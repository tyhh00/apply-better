#!/usr/bin/env node
// Connects the apply-better extension to Claude Code / Codex on this computer.
//
//   npm run connect                       # set up for every Chromium browser you have
//   npm run connect -- --extension-id ID  # also trust another copy of the extension
//   npm run disconnect                    # remove it all
//
// It writes three things, all inside your home folder:
//   ~/.apply-better/bridge.json         where node, claude and codex live (Chrome starts helpers with a bare PATH)
//   ~/.apply-better/apply-better-bridge a tiny launcher Chrome runs
//   <browser>/NativeMessagingHosts/com.apply_better.bridge.json   tells the browser which extension may use it
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS, which } from "./agents.mjs";

const HOST_NAME = "com.apply_better.bridge";
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const values = (name) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));

const HOME = values("--home")[0] ?? process.env.APPLY_BETTER_HOME ?? path.join(os.homedir(), ".apply-better");
const { id: BUILT_IN_ID } = JSON.parse(readFileSync(path.join(repo, "src/extension-key.json"), "utf8"));
const extensionIds = [BUILT_IN_ID, ...values("--extension-id")];

function browserDirs() {
  const h = os.homedir();
  if (process.platform === "darwin") {
    const base = path.join(h, "Library/Application Support");
    return [
      "Google/Chrome",
      "Google/Chrome Beta",
      "Google/Chrome Dev",
      "Google/Chrome Canary",
      "Google/Chrome for Testing",
      "Chromium",
      "BraveSoftware/Brave-Browser",
      "Microsoft Edge",
      "Vivaldi",
      "Arc/User Data",
    ].map((d) => path.join(base, d));
  }
  if (process.platform === "linux") {
    const base = process.env.XDG_CONFIG_HOME || path.join(h, ".config");
    return ["google-chrome", "google-chrome-beta", "google-chrome-unstable", "chromium", "BraveSoftware/Brave-Browser", "microsoft-edge", "vivaldi"].map((d) =>
      path.join(base, d),
    );
  }
  return [];
}

function targets() {
  const custom = values("--user-data-dir");
  if (custom.length) return custom; // tests: only the throwaway profile
  const found = browserDirs().filter((d) => existsSync(d));
  return found.length ? found : browserDirs().slice(0, 1);
}

function say(s = "") {
  if (!flag("--quiet")) console.log(s);
}

if (process.platform === "win32") {
  console.error("apply better's bridge doesn't support Windows yet (it needs a registry entry). Pull requests welcome!");
  process.exit(1);
}

const launcher = path.join(HOME, "apply-better-bridge");
const manifestName = `${HOST_NAME}.json`;

if (flag("--uninstall")) {
  for (const dir of [...browserDirs(), ...values("--user-data-dir")]) rmSync(path.join(dir, "NativeMessagingHosts", manifestName), { force: true });
  rmSync(launcher, { force: true });
  rmSync(path.join(HOME, "bridge.json"), { force: true });
  say("apply better is disconnected from your local agents. Your saved answers in the extension are untouched.");
  process.exit(0);
}

mkdirSync(HOME, { recursive: true });

// Prefer the node on your PATH (e.g. /opt/homebrew/bin/node) over the resolved
// versioned path, so upgrading node doesn't break the bridge.
const node = which("node", process.env.PATH) ?? process.execPath;

const agents = {};
for (const kind of AGENTS) agents[kind] = values(`--${kind}`)[0] ?? which(kind, process.env.PATH);

writeFileSync(
  path.join(HOME, "bridge.json"),
  JSON.stringify({ node, host: path.join(here, "host.mjs"), PATH: process.env.PATH, agents, installedAt: new Date().toISOString() }, null, 2),
);

const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
writeFileSync(launcher, `#!/bin/sh\nAPPLY_BETTER_HOME=${q(HOME)} exec ${q(node)} ${q(path.join(here, "host.mjs"))} "$@"\n`);
chmodSync(launcher, 0o755);

const manifest = {
  name: HOST_NAME,
  description: "apply better: lets the extension ask Claude Code or Codex on this computer to write with you",
  path: launcher,
  type: "stdio",
  allowed_origins: [...new Set(extensionIds)].map((id) => `chrome-extension://${id}/`),
};
const written = [];
for (const dir of targets()) {
  const d = path.join(dir, "NativeMessagingHosts");
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, manifestName), JSON.stringify(manifest, null, 2));
  written.push(dir);
}

say("apply better is connected to this computer.\n");
say(`  Claude Code  ${agents.claude ? `found at ${agents.claude}` : "not found (install it from claude.com/claude-code)"}`);
say(`  Codex        ${agents.codex ? `found at ${agents.codex}` : "not found (optional: npm i -g @openai/codex)"}`);
say(`  Browsers     ${written.map((d) => path.basename(d.replace(/\/User Data$/, ""))).join(", ")}`);
say("\nWhat's next: open the apply better side panel → Settings, and press Check again.");
say("If you moved this folder or installed a new agent, run `npm run connect` again.");
