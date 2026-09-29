// Prompt assembly for every turn, for whichever companion (Gio, Tony) this
// deployment is. The context the model sees is always, in order:
//
//   1. SYSTEM PROMPT     – the companion's prompt (src/lib/companions)
//   2. APP CAPABILITIES  – what this app gives the companion, and what it doesn't
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

export function capabilitiesBlock(companion: Companion, webSearch: boolean): ContextBlock {
  return {
    label: "app_capabilities",
    title: "APP CAPABILITIES",
    body: companion.capabilities(webSearch).join("\n"),
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
