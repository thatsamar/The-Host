import type { AskTurn } from "./prompt";

// Vercel caps a request body at 4.5 MB, and every question resends the visit's
// conversation. Photos dominate the size, so older ones give way first.
export const REQUEST_BUDGET = 3_800_000;

function size(turns: AskTurn[]): number {
  return turns.reduce((n, t) => n + t.text.length + (t.images ?? []).reduce((m, i) => m + i.data.length, 0), 0);
}

/**
 * Drops photos from the oldest turns until the request fits, leaving a note in
 * their place. The latest turn's photos are never dropped; if they alone are
 * too big, this throws a message to show.
 */
export function fitToBudget(turns: AskTurn[], budget = REQUEST_BUDGET): AskTurn[] {
  const out = turns.map((t) => ({ ...t }));
  for (let i = 0; i < out.length - 1 && size(out) > budget; i++) {
    const n = out[i].images?.length ?? 0;
    if (!n) continue;
    const note = `(${n === 1 ? "A photo was" : `${n} photos were`} shared here earlier.)`;
    out[i] = { ...out[i], images: [], text: out[i].text.trim() ? `${out[i].text}\n\n${note}` : note };
  }
  if (size(out) > budget) throw new Error("Those photos are too large to send together. Try fewer.");
  return out;
}
