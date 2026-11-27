import "server-only";

// Detects an answer reproducing an advisor's private foundation word for word
// (docs/foundations.md). Deterministic and local: no model call, no logging
// of either text. It finds a long run of identical words (RUN_WORDS or more,
// after normalizing case and punctuation), or several of the foundation's
// distinctive phrases. No guard, and no prompt instruction, can
// guarantee the material is never paraphrased or revealed; this catches the
// commonest failure, verbatim reproduction. A paraphrase of the founder's own
// examples (seen in testing) is not verbatim and is left to the advisor's
// instructions and to the extraction tests.
//
// By text the answer is complete before it is sent, so a hit can be rewritten
// (the SMS route does this once, with a quick low-effort call). On the website
// the answer streams to the page as it is written and can't be unsent, so a
// hit there is only detected and counted.

export const RUN_WORDS = 10;
export const PHRASE_HITS = 3;
/** The length of a shared phrase. */
export const PHRASE_WORDS = 5;

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

export interface LeakCheck {
  leaked: boolean;
  /** The longest run of the foundation's words found in the answer. */
  longestRun: number;
  /** How many separate stretches of the answer repeat a five-word phrase of the foundation. */
  phrases: number;
}

export function checkLeak(answer: string, foundation: string): LeakCheck {
  const a = words(answer);
  const f = words(foundation);
  let longestRun = 0;
  if (a.length && f.length) {
    // Every RUN_WORDS-word window of the foundation; then extend matches to measure the run.
    const index = new Map<string, number[]>();
    for (let i = 0; i + RUN_WORDS <= f.length; i++) {
      const key = f.slice(i, i + RUN_WORDS).join(" ");
      const at = index.get(key);
      if (at) at.push(i);
      else index.set(key, [i]);
    }
    for (let j = 0; j + RUN_WORDS <= a.length; j++) {
      const starts = index.get(a.slice(j, j + RUN_WORDS).join(" "));
      if (!starts) continue;
      for (const i of starts) {
        let n = RUN_WORDS;
        while (i + n < f.length && j + n < a.length && f[i + n] === a[j + n]) n++;
        longestRun = Math.max(longestRun, n);
      }
    }
  }
  // Shorter shared phrases: distinct PHRASE_WORDS-word sequences of the foundation that the answer repeats.
  const shingles = new Set<string>();
  for (let i = 0; i + PHRASE_WORDS <= f.length; i++) shingles.add(f.slice(i, i + PHRASE_WORDS).join(" "));
  // Each separate stretch of matching windows counts once.
  let phrases = 0;
  let inRun = false;
  for (let j = 0; j + PHRASE_WORDS <= a.length; j++) {
    const hit = shingles.has(a.slice(j, j + PHRASE_WORDS).join(" "));
    if (hit && !inRun) phrases++;
    inRun = hit;
  }
  return { leaked: longestRun >= RUN_WORDS || phrases >= PHRASE_HITS, longestRun, phrases };
}

/** The instruction for the one rewrite by text: the answer only goes to the rewrite, never the foundation. */
export const LEAK_REWRITE_PROMPT = (name: string, room: number) =>
  `You are rewriting a text message from ${name}, an advisor. Keep its meaning, its advice and its warmth, but express it entirely in fresh words of your own: no sentence or phrase may be carried over word for word from any source the advisor drew on. Keep it to one text of at most ${room} characters. Plain text, no Markdown, no name label. Return only the rewritten message.`;

/** A reply's sentences, so a reply whose rewrite failed can keep only those that don't repeat the foundation. */
export function sentencesOf(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+["')\u201d]*|[^.!?]+$/g) ?? []).map((s) => s.trim()).filter(Boolean);
}
