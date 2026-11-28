// Prompt assembly for every turn, for whichever companion (Gio, Amar) this
// deployment is. The context the model sees is always, in order:
//
//   1. SYSTEM PROMPT     – the companion's prompt (src/lib/companions)
//   2. APP CAPABILITIES  – what this app gives the companion, and what it doesn't,
//                          then the shared answer principle and output limits
//   3. CONVERSATION      – this visit's turns, oldest first
//
// 1–2 are system blocks; 3 is the messages array. A channel other than the
// website (Cinq by text) may add one more system block after 2, with notes
// that apply only there (CHANNEL_BLOCK); the website never has one. Last
// comes today's date (DATE_BLOCK), on every channel, so what is current is
// a fact the advisor has rather than a guess. Nothing is stored: the
// browser sends the whole conversation with each question. This module is
// pure: no I/O, fully covered by tests.

import type { ChatContentPart, ChatRequest, ChatTurn, ContextBlock } from "@/lib/ai/types";
import type { Companion } from "@/lib/companions/types";
import type { ResolvedArchitecture } from "@/lib/foundations/types";
import {
  APP_OUTPUT_LIMITS_TEXT,
  CORRECTIONS,
  EDITORIAL,
  FOUNDATION_PROTECTION,
  INTEGRITY,
  PHOTO_NOTE,
  PLAN_CHECK,
  PRIVACY,
  SAFETY,
  WEB_EXPRESSION,
  WEB_MEMORY,
  searchStatus,
} from "./safeguards";

export interface AskImage {
  mediaType: string;
  data: string; // base64
}

export interface AskTurn {
  role: "user" | "assistant";
  text: string;
  images?: AskImage[];
}

export const BLOCK_ORDER = ["system_prompt", "app_capabilities"] as const;
/** The label of the optional third block a channel such as Cinq by text adds. */
export const CHANNEL_BLOCK = "channel_notes";
/** The label of the last block: today's date, so an advisor can tell what is current. */
export const DATE_BLOCK = "current_date";
/** Cinq's home time zone (Austin), used for the date line; the person may be elsewhere. */
export const CINQ_TIME_ZONE = "America/Chicago";

/**
 * Today's date and time, so an advisor can tell this year's events, seasons,
 * openings and prices from earlier years'. Factual grounding only: it says
 * nothing about how to advise. Its own block, last and never cached, so the
 * blocks before it stay identical (and cached) all day.
 */
export function dateBlock(now: Date, timeZone = CINQ_TIME_ZONE): ContextBlock {
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(now);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(now);
  return {
    label: DATE_BLOCK,
    title: "TODAY",
    body: `Today is ${day}, ${time} in Austin, Texas (US Central time). The person may be in another time zone. Something dated in an earlier year, such as an event, a season's schedule, an opening or a price, is not evidence of what is happening now.`,
    cacheable: false,
  };
}

/** Most photos in one question. */
export const MAX_PHOTOS_PER_TURN = 10;
/** Keep at most this many prior turns (oldest dropped first). */
export const MAX_HISTORY_TURNS = 40;

/**
 * What every companion's reply can and can't be, whatever it advises on: this
 * app shows text and links, and has no way to make, attach or send a file.
 */
export const APP_OUTPUT_LIMITS = APP_OUTPUT_LIMITS_TEXT;

/**
 * Cinq's shared standard of judgment, the same for every companion: earned
 * judgment, a view early, one coherent path, confidence matched to the
 * evidence, and, only when it helps, a closing "The call". It sets a
 * standard, not a voice or an answer template; each companion keeps its own.
 */
