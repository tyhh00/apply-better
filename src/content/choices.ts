// Questions you answer by picking: radio buttons, checkboxes and dropdowns.
// Covers real <input>/<select> elements (even when a site hides them under custom
// styling, like Zoho Forms) and ARIA widgets with no input at all (like Google Forms).
// Pure DOM, so it runs under unit tests too.
import { byIds, clean, isTextField, textOutsideControls } from "./fields";
import { pickOptions } from "../shared/options";

export type ChoiceKind = "single" | "multi" | "select";

export interface ChoiceGroup {
  type: "radio" | "checkbox" | "aria-radio" | "aria-checkbox" | "select" | "listbox";
  kind: ChoiceKind;
  /** The element that holds the whole question's options. */
  container: Element;
  /** Native inputs of the group (radio / checkbox only). */
  inputs: HTMLInputElement[];
  /** The <select> or [role=listbox] (select / listbox only). */
  el: Element | null;
  name: string;
}

export interface ChoiceOption {
  label: string;
  selected: boolean;
  el: Element;
}

const doc = (el: Element) => el.ownerDocument;

function rendered(el: Element): boolean {
  if (typeof (el as HTMLElement).getClientRects !== "function" || navigator.userAgent.includes("HappyDOM")) return true;
  if (el.closest("[hidden], [aria-hidden='true']")) return false;
  const st = getComputedStyle(el);
  return st.display !== "none" && st.visibility !== "hidden" && el.getClientRects().length > 0;
}

function commonAncestor(els: Element[]): Element {
  let box = els[0].parentElement ?? els[0];
  while (box.parentElement && !els.every((e) => box.contains(e))) box = box.parentElement;
  return box;
}

/** True when `box` holds no form control besides `mine`. */
function holdsOnly(box: Element, mine: Element[]): boolean {
  return [...box.querySelectorAll("input:not([type='hidden']), textarea, select, [role='radio'], [role='checkbox'], [role='listbox'], [contenteditable]")].every(
    (x) => mine.includes(x) || mine.some((m) => m.contains(x)),
  );
}

/** The element wrapping one question's options: a radiogroup or fieldset if it's only theirs. */
function holder(inputs: HTMLInputElement[]): Element {
  const named = inputs[0].closest("[role='radiogroup'], [role='group'], fieldset");
  return named && inputs.every((i) => named.contains(i)) && holdsOnly(named, inputs) ? named : commonAncestor(inputs);
}

function textOf(el: Element): string {
  return clean(el.getAttribute("aria-label") || (el as HTMLElement).dataset?.value || (el as HTMLElement).dataset?.answerValue || el.textContent || "");
}

function inputLabel(i: HTMLInputElement): string {
  const d = doc(i);
  const byFor = i.id ? d.querySelector(`label[for="${CSS.escape(i.id)}"]`) : null;
  return clean(
    (byFor && textOutsideControls(byFor)) || (i.closest("label") && textOutsideControls(i.closest("label")!)) || i.getAttribute("aria-label") || i.value || "",
  );
}

const PLACEHOLDER = /^[-–—\s]*(select|choose|please select|pick|select an option|--)\b.*$/i;

export function optionsOf(g: ChoiceGroup): ChoiceOption[] {
  switch (g.type) {
    case "radio":
    case "checkbox":
      return g.inputs.map((i) => ({ label: inputLabel(i), selected: i.checked, el: i }));
    case "aria-radio":
      return [...g.container.querySelectorAll("[role='radio']")].map((el) => ({ label: textOf(el), selected: el.getAttribute("aria-checked") === "true", el }));
    case "aria-checkbox":
      return [...g.container.querySelectorAll("[role='checkbox']")]
        .filter((el) => !(el instanceof HTMLInputElement))
        .map((el) => ({ label: textOf(el), selected: el.getAttribute("aria-checked") === "true", el }));
    case "select":
      return [...(g.el as HTMLSelectElement).options]
        .filter((o) => o.value !== "" && o.textContent?.trim() && !PLACEHOLDER.test(o.textContent.trim()))
        .map((o) => ({ label: clean(o.textContent ?? ""), selected: o.selected, el: o }));
    case "listbox":
      return [...g.el!.querySelectorAll("[role='option']")]
        .filter((o) => (o as HTMLElement).dataset.value !== "" && !PLACEHOLDER.test(textOf(o)) && textOf(o))
        .map((o) => ({ label: textOf(o), selected: o.getAttribute("aria-selected") === "true", el: o }));
  }
}

