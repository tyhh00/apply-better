// The background owns three things:
// 1. every write to your data (one at a time, so nothing gets overwritten),
// 2. the line to your local Claude Code / Codex through the bridge,
// 3. which sites apply-better listens on.
import { applyOp, readStore, type StoreOp } from "../shared/store";
import type { BgRequest, BgResponse } from "../shared/messages";
import type { AgentStatus, Answer, CapturePayload, Site, Store } from "../shared/types";

export const BRIDGE_HOST = "com.apply_better.bridge";
const SCRIPT_ID = "capture";
const IDLE_DISCONNECT_MS = 90_000;

// ---------- the store: one writer ----------

let queue: Promise<unknown> = Promise.resolve();

function write<T>(fn: (s: Store) => { store: Store; result?: T } | null): Promise<T | undefined> {
  const next = queue.then(async () => {
    const before = await readStore();
    const out = fn(before);
    if (!out) return undefined;
    const changed: Partial<Store> = {};
    for (const k of ["answers", "projects", "voices", "settings"] as const)
      if (out.store[k] !== before[k]) (changed as Record<string, unknown>)[k] = out.store[k];
    if (Object.keys(changed).length) await chrome.storage.local.set(changed);
    return out.result;
  });
  queue = next.catch(() => undefined);
  return next;
}

const runOp = (op: StoreOp) => write((s) => applyOp(s, op));

export function siteKey(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? `${u.protocol}//${u.hostname}` : null;
  } catch {
    return null;
  }
}

async function onCapture(p: CapturePayload, senderUrl: string | undefined) {
  const key = siteKey(senderUrl ?? p.url);
  return write<Answer | "site-off">((s) => {
    if (!key || !s.settings.sites.some((site) => site.origin === key)) return { store: s, result: "site-off" };
    const existing = Object.values(s.answers).find((a) => a.captureKey === p.captureKey);
    if (existing && existing.answer === p.answer && existing.source === p.source) return null;
    return applyOp(s, {
      op: "upsertAnswer",
      answer: {
        id: existing?.id,
        question: p.question,
        answer: p.answer,
        source: p.source,
        url: p.url,
        site: p.site,
        pageTitle: p.pageTitle,
        captureKey: p.captureKey,
        // A box keeps the project it was first saved under.
        projectId: existing ? existing.projectId : s.settings.activeProjectId,
      },
    }) as { store: Store; result: Answer };
  });
}

// ---------- sites ----------

async function syncScripts(sites: Site[]) {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (!sites.length) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return;
  }
  const def: chrome.scripting.RegisteredContentScript = {
    id: SCRIPT_ID,
    matches: sites.map((s) => s.pattern),
    js: ["content.js"],
    runAt: "document_idle",
    allFrames: true,
    persistAcrossSessions: true,
  };
  if (existing.length) await chrome.scripting.updateContentScripts([def]);
  else await chrome.scripting.registerContentScripts([def]);
}

async function enableSite(site: Site, tabId?: number) {
  const store = await write((s) => {
    if (s.settings.sites.some((x) => x.origin === site.origin)) return { store: s, result: s };
    const next = applyOp(s, { op: "settings", patch: { sites: [...s.settings.sites, site] } }).store;
    return { store: next, result: next };
  });
  await syncScripts(store!.settings.sites);
  // Registered scripts only run on the next page load; start now on the open tab too.
  if (tabId !== undefined)
    await chrome.scripting
      .executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] })
      .catch(() => chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }));
}

async function disableSite(origin: string) {
  const s = await readStore();
  const site = s.settings.sites.find((x) => x.origin === origin);
  const sites = s.settings.sites.filter((x) => x.origin !== origin);
  await runOp({ op: "settings", patch: { sites } });
  await syncScripts(sites);
  if (site) await chrome.permissions.remove({ origins: [site.pattern] }).catch(() => false);
}

chrome.permissions.onRemoved.addListener(async (p) => {
  const gone = new Set(p.origins ?? []);
  if (!gone.size) return;
  const s = await readStore();
  const sites = s.settings.sites.filter((x) => !gone.has(x.pattern));
  if (sites.length === s.settings.sites.length) return;
  await runOp({ op: "settings", patch: { sites } });
  await syncScripts(sites);
});

