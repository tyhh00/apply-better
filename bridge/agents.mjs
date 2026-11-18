// How the bridge runs your local agent. Both agents get the same treatment:
// an empty scratch folder as the working directory, no tools, and a JSON schema
// for the reply. Page text is untrusted, so the agent must never be able to act.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";

export const AGENTS = ["claude", "codex"];

// Codex tools apply-better never needs: shell, browser, computer use, apps, plugins, hooks.
const CODEX_TOOLS_OFF = ["shell_tool", "unified_exec", "apps", "plugins", "hooks", "browser_use", "in_app_browser", "computer_use"].flatMap((f) => ["--disable", f]);

const EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".local/bin"), path.join(os.homedir(), ".npm-global/bin"), path.join(os.homedir(), ".bun/bin")];

export function agentEnv(config) {
  const env = { ...process.env };
  // Chrome starts the bridge with a bare PATH; use the one captured at install time.
  env.PATH = [config?.PATH, process.env.PATH, ...EXTRA_PATH].filter(Boolean).join(":");
  // A Claude Code session that launched the browser must not leak into the child.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

export function which(name, envPath) {
  for (const dir of (envPath ?? "").split(":")) {
    if (!dir) continue;
    const p = path.join(dir, name);
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}

export function resolveAgent(kind, config) {
  const fromConfig = config?.agents?.[kind];
  if (fromConfig && existsSync(fromConfig)) return fromConfig;
  return which(kind, agentEnv(config).PATH);
}

/** Runs a command, feeding stdin, and collects its output. `onSpawn` gets the child for cancelling. */
export function exec(cmd, args, { input, cwd, env, onSpawn, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    onSpawn?.(child);
    let stdout = "";
    let stderr = "";
    let timer;
    if (timeoutMs) timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}

export async function agentVersion(bin, config) {
  try {
    const r = await exec(bin, ["--version"], { env: agentEnv(config), timeoutMs: 20_000 });
    return (r.stdout || r.stderr).trim().split("\n")[0].slice(0, 80);
  } catch {
    return "unknown";
  }
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  // Some replies wrap the JSON in a fence or a sentence; take the outermost object.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }
  return null;
}

function tail(s, n = 600) {
  s = (s ?? "").trim();
  return s.length > n ? `…${s.slice(-n)}` : s;
}

function explainFailure(kind, r) {
  const out = `${r.stderr}\n${r.stdout}`;
  const name = kind === "claude" ? "Claude Code" : "Codex";
  if (r.signal === "SIGTERM") return "stopped";
  if (/not (logged|signed) in|login|authenticat|unauthorized|api key/i.test(out))
    return `${name} isn't signed in. Open a terminal, run \`${kind}\` once and sign in, then try again.`;
  if (/rate.?limit|usage limit|quota|overloaded/i.test(out)) return `${name} is at its usage limit right now. Try again in a bit. (${tail(out, 200)})`;
  return `${name} stopped with an error: ${tail(out)}`;
}

/**
 * Runs one request and returns { json, text }.
 * kind: "claude" | "codex"; req: { system, prompt, schema, model }.
 */
export async function runAgent(kind, req, { config, onSpawn }) {
  const bin = resolveAgent(kind, config);
  if (!bin)
    throw new Error(
      kind === "claude"
        ? "Claude Code isn't installed on this computer, or the bridge can't find it. Install it, then run `npm run connect` again."
        : "Codex isn't installed on this computer, or the bridge can't find it. Install it (npm i -g @openai/codex), then run `npm run connect` again.",
    );
  const dir = await mkdtemp(path.join(os.tmpdir(), "apply-better-"));
  const env = agentEnv(config);
  try {
    if (kind === "claude") {
      const args = [
        "-p",
        "--safe-mode", // your CLAUDE.md, hooks, plugins and MCP servers stay out of it
        "--tools",
        "", // no tools at all: it can only write text
        "--no-session-persistence",
        "--output-format",
        "json",
        "--system-prompt",
        req.system,
      ];
      if (req.schema) args.push("--json-schema", JSON.stringify(req.schema));
      if (req.model) args.push("--model", req.model);
      const r = await exec(bin, args, { input: req.prompt, cwd: dir, env, onSpawn });
      const out = parseJson(r.stdout);
      if (r.code !== 0 || !out || out.is_error) {
        if (out?.is_error && out.result) throw new Error(explainFailure(kind, { ...r, stdout: String(out.result) }));
        throw new Error(explainFailure(kind, r));
      }
      const text = typeof out.result === "string" ? out.result : JSON.stringify(out.result ?? "");
      return { json: out.structured_output ?? parseJson(text), text };
    }

    // Codex: no separate system prompt flag, so the rules go first in the prompt.
    const outFile = path.join(dir, "reply.txt");
    const base = [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--ignore-user-config", // like Claude's --safe-mode: your MCP servers and config stay out of it
      "--ignore-rules",
      "--sandbox",
      "read-only",
      "--color",
      "never",
      "-C",
      dir,
      "-o",
      outFile,
    ];
    if (req.schema) {
      const schemaFile = path.join(dir, "schema.json");
      await writeFile(schemaFile, JSON.stringify(req.schema));
      base.push("--output-schema", schemaFile);
    }
    if (req.model) base.push("-m", req.model);
    const input = `${req.system}\n\n${req.prompt}`;
    let r = await exec(bin, [...base, ...CODEX_TOOLS_OFF, "-"], { input, cwd: dir, env, onSpawn });
    // An older Codex may not know one of the feature names; the read-only sandbox still applies.
    if (r.code !== 0 && !existsSync(outFile) && /unknown feature|invalid feature|unrecognized/i.test(r.stderr))
      r = await exec(bin, [...base, "-"], { input, cwd: dir, env, onSpawn });
    const text = existsSync(outFile) ? (await readFile(outFile, "utf8")).trim() : "";
    if (r.code !== 0 && !text) throw new Error(explainFailure(kind, r));
    return { json: parseJson(text), text };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
