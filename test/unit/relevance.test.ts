import { describe, expect, it } from "vitest";
import { pastAnswerFor, rank, styleSamples } from "../../src/shared/relevance";
import type { Answer } from "../../src/shared/types";

let n = 0;
const ans = (question: string, answer: string, extra: Partial<Answer> = {}): Answer => ({
  id: `a${++n}`, question, answer, projectId: null, source: "you", url: "", site: "", pageTitle: "", captureKey: null,
  createdAt: n, updatedAt: n, ...extra,
});

describe("rank", () => {
  it("puts the answer to the closest question first", () => {
    const pool = [
      ans("What is your favorite programming language?", "TypeScript"),
      ans("Why do you want to work at our company?", "Because I love developer tools."),
      ans("Tell us about a time you led a project", "I led the payments rewrite."),
    ];
    const top = rank("Why do you want to join this company?", pool, 3);
    expect(top[0].answer.question).toContain("work at our company");
  });
  it("returns nothing for an empty query", () => expect(rank("", [ans("a", "b")], 5)).toEqual([]));
});

describe("pastAnswerFor", () => {
  it("offers your newest answer to the same question", () => {
    const pool = [ans("Your LinkedIn URL", "old", { updatedAt: 1 }), ans("LinkedIn URL", "new", { updatedAt: 99 }), ans("GitHub", "gh")];
    expect(pastAnswerFor("LinkedIn URL", pool)?.answer).toBe("new");
  });
  it("doesn't offer an answer to a different question", () => {
    expect(pastAnswerFor("Why this role?", [ans("Why this company?", "x")])).toBeNull();
  });
  it("doesn't offer things you told the agent as a form answer", () => {
    expect(pastAnswerFor("LinkedIn URL", [ans("LinkedIn URL", "x", { source: "told" })])).toBeNull();
  });
});

describe("styleSamples", () => {
  it("learns style only from your own writing, not kept drafts", () => {
    const long = "x".repeat(200);
    const pool = [ans("q1", long, { source: "you" }), ans("q2", long, { source: "agent" }), ans("q3", long, { source: "edited" }), ans("q4", "short")];
    expect(styleSamples(pool, new Set(), 10).map((a) => a.question).sort()).toEqual(["q1", "q3"]);
  });
});
