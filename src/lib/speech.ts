/**
 * Reading an answer aloud with the browser's own voice (Web Speech API):
 * nothing leaves the device and nothing is paid for. These helpers turn an
 * answer's Markdown into plain sentences a voice can read.
 */

/** Some browsers stop a single long utterance partway, so read in pieces of at most this many characters. */
export const MAX_SPOKEN_CHUNK = 220;

/** The words of a Markdown answer, without the symbols a voice would read out. */
export function speakableText(markdown: string): string {
  return (
    markdown
      // Code blocks and inline code: keep the words, drop the fences and ticks.
      .replace(/```[^\n]*\n?/g, "")
      .replace(/`([^`]*)`/g, "$1")
      // Images and links: keep the label, never read the address.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      // Table rules and cell bars.
      .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, "")
      .replace(/^[ \t]*\|/gm, "")
      .replace(/\|[ \t]*$/gm, "")
      .replace(/[ \t]*\|[ \t]*/g, ", ")
      // Headings, quotes, list markers and horizontal rules.
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/^\s*(?:[-*_]\s*){3,}$/gm, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
      // Emphasis and strikethrough.
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1")
      .replace(/~~(.+?)~~/g, "$1")
      // A heading or list item with no closing stop still deserves a pause.
      .split(/\n+/)
      .map((line) => line.replace(/^[,\s]+|[,\s]+$/g, ""))
      .filter(Boolean)
      .map((line) => (/[.!?:;…]["”’)]?$/.test(line) ? line : `${line}.`))
      .join(" ")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

/** Split text into pieces of at most `max` characters, at sentence ends where possible, then at commas or spaces. */
export function spokenChunks(text: string, max = MAX_SPOKEN_CHUNK): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]+["”’)]*\s*|[^.!?…]+$/g) ?? [];
  const chunks: string[] = [];
  let current = "";
  const push = (piece: string) => {
    const trimmed = piece.trim();
    if (trimmed) chunks.push(trimmed);
  };
  for (const sentence of sentences) {
    if ((current + sentence).length <= max) {
      current += sentence;
      continue;
    }
    push(current);
    current = "";
    let rest = sentence;
    while (rest.length > max) {
      const window = rest.slice(0, max);
      const cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf(" "));
      const at = cut > max / 3 ? cut + 1 : max;
      push(rest.slice(0, at));
      rest = rest.slice(at);
    }
    current = rest;
  }
  push(current);
  return chunks;
}

/** What the page needs to know about a device voice (a subset of SpeechSynthesisVoice). */
export interface DeviceVoice {
  name: string;
  lang: string;
  localService?: boolean;
}

/** The parts of an advisor's voice profile used to choose a device voice. */
export interface VoiceChoice {
  preferred: string[];
  lang: string;
  gender: "female" | "male";
}

// Novelty voices that would make an advisor sound like a joke.
const NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|junior|organ|pipe organ|superstar|trinoids|whisper|wobble|zarvox|fred|ralph|kathy|princess|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley)\b/i;
// Common device voices whose gender the name alone doesn't say.
const FEMALE = /\b(female|samantha|ava|allison|susan|zoe|victoria|karen|moira|tessa|veena|fiona|serena|kate|martha|stephanie|catherine|nicky|joelle|aria|jenny|sonia|libby|natasha|clara|emma|michelle|sara|google us english)\b/i;
const MALE = /\b(male|daniel|arthur|oliver|jamie|alex|aaron|tom|evan|nathan|gordon|lee|rishi|ryan|thomas|guy|andrew|davis|william|liam|christopher|eric|brian)\b/i;
// Higher-quality variants are worth preferring when the device has them.
const QUALITY = /\b(premium|enhanced|natural|neural|online)\b/i;

function voiceGender(name: string): "female" | "male" | null {
  if (/\bfemale\b/i.test(name)) return "female";
  if (/\bmale\b/i.test(name)) return "male";
  if (FEMALE.test(name)) return "female";
  if (MALE.test(name)) return "male";
  return null;
}

/** "Daniel" matches "Daniel", "Daniel (Enhanced)" and "Daniel (English (United Kingdom))", not "Danielle". */
function nameMatches(voiceName: string, wanted: string): boolean {
  const name = voiceName.toLowerCase();
  const want = wanted.toLowerCase();
  return name === want || (name.startsWith(want) && !/[a-z]/.test(name[want.length]));
}

/**
 * The device voice that best fits an advisor: a preferred voice by name first,
 * then an English voice with the right accent and gender, preferring better
 * quality. Null when the device has no English voice, so the browser's
 * default reads instead.
 */
export function chooseVoice<V extends DeviceVoice>(voices: readonly V[], choice: VoiceChoice): V | null {
  const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang) && !NOVELTY.test(v.name));
  if (!english.length) return null;
  const sameLang = (v: V) => v.lang.replace("_", "-").toLowerCase() === choice.lang.toLowerCase();
  const score = (v: V) => {
    let s = 0;
    const rank = choice.preferred.findIndex((p) => nameMatches(v.name, p));
    if (rank >= 0) s += 1000 - rank * 10;
    const gender = voiceGender(v.name);
    if (gender === choice.gender) s += 100;
    else if (gender) s -= 100;
    if (sameLang(v)) s += 50;
    if (QUALITY.test(v.name)) s += 5;
    return s;
  };
  return english.reduce((best, v) => (score(v) > score(best) ? v : best));
}

/** The first piece is short so a natural voice starts quickly; the rest are longer for a steady delivery. */
export const FIRST_NATURAL_PIECE = 250;
export const NATURAL_PIECE = 1_200;

/** Split spoken text into pieces for a natural voice: a short opening piece, then longer ones. */
export function naturalPieces(text: string): string[] {
  const [first] = spokenChunks(text, FIRST_NATURAL_PIECE);
  if (!first) return [];
  const rest = text.slice(text.indexOf(first) + first.length).trim();
  return [first, ...spokenChunks(rest, NATURAL_PIECE)];
}
