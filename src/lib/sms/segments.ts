/**
 * How a text message travels: its encoding and how many segments it takes.
 *
 * A text with even one character outside GSM-7 (a curly apostrophe, an em
 * dash, "…", "•") is sent as UCS-2: 70 characters in a single text, 66 per
 * segment when long (toll-free to the US and Canada), and carriers lose
 * segments of long Unicode texts. Before this module Cinq sent 1,500-character
 * UCS-2 texts, about 23 segments each, and phones showed them with their
 * opening segments missing, starting mid-word. So: plain punctuation where it
 * means the same, and every text kept within MAX_SEGMENTS.
 */

// GSM 03.38 basic set (one unit each) and its extension table (two units each: escape + character).
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
const GSM_EXTENDED = new Set("^{}\\[~]|€\f");

/** Twilio's advice: carriers have trouble with Unicode texts longer than 10 segments. */
export const MAX_SEGMENTS = 10;

/**
 * How many segments an advisor's answer may take on Cinq by text: 3 (456
 * plain characters). Long texts lost their heads on real phones (even a
 * 9-segment plain one), while a 3-segment text arrived intact; one segment
 * proved too short (one beat per text). If 3-segment answers lose their
 * heads, lower it to 2 or 1; everything else follows from this number.
 */
export const SMS_MAX_SEGMENTS: number = 3;

/** Characters an answer text has in plain GSM-7 at SMS_MAX_SEGMENTS: 160 for one segment, 152 a segment beyond that. */
export const SMS_TEXT_CHARS = SMS_MAX_SEGMENTS === 1 ? 160 : SMS_MAX_SEGMENTS * 152;

/** Whether a text fits the answer cap, by its real encoding. */
export function fitsAnswerCap(text: string): boolean {
  return smsSegments(text) <= SMS_MAX_SEGMENTS;
}

export type SmsEncoding = "GSM-7" | "UCS-2";

export function smsEncoding(text: string): SmsEncoding {
  for (const ch of text) if (!GSM_BASIC.has(ch) && !GSM_EXTENDED.has(ch)) return "UCS-2";
  return "GSM-7";
}

/** Segments a text takes, with toll-free's per-segment sizes for long texts (152 GSM-7, 66 UCS-2). */
export function smsSegments(text: string): number {
  if (!text) return 0;
  if (smsEncoding(text) === "GSM-7") {
    let units = 0;
    for (const ch of text) units += GSM_EXTENDED.has(ch) ? 2 : 1;
    return units <= 160 ? 1 : Math.ceil(units / 152);
  }
  // UCS-2 counts UTF-16 code units (an emoji is two).
  return text.length <= 70 ? 1 : Math.ceil(text.length / 66);
}

/** Whether a text is short enough to arrive whole: at most MAX_SEGMENTS segments and `maxChars` characters. */
export function fitsInOneText(text: string, maxChars: number): boolean {
  return text.length <= maxChars && smsSegments(text) <= MAX_SEGMENTS;
}

/**
 * Plain punctuation for typographic punctuation that means the same, so a
 * text stays GSM-7 (more than twice the room per segment). Letters, the "•"
 * bullet and anything else are left as they are.
 */
export function plainPunctuation(text: string): string {
  return text
    .replace(/[‘’‚‛′ʼ]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[  -   　]/g, " ")
    .replace(/[​-‍⁠﻿]/g, "");
}