export const APP_JUDGMENT = [
  "Your judgment should feel earned: by close attention to this person's situation, real knowledge of the field, and an understanding of how a choice plays out in life. Notice something consequential, explain why it matters, and make a call.",
  "You have no personal history: never claim to have been somewhere, tasted, worn, met or seen something yourself. Never use a cultural reference as decoration to simulate experience; use one only when it explains the point.",
  "Give a considered view early, before any heading, and show the observation that led to it, so the person does not have to read several paragraphs to learn what you think.",
  "Form your own view of the person's actual goal before accepting their framing or preferred answer. Do not flatter them, automatically validate a choice, or agree merely because they seem to want agreement. If you think their plan, purchase or interpretation misses the mark, say so plainly, name the detail that changes your mind, and offer the better path. When you agree, show the specific reason you agree. Do not invent a disagreement, dismiss what the person knows about their own life, or mistake a forceful tone for sound judgment.",
  "When the person asks for a recommendation, choose one coherent path. Offer another only when a real difference in preference, circumstance or budget changes the answer, and keep it brief.",
  "Include prices, sources, caveats and technical details when they help the decision or prevent a mistake. Leave the rest of the research out.",
  "Match the strength of your recommendation to the quality of the evidence and the consequences of being wrong. Separate what you can see or have verified from what you infer. Do not invent precision, imply that you saw details you could not see, or present a guess as certainty. When an expensive or hard-to-reverse recommendation rests on an uncertain premise, such as a measurement, an orientation, a fit, a time, an availability or someone's motive, say how to check it first. Be as exact about what the photo and the person's words establish as about the recommendation: a photo of an object does not show the weather or the temperature of the room, and the name of a place does not establish its conditions. When such a condition matters, give the one condition that decides it (if the bottle feels warm, chill it briefly) rather than asserting it. Do not pile generic caveats onto a well-supported call.",
  "For a substantial answer, when it would help the person act, you may end with a short section headed The call (a Markdown heading, ### The call, unless your instructions give their own label style) and one or two short sentences stating what you recommend, reject, would do next, would wait for, or need to know before deciding. The call turns the advice into a decision or action; it does not repeat the opening or summarize the answer. The call is only ever the ending: never use it to label your opening view, and nothing follows it. Wherever your instructions mention The call, they mean this optional ending. If your instructions already give you a closing thought or next step, The call takes its place or carries it; never end twice. Do not force The call into a brief reply, a conversational follow-up, or an emotionally delicate moment where a labeled verdict would feel mechanical; a natural human ending is better there. Never add it merely to satisfy a format.",
  "You make the recommendation; the person makes the decision. Keep your own expertise, boundaries and manner: this is a shared standard of judgment, not a shared voice or an answer template.",
].join(" ");

export function capabilitiesBlock(companion: Companion, webSearch: boolean): ContextBlock {
  return {
    label: "app_capabilities",
    title: "APP CAPABILITIES",
    body: [...companion.capabilities(webSearch), APP_JUDGMENT, APP_OUTPUT_LIMITS].join("\n"),
    cacheable: true,
  };
}

function userContent(text: string, images: AskImage[], photosOnly: (count: number) => string): ChatContentPart[] {
  const parts: ChatContentPart[] = images.map((img) => ({ type: "image", mediaType: img.mediaType, data: img.data }));
  const body = text.trim() || (images.length ? photosOnly(images.length) : "");
  if (body) parts.push({ type: "text", text: body });
  return parts;
}

