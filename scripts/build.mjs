// Builds the extension into dist/ (or dist-e2e/ when APPLY_BETTER_E2E=1).
// Two passes: the side panel + background (ES modules), then the content
// script as one classic file, because Chrome can't load content scripts as modules.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const e2e = process.env.APPLY_BETTER_E2E === "1";
const outDir = path.join(root, e2e ? "dist-e2e" : "dist");
const watch = process.argv.includes("--watch") ? {} : null;
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const { key } = JSON.parse(readFileSync(path.join(root, "src/extension-key.json"), "utf8"));

function manifest() {
  return {
    manifest_version: 3,
    name: "apply better",
    version: pkg.version,
    description: "Remembers how you answer applications and fills the next one with you.",
    key,
    minimum_chrome_version: "116",
    action: { default_title: "apply better", default_icon: icons() },
    icons: icons(),
    side_panel: { default_path: "sidepanel/index.html" },
    background: { service_worker: "background.js", type: "module" },
    permissions: ["storage", "unlimitedStorage", "sidePanel", "scripting", "tabs", "nativeMessaging"],
    optional_host_permissions: ["https://*/*", "http://*/*"],
    // The end-to-end test serves its form pages from 127.0.0.1 and can't click
    // Chrome's permission prompt, so that build ships with that one origin granted.
    host_permissions: e2e ? ["http://127.0.0.1/*"] : [],
  };
}
function icons() {
  return { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" };
}

const emitManifest = {
  name: "apply-better-manifest",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "manifest.json", source: JSON.stringify(manifest(), null, 2) });
  },
};

await build({
  configFile: false,
  root: path.join(root, "src"),
  publicDir: path.join(root, "public"),
  plugins: [react(), emitManifest],
  logLevel: "warn",
  build: {
    outDir,
    emptyOutDir: true,
    target: "chrome116",
    modulePreload: false,
    watch,
    rollupOptions: {
      input: {
        background: path.join(root, "src/background/index.ts"),
        sidepanel: path.join(root, "src/sidepanel/index.html"),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
      },
    },
  },
});

await build({
  configFile: false,
  root,
  publicDir: false,
  logLevel: "warn",
  build: {
    outDir,
    emptyOutDir: false,
    target: "chrome116",
    watch,
    lib: {
      entry: path.join(root, "src/content/index.ts"),
      formats: ["iife"],
      name: "ApplyBetterContent",
      fileName: () => "content.js",
    },
  },
});

console.log(`built ${path.relative(root, outDir)}/${e2e ? " (e2e)" : ""}`);
