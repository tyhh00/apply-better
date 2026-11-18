import { describe, expect, it } from "vitest";
import { applyOp, DEFAULT_SETTINGS } from "../../src/shared/store";
import type { Store } from "../../src/shared/types";

const empty = (): Store => ({ answers: {}, projects: {}, voices: {}, settings: { ...DEFAULT_SETTINGS } });

describe("applyOp", () => {
  it("updates an answer in place and keeps when it was first written", () => {
    let s = empty();
    const first = applyOp(s, { op: "upsertAnswer", answer: { question: "Q", answer: "A1", source: "you" } });
    s = first.store;
    const id = (first.result as { id: string }).id;
    const created = s.answers[id].createdAt;
    s = applyOp(s, { op: "upsertAnswer", answer: { id, question: "Q", answer: "A2" } }).store;
    expect(Object.keys(s.answers)).toHaveLength(1);
    expect(s.answers[id]).toMatchObject({ answer: "A2", source: "you", createdAt: created });
  });

  it("deleting a project keeps its answers and clears the active project", () => {
    let s = empty();
    const p = applyOp(s, { op: "saveProject", project: { name: "YC" } });
    s = p.store;
    const pid = (p.result as { id: string }).id;
    s = applyOp(s, { op: "settings", patch: { activeProjectId: pid } }).store;
    s = applyOp(s, { op: "upsertAnswer", answer: { question: "Q", answer: "A", projectId: pid } }).store;
    s = applyOp(s, { op: "deleteProject", id: pid }).store;
    expect(Object.values(s.answers)[0].projectId).toBeNull();
    expect(s.settings.activeProjectId).toBeNull();
  });

  it("deleting the voice you use falls back to your own voice", () => {
    let s = empty();
    const v = applyOp(s, { op: "saveVoice", voice: { name: "Mine", instructions: "x" } });
    s = applyOp(v.store, { op: "settings", patch: { voiceId: (v.result as { id: string }).id } }).store;
    s = applyOp(s, { op: "deleteVoice", id: (v.result as { id: string }).id }).store;
    expect(s.settings.voiceId).toBe("own");
  });
});
