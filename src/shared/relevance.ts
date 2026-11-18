// Picks which past answers to show the agent for a new form. Plain BM25 over
// question + answer text: no network calls and no embedding model needed.
import type { Answer } from "./types";

const STOP = new Set(
  "a an and are as at be but by can do does for from had has have how i if in into is it its me my of on or our so than that the their them then there these they this to us was we were what when where which who why will with would you your yours about also any all".split(
    " ",
  ),
);

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1 && !STOP.has(t)).map(stem);
}

function stem(t: string): string {
  return t.replace(/(ing|ed|es|s)$/, "") || t;
}

export function rank(query: string, docs: Answer[], limit: number): { answer: Answer; score: number }[] {
  const q = [...new Set(tokens(query))];
  if (!q.length || !docs.length) return [];
  const docTokens = docs.map((d) => tokens(`${d.question} ${d.question} ${d.answer}`));
  const avg = docTokens.reduce((s, t) => s + t.length, 0) / docTokens.length || 1;
  const df = new Map<string, number>();
  for (const t of docTokens) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = docs.length;
  const k1 = 1.2;
  const b = 0.75;
  return docs
    .map((answer, i) => {
      const tf = new Map<string, number>();
      for (const w of docTokens[i]) tf.set(w, (tf.get(w) ?? 0) + 1);
      let score = 0;
      for (const w of q) {
        const f = tf.get(w);
        if (!f) continue;
        const n = df.get(w) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * docTokens[i].length) / avg));
      }
      return { answer, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Answers that show how the person writes: their own words, long enough to carry a style. */
export function styleSamples(answers: Answer[], exclude: Set<string>, limit: number): Answer[] {
  return answers
    .filter((a) => (a.source === "you" || a.source === "edited" || a.source === "manual") && a.answer.length >= 120)
    .filter((a) => !exclude.has(a.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / (A.size + B.size - n);
}

/** Your latest answer to the same question, if you've answered it before. */
export function pastAnswerFor(question: string, answers: Answer[], minSimilarity = 0.75): Answer | null {
  const q = tokens(question);
  let best: Answer | null = null;
  let bestScore = 0;
  for (const a of answers) {
    if (a.source === "told" || !a.answer.trim()) continue;
    const s = jaccard(q, tokens(a.question));
    if (s < minSimilarity) continue;
    // Closest question wins; between equally close ones, the newest answer wins.
    if (s > bestScore || (s === bestScore && best && a.updatedAt > best.updatedAt)) {
      best = a;
      bestScore = s;
    }
  }
  return best;
}
