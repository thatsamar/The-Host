/**
 * One short text per answer on Cinq by text (SMS_MAX_SEGMENTS). The advisor
 * is asked to write to fit (textChannelNotes); this module puts the text
 * together and, if the answer still runs long, keeps the whole sentences
 * that fit, or failing that the words that fit, with "...". It never cuts
 * a word or an address and never adds a second text.
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
