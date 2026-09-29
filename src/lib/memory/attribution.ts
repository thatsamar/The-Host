// Deterministic checks applied to every extracted proposal, so attribution
// and conservatism don't depend on the model getting it right:
//
// 1. Evidence: each proposal must quote words that actually appear in what
//    Courtney or Amar wrote. Anything supported only by Gio's reply is dropped,
//    so Gio's advice is never recorded as their preference.
// 2. Speaker attribution: a preference belongs to whoever said it. It becomes
//    shared only when the speaker says so ("we", "both of us") or the message
//    was sent as Both. It is attributed to the other person only when the
//    message names them ("Courtney wants the linen").
// 3. Duplicates of existing memories or decisions are dropped.

import type { MemoryType } from "@/lib/db/types";
import type { HumanSpeaker } from "@/lib/gio/speakers";

export const PREFERENCE_TYPES: readonly MemoryType[] = [
  "design_preference",
  "courtney_preference",
  "amar_preference",
  "shared_preference",
];

export function isPreferenceType(type: MemoryType): boolean {
  return PREFERENCE_TYPES.includes(type);
}

export function preferenceTypeFor(holder: HumanSpeaker): MemoryType {
  return holder === "Courtney" ? "courtney_preference" : holder === "Amar" ? "amar_preference" : "shared_preference";
}

/** Lowercase, straight quotes, single spaces, no surrounding punctuation. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'.,;:!?\-\s]+|["'.,;:!?\-\s]+$/g, "");
}

/** True when the quoted evidence really appears in the user's own message. */
export function evidenceSupported(evidence: string, userText: string): boolean {
  const quote = normalizeForMatch(evidence);
  if (quote.length < 4) return false;
  const source = normalizeForMatch(userText);
  if (source.includes(quote)) return true;
  // Tolerate an ellipsis joining two real fragments.
  const parts = quote.split(/\s*(?:\.\.\.|…)\s*/).filter((p) => p.length >= 4);
  return parts.length > 1 && parts.every((p) => source.includes(p));
}

const SHARED_LANGUAGE = /\b(we|we're|we've|us|our|ours|both|together|each of us)\b/i;

function names(text: string): Set<HumanSpeaker> {
  const found = new Set<HumanSpeaker>();
  if (/\bcourtney\b/i.test(text)) found.add("Courtney");
  if (/\bamar\b/i.test(text)) found.add("Amar");
  return found;
}

/**
 * Who a proposal belongs to, given who sent the message and what they wrote.
 * `claimed` is the model's guess; it is only trusted when the text backs it.
 */
export function resolveHolder(
  claimed: HumanSpeaker | "none",
  speaker: HumanSpeaker,
  userText: string,
  evidence: string,
): HumanSpeaker {
  const named = names(userText);
  if (claimed === "Courtney" || claimed === "Amar") {
    if (claimed === speaker) return claimed;
    // Reported preference ("Courtney wants the linen"): only if she's named.
    if (named.has(claimed)) return claimed;
    return speaker === "Both" ? "Both" : speaker;
  }
  if (claimed === "Both") {
    if (speaker === "Both") return "Both";
    return SHARED_LANGUAGE.test(evidence) || SHARED_LANGUAGE.test(userText) ? "Both" : speaker;
  }
  return speaker;
}

function tokens(text: string): Set<string> {
  return new Set(normalizeForMatch(text).match(/[a-z0-9']+/g)?.filter((t) => t.length > 2) ?? []);
}

/** Jaccard overlap of meaningful words, 0 to 1. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export const DUPLICATE_THRESHOLD = 0.7;

export function isDuplicate(text: string, existing: string[]): boolean {
  const n = normalizeForMatch(text);
  return existing.some((e) => normalizeForMatch(e) === n || similarity(text, e) >= DUPLICATE_THRESHOLD);
}
