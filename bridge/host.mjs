// The apply-better bridge: a Chrome native messaging host.
// Chrome starts it when the extension connects, and only the extension IDs listed
// in its manifest can reach it. It speaks Chrome's framing on stdin/stdout:
// a 4-byte little-endian length, then that many bytes of JSON.
import { appendFileSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS, agentVersion, resolveAgent, runAgent } from "./agents.mjs";
import { decoder, encode } from "./framing.mjs";

const HOME = process.env.APPLY_BETTER_HOME || path.join(os.homedir(), ".apply-better");
const LOG = path.join(HOME, "bridge.log");
const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8")).version;

function log(...parts) {
  try {
    mkdirSync(HOME, { recursive: true });
    try {
      if (statSync(LOG).size > 1_000_000) writeFileSync(LOG, "");
    } catch {}
    appendFileSync(LOG, `${new Date().toISOString()} ${parts.join(" ")}\n`);
  } catch {}
}

function loadConfig() {
  try {
    return JSON.parse(readFileSync(path.join(HOME, "bridge.json"), "utf8"));
  } catch {
    return {};
  }
}

function reply(obj) {
  process.stdout.write(encode(obj));
}

const children = new Map();

async function handle(msg) {
  const config = loadConfig();
  if (msg.type === "hello") {
    const agents = {};
    for (const kind of AGENTS) {
      const bin = resolveAgent(kind, config);
      agents[kind] = bin ? { path: bin, version: await agentVersion(bin, config) } : null;
    }
    return reply({ id: msg.id, ok: true, type: "hello", version: VERSION, agents });
  }
  if (msg.type === "cancel") {
    children.get(msg.target)?.kill("SIGTERM");
    return reply({ id: msg.id, ok: true });
  }
  if (msg.type === "run") {
    if (!AGENTS.includes(msg.agent)) return reply({ id: msg.id, ok: false, error: `Unknown agent: ${msg.agent}` });
    const started = Date.now();
    log("run", msg.agent, msg.model ?? "default", `${msg.prompt?.length ?? 0} chars`);
    try {
      const out = await runAgent(msg.agent, msg, { config, onSpawn: (c) => children.set(msg.id, c) });
      log("done", msg.agent, `${Date.now() - started}ms`, out.json ? "json" : "text-only");
      return reply({ id: msg.id, ok: true, json: out.json, text: out.text.slice(0, 200_000), ms: Date.now() - started });
    } catch (e) {
      log("fail", msg.agent, String(e?.message ?? e).slice(0, 300));
      return reply({ id: msg.id, ok: false, error: String(e?.message ?? e) });
    } finally {
      children.delete(msg.id);
    }
  }
  reply({ id: msg.id, ok: false, error: `Unknown request: ${msg.type}` });
}

process.stdin.on(
  "data",
  decoder((msg) => {
    handle(msg).catch((e) => reply({ id: msg?.id, ok: false, error: String(e?.message ?? e) }));
  }),
);
process.stdin.on("end", () => {
  for (const c of children.values()) c.kill("SIGTERM");
  process.exit(0);
});
log("start", `v${VERSION}`, `pid ${process.pid}`);
