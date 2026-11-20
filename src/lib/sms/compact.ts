/**
 * What of a number's conversation is kept when its session is saved. The
 * whole session is one row, rewritten on every save, so it must stay small:
 * MMS photos (base64, often megabytes) and turns no advisor will see again
 * made the row grow with every text until the save ran past the database's
 * statement timeout.
 *
 * Kept: the turns from the last CONTEXT_WINDOW_MS (all an advisor sees, see
 * context.ts), handoff notes whatever their age (an older one stored as the
 * shortened note the advisor is sent anyway), and the photos of the current
 * advisor's latest question only, so a follow-up or a handoff still has them.
 * Other photos are dropped from their turns; a photo-only turn keeps a short
 * stand-in so it is never empty. Every advisor with turns is remembered as
 * met before older turns go, so none introduces themselves again.
 */

import { CONTEXT_WINDOW_MS, isHandoffNote, recentTurns } from "./context";
import type { SmsSession, SmsTurn } from "./store";

function isRecent(turn: SmsTurn, now: number): boolean {
  return typeof turn.at === "number" && now - turn.at <= CONTEXT_WINDOW_MS;
}

function photoStandIn(count: number): string {
  return count === 1 ? "(Sent a photo earlier.)" : `(Sent ${count} photos earlier.)`;
}

/** A copy of the session as it should be stored at `now`. The session itself is not changed. */
export function compactSession(session: SmsSession, now: number): SmsSession {
  const introduced = [...(session.introduced ?? [])];
  const turnsByAdvisor: Record<string, SmsTurn[]> = {};

  for (const [advisorId, turns] of Object.entries(session.turnsByAdvisor)) {
    if (!Array.isArray(turns)) continue;
    if (turns.length && !introduced.includes(advisorId)) introduced.push(advisorId);
    // Only the current advisor's latest question keeps its photos.
    const keepPhotosAt = advisorId === session.advisorId ? turns.findLastIndex((t) => t.role === "user" && !isHandoffNote(t)) : -1;
    const kept: SmsTurn[] = [];
    turns.forEach((turn, i) => {
      if (!isRecent(turn, now)) {
        // An older note is stored as the shortened note the advisor would be sent.
        if (!isHandoffNote(turn)) return;
        const [short] = recentTurns([turn], now);
        if (!short) return;
        kept.push({ ...stripImages(turn), text: short.text });
        return;
      }
      kept.push(i === keepPhotosAt ? turn : stripImages(turn));
    });
    if (kept.length) turnsByAdvisor[advisorId] = kept;
  }

  return { ...session, turnsByAdvisor, ...(introduced.length ? { introduced } : {}) };
}

function stripImages(turn: SmsTurn): SmsTurn {
  if (!turn.images?.length) return turn;
  const { images, ...rest } = turn;
  return { ...rest, text: rest.text.trim() ? rest.text : photoStandIn(images.length) };
}
