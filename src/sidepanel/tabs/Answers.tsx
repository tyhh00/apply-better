import { useMemo, useState } from "react";
import type { PanelProps } from "../App";
import { op } from "../hooks";
import { Empty, timeAgo } from "../ui";
import { rank } from "../../shared/relevance";
import type { Answer, AnswerSource, Store } from "../../shared/types";

export const SOURCE_LABEL: Record<AnswerSource, string> = {
  you: "You wrote it",
  edited: "Your edit of a draft",
  agent: "Draft you kept",
  told: "You told the agent",
  manual: "Added by you",
};

export function AnswersTab({ store }: PanelProps) {
  const [query, setQuery] = useState("");
  const [project, setProject] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const list = useMemo(() => {
    let all = Object.values(store.answers);
    if (project === "none") all = all.filter((a) => !a.projectId);
    else if (project !== "all") all = all.filter((a) => a.projectId === project);
    if (query.trim()) return rank(query, all, 200).map((r) => r.answer);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [store.answers, query, project]);

  const total = Object.keys(store.answers).length;
  const projects = Object.values(store.projects);

  return (
    <div className="stack">
      <div className="stack tight">
        <h2>Your answers</h2>
        <p className="muted small">Everything you've written on sites you turned on, plus what you've told the agent. The more there is, the less it has to ask.</p>
      </div>
      <div className="row">
        <input type="search" placeholder="Search questions and answers" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="Filter by project" value={project} onChange={(e) => setProject(e.target.value)} style={{ width: 130, flex: "none" }}>
          <option value="all">All projects</option>
          <option value="none">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {adding ? (
        <AnswerEditor store={store} onDone={() => setAdding(false)} />
      ) : (
        <div>
          <button className="btn small" onClick={() => setAdding(true)}>
            + Add an answer
          </button>
        </div>
      )}
      {!total ? (
        <Empty title="Nothing saved yet">
          <p>Turn apply better on for a site with a form, write your answers as usual, and they'll show up here.</p>
        </Empty>
      ) : !list.length ? (
        <Empty title="No matches" />
      ) : (
        <div className="list">
          {list.map((a) =>
            open === a.id ? (
              <div className="item" key={a.id}>
                <AnswerEditor store={store} answer={a} onDone={() => setOpen(null)} />
              </div>
            ) : (
              <button className="item" key={a.id} onClick={() => setOpen(a.id)}>
                <span className="q">{a.question}</span>
                <span className="a">{a.answer}</span>
                <span className="meta">
                  <span>{SOURCE_LABEL[a.source]}</span>
                  {a.projectId && store.projects[a.projectId] && <span>{store.projects[a.projectId].name}</span>}
                  {a.site && <span>{a.site}</span>}
                  <span>{timeAgo(a.updatedAt)}</span>
                </span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function AnswerEditor({ store, answer, onDone }: { store: Store; answer?: Answer; onDone: () => void }) {
  const [question, setQuestion] = useState(answer?.question ?? "");
  const [text, setText] = useState(answer?.answer ?? "");
  const [projectId, setProjectId] = useState<string>(answer ? (answer.projectId ?? "") : (store.settings.activeProjectId ?? ""));
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="stack" style={{ width: "100%" }}>
      <label className="field">
        <span>Question</span>
        <input type="text" value={question} onChange={(e) => setQuestion(e.target.value)} />
      </label>
      <label className="field">
        <span>Answer</span>
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="field">
        <span>Project</span>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">No project</option>
          {Object.values(store.projects).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {answer?.url && (
        <a className="small muted" href={answer.url} target="_blank" rel="noreferrer">
          Written on {answer.pageTitle || answer.site}
        </a>
      )}
      <div className="row">
        <button
          className="btn primary small"
          disabled={!question.trim() || !text.trim()}
          onClick={async () => {
            const changed = !answer || answer.answer !== text.trim() || answer.question !== question.trim();
            await op({
              op: "upsertAnswer",
              answer: {
                id: answer?.id,
                question: question.trim(),
                answer: text.trim(),
                projectId: projectId || null,
                // Your own edit counts as your writing.
                source: changed ? (answer?.source === "told" ? "told" : "manual") : answer?.source,
              },
            });
            onDone();
          }}
        >
          Save
        </button>
        <button className="btn ghost small" onClick={onDone}>
          Cancel
        </button>
        <span className="spacer" />
        {answer && (
          <button
            className="btn ghost small"
            onClick={async () => {
              if (!confirm) return setConfirm(true);
              await op({ op: "deleteAnswer", id: answer.id });
              onDone();
            }}
          >
            {confirm ? "Press again to delete" : "Delete"}
          </button>
        )}
      </div>
    </div>
  );
}
