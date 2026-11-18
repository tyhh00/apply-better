import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelProps } from "../App";
import { op, useSessionState } from "../hooks";
import { focusInPage, insertIntoPage, scanPage, siteOf } from "../page";
import { Run, audit, draft, plan, refine } from "../agent";
import { AgentError, Counter, Empty, Thinking } from "../ui";
import { send } from "../../shared/messages";
import { fieldLabel, type FillContext } from "../../shared/prompts";
import { pastAnswerFor } from "../../shared/relevance";
import { allVoices, findVoice } from "../../shared/voices";
import type { Answer, AuditResult, GapQuestion, PageField, RefineResult, Store } from "../../shared/types";

type Step = "pick" | "planning" | "asking" | "drafting" | "review";

interface Draft {
  answer: string;
  note: string;
  inserted: string | null;
}

interface Session {
  url: string;
  step: Step;
  fields: PageField[];
  selected: string[];
  gaps: GapQuestion[];
  told: string[];
  drafts: Record<string, Draft>;
  error: string | null;
}

const fresh = (url: string): Session => ({ url, step: "pick", fields: [], selected: [], gaps: [], told: [], drafts: {}, error: null });

export function FillTab({ store, tab, goto }: PanelProps) {
  const site = tab ? siteOf(tab.url) : null;
  const on = !!site && store.settings.sites.some((s) => s.origin === site.origin);
  const [session, setSession, loaded] = useSessionState<Session>(tab ? `fill:${tab.id}` : null, fresh(tab?.url ?? ""));
  const [scanning, setScanning] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);
  const run = useRef<Run | null>(null);
  const s = session.url === tab?.url ? session : fresh(tab?.url ?? "");
  const patch = useCallback((p: Partial<Session>) => setSession((prev) => ({ ...(prev.url === tab?.url ? prev : fresh(tab?.url ?? "")), ...p })), [setSession, tab?.url]);

  const project = store.settings.activeProjectId ? (store.projects[store.settings.activeProjectId] ?? null) : null;
  const voice = findVoice(store.settings.voiceId, store.voices);
  const answers = useMemo(() => Object.values(store.answers), [store.answers]);

  const rescan = useCallback(async () => {
    if (!tab || !on) return;
    setScanning(true);
    try {
      const fields = await scanPage(tab.id);
      patch({ fields, selected: fields.filter((f) => !f.value.trim()).map((f) => f.ref), error: null });
    } catch (e) {
      patch({ fields: [], error: `apply better couldn't read this page: ${(e as Error).message}` });
    } finally {
      setScanning(false);
    }
  }, [tab, on, patch]);

  useEffect(() => {
    if (loaded && on && s.step === "pick") rescan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, on, tab?.id, tab?.url]);

  if (!tab || !site)
    return (
      <Empty title="Open an application to get started">
        <p>Go to any form you're filling in (a job, a program, a grant) and apply better will help you write it.</p>
      </Empty>
    );

  // Wait for a saved session (closing the panel mid-fill keeps your place) before drawing.
  if (on && !loaded) return null;

  if (!on)
    return (
      <div className="card hero">
        <h2>Turn on apply better for {site.host}?</h2>
        <p className="muted">
          It will remember what you write in this site's forms, so the next application starts from your best answers. It
          only works on sites you turn on, and everything stays on your computer.
        </p>
        <button
          className="btn primary big block"
          onClick={() => {
            setPermError(null);
            // Chrome only shows its permission prompt straight from a click.
            chrome.permissions.request({ origins: [site.pattern] }).then(async (granted) => {
              if (!granted) return setPermError("Chrome didn't give access to this site, so apply better can't read its forms.");
              await send({ type: "sites:enable", site: { origin: site.origin, pattern: site.pattern }, tabId: tab.id });
            });
          }}
        >
          Turn on for {site.host}
        </button>
        {permError && <p className="small">{permError}</p>}
      </div>
    );

  const chosen = s.fields.filter((f) => s.selected.includes(f.ref));
  const MOVED = "The form changed since apply better read it (the page may have reloaded). Press Start over to read it again.";
  const ctx = (st: Store = store): FillContext => ({ store: st, fields: chosen, project, voice, page: { title: tab.title, url: tab.url } });

  const startPlan = async () => {
    const r = (run.current = new Run());
    patch({ step: "planning", error: null, drafts: {}, gaps: [], told: [] });
    try {
      const gaps = await plan(r, ctx());
      if (!gaps.length) return writeDrafts([], r);
      patch({ step: "asking", gaps, told: gaps.map(() => "") });
    } catch (e) {
      patch({ step: "pick", error: (e as Error).message });
    }
  };

  const writeDrafts = async (told: { question: string; answer: string }[], r = (run.current = new Run())) => {
    patch({ step: "drafting", error: null });
    // What you tell the agent is kept, so the next form doesn't ask again.
    for (const t of told) {
      const same = answers.find((a) => a.source === "told" && a.question === t.question && a.projectId === (project?.id ?? null));
      await op({ op: "upsertAnswer", answer: { id: same?.id, question: t.question, answer: t.answer, source: "told", projectId: project?.id ?? null } });
    }
    try {
      const out = await draft(r, ctx(), told);
      const drafts: Record<string, Draft> = {};
      chosen.forEach((f, i) => {
        const d = out.find((a) => a.field.trim().toUpperCase() === fieldLabel(i));
        drafts[f.ref] = { answer: d?.answer ?? "", note: d?.note ?? "", inserted: null };
      });
      patch({ step: "review", drafts });
    } catch (e) {
      patch({ step: s.gaps.length ? "asking" : "pick", error: (e as Error).message });
    }
  };

  const stop = () => run.current?.cancel();
  const error = s.error ? <AgentError message={s.error} onSettings={() => goto("settings")} onRetry={() => patch({ error: null })} /> : null;
  const memory = answers.filter((a) => a.source !== "told").length;
  const known = answers.filter((a) => a.source === "told").length;

  if (s.step === "planning")
    return (
      <Thinking
        title="Reading how you write…"
        steps={[`Looking through ${memory} past answers${known ? ` and ${known} things you've told it` : ""}`, "Working out what it still needs to ask you"]}
        onStop={stop}
      />
    );
  if (s.step === "drafting") return <Thinking title="Writing in your voice…" steps={[`${chosen.length} answers, as ${voice.name.toLowerCase()}`]} onStop={stop} />;

  if (s.step === "asking")
    return (
      <div className="stack">
        <div className="stack tight">
          <h2>A few things before it writes</h2>
          <p className="muted">Answer what you can. Everything you say here is saved, so you won't be asked again.</p>
        </div>
        {error}
        {s.gaps.map((g, i) => (
          <div className="card" key={i}>
            <div className="stack tight">
              <h3>{g.question}</h3>
              {g.why && <p className="small muted">{g.why}</p>}
            </div>
            {g.suggestions.length > 0 && (
              <div className="chips">
                {g.suggestions.map((sug) => (
                  <button key={sug} className="chip" aria-pressed={(s.told[i] ?? "") === sug} onClick={() => patch({ told: s.told.map((t, j) => (j === i ? sug : t)) })}>
                    {sug}
                  </button>
                ))}
              </div>
            )}
            <textarea
              rows={2}
              value={s.told[i] ?? ""}
              placeholder="Your answer"
              onChange={(e) => patch({ told: s.told.map((t, j) => (j === i ? e.target.value : t)) })}
            />
          </div>
        ))}
        <div className="row">
          <button
            className="btn primary big"
            onClick={() => writeDrafts(s.gaps.map((g, i) => ({ question: g.question, answer: (s.told[i] ?? "").trim() })).filter((t) => t.answer))}
          >
            Write my answers
          </button>
          <button className="btn ghost" onClick={() => writeDrafts([])}>
            Skip and write anyway
          </button>
          <span className="spacer" />
          <button className="btn ghost small" onClick={() => patch({ step: "pick" })}>
            Back
          </button>
        </div>
      </div>
    );

  if (s.step === "review") {
    const refs = chosen.map((f) => f.ref).filter((r) => s.drafts[r]?.answer.trim());
    const putAll = async () => {
      const next = { ...s.drafts };
      for (const f of chosen) {
        const d = next[f.ref];
        if (!d?.answer.trim()) continue;
        if (await insertIntoPage(tab.id, f, d.answer)) next[f.ref] = { ...d, inserted: d.answer };
        else return patch({ drafts: next, error: MOVED });
      }
      patch({ drafts: next, error: null });
    };
    return (
      <div className="stack">
        <div className="row">
          <div className="stack tight" style={{ flex: 1 }}>
            <h2>{refs.length} answers ready</h2>
            <p className="small muted">Read them, change anything, then put them in the form. Nothing is submitted for you.</p>
          </div>
        </div>
        <div className="row">
          <button className="btn primary" onClick={putAll} disabled={!refs.length}>
            Put all in the form
          </button>
          <span className="spacer" />
          <button className="btn ghost small" onClick={() => patch(fresh(tab.url))}>
            Start over
          </button>
        </div>
        {chosen.map((f) => (
          <DraftCard
            key={f.ref}
            field={f}
            draft={s.drafts[f.ref] ?? { answer: "", note: "", inserted: null }}
            store={store}
            onChange={(d) => patch({ drafts: { ...s.drafts, [f.ref]: d } })}
            onInsert={async (text) => {
              if (await insertIntoPage(tab.id, f, text)) patch({ drafts: { ...s.drafts, [f.ref]: { ...s.drafts[f.ref], answer: text, inserted: text } }, error: null });
              else patch({ error: MOVED });
            }}
            onFocus={() => focusInPage(tab.id, f)}
            onError={(m) => patch({ error: m })}
          />
        ))}
        {error}
      </div>
    );
  }

  // pick
  const newProjectHere = async () => {
    const name = (tab.title || site.host).replace(/\s*[|·–—-]\s*(apply|application|careers?|jobs?)\b.*$/i, "").trim().slice(0, 60) || site.host;
    const p = await op<{ id: string }>({ op: "saveProject", project: { name, brief: "" } });
    await op({ op: "settings", patch: { activeProjectId: p.id } });
  };
  const usePast = async (f: PageField, a: Answer) => {
    if (await insertIntoPage(tab.id, f, a.answer)) patch({ fields: s.fields.map((x) => (x.ref === f.ref ? { ...x, value: a.answer } : x)), selected: s.selected.filter((r) => r !== f.ref) });
  };
  return (
    <div className="stack">
      <div className="sitebar">
        <span>
          Remembering what you write on <b>{site.host}</b>
        </span>
        <span className="spacer" />
        <button className="link small" onClick={() => send({ type: "sites:disable", origin: site.origin })}>
          Turn off
        </button>
      </div>
      {error}
      {scanning && !s.fields.length ? (
        <Thinking title="Reading the form…" />
      ) : !s.fields.length ? (
        <Empty title="No questions found on this page">
          <p>Scroll to the form or open the next step, then look again.</p>
          <button className="btn small" onClick={rescan}>
            Look again
          </button>
        </Empty>
      ) : (
        <>
          <div className="row">
            <div className="stack tight" style={{ flex: 1 }}>
              <h2>
                {s.fields.length} question{s.fields.length === 1 ? "" : "s"} on this page
              </h2>
              <p className="small muted">
                {memory ? `It knows ${memory} of your answers${project ? ` and writes for ${project.name}` : ""}.` : "Your first form: write as usual, or let the agent ask you a few things first."}
              </p>
            </div>
            <button className="btn ghost small" onClick={rescan} disabled={scanning}>
              {scanning ? "Reading…" : "Look again"}
            </button>
          </div>
          <div className="list">
            {s.fields.map((f) => {
              const past = !f.value.trim() ? pastAnswerFor(f.question, answers) : null;
              return (
                <div className="qrow" key={f.ref}>
                  <input
                    type="checkbox"
                    aria-label={`Write ${f.question}`}
                    checked={s.selected.includes(f.ref)}
                    onChange={(e) => patch({ selected: e.target.checked ? [...s.selected, f.ref] : s.selected.filter((r) => r !== f.ref) })}
                  />
                  <div className="qtext stack tight">
                    <button onClick={() => focusInPage(tab.id, f)}>{f.question}</button>
                    {f.value.trim() ? (
                      <span className="small faint">Already filled: {f.value.slice(0, 80)}</span>
                    ) : past ? (
                      <span className="row small">
                        <span className="tag">Answered before</span>
                        <button className="link small" onClick={() => usePast(f, past)}>
                          Use it
                        </button>
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="stack tight">
            <div className="row">
              <span className="small muted" style={{ width: 52 }}>Project</span>
              <select
                aria-label="Project for this form"
                value={store.settings.activeProjectId ?? ""}
                onChange={(e) => op({ op: "settings", patch: { activeProjectId: e.target.value || null } })}
                style={{ flex: 1 }}
              >
                <option value="">No project</option>
                {Object.values(store.projects).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button className="btn small" title="Start a project for this application" onClick={newProjectHere}>
                + New
              </button>
            </div>
            <div className="row">
              <span className="small muted" style={{ width: 52 }}>Voice</span>
              <select aria-label="Voice" value={voice.id} onChange={(e) => op({ op: "settings", patch: { voiceId: e.target.value } })} style={{ flex: 1 }}>
                {allVoices(store.voices).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn primary big block" disabled={!chosen.length} onClick={startPlan}>
              Fill {chosen.length} with my agent
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function DraftCard({
  field,
  draft,
  store,
  onChange,
  onInsert,
  onFocus,
  onError,
}: {
  field: PageField;
  draft: Draft;
  store: Store;
  onChange: (d: Draft) => void;
  onInsert: (text: string) => void;
  onFocus: () => void;
  onError: (m: string) => void;
}) {
  const [voiceId, setVoiceId] = useState(store.settings.voiceId);
  const [busy, setBusy] = useState<"refine" | "audit" | null>(null);
  const [checked, setChecked] = useState<AuditResult | null>(null);
  const [refined, setRefined] = useState<RefineResult | null>(null);
  const voice = findVoice(voiceId, store.voices);
  const inForm = draft.inserted !== null && draft.inserted === draft.answer;
  // The agent leaves [brackets] where it was missing a fact; don't let one slip into a real form unseen.
  const blanks = draft.answer.match(/\[[^\]\n]{2,80}\]/g) ?? [];

  const go = async (kind: "refine" | "audit") => {
    setBusy(kind);
    setChecked(null);
    setRefined(null);
    try {
      if (kind === "audit") setChecked(await audit(new Run(), draft.answer, voice, field.question));
      else setRefined(await refine(new Run(), draft.answer, voice, field.question, field.maxLength));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card">
      <button className="link" style={{ textDecoration: "none", color: "var(--ink)", fontWeight: 600, textAlign: "left" }} onClick={onFocus}>
        {field.question}
      </button>
      <textarea rows={field.kind === "text" ? 1 : 6} value={draft.answer} onChange={(e) => onChange({ ...draft, answer: e.target.value })} placeholder="(left empty)" />
      <div className="row">
        <Counter text={draft.answer} max={field.maxLength} />
        <span className="spacer" />
        {inForm ? <span className="tag solid">In the form</span> : null}
      </div>
      {blanks.length > 0 && (
        <div className="note">
          <b>{blanks.length === 1 ? "1 blank" : `${blanks.length} blanks`} to fill in:</b> {blanks.join(", ")}
        </div>
      )}
      {draft.note && <div className="note">{draft.note}</div>}
      <div className="row wrap">
        <button className="btn small primary" disabled={!draft.answer.trim() || inForm} onClick={() => onInsert(draft.answer)}>
          {draft.inserted !== null && !inForm ? "Put in again" : "Put in form"}
        </button>
        <div className="row" style={{ gap: 6, marginLeft: "auto" }}>
          <select aria-label="Voice for this answer" value={voiceId} onChange={(e) => setVoiceId(e.target.value)} style={{ width: 112, height: 26, fontSize: 12, padding: "0 6px" }}>
            {allVoices(store.voices).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <button className="btn small" disabled={!!busy || !draft.answer.trim()} onClick={() => go("refine")}>
            {busy === "refine" ? "Refining…" : "Refine"}
          </button>
          <button className="btn small" disabled={!!busy || !draft.answer.trim()} onClick={() => go("audit")}>
            {busy === "audit" ? "Checking…" : "Check"}
          </button>
        </div>
      </div>
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
              className="btn small primary"
              onClick={() => {
                onChange({ ...draft, answer: refined.text });
                setRefined(null);
              }}
            >
              Use this
            </button>
            <button className="btn small ghost" onClick={() => setRefined(null)}>
              Keep mine
            </button>
          </div>
        </div>
      )}
      {checked && <AuditView result={checked} />}
    </div>
  );
}

export function AuditView({ result }: { result: AuditResult }) {
  return (
    <div className="card soft">
      <div className="row" style={{ alignItems: "baseline" }}>
        <span className="score">{Math.round(result.score)}</span>
        <span className="muted">/ 10</span>
      </div>
      <p>{result.verdict}</p>
      {result.issues.map((i, n) => (
        <div className="issue" key={n}>
          <span className="small">
            <mark>{i.quote}</mark>
          </span>
          <span className="small muted">{i.problem}</span>
          <span className="small">→ {i.fix}</span>
        </div>
      ))}
    </div>
  );
}
