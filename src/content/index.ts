// Runs only on sites you turned on. Saves what you type into form boxes and what you
// pick in radio buttons, checkboxes and dropdowns, and lets the side panel read the
// form and put drafts back into it. It never submits anything.
import { fieldKind, fieldSignature, fieldValue, findFields, isSensitive, isTextField, questionFor, type FieldEl } from "./fields";
import { choiceValue, choose, findChoiceGroups, optionsOf, questionForGroup, type ChoiceGroup } from "./choices";
import { joinPicks, pickOptions } from "../shared/options";
import type { AnswerSource, CapturePayload, FieldKind } from "../shared/types";

declare global {
  interface Window {
    __applyBetter?: ApplyBetterPage;
  }
}

export interface ScannedField {
  fieldId: string;
  question: string;
  kind: FieldKind;
  inputType: string;
  maxLength: number | null;
  value: string;
  /** The choices, for radio buttons, checkboxes and dropdowns. */
  options: string[] | null;
}

interface ApplyBetterPage {
  version: number;
  scan(): ScannedField[];
  insert(fieldId: string, value: string): boolean;
  focus(fieldId: string): boolean;
}

const DEBOUNCE_MS = 1200;
const CHOICE_SETTLE_MS = 200;

const VERSION = 2;

// A page left open across an extension update still has the old copy; let the new one take over
// (the old copy stops itself as soon as it can't reach the extension).
if (!window.__applyBetter || window.__applyBetter.version < VERSION) {
  const ids = new WeakMap<Element, string>();
  const textById = new Map<string, FieldEl>();
  const choiceById = new Map<string, Element>();
  const questions = new WeakMap<Element, string>();
  const inserted = new WeakMap<Element, string>();
  const timers = new Map<Element, number>();
  const lastChoice = new WeakMap<Element, string>();
  let counter = 0;
  let stopped = false;

  const idFor = (el: Element) => {
    let id = ids.get(el);
    if (!id) {
      id = `f${++counter}`;
      ids.set(el, id);
    }
    return id;
  };

  const questionOf = (el: FieldEl) => {
    let q = questions.get(el);
    if (!q) {
      q = questionFor(el);
      questions.set(el, q);
    }
    return q;
  };

  const questionOfGroup = (g: ChoiceGroup) => {
    let q = questions.get(g.container);
    if (!q) {
      q = questionForGroup(g);
      questions.set(g.container, q);
    }
    return q;
  };

  const sourceFor = (el: Element, answer: string, same: (a: string, b: string) => boolean): AnswerSource => {
    const mine = inserted.get(el);
    return mine === undefined ? "you" : same(mine, answer) ? "agent" : "edited";
  };

  const send = (payload: CapturePayload) => {
    chrome.runtime.sendMessage({ type: "capture", payload }).then(
      (res: { ok: boolean; error?: string } | undefined) => {
        // The site was turned off while this page was open: stop listening.
        if (res && !res.ok && res.error === "site-off") stopped = true;
      },
      () => {
        // The extension was reloaded or removed; this copy of the script is orphaned.
        stopped = true;
      },
    );
  };

  const page = () => ({ url: location.href, site: location.hostname, pageTitle: document.title });

  // ---------- text boxes ----------

  const targetField = (e: Event): FieldEl | null => {
    for (const n of e.composedPath()) {
      if (n instanceof Element && isTextField(n)) return n;
      if (n === document) break;
    }
    return null;
  };

  const capture = (el: FieldEl) => {
    timers.delete(el);
    if (stopped || !el.isConnected) return;
    const answer = fieldValue(el).trim();
    if (!answer) return;
    const question = questionOf(el);
    if (isSensitive(el, question)) return;
    send({
      question,
      answer,
      ...page(),
      captureKey: `${location.origin}${location.pathname}#${fieldSignature(el, question)}`,
      source: sourceFor(el, answer, (a, b) => a.trim() === b),
    });
  };

  const schedule = (el: FieldEl) => {
    const t = timers.get(el);
    if (t) clearTimeout(t);
    timers.set(el, window.setTimeout(() => capture(el), DEBOUNCE_MS));
  };

  const flush = (el: FieldEl) => {
    const t = timers.get(el);
    if (t === undefined) return;
    clearTimeout(t);
    capture(el);
  };

  const flushAll = () => [...timers.keys()].forEach((el) => flush(el as FieldEl));

  // ---------- choices ----------
  // Sites change radios, checkboxes and dropdowns in many ways (hidden inputs under
  // custom styling, select2 setting a hidden <select> without an event, ARIA widgets
  // with no input at all), so rather than trust any one event, re-read every choice
  // right before and right after you click or type, and save what changed.

  const canon = (v: string) => v.split("; ").filter(Boolean).sort().join("; ");

  const baseline = () => {
    for (const g of findChoiceGroups(document)) if (!lastChoice.has(g.container)) lastChoice.set(g.container, choiceValue(g));
  };

  const sweep = () => {
    if (stopped) return;
    for (const g of findChoiceGroups(document)) {
      const value = choiceValue(g);
      const prev = lastChoice.get(g.container);
      lastChoice.set(g.container, value);
      if (prev === undefined || prev === value || !value) continue;
      const question = questionOfGroup(g);
      send({
        question,
        answer: value,
        ...page(),
        captureKey: `${location.origin}${location.pathname}#choice|${g.name}|${question.toLowerCase().slice(0, 120)}`,
        source: sourceFor(g.container, value, (a, b) => canon(a) === canon(b)),
      });
    }
  };

  let sweepTimer: number | undefined;
  const sweepSoon = () => {
    clearTimeout(sweepTimer);
    sweepTimer = window.setTimeout(sweep, CHOICE_SETTLE_MS);
  };

  // ---------- listeners ----------

  document.addEventListener(
    "input",
    (e) => {
      const el = targetField(e);
      if (el) schedule(el);
      else sweepSoon();
    },
    true,
  );
  document.addEventListener(
    "focusout",
    (e) => {
      const el = targetField(e);
      if (el) flush(el);
    },
    true,
  );
  document.addEventListener("pointerdown", baseline, true);
  document.addEventListener("keydown", baseline, true);
  document.addEventListener("click", sweepSoon, true);
  document.addEventListener("change", sweepSoon, true);
  document.addEventListener("keyup", sweepSoon, true);
  document.addEventListener("submit", () => (flushAll(), sweep()), true);
  window.addEventListener("pagehide", () => (flushAll(), sweep()));
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && (flushAll(), sweep()));
  // Whatever was already picked when the page loaded is the site's default, not your answer.
  baseline();

  // ---------- the side panel's view of the form ----------

  const setValue = (el: FieldEl, value: string) => {
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      // Rich editors listen for real text input, so select everything and type over it.
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      if (!document.execCommand("insertText", false, value)) {
        el.textContent = value;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      }
    }
    el.blur();
  };

  const groupFor = (id: string) => {
    const box = choiceById.get(id);
    return box ? (findChoiceGroups(document).find((g) => g.container === box) ?? null) : null;
  };

  const outline = (el: Element) => {
    const h = el as HTMLElement;
    h.scrollIntoView({ behavior: "smooth", block: "center" });
    const prev = h.style.outline;
    h.style.outline = "2px solid #141414";
    h.style.outlineOffset = "2px";
    setTimeout(() => (h.style.outline = prev), 1400);
  };

  const position = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

  window.__applyBetter = {
    version: VERSION,
    scan() {
      const texts = findFields(document)
        .map((el): [Element, ScannedField] | null => {
          const question = questionOf(el);
          if (isSensitive(el, question)) return null;
          const id = idFor(el);
          textById.set(id, el);
          const max = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.maxLength : -1;
          return [
            el,
            {
              fieldId: id,
              question,
              kind: fieldKind(el),
              inputType: el instanceof HTMLInputElement ? el.type : el instanceof HTMLTextAreaElement ? "textarea" : "rich",
              maxLength: max > 0 ? max : null,
              value: fieldValue(el),
              options: null,
            },
          ];
        })
        .filter((x): x is [Element, ScannedField] => !!x);
      const choices = findChoiceGroups(document).map((g): [Element, ScannedField] => {
        const id = idFor(g.container);
        choiceById.set(id, g.container);
        return [
          g.container,
          { fieldId: id, question: questionOfGroup(g), kind: g.kind, inputType: g.type, maxLength: null, value: choiceValue(g), options: optionsOf(g).map((o) => o.label) },
        ];
      });
      return [...texts, ...choices].sort((a, b) => position(a[0], b[0])).map(([, f]) => f);
    },
    insert(fieldId, value) {
      const el = textById.get(fieldId);
      if (el?.isConnected) {
        inserted.set(el, value);
        setValue(el, value);
        flush(el);
        return true;
      }
      const g = groupFor(fieldId);
      if (!g) return false;
      baseline();
      const picks = pickOptions(value, optionsOf(g).map((o) => o.label), g.kind === "multi");
      if (!picks || !choose(g, value)) return false;
      // Some widgets update a moment later, so remember what was asked for, not what's shown yet.
      inserted.set(g.container, canon(joinPicks(picks)));
      sweepSoon();
      return true;
    },
    focus(fieldId) {
      const el = textById.get(fieldId) ?? groupFor(fieldId)?.container;
      if (!el?.isConnected) return false;
      outline(el);
      return true;
    },
  };
}
