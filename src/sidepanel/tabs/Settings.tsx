import { useEffect, useRef, useState } from "react";
import type { PanelProps } from "../App";
import { op, useAgentStatus } from "../hooks";
import { send } from "../../shared/messages";
import type { AgentKind, Store } from "../../shared/types";

const AGENTS: { id: AgentKind; name: string; install: string }[] = [
  { id: "claude", name: "Claude Code", install: "Install from claude.com/claude-code, sign in once, then run npm run connect again." },
  { id: "codex", name: "Codex", install: "Install with npm i -g @openai/codex, sign in once, then run npm run connect again." },
];

export function SettingsTab({ store }: PanelProps) {
  const [status, check] = useAgentStatus();
  const [about, setAbout] = useState(store.settings.aboutMe);
  const [model, setModel] = useState(store.settings.model);
  const [saved, setSaved] = useState(false);
  const [wipe, setWipe] = useState(false);
  const [imported, setImported] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setAbout(store.settings.aboutMe), [store.settings.aboutMe]);

  const missing = status && !status.connected && (status.error === "bridge-missing" || status.error === "bridge-forbidden");

  return (
    <div className="stack">
      <h2>Settings</h2>

      <section className="card">
        <div className="row">
          <h3 style={{ flex: 1 }}>Your agent</h3>
          <button className="btn ghost small" onClick={() => check(true)}>
            Check again
          </button>
        </div>
        {!status ? (
          <p className="muted small">Checking…</p>
        ) : status.connected ? (
          <>
            <p className="small muted">apply better writes with an agent already on your computer, using your own plan. Pick which one.</p>
            <div className="voice-pick">
              {AGENTS.map((a) => {
                const found = status.agents?.[a.id];
                return (
                  <button
                    key={a.id}
                    className="voice"
                    aria-pressed={store.settings.agent === a.id}
                    disabled={!found}
                    style={!found ? { opacity: 0.6, cursor: "default" } : undefined}
                    onClick={() => found && op({ op: "settings", patch: { agent: a.id } })}
                  >
                    <span className="dotsel" />
                    <span className="stack tight" style={{ flex: 1, gap: 1 }}>
                      <span style={{ fontWeight: 600 }}>{a.name}</span>
                      <span className="small muted">{found ? found.version : `Not found. ${a.install}`}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <label className="field">
              <span>Model</span>
              <input
                type="text"
                value={model}
                placeholder={`Default: whatever your ${store.settings.agent === "claude" ? "Claude Code" : "Codex"} uses`}
                onChange={(e) => setModel(e.target.value)}
                onBlur={() => model !== store.settings.model && op({ op: "settings", patch: { model: model.trim() } })}
              />
            </label>
          </>
        ) : missing ? (
          <>
            <p className="muted">Connect apply better to Claude Code or Codex on this computer. One time only:</p>
            <ol className="how small">
              <li>Open a terminal in the folder where you downloaded apply better.</li>
              <li>
                Run this:
                <div className="code" style={{ marginTop: 4 }}>
                  npm run connect{status.error === "bridge-forbidden" ? ` -- --extension-id ${chrome.runtime.id}` : ""}
                </div>
              </li>
              <li>Come back and press Check again.</li>
            </ol>
          </>
        ) : (
          <p className="small">{status.error}</p>
        )}
      </section>

      <section className="card">
        <h3>About you</h3>
        <p className="small muted">Facts the agent can always use: your name, links, where you've worked, what you're proud of. It never makes these up.</p>
        <textarea
          rows={6}
          value={about}
          placeholder={"Name, email, LinkedIn, GitHub\nWhat you do now and before\nNumbers you're proud of"}
          onChange={(e) => {
            setAbout(e.target.value);
            setSaved(false);
          }}
          onBlur={async () => {
            if (about === store.settings.aboutMe) return;
            await op({ op: "settings", patch: { aboutMe: about } });
            setSaved(true);
          }}
        />
        {saved && <span className="small muted">Saved</span>}
      </section>

      <section className="card">
        <h3>Sites it remembers on</h3>
        {!store.settings.sites.length ? (
          <p className="small muted">None yet. Open a form and press Turn on in the Fill tab.</p>
        ) : (
          <div className="list">
            {store.settings.sites.map((s) => (
              <div className="item" key={s.origin} style={{ flexDirection: "row", alignItems: "center" }}>
                <span style={{ flex: 1 }}>{new URL(s.origin).hostname}</span>
                <button className="btn ghost small" onClick={() => send({ type: "sites:disable", origin: s.origin })}>
                  Turn off
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h3>Your data</h3>
        <p className="small muted">
          {Object.keys(store.answers).length} answers and {Object.keys(store.projects).length} projects, stored only in this browser. Your agent sees what's
          relevant to the form you're filling, and nothing is sent anywhere else.
        </p>
        <div className="row wrap">
          <button className="btn small" onClick={() => exportData(store)}>
            Export
          </button>
          <button className="btn small" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const data = JSON.parse(await f.text());
                await op({ op: "import", data: { answers: data.answers, projects: data.projects, voices: data.voices } });
                setImported(`Imported ${Object.keys(data.answers ?? {}).length} answers.`);
              } catch {
                setImported("That file isn't an apply better export.");
              }
              e.target.value = "";
            }}
          />
          <span className="spacer" />
          <button
            className="btn ghost small"
            onClick={async () => {
              if (!wipe) return setWipe(true);
              await op({ op: "wipe" });
              setWipe(false);
            }}
          >
            {wipe ? "Press again to delete everything" : "Delete everything"}
          </button>
        </div>
        {imported && <span className="small muted">{imported}</span>}
      </section>
      <p className="faint small" style={{ textAlign: "center" }}>
        apply better {chrome.runtime.getManifest().version} · bridge {status?.version ?? "not connected"} · open source, MIT
      </p>
    </div>
  );
}

function exportData(store: Store) {
  const blob = new Blob([JSON.stringify({ app: "apply-better", exportedAt: new Date().toISOString(), ...store }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `apply-better-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
