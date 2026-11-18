import type { AgentStatus, CapturePayload, Site } from "./types";
import type { StoreOp } from "./store";

export type BgRequest =
  | { type: "capture"; payload: CapturePayload }
  | { type: "store"; op: StoreOp }
  | { type: "agent:status"; refresh?: boolean }
  | { type: "agent:run"; runId: string; system: string; prompt: string; schema: object }
  | { type: "agent:cancel"; runId: string }
  | { type: "sites:enable"; site: Site; tabId?: number }
  | { type: "sites:disable"; origin: string };

export type BgResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export async function send<T = unknown>(req: BgRequest): Promise<T> {
  const res = (await chrome.runtime.sendMessage(req)) as BgResponse<T> | undefined;
  if (!res) throw new Error("apply better's background didn't answer. Reload the extension and try again.");
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export type { AgentStatus };
