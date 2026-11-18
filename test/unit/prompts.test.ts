import { describe, expect, it } from "vitest";
import { buildContext, draftPrompt, planPrompt, PLAN_SCHEMA, DRAFT_SCHEMA, AUDIT_SCHEMA, REFINE_SCHEMA } from "../../src/shared/prompts";
import { DEFAULT_SETTINGS } from "../../src/shared/store";
import { BUILT_IN_VOICES } from "../../src/shared/voices";
import type { Answer, PageField, Store } from "../../src/shared/types";

const a = (id: string, question: string, answer: string, extra: Partial<Answer> = {}): Answer => ({
  id, question, answer, projectId: null, source: "you", url: "", site: "jobs.example.com", pageTitle: "", captureKey: null, createdAt: 1, updatedAt: 1, ...extra,
});
const field = (i: number, question: string, extra: Partial<PageField> = {}): PageField => ({
  ref: `0:f${i}`, frameId: 0, fieldId: `f${i}`, question, kind: "textarea", inputType: "textarea", maxLength: null, value: "", ...extra,
});

const store: Store = {
  answers: {
    a1: a("a1", "Why do you want to work here?", "I build tools people use every day."),
    a2: a("a2", "What's your proudest result?", "Cut checkout time by 40%.", { source: "told", projectId: "p1" }),
    a3: a("a3", "Favourite food", "Laksa"),
  },
  projects: { p1: { id: "p1", name: "Acme", brief: "Senior engineer role", createdAt: 1 } },
  voices: {},
  settings: { ...DEFAULT_SETTINGS, aboutMe: "Sam, engineer" },
};

describe("buildContext", () => {
  const ctx = { store, fields: [field(0, "Why do you want to join Acme?", { maxLength: 500 })], project: store.projects.p1, voice: BUILT_IN_VOICES[1], page: { title: "Acme jobs", url: "https://acme.test/apply" } };

  it("includes the person, the project, what they told the agent and the closest past answers", () => {
    const c = buildContext(ctx);
    expect(c).toContain("Sam, engineer");
    expect(c).toContain("Senior engineer role");
    expect(c).toContain("Cut checkout time by 40%."); // told for this project: always in
    expect(c).toContain("I build tools people use every day."); // closest match
    expect(c).not.toContain("Laksa"); // unrelated, short: left out
  });

  it("labels fields F1.. with their limits, inside <field> tags", () => {
    expect(buildContext(ctx)).toContain("F1 [long answer, max 500 characters]\n<field>Why do you want to join Acme?</field>");
  });

  it("puts what they just told you into the draft prompt", () => {
    expect(draftPrompt(ctx, [{ question: "Which team?", answer: "Payments" }])).toContain("Q: Which team?\nA: Payments");
    expect(planPrompt(ctx)).toContain("At most 6 questions");
  });
});

describe("schemas", () => {
  // Codex's --output-schema needs the strict form: every property required, no extras.
  const strict = (s: any): void => {
    if (s.type === "object") {
      expect(s.additionalProperties).toBe(false);
      expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort());
      Object.values(s.properties).forEach(strict);
    }
    if (s.type === "array") strict(s.items);
  };
  it("are all strict", () => [PLAN_SCHEMA, DRAFT_SCHEMA, AUDIT_SCHEMA, REFINE_SCHEMA].forEach(strict));
});
