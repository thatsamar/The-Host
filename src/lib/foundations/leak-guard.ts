import "server-only";
import { createHash } from "node:crypto";

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
// Common words and phrases are left out of the index, so ordinary sentences
// never count. By text the answer is complete before it is sent, so a hit can
// be rewritten (the SMS route does this once, with a quick low-effort call).
// On the website a C2 answer is screened before release (screen.ts): text
// reaches the page only after it has been checked against the same index.

export const RUN_WORDS = 10;
export const PHRASE_HITS = 3;
/** The length of a shared phrase. */
export const PHRASE_WORDS = 5;
/** A sequence counts as distinctive only with at least this many words that aren't common ones. */
export const DISTINCT_WORDS = 3;

// Words too common to make a sequence distinctive: "at the end of the day it
// is what it is" is no sign of the foundation, whoever wrote it.
const COMMON = new Set(
  (
    "a an the and or but nor so yet for of to in on at by with from into onto out up down over under about as than then " +
    "is am are was were be been being do does did done have has had having will would shall should can could may might must " +
    "i me my mine we us our ours you your yours he him his she her hers it its they them their theirs this that these those " +
    "there here what which who whom whose when where why how all any both each every few more most other some such no not " +
    "only own same too very just also even still really much many lot lots one two first last next new old good great best " +
    "better well way ways thing things something anything everything nothing time times day days end make makes made take " +
    "takes took get gets got go goes going gone come comes came know knows think thinks want wants need needs like see say " +
    "says said tell look looks give gives put let lets keep keeps if because while though although until unless whether " +
    "i'm it's don't you're that's isn't can't won't i've you've we're they're there's what's let's"
  ).split(" "),
);

/** The words of a text, normalized (case, curly quotes, punctuation), with where each one is in the text. */
export interface Token {
  w: string;
  start: number;
  end: number;
}

const WORD = /[a-z0-9'‘’]+/gi;

export function tokens(text: string, offset = 0): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(WORD)) {
    out.push({ w: m[0].toLowerCase().replace(/[‘’]/g, "'"), start: offset + m.index!, end: offset + m.index! + m[0].length });
  }
  return out;
}

const words = (text: string) => tokens(text).map((t) => t.w);
const distinctive = (ws: string[]) => ws.filter((w) => !COMMON.has(w)).length >= DISTINCT_WORDS;

/**
 * The distinctive word sequences of an advisor's private material: every
 * RUN_WORDS-word and PHRASE_WORDS-word sequence with enough uncommon words.
 * Built once per version (leakIndexFor) and used by both channels.
 */
export interface LeakIndex {
  runs: Set<string>;
  phrases: Set<string>;
}

export function buildLeakIndex(...texts: string[]): LeakIndex {
  const runs = new Set<string>();
  const phrases = new Set<string>();
  for (const text of texts) {
    const f = words(text);
    for (let i = 0; i + PHRASE_WORDS <= f.length; i++) {
      const p = f.slice(i, i + PHRASE_WORDS);
      if (distinctive(p)) phrases.add(p.join(" "));
      if (i + RUN_WORDS <= f.length) {
        const r = f.slice(i, i + RUN_WORDS);
        if (distinctive(r)) runs.add(r.join(" "));
      }
    }
  }
  return { runs, phrases };
}

// One index per version of the material: keyed by its checksum, a handful kept.
const indexes = new Map<string, LeakIndex>();
const MAX_INDEXES = 16;

/** The index for an advisor's resolved C2 material (identity and foundation), built once per version. */
export function leakIndexFor(material: { identity?: string; foundation: string }): LeakIndex {
  const key = createHash("sha256").update(material.identity ?? "").update("\0").update(material.foundation).digest("hex");
  let index = indexes.get(key);
  if (!index) {
    index = buildLeakIndex(...(material.identity ? [material.identity] : []), material.foundation);
    if (indexes.size >= MAX_INDEXES) indexes.delete(indexes.keys().next().value!);
    indexes.set(key, index);
  }
  return index;
}

export interface LeakCheck {
  leaked: boolean;
  /** The longest run of the foundation's words found in the answer. */
  longestRun: number;
  /** How many separate stretches of the answer repeat a five-word phrase of the foundation. */
  phrases: number;
}

/** Checks a finished text (by text, before it is sent; on the website, after the screened stream as a count). */
export function checkLeak(answer: string, material: LeakIndex | string): LeakCheck {
  const index = typeof material === "string" ? buildLeakIndex(material) : material;
  const a = words(answer);
  // Consecutive matching RUN_WORDS-word windows make one run, RUN_WORDS - 1 words longer than the windows.
  let longestRun = 0;
  let windows = 0;
  for (let j = 0; j + RUN_WORDS <= a.length; j++) {
    windows = index.runs.has(a.slice(j, j + RUN_WORDS).join(" ")) ? windows + 1 : 0;
    if (windows) longestRun = Math.max(longestRun, windows + RUN_WORDS - 1);
  }
  // Each separate stretch of matching phrase windows counts once.
  let phrases = 0;
  let inRun = false;
  for (let j = 0; j + PHRASE_WORDS <= a.length; j++) {
    const hit = index.phrases.has(a.slice(j, j + PHRASE_WORDS).join(" "));
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
