// The four things the side panel asks your agent to do.
import { send } from "../shared/messages";
import {
  AUDIT_SCHEMA,
  DRAFT_SCHEMA,
  PLAN_SCHEMA,
  REFINE_SCHEMA,
  SYSTEM,
  auditPrompt,
  draftPrompt,
  planPrompt,
  refinePrompt,
  type FillContext,
} from "../shared/prompts";
import type { AuditResult, DraftAnswer, GapQuestion, RefineResult, Voice } from "../shared/types";

export class Run {
  readonly id = crypto.randomUUID();
  cancel() {
    send({ type: "agent:cancel", runId: this.id }).catch(() => {});
  }
}

async function ask<T>(run: Run, prompt: string, schema: object): Promise<T> {
  const res = await send<{ json: T | null; text: string }>({ type: "agent:run", runId: run.id, system: SYSTEM, prompt, schema });
  if (!res.json) throw new Error("Your agent answered, but not in the shape apply better expects. Try again.");
  return res.json;
}

export const plan = (run: Run, c: FillContext) =>
  ask<{ questions: GapQuestion[] }>(run, planPrompt(c), PLAN_SCHEMA).then((r) => r.questions ?? []);

export const draft = (run: Run, c: FillContext, told: { question: string; answer: string }[]) =>
  ask<{ answers: DraftAnswer[] }>(run, draftPrompt(c, told), DRAFT_SCHEMA).then((r) => r.answers ?? []);

export const audit = (run: Run, text: string, voice: Voice, question: string) =>
  ask<AuditResult>(run, auditPrompt(text, voice, question), AUDIT_SCHEMA);

export const refine = (run: Run, text: string, voice: Voice, question: string, maxLength: number | null) =>
  ask<RefineResult>(run, refinePrompt(text, voice, question, maxLength), REFINE_SCHEMA);