export function choiceValue(g: ChoiceGroup): string {
  return optionsOf(g)
    .filter((o) => o.selected)
    .map((o) => o.label)
    .join("; ");
}

export function findChoiceGroups(d: Document): ChoiceGroup[] {
  const groups: ChoiceGroup[] = [];

  // Real radio buttons and checkboxes, grouped by name within their form
  // (unnamed ones by the box they sit in, or on their own).
  const byKey = new Map<string, HTMLInputElement[]>();
  const formIds = new Map<HTMLFormElement | null, number>();
  const boxIds = new Map<Element, number>();
  let solo = 0;
  for (const i of d.querySelectorAll<HTMLInputElement>("input[type='radio'], input[type='checkbox']")) {
    if (i.disabled) continue;
    if (!formIds.has(i.form)) formIds.set(i.form, formIds.size);
    const box = i.closest("[role='radiogroup'], [role='group']");
    let key: string;
    if (i.name) key = `${i.type}|${formIds.get(i.form)}|${i.name}`;
    else if (box) {
      if (!boxIds.has(box)) boxIds.set(box, boxIds.size);
      key = `${i.type}|box|${boxIds.get(box)}`;
    } else key = `${i.type}|solo|${++solo}`;
    byKey.set(key, [...(byKey.get(key) ?? []), i]);
  }
  for (const [key, inputs] of byKey) {
    const type = key.startsWith("radio") ? "radio" : "checkbox";
    if (!inputs.some((i) => rendered(i) || rendered(i.closest("label") ?? i.parentElement ?? i))) continue;
    groups.push({ type, kind: type === "radio" ? "single" : "multi", container: holder(inputs), inputs, el: null, name: inputs[0].name });
  }

  // ARIA radio groups and checkboxes with no real inputs (Google Forms and others).
  for (const rg of d.querySelectorAll("[role='radiogroup']")) {
    if (rg.querySelector("input[type='radio']") || !rg.querySelector("[role='radio']") || !rendered(rg)) continue;
    groups.push({ type: "aria-radio", kind: "single", container: rg, inputs: [], el: null, name: "" });
  }
  const ariaBoxes = new Map<Element, true>();
  for (const cb of d.querySelectorAll("[role='checkbox']")) {
    if (cb instanceof HTMLInputElement || cb.querySelector("input[type='checkbox']")) continue;
    const box = cb.closest("[role='group'], [role='list'], fieldset") ?? cb.parentElement?.parentElement ?? cb.parentElement;
    if (box && !ariaBoxes.has(box) && rendered(cb)) {
      ariaBoxes.set(box, true);
      groups.push({ type: "aria-checkbox", kind: "multi", container: box, inputs: [], el: null, name: "" });
    }
  }

  // Dropdowns. A <select> hidden under a custom widget (select2, Choices…) still counts.
  for (const s of d.querySelectorAll("select")) {
    if (s.disabled) continue;
    const widget = s.parentElement?.querySelector("[role='combobox']");
    if (!rendered(s) && !(widget && rendered(widget))) continue;
    const g: ChoiceGroup = { type: "select", kind: s.multiple ? "multi" : "select", container: s, inputs: [], el: s, name: s.name };
    if (optionsOf(g).length) groups.push(g);
  }
  for (const lb of d.querySelectorAll("[role='listbox']")) {
    if (lb.closest(".select2-container") || lb instanceof HTMLSelectElement || !rendered(lb)) continue;
    const g: ChoiceGroup = { type: "listbox", kind: "select", container: lb, inputs: [], el: lb, name: "" };
    if (optionsOf(g).length) groups.push(g);
  }
  return groups;
}

