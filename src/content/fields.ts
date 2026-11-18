// Finds answerable boxes on a page and the question each one belongs to.
// Pure DOM, no chrome.* calls, so it runs under unit tests too.

export type FieldEl = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

const TEXT_INPUT_TYPES = new Set(["", "text", "email", "url", "tel", "number", "search"]);
const SENSITIVE = /pass(word|code)?|\bpwd\b|otp|one.?time|2fa|verification.?code|cvv|cvc|security.?code|card.?(number|no)|credit.?card|\bssn\b|social.?security|routing|iban|account.?number|\bpin\b/i;
// Text inside these is an answer or an option, never part of a question.
export const CONTROL_SELECTOR =
  "input, textarea, select, button, [contenteditable=''], [contenteditable='true'], [role='textbox'], [role='radio'], [role='checkbox'], [role='option'], [role='listbox'], [role='combobox']";

export function isTextField(el: Element): el is FieldEl {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement)
    // A dropdown widget's own search box (select2 and friends) is not a question.
    return TEXT_INPUT_TYPES.has((el.getAttribute("type") ?? "").toLowerCase()) && !el.closest(".select2-container, [role='listbox']");
  if (el instanceof HTMLElement) {
    const ce = el.getAttribute("contenteditable");
    if (ce === "" || ce === "true" || ce === "plaintext-only") return !el.parentElement?.closest("[contenteditable='true'], [contenteditable='']");
    if (el.getAttribute("role") === "textbox") return true;
  }
  return false;
}

/** Never touch passwords, one-time codes or payment details. */
export function isSensitive(el: FieldEl, question: string): boolean {
  if (el instanceof HTMLInputElement && el.type === "password") return true;
  const ac = el.getAttribute("autocomplete") ?? "";
  if (/cc-|one-time-code|password/.test(ac)) return true;
  const hay = [el.getAttribute("name"), el.id, el.getAttribute("aria-label"), el.getAttribute("placeholder"), question]
    .filter(Boolean)
    .join(" ");
  return SENSITIVE.test(hay);
}

export function fieldKind(el: FieldEl): "text" | "textarea" | "rich" {
  if (el instanceof HTMLTextAreaElement) return "textarea";
  if (el instanceof HTMLInputElement) return "text";
  return "rich";
}

export function fieldValue(el: FieldEl): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
  return (el.innerText ?? el.textContent ?? "").replace(/ /g, " ");
}

export function clean(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\s*\*\s*$/, "")
    .replace(/\s*\(?required\)?\s*$/i, "")
    .trim()
    .slice(0, 500);
}

/** Visible text under `root`, skipping form controls and hidden parts. */
export function textOutsideControls(root: Element, skip?: Set<Element>): string {
  if (skip?.has(root)) return "";
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node.textContent ?? "");
      return;
    }
    if (!(node instanceof Element) || skip?.has(node)) return;
    if (node.matches(CONTROL_SELECTOR) || node.matches("script, style, noscript, svg, template, [hidden], [aria-hidden='true']"))
      return;
    if (node instanceof HTMLElement && node.style?.display === "none") return;
    node.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return clean(out.join(" "));
}

export function byIds(ids: string, doc: Document): string {
  return clean(
    ids
      .split(/\s+/)
      .map((id) => doc.getElementById(id))
      .filter((n): n is HTMLElement => !!n)
      .map((n) => textOutsideControls(n) || n.textContent || "")
      .join(" "),
  );
}

function humanize(name: string): string {
  return clean(
    name
      .replace(/\[|\]/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_\-.]+/g, " "),
  );
}

/** The question a box answers, by the same clues a person would read. */
export function questionFor(el: FieldEl, doc: Document = el.ownerDocument): string {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const t = byIds(labelledBy, doc);
    if (t) return withHint(el, t, doc);
  }
  if (el.id) {
    const label = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const t = label ? textOutsideControls(label) : "";
    if (t) return withHint(el, t, doc);
  }
  const wrap = el.closest("label");
  if (wrap) {
    const t = textOutsideControls(wrap);
    if (t) return withHint(el, t, doc);
  }
  const aria = clean(el.getAttribute("aria-label") ?? "");
  if (aria) return withHint(el, aria, doc);

  // No label: climb to the nearest block that holds only this box, and read it.
  let node: Element | null = el.parentElement;
  for (let depth = 0; node && depth < 8 && node !== doc.body; depth++, node = node.parentElement) {
    const boxes = [...node.querySelectorAll("input, textarea, [contenteditable], [role='textbox']")].filter(isTextField);
    if (boxes.length > 1) break;
    const t = textOutsideControls(node);
    if (t) return t;
  }
  // Last resort: what's written right before it.
  const prev = previousText(el);
  if (prev) return prev;
  return clean(el.getAttribute("placeholder") ?? "") || humanize(el.getAttribute("name") ?? "") || "Untitled question";
}

/** Adds a description or placeholder that sits under the label, like "Max 200 words". */
function withHint(el: FieldEl, label: string, doc: Document): string {
  const describedBy = el.getAttribute("aria-describedby");
  const hint = describedBy ? byIds(describedBy, doc) : "";
  const ph = clean(el.getAttribute("placeholder") ?? "");
  const extra = [hint, ph && ph !== label ? ph : ""].filter((s) => s && !label.includes(s));
  return clean([label, ...extra].join(" — "));
}

function previousText(el: Element): string {
  let n: Element | null = el;
  for (let i = 0; n && i < 4; i++, n = n.parentElement) {
    let sib = n.previousElementSibling;
    while (sib) {
      const t = textOutsideControls(sib);
      if (t) return t;
      sib = sib.previousElementSibling;
    }
  }
  return "";
}

/** A signature that stays the same when you come back to the same form. */
export function fieldSignature(el: FieldEl, question: string): string {
  const name = el.getAttribute("name") || el.id || "";
  return `${name}|${question.toLowerCase().slice(0, 120)}`;
}

export function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest("[hidden], [aria-hidden='true']")) return false;
  // happy-dom has no layout; treat everything as visible there.
  if (typeof el.getClientRects !== "function" || navigator.userAgent.includes("HappyDOM")) return true;
  const style = getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  return el.getClientRects().length > 0;
}

export function findFields(root: Document): FieldEl[] {
  return [...root.querySelectorAll("input, textarea, [contenteditable], [role='textbox']")]
    .filter(isTextField)
    .filter((el) => !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || (!el.disabled && !el.readOnly))
    .filter(isVisible);
}