// ---------- the bridge to your local agent ----------

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
let port: chrome.runtime.Port | null = null;
const pending = new Map<string, Pending>();
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let lastStatus: AgentStatus | null = null;

function connect(): chrome.runtime.Port {
  if (port) return port;
  const p = chrome.runtime.connectNative(BRIDGE_HOST);
  p.onMessage.addListener((msg: { id: string; ok: boolean; error?: string } & Record<string, unknown>) => {
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.ok) waiter.resolve(msg);
    else waiter.reject(new Error(msg.error || "Your agent returned an error."));
    armIdle();
  });
  p.onDisconnect.addListener(() => {
    const why = chrome.runtime.lastError?.message ?? "The bridge closed.";
    port = null;
    const err = new Error(friendlyBridgeError(why));
    for (const w of pending.values()) w.reject(err);
    pending.clear();
  });
  port = p;
  return p;
}

function friendlyBridgeError(raw: string): string {
  if (/not found/i.test(raw)) return "bridge-missing";
  if (/forbidden/i.test(raw)) return "bridge-forbidden";
  if (/exited/i.test(raw)) return "The bridge stopped unexpectedly. Run `npm run connect` again in the apply-better folder.";
  return raw;
}

function armIdle() {
  clearTimeout(idleTimer);
  if (pending.size) return;
  idleTimer = setTimeout(() => {
    if (!pending.size && port) {
      port.disconnect();
      port = null;
    }
  }, IDLE_DISCONNECT_MS);
}

function call<T>(msg: Record<string, unknown> & { id: string }): Promise<T> {
  clearTimeout(idleTimer);
  return new Promise<T>((resolve, reject) => {
    pending.set(msg.id, { resolve: resolve as (v: unknown) => void, reject });
    try {
      connect().postMessage(msg);
    } catch (e) {
      pending.delete(msg.id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

async function status(refresh: boolean): Promise<AgentStatus> {
  if (lastStatus?.connected && !refresh) return lastStatus;
  try {
    const hello = await call<{ version: string; agents: AgentStatus["agents"] }>({ id: crypto.randomUUID(), type: "hello" });
    lastStatus = { connected: true, version: hello.version, agents: hello.agents };
  } catch (e) {
    lastStatus = { connected: false, error: (e as Error).message };
  }
  armIdle();
  return lastStatus;
}

async function run(r: Extract<BgRequest, { type: "agent:run" }>) {
  const { settings } = await readStore();
  const res = await call<{ json: unknown; text: string; ms: number }>({
    id: r.runId,
    type: "run",
    agent: settings.agent,
    model: settings.model || undefined,
    system: r.system,
    prompt: r.prompt,
    schema: r.schema,
  });
  return { json: res.json, text: res.text, ms: res.ms };
}

// ---------- wiring ----------

async function handle(req: BgRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  // Pages only ever get to save what you typed. Running your agent, changing your data
  // and turning sites on or off are for apply better's own pages (the side panel).
  const fromOwnPage = sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL(""));
  if (req.type !== "capture" && !fromOwnPage) throw new Error("not allowed");
  switch (req.type) {
    case "capture": {
      const r = await onCapture(req.payload, sender.url);
      if (r === "site-off") throw new Error("site-off");
      return r ?? null;
    }
    case "store":
      return runOp(req.op);
    case "agent:status":
      return status(!!req.refresh);
    case "agent:run":
      return run(req);
    case "agent:cancel":
      if (port && pending.has(req.runId)) port.postMessage({ id: crypto.randomUUID(), type: "cancel", target: req.runId });
      return null;
    case "sites:enable":
      await enableSite(req.site, req.tabId);
      return null;
    case "sites:disable":
      await disableSite(req.origin);
      return null;
  }
}

chrome.runtime.onMessage.addListener((req: BgRequest, sender, sendResponse) => {
  handle(req, sender).then(
    (data) => sendResponse({ ok: true, data } satisfies BgResponse),
    (e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) } satisfies BgResponse),
  );
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  const s = await readStore();
  await syncScripts(s.settings.sites);
});

chrome.runtime.onStartup.addListener(async () => {
  const s = await readStore();
  await syncScripts(s.settings.sites);
});
