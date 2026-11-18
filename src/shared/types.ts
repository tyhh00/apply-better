// Everything apply-better stores lives in chrome.storage.local on your machine.

/** Where an answer came from. Only your own writing teaches the agent your style. */
export type AnswerSource =
  | "you" // you typed it into a form
  | "edited" // the agent drafted it and you changed it
  | "agent" // the agent drafted it and you kept it as is
  | "told" // you answered one of the agent's questions
  | "manual"; // you added or edited it in the Answers tab

export interface Answer {
  id: string;
  question: string;
  answer: string;
  projectId: string | null;
  source: AnswerSource;
  /** Page the answer was written on (empty for told/manual answers). */
  url: string;
  site: string;
  pageTitle: string;
  /** origin + path + field signature, so re-typing in the same box updates one record. */
  captureKey: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  /** What this application is and anything the agent should know for it. */
  brief: string;
  createdAt: number;
}

export interface Voice {
  id: string;
  name: string;
  /** One line shown in the picker. */
  tagline: string;
  /** How the agent should sound in this voice. */
  instructions: string;
  builtIn?: boolean;
}

export type AgentKind = "claude" | "codex";

export interface Site {
  origin: string;
  /** Match pattern Chrome granted, e.g. https://jobs.lever.co/* */
  pattern: string;
}

export interface Settings {
  agent: AgentKind;
  /** Empty = whatever your Claude Code / Codex is set to use. */
  model: string;
  activeProjectId: string | null;
  sites: Site[];
  aboutMe: string;
  voiceId: string;
}

export interface Store {
  answers: Record<string, Answer>;
  projects: Record<string, Project>;
  voices: Record<string, Voice>;
  settings: Settings;
}

/** Typed boxes, or one pick (radio / dropdown), or any number of picks (checkboxes). */
export type FieldKind = "text" | "textarea" | "rich" | "single" | "select" | "multi";

export const isChoice = (k: FieldKind) => k === "single" || k === "select" || k === "multi";

/** A form field found on the page. */
export interface PageField {
  /** frameId:fieldId, unique within the tab. */
  ref: string;
  frameId: number;
  fieldId: string;
  question: string;
  kind: FieldKind;
  inputType: string;
  maxLength: number | null;
  value: string;
  /** The choices, for radio buttons, checkboxes and dropdowns. */
  options: string[] | null;
}

export interface CapturePayload {
  question: string;
  answer: string;
  url: string;
  site: string;
  pageTitle: string;
  captureKey: string;
  source: AnswerSource;
}

/** What the agent asks you before it writes. */
export interface GapQuestion {
  question: string;
  why: string;
  fields: string[];
  suggestions: string[];
}

export interface DraftAnswer {
  field: string;
  answer: string;
  note: string;
}

export interface AuditResult {
  verdict: string;
  score: number;
  issues: { quote: string; problem: string; fix: string }[];
}

export interface RefineResult {
  text: string;
  changes: string[];
}

export interface AgentStatus {
  connected: boolean;
  error?: string;
  version?: string;
  agents?: Partial<Record<AgentKind, { path: string; version: string } | null>>;
}
