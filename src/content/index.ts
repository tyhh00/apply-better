// Runs only on sites you turned on. Saves what you type into form boxes, and lets
// the side panel read the form and put drafts back into it. It never submits anything.
import { fieldKind, fieldSignature, fieldValue, findFields, isSensitive, isTextField, questionFor, type FieldEl } from "./fields";
import type { AnswerSource, CapturePayload } from "../shared/types";

declare global {
  interface Window {
    __applyBetter?: ApplyBetterPage;
  }
}

export interface ScannedField {
  fieldId: string;
  question: string;
  kind: "text" | "textarea" | "rich";
  inputType: string;
  maxLength: number | null;
  value: string;
}

interface ApplyBetterPage {
  version: number;
  scan(): ScannedField[];
  insert(fieldId: string, value: string): boolean;
  focus(fieldId: string): boolean;
}

const DEBOUNCE_MS = 1200;

if (!window.__applyBetter) {
  const ids = new WeakMap<Element, string>();
  const byId = new Map<string, FieldEl>();
  const questions = new WeakMap<Element, string>();
  const inserted = new WeakMap<Element, string>();
  const timers = new Map<Element, number>();
  let counter = 0;
  let stopped = false;

  const idFor = (el: FieldEl) => {
    let id = ids.get(el);
    if (!id) {
      id = `f${++counter}`;
      ids.set(el, id);
      byId.set(id, el);
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
    const mine = inserted.get(el);
    const source: AnswerSource = mine === undefined ? "you" : mine.trim() === answer ? "agent" : "edited";
    const payload: CapturePayload = {
      question,
      answer,
      url: location.href,
      site: location.hostname,
      pageTitle: document.title,
      captureKey: `${location.origin}${location.pathname}#${fieldSignature(el, question)}`,
      source,
    };
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

  document.addEventListener(
    "input",
    (e) => {
      const el = targetField(e);
      if (el) schedule(el);
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
  document.addEventListener("submit", flushAll, true);
  window.addEventListener("pagehide", flushAll);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushAll());

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

  window.__applyBetter = {
    version: 1,
    scan() {
      return findFields(document)
        .map((el) => {
          const question = questionOf(el);
          if (isSensitive(el, question)) return null;
          const max = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.maxLength : -1;
          return {
            fieldId: idFor(el),
            question,
            kind: fieldKind(el),
            inputType: el instanceof HTMLInputElement ? el.type : el instanceof HTMLTextAreaElement ? "textarea" : "rich",
            maxLength: max > 0 ? max : null,
            value: fieldValue(el),
          };
        })
        .filter((f): f is ScannedField => !!f);
    },
    insert(fieldId, value) {
      const el = byId.get(fieldId);
      if (!el?.isConnected) return false;
      inserted.set(el, value);
      setValue(el, value);
      flush(el);
      return true;
    },
    focus(fieldId) {
      const el = byId.get(fieldId);
      if (!el?.isConnected) return false;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const prev = el.style.outline;
      el.style.outline = "2px solid #141414";
      el.style.outlineOffset = "2px";
      setTimeout(() => (el.style.outline = prev), 1400);
      return true;
    },
  };
}
