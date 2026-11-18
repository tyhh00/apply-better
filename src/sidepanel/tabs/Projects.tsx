import { useState } from "react";
import type { PanelProps } from "../App";
import { op } from "../hooks";
import { Empty, timeAgo } from "../ui";
import type { Project } from "../../shared/types";
import { SOURCE_LABEL } from "./Answers";

export function ProjectsTab({ store, startNew }: PanelProps & { startNew?: boolean }) {
  const [creating, setCreating] = useState(!!startNew);
  const [openId, setOpenId] = useState<string | null>(null);
  const projects = Object.values(store.projects).sort((a, b) => b.createdAt - a.createdAt);
  const counts = new Map<string, number>();
  for (const a of Object.values(store.answers)) if (a.projectId) counts.set(a.projectId, (counts.get(a.projectId) ?? 0) + 1);

  const open = openId ? store.projects[openId] : null;
  if (open) return <ProjectDetail project={open} store={store} onBack={() => setOpenId(null)} />;

  return (
    <div className="stack">
      <div className="stack tight">
        <h2>Projects</h2>
        <p className="muted small">
          One project per application, like "YC W27" or "Stripe, product role". The answers you write go to the active project, and its notes tell
          the agent what this application is about.
        </p>
      </div>
      {creating ? (
        <ProjectForm
          onSave={async (name, brief) => {
            const p = await op<Project>({ op: "saveProject", project: { name, brief } });
            await op({ op: "settings", patch: { activeProjectId: p.id } });
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <div>
          <button className="btn primary small" onClick={() => setCreating(true)}>
            + New project
          </button>
        </div>
      )}
      {!projects.length && !creating ? (
        <Empty title="No projects yet">
          <p>Answers still save without one. Make a project when you start an application you want the agent to tailor to.</p>
        </Empty>
      ) : (
        <div className="list">
          {projects.map((p) => (
            <button className="item" key={p.id} onClick={() => setOpenId(p.id)}>
              <span className="row">
                <span className="q">{p.name}</span>
                <span className="spacer" />
                {store.settings.activeProjectId === p.id && <span className="tag solid">Active</span>}
              </span>
              {p.brief && <span className="a">{p.brief}</span>}
              <span className="meta">
                <span>
                  {counts.get(p.id) ?? 0} question{counts.get(p.id) === 1 ? "" : "s"}
                </span>
                <span>started {timeAgo(p.createdAt)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectForm({ project, onSave, onCancel }: { project?: Project; onSave: (name: string, brief: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(project?.name ?? "");
  const [brief, setBrief] = useState(project?.brief ?? "");
  return (
    <div className="card">
      <label className="field">
        <span>Name</span>
        <input type="text" autoFocus value={name} placeholder="e.g. YC W27 application" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>What the agent should know</span>
        <textarea
          rows={4}
          value={brief}
          placeholder="What is this application? What's the role or program, what do they look for, and what do you want to lead with?"
          onChange={(e) => setBrief(e.target.value)}
        />
      </label>
      <div className="row">
        <button className="btn primary small" disabled={!name.trim()} onClick={() => onSave(name.trim(), brief.trim())}>
          Save
        </button>
        <button className="btn ghost small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ProjectDetail({ project, store, onBack }: { project: Project; store: PanelProps["store"]; onBack: () => void }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const active = store.settings.activeProjectId === project.id;
  const answers = Object.values(store.answers)
    .filter((a) => a.projectId === project.id)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div className="stack">
      <div>
        <button className="btn ghost small" onClick={onBack}>
          ← All projects
        </button>
      </div>
      {editing ? (
        <ProjectForm
          project={project}
          onSave={async (name, brief) => {
            await op({ op: "saveProject", project: { id: project.id, name, brief } });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="card">
          <div className="row">
            <h2 style={{ flex: 1 }}>{project.name}</h2>
            {active ? (
              <span className="tag solid">Active</span>
            ) : (
              <button className="btn small primary" onClick={() => op({ op: "settings", patch: { activeProjectId: project.id } })}>
                Make active
              </button>
            )}
          </div>
          <p className="muted" style={{ whiteSpace: "pre-wrap" }}>
            {project.brief || "No notes yet. Add what this application is and what you want to lead with."}
          </p>
          <div className="row">
            <button className="btn small" onClick={() => setEditing(true)}>
              Edit
            </button>
            <span className="spacer" />
            <button
              className="btn ghost small"
              onClick={async () => {
                if (!confirm) return setConfirm(true);
                await op({ op: "deleteProject", id: project.id });
                onBack();
              }}
            >
              {confirm ? "Press again: answers stay, the project goes" : "Delete project"}
            </button>
          </div>
        </div>
      )}
      <h3>
        {answers.length} question{answers.length === 1 ? "" : "s"} in this project
      </h3>
      {!answers.length ? (
        <p className="muted small">Make this project active and fill in its form. Every question you answer lands here.</p>
      ) : (
        <div className="list">
          {answers.map((a) => (
            <div className="item" key={a.id}>
              <span className="q">{a.question}</span>
              <span className="a">{a.answer}</span>
              <span className="meta">
                <span>{SOURCE_LABEL[a.source]}</span>
                {a.site && <span>{a.site}</span>}
                <span>{timeAgo(a.updatedAt)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