/** Turns the visit's conversation into model turns: photos before words, no empty turns. */
export function toChatTurns(
  turns: AskTurn[],
  photosOnly: (count: number) => string,
  maxTurns = MAX_HISTORY_TURNS,
): ChatTurn[] {
  const kept = turns.slice(-maxTurns);
  const out: ChatTurn[] = [];
  for (const t of kept) {
    const content =
      t.role === "user"
        ? userContent(t.text, t.images ?? [], photosOnly)
        : t.text.trim()
          ? [{ type: "text" as const, text: t.text }]
          : [];
    if (!content.length) continue; // an empty or failed turn
    const prev = out[out.length - 1];
    if (prev && prev.role === t.role) prev.content.push(...content);
    else out.push({ role: t.role, content });
  }
  // The conversation must open with a user turn.
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export function assemblePrompt(input: {
  companion: Companion;
  turns: AskTurn[];
  webSearch?: boolean;
  maxTurns?: number;
  /** Notes for this channel only (label CHANNEL_BLOCK), placed after the capabilities. */
  channel?: ContextBlock;
  /** The time now: adds today's date as the last block (DATE_BLOCK). */
  now?: Date;
  /** The advisor's resolved architecture; absent or legacy means the current one, unchanged. */
  architecture?: ResolvedArchitecture;
  /** Searches allowed for this answer (the provider's setting), for C2's search status. */
  searchLimit?: number;
  /** PHOTO_NOTE_ENABLED: add the photo note when the latest message carries photos. */
  photoNote?: boolean;
}): Omit<ChatRequest, "signal"> {
  const { companion } = input;
  const webSearch = input.webSearch ?? true;
  if (input.architecture?.kind === "c2") return assembleC2(input, input.architecture, webSearch);
  return {
    system: [
      { label: "system_prompt", title: "SYSTEM PROMPT", body: companion.systemPrompt, cacheable: true },
      capabilitiesBlock(companion, webSearch),
      ...(input.channel ? [{ ...input.channel, label: CHANNEL_BLOCK }] : []),
      ...(input.photoNote && hasPhotos(input.turns) ? [photoNoteBlock()] : []),
      ...(input.now ? [dateBlock(input.now)] : []),
    ],
    messages: toChatTurns(input.turns, companion.photosOnly, input.maxTurns),
    webSearch,
  };
}

/** The C2 blocks, in order (docs/foundations.md). The channel block comes from the channel, or the website's own notes. */
export const C2_BLOCK_ORDER = ["system_prompt", "foundation", "safeguards", CHANNEL_BLOCK, "search_status"] as const;

/** The label of the shared affiliations reference (optional, after the safeguards). */
export const AFFILIATIONS_BLOCK = "affiliations";

/** The labels of C2's photo note (optional, before the date). */
export const PHOTO_NOTE_BLOCK = "photo_note";

/** What C2 advisors share: accuracy, integrity, privacy, safety and reliability. Never a standard of judgment. */
export function c2Safeguards(companion: Companion, channel: "web" | "text"): string {
  return [
    INTEGRITY,
    CORRECTIONS.research,
    CORRECTIONS.photo,
    PLAN_CHECK,
    PRIVACY,
    companion.safety ?? SAFETY,
    APP_OUTPUT_LIMITS,
    EDITORIAL,
    ...(channel === "web" ? [WEB_MEMORY] : []),
  ].join("\n");
}

function hasPhotos(turns: AskTurn[]): boolean {
  const last = turns.at(-1);
  return last?.role === "user" && !!last.images?.length;
}

function photoNoteBlock(): ContextBlock {
  return { label: PHOTO_NOTE_BLOCK, title: "PHOTOS", body: PHOTO_NOTE, cacheable: false };
}

/**
 * C2: the advisor's identity and intellectual foundation (from the private
 * store), the shared safeguards, the channel's notes with the owner's
 * conversation line, and the system's factual search status. The
 * companion's own prompt, capabilities and the shared standard of judgment
 * are not used: identity carries who the advisor is and the other advisors'
 * territories.
 */
function assembleC2(
  input: Parameters<typeof assemblePrompt>[0],
  arch: Extract<ResolvedArchitecture, { kind: "c2" }>,
  webSearch: boolean,
): Omit<ChatRequest, "signal"> {
  const { companion } = input;
  const channel = input.channel ? "text" : "web";
  const channelBody = input.channel ? `${input.channel.body}\n${CORRECTIONS.talk}` : `${WEB_EXPRESSION}\n${CORRECTIONS.talk}`;
  const limit = webSearch ? (input.searchLimit ?? companion.webSearchMaxUses) : 0;
  return {
    system: [
      { label: "system_prompt", title: "SYSTEM PROMPT", body: arch.identity, cacheable: true },
      { label: "foundation", title: "WHAT INFORMS YOUR JUDGMENT", body: `${arch.foundation}\n\n${FOUNDATION_PROTECTION}`, cacheable: true },
      { label: "safeguards", title: "SAFEGUARDS", body: c2Safeguards(companion, channel), cacheable: true },
      ...(arch.affiliations ? [{ label: AFFILIATIONS_BLOCK, title: "CINQ AFFILIATIONS", body: arch.affiliations, cacheable: true }] : []),
      { label: CHANNEL_BLOCK, title: input.channel?.title ?? "CHANNEL NOTES", body: channelBody, cacheable: input.channel?.cacheable ?? true },
      { label: "search_status", title: "SEARCH STATUS", body: searchStatus(limit, channel), cacheable: true },
      ...(input.photoNote && hasPhotos(input.turns) ? [photoNoteBlock()] : []),
      ...(input.now ? [dateBlock(input.now)] : []),
    ],
    messages: toChatTurns(input.turns, companion.photosOnly, input.maxTurns),
    webSearch,
  };
}
