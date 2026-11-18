import { useState } from "react";
import type { PanelProps } from "../App";
import { op } from "../hooks";
import { Run, audit, refine } from "../agent";
import { insertIntoPage, scanPage, siteOf } from "../page";
import { AgentError, Counter } from "../ui";
import { AuditView } from "./Fill";
import { allVoices, findVoice } from "../../shared/voices";
import { isChoice, type AuditResult, type PageField, type RefineResult, type Voice } from "../../shared/types";

export function VoicesTab({ store, tab, goto }: PanelProps) {
  const voices = allVoices(store.voices);
  const voice = findVoice(store.settings.voiceId, store.voices);
  const [text, setText] = useState("");
  const [question, setQuestion] = useState("");
  const [from, setFrom] = useState<PageField | null>(null);
  const [pageFields, setPageFields] = useState<PageField[] | null>(null);
  const [busy, setBusy] = useState<"audit" | "refine" | null>(null);
  const [checked, setChecked] = useState<AuditResult | null>(null);
  const [refined, setRefined] = useState<RefineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Voice | "new" | null>(null);
  const site = tab ? siteOf(tab.url) : null;
  const siteOn = !!site && store.settings.sites.some((s) => s.origin === site.origin);

  const go = async (kind: "audit" | "refine") => {
    setBusy(kind);
    setError(null);
    setChecked(null);
    setRefined(null);
    try {
      if (kind === "audit") setChecked(await audit(new Run(), text, voice, question));
      else setRefined(await refine(new Run(), text, voice, question, from?.maxLength ?? null));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pull = async () => {
    if (!tab) return;
    try {
      setPageFields((await scanPage(tab.id)).filter((f) => !isChoice(f.kind) && f.value.trim().length > 0));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (editing) return <VoiceForm voice={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />;

  return (
    <div className="stack">
      <div className="stack tight">
        <h2>Voices</h2>
        <p className="muted small">How your answers should come across. Pick one for filling, or use it to check and sharpen anything you've written.</p>
      </div>
      <div className="voice-pick" role="radiogroup" aria-label="Voice">
        {voices.map((v) => (
          <button key={v.id} className="voice" aria-pressed={v.id === voice.id} onClick={() => op({ op: "settings", patch: { voiceId: v.id } })}>
            <span className="dotsel" />
            <span className="stack tight" style={{ flex: 1, gap: 1 }}>
              <span style={{ fontWeight: 600 }}>{v.name}</span>
              <span className="small muted">{v.tagline}</span>
            </span>
            {!v.builtIn && store.voices[v.id] && (
              <span
                className="link small"
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(v);
                }}
              >
                Edit
              </span>
            )}
          </button>
        ))}
        <div>
          <button className="btn ghost small" onClick={() => setEditing("new")}>
            + Make your own voice
          </button>
        </div>
      </div>

      <hr className="sep" />

      <div className="stack">
        <div className="row">
          <h3 style={{ flex: 1 }}>Check or sharpen a piece of writing</h3>
          {siteOn && (
            <button className="btn ghost small" onClick={pull}>
              Take it from the page
            </button>
          )}
        </div>
        {pageFields && (
          <div className="list">
            {pageFields.length ? (
              pageFields.map((f) => (
                <button
                  className="item"
                  key={f.ref}
                  onClick={() => {
                    setFrom(f);
                    setText(f.value);
                    setQuestion(f.question);
                    setPageFields(null);
                  }}
                >
                  <span className="q">{f.question}</span>
                  <span className="a">{f.value}</span>
                </button>
              ))
            ) : (
              <div className="item muted small">No filled-in boxes on this page yet.</div>
            )}
          </div>
        )}
        <input type="text" placeholder="The question it answers (optional)" value={question} onChange={(e) => setQuestion(e.target.value)} />
        <textarea rows={7} placeholder="Paste or write something" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row">
          <Counter text={text} max={from?.maxLength ?? null} />
          <span className="spacer" />
          <button className="btn small" disabled={!text.trim() || !!busy} onClick={() => go("audit")}>
            {busy === "audit" ? "Checking…" : `Check as ${voice.name}`}
          </button>
          <button className="btn small primary" disabled={!text.trim() || !!busy} onClick={() => go("refine")}>
            {busy === "refine" ? "Rewriting…" : "Rewrite"}
          </button>
        </div>
        {error && <AgentError message={error} onSettings={() => goto("settings")} />}
        {checked && <AuditView result={checked} />}
        {refined && (
          <div className="card soft">
            <p style={{ whiteSpace: "pre-wrap" }}>{refined.text}</p>
            {refined.changes.length > 0 && (
              <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
                {refined.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
            <div className="row">
              <button
                className="btn small"
                onClick={() => {
                  setText(refined.text);
                  setRefined(null);
                }}
              >
                Use this
              </button>
              {from && tab && (
                <button
                  className="btn small primary"
                  onClick={async () => {
                    if (await insertIntoPage(tab.id, from, refined.text)) {
                      setText(refined.text);
                      setRefined(null);
                    } else setError("That box isn't on the page anymore. Take it from the page again.");
                  }}
                >
                  Put back in the form
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function VoiceForm({ voice, onDone }: { voice?: Voice; onDone: () => void }) {
  const [name, setName] = useState(voice?.name ?? "");
  const [tagline, setTagline] = useState(voice?.tagline ?? "");
  const [instructions, setInstructions] = useState(voice?.instructions ?? "");
  return (
    <div className="stack">
      <h2>{voice ? "Edit voice" : "Make your own voice"}</h2>
      <label className="field">
        <span>Name</span>
        <input type="text" autoFocus value={name} placeholder="e.g. Calm operator" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>One line about it</span>
        <input type="text" value={tagline} placeholder="e.g. Steady, specific, never oversells" onChange={(e) => setTagline(e.target.value)} />
      </label>
      <label className="field">
        <span>How it should sound</span>
        <textarea
          rows={6}
          value={instructions}
          placeholder="Describe it like you'd brief a friend editing your writing: what to keep, what to cut, words to avoid, an example sentence you like."
          onChange={(e) => setInstructions(e.target.value)}
        />
      </label>
      <div className="row">
        <button
          className="btn primary small"
          disabled={!name.trim() || !instructions.trim()}
          onClick={async () => {
            await op({ op: "saveVoice", voice: { id: voice?.id, name: name.trim(), tagline: tagline.trim(), instructions: instructions.trim() } });
            onDone();
          }}
        >
          Save
        </button>
        <button className="btn ghost small" onClick={onDone}>
          Cancel
        </button>
        <span className="spacer" />
        {voice && (
          <button
            className="btn ghost small"
            onClick={async () => {
              await op({ op: "deleteVoice", id: voice.id });
              onDone();
            }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
