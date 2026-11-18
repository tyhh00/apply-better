// Reading the store is open to every part of the extension.
// Writing goes through the background (see background/index.ts) so that a capture
// on the page and an edit in the side panel never overwrite each other.
import type { Answer, Project, Settings, Store, Voice } from "./types";
import { OWN_VOICE_ID } from "./voices";

export const DEFAULT_SETTINGS: Settings = {
  agent: "claude",
  model: "",
  activeProjectId: null,
  sites: [],
  aboutMe: "",
  voiceId: OWN_VOICE_ID,
};

const KEYS = ["answers", "projects", "voices", "settings"] as const;

export async function readStore(): Promise<Store> {
  const raw = (await chrome.storage.local.get([...KEYS])) as Partial<Store>;
  return {
    answers: raw.answers ?? {},
    projects: raw.projects ?? {},
    voices: raw.voices ?? {},
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
  };
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Operations the background applies one at a time. */
export type StoreOp =
  | { op: "upsertAnswer"; answer: Partial<Answer> & { question: string; answer: string } }
  | { op: "deleteAnswer"; id: string }
  | { op: "saveProject"; project: Partial<Project> & { name: string } }
  | { op: "deleteProject"; id: string }
  | { op: "saveVoice"; voice: Partial<Voice> & { name: string; instructions: string } }
  | { op: "deleteVoice"; id: string }
  | { op: "settings"; patch: Partial<Settings> }
  | { op: "import"; data: Partial<Store> }
  | { op: "wipe" };

export function applyOp(store: Store, o: StoreOp): { store: Store; result?: unknown } {
  const now = Date.now();
  switch (o.op) {
    case "upsertAnswer": {
      const prev = o.answer.id ? store.answers[o.answer.id] : undefined;
      const a: Answer = {
        id: prev?.id ?? o.answer.id ?? newId("a"),
        question: o.answer.question,
        answer: o.answer.answer,
        projectId: o.answer.projectId !== undefined ? o.answer.projectId : (prev?.projectId ?? null),
        source: o.answer.source ?? prev?.source ?? "manual",
        url: o.answer.url ?? prev?.url ?? "",
        site: o.answer.site ?? prev?.site ?? "",
        pageTitle: o.answer.pageTitle ?? prev?.pageTitle ?? "",
        captureKey: o.answer.captureKey ?? prev?.captureKey ?? null,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
      };
      return { store: { ...store, answers: { ...store.answers, [a.id]: a } }, result: a };
    }
    case "deleteAnswer": {
      const answers = { ...store.answers };
      delete answers[o.id];
      return { store: { ...store, answers } };
    }
    case "saveProject": {
      const prev = o.project.id ? store.projects[o.project.id] : undefined;
      const p: Project = {
        id: prev?.id ?? newId("p"),
        name: o.project.name,
        brief: o.project.brief ?? prev?.brief ?? "",
        createdAt: prev?.createdAt ?? now,
      };
      return { store: { ...store, projects: { ...store.projects, [p.id]: p } }, result: p };
    }
    case "deleteProject": {
      const projects = { ...store.projects };
      delete projects[o.id];
      // Answers stay in your pool; they just stop belonging to the project.
      const answers = Object.fromEntries(
        Object.entries(store.answers).map(([k, a]) => [k, a.projectId === o.id ? { ...a, projectId: null } : a]),
      );
      const settings =
        store.settings.activeProjectId === o.id ? { ...store.settings, activeProjectId: null } : store.settings;
      return { store: { ...store, projects, answers, settings } };
    }
    case "saveVoice": {
      const prev = o.voice.id ? store.voices[o.voice.id] : undefined;
      const v: Voice = {
        id: prev?.id ?? newId("v"),
        name: o.voice.name,
        tagline: o.voice.tagline ?? prev?.tagline ?? "",
        instructions: o.voice.instructions,
      };
      return { store: { ...store, voices: { ...store.voices, [v.id]: v } }, result: v };
    }
    case "deleteVoice": {
      const voices = { ...store.voices };
      delete voices[o.id];
      const settings =
        store.settings.voiceId === o.id ? { ...store.settings, voiceId: OWN_VOICE_ID } : store.settings;
      return { store: { ...store, voices, settings } };
    }
    case "settings":
      return { store: { ...store, settings: { ...store.settings, ...o.patch } } };
    case "import": {
      const d = o.data;
      return {
        store: {
          answers: { ...store.answers, ...(d.answers ?? {}) },
          projects: { ...store.projects, ...(d.projects ?? {}) },
          voices: { ...store.voices, ...(d.voices ?? {}) },
          settings: store.settings,
        },
      };
    }
    case "wipe":
      return { store: { answers: {}, projects: {}, voices: {}, settings: { ...store.settings, activeProjectId: null } } };
  }
}
