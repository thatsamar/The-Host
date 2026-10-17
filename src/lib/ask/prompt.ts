// Prompt assembly for every turn, for whichever companion (Gio, Amar) this
// deployment is. The context the model sees is always, in order:
//
//   1. SYSTEM PROMPT     – the companion's prompt (src/lib/companions)
//   2. APP CAPABILITIES  – what this app gives the companion, and what it doesn't,
//                          then the shared answer principle and output limits
//   3. CONVERSATION      – this visit's turns, oldest first
//
// 1–2 are system blocks; 3 is the messages array. Nothing is stored: the
// browser sends the whole conversation with each question. This module is
// pure: no I/O, fully covered by tests.

import type { ChatContentPart, ChatRequest, ChatTurn, ContextBlock } from "@/lib/ai/types";
import type { Companion } from "@/lib/companions/types";

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

/** Most photos in one question. */
export const MAX_PHOTOS_PER_TURN = 10;
/** Keep at most this many prior turns (oldest dropped first). */
export const MAX_HISTORY_TURNS = 40;

/**
 * What every companion's reply can and can't be, whatever it advises on: this
 * app shows text and links, and has no way to make, attach or send a file.
 */
export const APP_OUTPUT_LIMITS =
  "This app shows your reply as text. You cannot create, attach, export, upload or send files of any kind (PNG, PDF, images, drawings, renderings, spreadsheets, documents) or links to files you made, so never say or imply that you have. Put the substance in the reply itself, in full: plans, measurements, quantities, schedules, lists and tables, and when a layout helps, a text layout or table someone can work from, labeled as a text layout rather than a drawing or map. If someone asks for a file, say plainly that this app can't produce one, then give them the content you can.";

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
}): Omit<ChatRequest, "signal"> {
  const { companion } = input;
  const webSearch = input.webSearch ?? true;
  return {
    system: [
      { label: "system_prompt", title: "SYSTEM PROMPT", body: companion.systemPrompt, cacheable: true },
      capabilitiesBlock(companion, webSearch),
    ],
    messages: toChatTurns(input.turns, companion.photosOnly, input.maxTurns),
    webSearch,
  };
}
