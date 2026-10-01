// Some companions end each answer with a notes block the app reads:
//
//   <the answer, in prose>
//   <notes>
//   {"thing_under_the_thing": "...", "one_sentence": "...", ...}
//   </notes>
//
// The person sees the prose, and the notes as cards beneath it. The raw text,
// notes included, is what goes back to the model as history, so it can see
// its own earlier drafts and safety calls. Parsing is lenient: anything
// missing or malformed reads as null, and a broken block leaves plain prose.

import { z } from "zod";

const OPEN = "<notes>";
const CLOSE = "</notes>";

const line = z
  .string()
  .transform((s) => s.trim() || null)
  .nullable()
  .catch(null);

const notesSchema = z.object({
  thing_under_the_thing: line,
  one_sentence: line,
  next_move: line,
  safety_flag: z.enum(["none", "low", "medium", "high"]).catch("none"),
  suggested_memory_pattern: line,
  draft_message: line,
});

export type SafetyFlag = "none" | "low" | "medium" | "high";

export interface AnswerNotes {
  thing_under_the_thing: string | null;
  one_sentence: string | null;
  next_move: string | null;
  safety_flag: SafetyFlag;
  suggested_memory_pattern: string | null;
  draft_message: string | null;
}

/**
 * Splits an answer into the prose to show and its notes. While the answer is
 * still streaming, a half-written notes block (or the start of its tag) is
 * hidden rather than flashed on screen.
 */
export function splitNotes(text: string): { prose: string; notes: AnswerNotes | null } {
  const start = text.indexOf(OPEN);
  if (start === -1) return { prose: withoutPartialTag(text).trimEnd(), notes: null };
  const prose = text.slice(0, start).trimEnd();
  const end = text.indexOf(CLOSE, start);
  const raw = text.slice(start + OPEN.length, end === -1 ? undefined : end);
  return { prose, notes: parseNotes(raw) };
}

/** Drops a trailing "<", "<no", "<note"… that may be the notes tag arriving. */
function withoutPartialTag(text: string): string {
  const lt = text.lastIndexOf("<");
  if (lt !== -1 && lt > text.length - OPEN.length && OPEN.startsWith(text.slice(lt))) return text.slice(0, lt);
  return text;
}

export function parseNotes(raw: string): AnswerNotes | null {
  const body = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first === -1 || last <= first) return null;
  let json: unknown;
  try {
    json = JSON.parse(body.slice(first, last + 1));
  } catch {
    return null;
  }
  const parsed = notesSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** True when any answer so far called for care: errors then read plainly. */
export function isCareful(answers: string[]): boolean {
  return answers.some((text) => {
    const flag = splitNotes(text).notes?.safety_flag;
    return flag === "medium" || flag === "high";
  });
}
