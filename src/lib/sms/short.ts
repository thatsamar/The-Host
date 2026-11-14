/**
 * One short text per answer on Cinq by text (SMS_MAX_SEGMENTS). The advisor
 * is asked to design its answer for that length (textChannelNotes). If one
 * still runs long, it is rewritten to fit as one complete text (CONDENSE
 * prompt, a quick model call); only if that fails does this module keep the
 * whole sentences that fit, or as a last resort the words that fit, with
 * "...". It never cuts a word or an address and never adds a second text.
 */

import { fitsAnswerCap, plainPunctuation, SMS_TEXT_CHARS } from "./segments";

/** The plain text of an answer for a short text: GSM-friendly punctuation, "-" bullets, no blank-line padding. */
export function shortPlain(text: string): string {
  return plainPunctuation(text)
    .replace(/^(\s*)•\s/gm, "$1- ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Characters the advisor's own words have, after the label and any introduction (one line each). */
export function answerBudget(label: string, intro: string | null): number {
  return SMS_TEXT_CHARS - label.length - (intro ? intro.length + 1 : 0);
}

const ELLIPSIS = "...";

/**
 * The one text for an answer: label, introduction, answer, offer, each on
 * its own line. Returns the text and the answer as it was sent (what history
 * keeps, so a follow-up continues from what the person actually saw).
 */
export function shortAnswerText(parts: { label: string; intro: string | null; answer: string; offer: string | null }): {
  text: string;
  sent: string;
} {
  const compose = (answer: string) => parts.label + [parts.intro, answer, parts.offer].filter(Boolean).join("\n");
  const answer = shortPlain(parts.answer);
  if (fitsAnswerCap(compose(answer))) return { text: compose(answer), sent: answer };

  // Word by word, keeping the spaces and line breaks between them.
  const words = answer.split(/(\s+)/).filter((w) => w.length);
  const isUrl = (w: string) => /^\(?https?:\/\//.test(w);
  const prefix = (n: number) => words.slice(0, n).join("").trimEnd();

  // Longest run of whole sentences that fits.
  let best = "";
  for (let n = 1; n <= words.length; n++) {
    const w = words[n - 1];
    if (/\s/.test(w)) continue;
    if (!isUrl(w) && /[.!?]["')]*$/.test(w)) {
      const candidate = prefix(n);
      if (fitsAnswerCap(compose(candidate))) best = candidate;
      else break;
    }
  }
  if (best) return { text: compose(best), sent: best };

  // Not even one sentence fits: the words that do, then "...". An address is kept whole or left out.
  let cut = "";
  for (let n = 1; n <= words.length; n++) {
    const w = words[n - 1];
    if (/\s/.test(w)) continue;
    const candidate = prefix(n).replace(/[\s,;:—-]+$/, "") + ELLIPSIS;
    if (fitsAnswerCap(compose(candidate))) cut = candidate;
    else if (!isUrl(w)) break;
  }
  if (cut) return { text: compose(cut), sent: cut };
  // A single "word" longer than a whole text (never a real answer): cut it, the one place a cut is unavoidable.
  let room = answer.length;
  while (room > 0 && !fitsAnswerCap(compose(answer.slice(0, room) + ELLIPSIS))) room--;
  const forced = answer.slice(0, room) + ELLIPSIS;
  return { text: compose(forced), sent: forced };
}

/** Whether an answer, as it would be sent, fits the one text. */
export function answerFits(parts: { label: string; intro: string | null; answer: string; offer: string | null }): boolean {
  return shortAnswerText(parts).sent === shortPlain(parts.answer);
}

/** Characters the answer itself has, once the offer line (if any) is in the text too. */
export function roomForAnswer(budget: number, offer: string | null): number {
  return budget - (offer ? offer.length + 1 : 0);
}

/**
 * Instructions for rewriting an answer that came back too long into one
 * complete text: the same advisor's voice and view, designed for the room,
 * not cut down.
 */
export function condensePrompt(name: string, room: number): string {
  return [
    `You rewrite a text message from ${name}, one of Cinq's advisors, so it fits in one text of at most ${room} characters. Reply with the rewritten text only.`,
    "Keep the same voice, the same view and the single most useful point, specific and concrete. Make it one complete thought that ends cleanly: not a shortened version that trails off, no list or sequence it can't finish, no \"...\".",
    "Write it as plain text: no name label, no greeting or introduction, no headings, bullets or Markdown, no disclaimers or filler.",
    "If it offers to bring in another advisor, keep that offer, briefly.",
  ].join("\n");
}
