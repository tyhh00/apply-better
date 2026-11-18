#!/usr/bin/env node
// Stands in for the `claude` CLI in tests: same flags in, same JSON shape out.
// Writes the flags it was started with to $APPLY_BETTER_FAKE_LOG so tests can check them.
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("9.9.9 (Fake Claude)");
  process.exit(0);
}
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  if (process.env.APPLY_BETTER_FAKE_LOG) appendFileSync(process.env.APPLY_BETTER_FAKE_LOG, JSON.stringify({ args, cwd: process.cwd(), chars: input.length }) + "\n");
  const schema = JSON.parse(args[args.indexOf("--json-schema") + 1] ?? "{}");
  const keys = schema.required ?? [];
  let out;
  if (keys.includes("questions")) {
    // Ask one question per form unless the person already told us their proudest result.
    out = input.includes("proudest result")
      ? { questions: [] }
      : { questions: [{ question: "What's the proudest result you've shipped, with a number?", why: "Makes the impact answer concrete", fields: ["F2"], suggestions: ["Cut checkout time 40%"] }] };
  } else if (keys.includes("answers")) {
    const labels = [...input.matchAll(/^(F\d+) \[/gm)].map((m) => m[1]);
    const told = input.match(/## What they just told you for this form\nQ: .*\nA: (.*)/);
    out = { answers: labels.map((f) => ({ field: f, answer: `Draft for ${f}${told ? `, built on: ${told[1]}` : ""}.`, note: f === "F1" ? "Check the name" : "" })) };
  } else if (keys.includes("verdict")) {
    out = { verdict: "Clear, but it hides who made the call.", score: 6, issues: [{ quote: "we", problem: "Hides ownership", fix: "I" }] };
  } else if (keys.includes("text")) {
    out = { text: "I made the call and shipped it.", changes: ["Switched to first person"] };
  } else out = { ok: true };
  if (process.env.APPLY_BETTER_FAKE_FAIL) {
    console.log(JSON.stringify({ type: "result", is_error: true, result: "Not logged in · Please run /login" }));
    process.exit(1);
  }
  console.log(JSON.stringify({ type: "result", is_error: false, result: JSON.stringify(out), structured_output: out }));
});
