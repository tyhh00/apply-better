// Talks to the form on the page through the content script.
import type { PageField } from "../shared/types";
import type { ScannedField } from "../content/index";

export function siteOf(url: string): { origin: string; pattern: string; host: string } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return { origin: `${u.protocol}//${u.hostname}`, pattern: `${u.protocol}//${u.hostname}/*`, host: u.hostname };
  } catch {
    return null;
  }
}

async function inEveryFrame<T>(tabId: number, func: () => T): Promise<chrome.scripting.InjectionResult<Awaited<T>>[]> {
  try {
    return await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func });
  } catch {
    // Some embedded frames may be on sites you haven't turned on; fall back to the page itself.
    return chrome.scripting.executeScript({ target: { tabId }, func });
  }
}

export async function scanPage(tabId: number): Promise<PageField[]> {
  const scan = () => inEveryFrame(tabId, () => window.__applyBetter?.scan() ?? null);
  let results = await scan();
  if (results.every((r) => r.result == null)) {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] }).catch(() =>
      chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }),
    );
    results = await scan();
  }
  return results.flatMap((r) =>
    ((r.result as ScannedField[] | null) ?? []).map((f) => ({ ...f, frameId: r.frameId, ref: `${r.frameId}:${f.fieldId}` })),
  );
}

export async function insertIntoPage(tabId: number, field: PageField, value: string): Promise<boolean> {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [field.frameId] },
    func: (id: string, v: string) => window.__applyBetter?.insert(id, v) ?? false,
    args: [field.fieldId, value],
  });
  return !!r?.result;
}

export async function focusInPage(tabId: number, field: PageField): Promise<void> {
  await chrome.scripting
    .executeScript({
      target: { tabId, frameIds: [field.frameId] },
      func: (id: string) => window.__applyBetter?.focus(id) ?? false,
      args: [field.fieldId],
    })
    .catch(() => {});
}
