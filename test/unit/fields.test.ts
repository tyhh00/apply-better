// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { findFields, isSensitive, questionFor, type FieldEl } from "../../src/content/fields";

const el = (sel: string) => document.querySelector(sel) as FieldEl;

describe("questionFor", () => {
  beforeEach(() => (document.body.innerHTML = ""));

  it("reads a <label for>", () => {
    document.body.innerHTML = `<label for="why">Why do you want to join? *</label><textarea id="why"></textarea>`;
    expect(questionFor(el("#why"))).toBe("Why do you want to join?");
  });

  it("reads a wrapping label without the box's own text", () => {
    document.body.innerHTML = `<label>Your LinkedIn <input name="li" value="x"></label>`;
    expect(questionFor(el("input"))).toBe("Your LinkedIn");
  });

  it("prefers aria-labelledby and adds the description under it", () => {
    document.body.innerHTML = `<div id="t">Describe a hard problem</div><div id="d">Max 200 words</div><textarea aria-labelledby="t" aria-describedby="d"></textarea>`;
    expect(questionFor(el("textarea"))).toBe("Describe a hard problem — Max 200 words");
  });

  it("reads Google-Forms-style blocks with no label at all", () => {
    document.body.innerHTML = `
      <div role="listitem"><div><div role="heading">What's your biggest win? <span>*</span></div><div>One paragraph</div></div>
        <div><div><textarea></textarea></div></div></div>
      <div role="listitem"><div role="heading">Anything else?</div><div><input type="text"></div></div>`;
    const [a, b] = findFields(document);
    expect(questionFor(a)).toBe("What's your biggest win? * One paragraph");
    expect(questionFor(b)).toBe("Anything else?");
  });

  it("falls back to the placeholder, then the name", () => {
    document.body.innerHTML = `<div><input placeholder="Company website"></div><div><input name="current_company"></div>`;
    const [a, b] = findFields(document);
    // The two boxes share no block, so each reads its own.
    expect(questionFor(a)).toBe("Company website");
    expect(questionFor(b)).toBe("current company");
  });
});

describe("what gets saved", () => {
  it("never treats passwords, codes or card numbers as answers", () => {
    document.body.innerHTML = `
      <input type="password" id="p">
      <input id="otp" autocomplete="one-time-code">
      <label for="cc">Card number</label><input id="cc">
      <label for="ok">Portfolio link</label><input id="ok">`;
    expect(isSensitive(el("#p"), "")).toBe(true);
    expect(isSensitive(el("#otp"), "")).toBe(true);
    expect(isSensitive(el("#cc"), questionFor(el("#cc")))).toBe(true);
    expect(isSensitive(el("#ok"), questionFor(el("#ok")))).toBe(false);
  });

  it("finds text boxes and rich editors, and skips checkboxes, hidden and read-only boxes", () => {
    document.body.innerHTML = `
      <input type="text" id="a"><input type="email" id="b"><textarea id="c"></textarea>
      <div contenteditable="true" id="d"><p contenteditable="true">nested</p></div>
      <input type="checkbox"><input type="hidden"><input type="file"><input readonly id="r"><input disabled>`;
    expect(findFields(document).map((f) => f.id)).toEqual(["a", "b", "c", "d"]);
  });
});
