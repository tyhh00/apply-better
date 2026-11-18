import type { ReactNode } from "react";

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="var(--ink)" />
      <rect x="15" y="18" width="34" height="5" rx="2.5" fill="var(--paper)" />
      <rect x="15" y="29.5" width="34" height="5" rx="2.5" fill="var(--paper)" opacity="0.55" />
      <rect x="15" y="41" width="20" height="5" rx="2.5" fill="var(--paper)" opacity="0.55" />
      <path d="M40 46.5l4 4 8.5-9.5" stroke="var(--paper)" strokeWidth="4.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Thinking({ title, steps, onStop }: { title: string; steps?: string[]; onStop?: () => void }) {
  return (
    <div className="thinking" role="status" aria-live="polite">
      <div className="pulse">
        <i />
        <i />
        <i />
      </div>
      <h2>{title}</h2>
      {steps?.length ? (
        <div className="steps">
          {steps.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
      ) : null}
      {onStop && (
        <button className="btn ghost small" onClick={onStop}>
          Stop
        </button>
      )}
    </div>
  );
}

export function Counter({ text, max }: { text: string; max: number | null }) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <span className={`counter${max && text.length > max ? " over" : ""}`}>
      {words} words · {max ? `${text.length} / ${max}` : `${text.length}`} characters
    </span>
  );
}

export function AgentError({ message, onSettings, onRetry }: { message: string; onSettings?: () => void; onRetry?: () => void }) {
  if (message === "stopped") return null;
  if (message === "bridge-missing" || message === "bridge-forbidden")
    return (
      <div className="error">
        <h3>Connect apply better to your agent</h3>
        <p className="muted">
          It writes with Claude Code or Codex on your computer. That takes one command, run once in the folder where you
          downloaded apply better:
        </p>
        <div className="code">
          npm run connect{message === "bridge-forbidden" ? ` -- --extension-id ${chrome.runtime.id}` : ""}
        </div>
        <div className="row">
          {onRetry && (
            <button className="btn primary small" onClick={onRetry}>
              I ran it, try again
            </button>
          )}
          {onSettings && (
            <button className="btn small" onClick={onSettings}>
              Open Settings
            </button>
          )}
        </div>
      </div>
    );
  return (
    <div className="error">
      <h3>That didn't work</h3>
      <p className="muted" style={{ whiteSpace: "pre-wrap" }}>
        {message}
      </p>
      {onRetry && (
        <div>
          <button className="btn small" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

export function timeAgo(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(t).toLocaleDateString();
}
