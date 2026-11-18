import type { Voice } from "./types";

export const OWN_VOICE_ID = "own";

export const BUILT_IN_VOICES: Voice[] = [
  {
    id: OWN_VOICE_ID,
    name: "Your voice",
    tagline: "Sounds like you, learned from what you've written",
    instructions:
      "No preset. Sound exactly like the person does in their past answers: their sentence length, their words, their punctuation, how formal they are.",
  },
  {
    id: "ownership",
    name: "Ownership",
    tagline: "You made the call and you own the result",
    instructions:
      "Write like someone who owns outcomes. First person, active verbs: I decided, I built, I shipped, I got it wrong and fixed it. Never 'we helped', 'was involved in' or 'contributed to'. Name the decision they made, why they made it, and what changed because of it. Own failures plainly, then say what they did next.",
  },
  {
    id: "crisp",
    name: "Crisp",
    tagline: "Every word earns its place",
    instructions:
      "Cut every word that isn't working. Short sentences, one idea each. Lead with the answer, then the proof. No throat-clearing, no 'I believe' or 'I think', no adjectives without evidence. Aim for about 30% shorter than a typical answer.",
  },
  {
    id: "founder",
    name: "Founder",
    tagline: "Ambitious, specific, and clear about why now",
    instructions:
      "Write like a founder a top accelerator would fund. Say what they're building in one sentence a smart outsider gets. Show the insight others miss, proof in numbers, and why now. Confident and concrete, never hype or buzzwords.",
  },
  {
    id: "proof",
    name: "Proof",
    tagline: "Every claim backed by a number or example",
    instructions:
      "Every claim carries a number, a name or a concrete example. Swap adjectives for evidence: 'grew revenue 3x in 6 months' beats 'drove strong growth'. If a number is missing from what you know, ask for it or leave a [bracketed placeholder]; never make one up.",
  },
  {
    id: "warm",
    name: "Warm",
    tagline: "Human and genuine, with one real moment",
    instructions:
      "Human and genuine. Show why they care through one real moment or story from their own experience. Plain, friendly words, no corporate phrasing, still specific about what they did.",
  },
  {
    id: "plain",
    name: "Plain",
    tagline: "Simple words anyone understands",
    instructions:
      "Use simple words a 12-year-old understands. No jargon; explain any acronym. Short sentences and short paragraphs. Keep every fact.",
  },
];

export function allVoices(custom: Record<string, Voice>): Voice[] {
  return [...BUILT_IN_VOICES, ...Object.values(custom).sort((a, b) => a.name.localeCompare(b.name))];
}

export function findVoice(id: string, custom: Record<string, Voice>): Voice {
  return allVoices(custom).find((v) => v.id === id) ?? BUILT_IN_VOICES[0];
}
