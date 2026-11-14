/**
 * What of a number's stored conversation reaches the advisor. Everything
 * stays stored, but only turns from the last CONTEXT_WINDOW_MS are sent: a
 * new day starts fresh on specifics (yesterday's suitcase, last night's
 * dinner) unless the person raises them again. Turns stored before turns
 * carried a time have none, and count as older than the window: a one-time
 * fresh start for existing sessions.
 */

import { HANDOFF_NOTE_PREFIX } from "./handoff";
import { SMS_ADVISORS } from "./navigation";
import type { SmsTurn } from "./store";

/** How far back the advisor sees: 24 hours. */
export const CONTEXT_WINDOW_MS = 24 * 60 * 60 * 1000;

function isRecent(turn: SmsTurn, now: number): boolean {
  return typeof turn.at === "number" && now - turn.at <= CONTEXT_WINDOW_MS;
}

export function isHandoffNote(turn: SmsTurn): boolean {
  return turn.note === "handoff" || (turn.role === "user" && turn.text.startsWith(HANDOFF_NOTE_PREFIX));
}

/** The advisor who handed over, from the note's own field or, for notes stored before it had one, its text. */
function noteFrom(turn: SmsTurn): string | null {
  const named = SMS_ADVISORS.find((a) => a.id === turn.from)?.name;
  if (named) return named;
  const word = turn.text.slice(HANDOFF_NOTE_PREFIX.length).trim().split(/\s/)[0];
  return SMS_ADVISORS.find((a) => a.name === word)?.name ?? null;
}

/**
 * The turns to send the advisor: recent turns as they are, and a handoff
 * note kept whatever its age, so the advisor always knows who brought them
 * in. An older note is cut down to that fact: the first advisor's answer,
 * a specific of its day, is left out. Only role, text and photos are sent.
 */
export function recentTurns(turns: SmsTurn[], now: number): SmsTurn[] {
  const out: SmsTurn[] = [];
  for (const turn of turns) {
    if (isRecent(turn, now)) {
      out.push({ role: turn.role, text: turn.text, images: turn.images });
    } else if (isHandoffNote(turn)) {
      const from = noteFrom(turn);
      if (from) out.push({ role: "user", text: `${HANDOFF_NOTE_PREFIX} ${from} brought you in earlier, more than a day ago.` });
    }
  }
  return out;
}
