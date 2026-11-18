import { useCallback, useEffect, useState } from "react";
import { readStore, type StoreOp } from "../shared/store";
import { send } from "../shared/messages";
import type { AgentStatus, Store } from "../shared/types";

export function useStore(): Store | null {
  const [store, setStore] = useState<Store | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => readStore().then((s) => alive && setStore(s));
    load();
    const onChange = (_: unknown, area: string) => area === "local" && load();
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, []);
  return store;
}

export function op<T = unknown>(o: StoreOp): Promise<T> {
  return send<T>({ type: "store", op: o });
}

export interface ActiveTab {
  id: number;
  url: string;
  title: string;
}

/** The tab the side panel is helping with. `?tab=123` pins it (used by tests and dev). */
export function useActiveTab(): ActiveTab | null {
  const [tab, setTab] = useState<ActiveTab | null>(null);
  useEffect(() => {
    const pinned = new URLSearchParams(location.search).get("tab");
    const refresh = async () => {
      const t = pinned
        ? await chrome.tabs.get(Number(pinned)).catch(() => undefined)
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      setTab(t?.id !== undefined ? { id: t.id, url: t.url ?? "", title: t.title ?? "" } : null);
    };
    refresh();
    const onActivated = () => !pinned && refresh();
    const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if ((info.url || info.status === "complete" || info.title) && (!pinned || String(id) === pinned)) refresh();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onFocusChanged.addListener(onActivated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.windows.onFocusChanged.removeListener(onActivated);
    };
  }, []);
  return tab;
}

export function useAgentStatus(): [AgentStatus | null, (refresh?: boolean) => Promise<void>] {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const check = useCallback(async (refresh = false) => {
    setStatus((s) => (refresh ? null : s));
    try {
      setStatus(await send<AgentStatus>({ type: "agent:status", refresh }));
    } catch (e) {
      setStatus({ connected: false, error: (e as Error).message });
    }
  }, []);
  useEffect(() => {
    check(false);
  }, [check]);
  return [status, check];
}

/** State that survives closing and reopening the side panel, per key, for this browser session. */
export function useSessionState<T>(key: string | null, initial: T): [T, (v: T | ((p: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    chrome.storage.session.get(key).then((r) => {
      if (!alive) return;
      setValue((r[key] as T) ?? initial);
      setLoadedKey(key);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback(
    (v: T | ((p: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        if (key && loadedKey === key) chrome.storage.session.set({ [key]: next }).catch(() => {});
        return next;
      });
    },
    [key, loadedKey],
  );
  return [loadedKey === key ? value : initial, set, loadedKey === key];
}
