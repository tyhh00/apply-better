import { describe, expect, it, beforeAll } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error plain JS module
import { encode, decoder } from "../../bridge/framing.mjs";

const repo = path.resolve(__dirname, "../..");
const fake = path.join(repo, "test/fake/fake-claude.mjs");
const fakeCodex = path.join(repo, "test/fake/fake-codex.mjs");
let home: string;
let profile: string;
let log: string;

beforeAll(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "ab-home-"));
  profile = mkdtempSync(path.join(os.tmpdir(), "ab-profile-"));
  log = path.join(home, "fake.log");
  execFileSync("node", [path.join(repo, "bridge/install.mjs"), "--home", home, "--user-data-dir", profile, "--claude", fake, "--codex", fakeCodex, "--quiet"]);
});

function talk(messages: object[], env: Record<string, string> = {}): Promise<any[]> {
  return new Promise((resolve, reject) => {
    // Start it exactly the way Chrome does: the launcher, with a bare PATH.
    const child = spawn(path.join(home, "apply-better-bridge"), ["chrome-extension://test/"], {
      env: { PATH: "/usr/bin:/bin", HOME: os.homedir(), APPLY_BETTER_FAKE_LOG: log, ...env },
    });
    const out: any[] = [];
    child.stdout.on("data", decoder((m: any) => {
      out.push(m);
      if (out.length === messages.length) child.stdin.end();
    }));
    child.on("close", () => resolve(out));
    child.on("error", reject);
    for (const m of messages) child.stdin.write(encode(m));
  });
}

describe("install", () => {
  it("writes a browser manifest that trusts only apply better's extension id", () => {
    const m = JSON.parse(readFileSync(path.join(profile, "NativeMessagingHosts/com.apply_better.bridge.json"), "utf8"));
    const { id } = JSON.parse(readFileSync(path.join(repo, "src/extension-key.json"), "utf8"));
    expect(m.allowed_origins).toEqual([`chrome-extension://${id}/`]);
    expect(m.type).toBe("stdio");
    expect(existsSync(m.path)).toBe(true);
  });
});

describe("bridge", () => {
  it("says hello with the agents it found", async () => {
    const [hello] = await talk([{ id: "1", type: "hello" }]);
    expect(hello).toMatchObject({ id: "1", ok: true, type: "hello" });
    expect(hello.agents.claude).toMatchObject({ path: fake, version: "9.9.9 (Fake Claude)" });
  });

  it("runs Claude Code with no tools, no personal config, in an empty folder", async () => {
    const schema = { type: "object", additionalProperties: false, required: ["verdict", "score", "issues"], properties: {} };
    const [r] = await talk([{ id: "2", type: "run", agent: "claude", system: "S", prompt: "P", schema }]);
    expect(r.ok).toBe(true);
    expect(r.json.score).toBe(6);
    const last = JSON.parse(readFileSync(log, "utf8").trim().split("\n").pop()!);
    const args: string[] = last.args;
    expect(args).toContain("--safe-mode");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args).toContain("--no-session-persistence");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("S");
    expect(path.basename(last.cwd)).toMatch(/^apply-better-/);
  });

  it("turns a sign-in failure into a plain instruction", async () => {
    const [r] = await talk([{ id: "3", type: "run", agent: "claude", system: "S", prompt: "P", schema: {} }], { APPLY_BETTER_FAKE_FAIL: "1" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/isn't signed in/);
  });

  it("runs Codex read-only, with its shell and your config switched off", async () => {
    const schema = { type: "object", additionalProperties: false, required: ["text", "changes"], properties: {} };
    const [r] = await talk([{ id: "5", type: "run", agent: "codex", system: "RULES", prompt: "TEXT", schema }]);
    expect(r).toMatchObject({ ok: true, json: { text: "Rewritten by Codex." } });
    const last = JSON.parse(readFileSync(log, "utf8").trim().split("\n").pop()!);
    const a: string[] = last.args;
    expect(a[0]).toBe("exec");
    expect(a[a.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(a).toEqual(expect.arrayContaining(["--ignore-user-config", "--ephemeral", "--skip-git-repo-check"]));
    expect(a.join(" ")).toContain("--disable shell_tool --disable unified_exec");
    expect(a.at(-1)).toBe("-");
    expect(last.input).toBe("RULES\n\nTEXT");
  });

  it("still works with an older Codex that doesn't know the feature flags", async () => {
    const schema = { type: "object", additionalProperties: false, required: ["text", "changes"], properties: {} };
    const [r] = await talk([{ id: "6", type: "run", agent: "codex", system: "S", prompt: "P", schema }], { APPLY_BETTER_FAKE_OLD_CODEX: "1" });
    expect(r.ok).toBe(true);
    const a: string[] = JSON.parse(readFileSync(log, "utf8").trim().split("\n").pop()!).args;
    expect(a).not.toContain("--disable");
    expect(a[a.indexOf("--sandbox") + 1]).toBe("read-only");
  });

  it("refuses agents it doesn't know", async () => {
    const [r] = await talk([{ id: "4", type: "run", agent: "bash", prompt: "rm -rf" }]);
    expect(r).toMatchObject({ ok: false });
  });
});