/** The question a group of options answers. */
export function questionForGroup(g: ChoiceGroup): string {
  const d = doc(g.container);
  const target = g.el ?? g.container;
  for (const el of [g.container, target]) {
    const ids = el.getAttribute("aria-labelledby");
    const t = ids ? byIds(ids, d) : "";
    if (t) return t;
    const aria = clean(el.getAttribute("aria-label") ?? "");
    if (aria) return aria;
  }
  if (target instanceof HTMLSelectElement && target.id) {
    const label = d.querySelector(`label[for="${CSS.escape(target.id)}"]`);
    const t = label ? textOutsideControls(label) : "";
    if (t) return t;
  }
  const fieldset = g.container.closest("fieldset");
  const legend = fieldset?.querySelector(":scope > legend");
  if (fieldset && legend?.textContent?.trim() && holdsOnly(fieldset, [...g.inputs, ...(g.el ? [g.el] : [g.container])])) return clean(legend.textContent);

  // Climb to the block that holds only this question, and read it without the option labels.
  const optionLabels = new Set<Element>(
    g.inputs.flatMap((i) => [i.closest("label"), i.id ? d.querySelector(`label[for="${CSS.escape(i.id)}"]`) : null].filter((x): x is Element => !!x)),
  );
  // Never read the options themselves (or a dropdown's own text) as the question.
  const skip = new Set<Element>([...optionLabels, ...(g.el ? [g.el] : [])]);
  const mine = new Set<Element>([...g.inputs, ...(g.el ? [g.el] : []), ...optionsOf(g).map((o) => o.el)]);
  let node: Element | null = g.container;
  for (let depth = 0; node && depth < 6 && node !== d.body; depth++, node = node.parentElement) {
    const others = [...node.querySelectorAll("input, textarea, select, [role='radio'], [role='checkbox'], [role='listbox'], [contenteditable]")].filter(
      (x) => !mine.has(x) && !g.container.contains(x) && (isTextField(x) || x.matches("input[type='radio'], input[type='checkbox'], select, [role]")),
    );
    if (others.length) break;
    const t = textOutsideControls(node, skip);
    if (t) return t;
  }
  return clean(g.name.replace(/[_\-.]+/g, " ")) || "Untitled question";
}

function press(el: Element) {
  const o = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new PointerEvent("pointerdown", o));
  el.dispatchEvent(new MouseEvent("mousedown", o));
  el.dispatchEvent(new PointerEvent("pointerup", o));
  el.dispatchEvent(new MouseEvent("mouseup", o));
  (el as HTMLElement).click();
}

/** Picks the options `value` names. Returns false if they aren't all on the form. */
export function choose(g: ChoiceGroup, value: string): boolean {
  const options = optionsOf(g);
  const picks = pickOptions(value, options.map((o) => o.label), g.kind === "multi");
  if (!picks) return false;
  const want = (o: ChoiceOption) => picks.includes(o.label);
  switch (g.type) {
    case "radio":
    case "aria-radio": {
      const o = options.find(want)!;
      if (!o.selected) (g.type === "radio" ? (o.el as HTMLElement).click() : press(o.el));
      break;
    }
    case "checkbox":
    case "aria-checkbox":
      for (const o of options) if (want(o) !== o.selected) g.type === "checkbox" ? (o.el as HTMLElement).click() : press(o.el);
      break;
    case "select": {
      const s = g.el as HTMLSelectElement;
      for (const o of options) (o.el as HTMLOptionElement).selected = want(o);
      s.dispatchEvent(new Event("input", { bubbles: true }));
      s.dispatchEvent(new Event("change", { bubbles: true }));
      break;
    }
    case "listbox": {
      press(g.el!); // open it, then pick
      const o = optionsOf(g).find(want);
      if (o) press(o.el);
      break;
    }
  }
  return true;
}
