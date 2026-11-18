import { useState } from "react";
import { useActiveTab, useStore, op } from "./hooks";
import { Mark } from "./ui";
import { FillTab } from "./tabs/Fill";
import { AnswersTab } from "./tabs/Answers";
import { ProjectsTab } from "./tabs/Projects";
import { VoicesTab } from "./tabs/Voices";
import { SettingsTab } from "./tabs/Settings";
import type { ActiveTab } from "./hooks";
import type { Store } from "../shared/types";

export type View = "fill" | "answers" | "projects" | "voices" | "settings";

export interface PanelProps {
  store: Store;
  tab: ActiveTab | null;
  goto: (v: View, opts?: { newProject?: boolean }) => void;
}

const VIEWS: { id: View; label: string }[] = [
  { id: "fill", label: "Fill" },
  { id: "answers", label: "Answers" },
  { id: "projects", label: "Projects" },
  { id: "voices", label: "Voices" },
  { id: "settings", label: "Settings" },
];

export function App() {
  const store = useStore();
  const tab = useActiveTab();
  const initial = (new URLSearchParams(location.search).get("view") as View | null) ?? "fill";
  const [view, setView] = useState<View>(VIEWS.some((v) => v.id === initial) ? initial : "fill");
  const [newProject, setNewProject] = useState(false);

  if (!store) return null;
  const goto: PanelProps["goto"] = (v, opts) => {
    setNewProject(!!opts?.newProject);
    setView(v);
  };
  const props: PanelProps = { store, tab, goto };
  const answerCount = Object.keys(store.answers).length;
  const projects = Object.values(store.projects).sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <Mark />
          <span className="brand-name">apply better</span>
          <select
            className="project-pick"
            aria-label="Project"
            value={store.settings.activeProjectId ?? ""}
            onChange={(e) => {
              if (e.target.value === "__new") return goto("projects", { newProject: true });
              op({ op: "settings", patch: { activeProjectId: e.target.value || null } });
            }}
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="__new">+ New project…</option>
          </select>
        </div>
        <nav className="tabs" role="tablist">
          {VIEWS.map((v) => (
            <button key={v.id} className="tab" role="tab" aria-selected={view === v.id} onClick={() => goto(v.id)}>
              {v.label}
              {v.id === "answers" && answerCount > 0 && <span className="count">{answerCount}</span>}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {view === "fill" && <FillTab {...props} />}
        {view === "answers" && <AnswersTab {...props} />}
        {view === "projects" && <ProjectsTab {...props} startNew={newProject} />}
        {view === "voices" && <VoicesTab {...props} />}
        {view === "settings" && <SettingsTab {...props} />}
      </main>
    </div>
  );
}
