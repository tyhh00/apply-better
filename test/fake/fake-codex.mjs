#!/usr/bin/env node
// Stands in for `codex exec` in tests. Logs its flags, answers through the -o file.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("codex-cli 0.0.0-fake");
  process.exit(0);
}
if (process.env.APPLY_BETTER_FAKE_OLD_CODEX && args.includes("--disable")) {
  console.error("Error: Unknown feature flag: shell_tool");
  process.exit(1);
}
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  if (process.env.APPLY_BETTER_FAKE_LOG) appendFileSync(process.env.APPLY_BETTER_FAKE_LOG, JSON.stringify({ args, cwd: process.cwd(), input }) + "\n");
  const schema = JSON.parse(readFileSync(args[args.indexOf("--output-schema") + 1], "utf8"));
  const out = schema.required?.includes("text") ? { text: "Rewritten by Codex.", changes: ["Tighter"] } : { ok: true };
  writeFileSync(args[args.indexOf("-o") + 1], JSON.stringify(out));
});
