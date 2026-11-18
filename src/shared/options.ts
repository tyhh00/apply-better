// Matching an answer like "Chinese" or "Design; Research" to a form's real options.
// Shared by the page (to tick the right box) and the side panel (to show matches).

export const normOption = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Several picks are stored as "A; B". */
export const joinPicks = (picks: string[]) => picks.join("; ");

/**
 * The options `value` names, written exactly as the form writes them,
 * or null if any part of it isn't one of the options.
 */
export function pickOptions(value: string, options: string[], multi: boolean): string[] | null {
  const parts = (multi ? value.split(/\s*[;\n]\s*/) : [value]).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const out: string[] = [];
  for (const part of parts) {
    const n = normOption(part);
    const hit =
      options.find((o) => normOption(o) === n) ??
      // "Yes" picks "Yes, I'm authorised to work here"; whole words only, so "No" never picks "Not sure".
      options.find((o) => {
        const m = normOption(o);
        return !!m && !!n && (m.startsWith(`${n} `) || n.startsWith(`${m} `));
      });
    if (!hit) return null;
    if (!out.includes(hit)) out.push(hit);
  }
  return out;
}
