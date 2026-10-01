// Prompt assembly for every turn, for whichever companion this deployment is.
// The context the model sees is always, in order:
//
//   1. SYSTEM PROMPT        – the companion's prompt (src/lib/companions)
//   2. APP CAPABILITIES     – what this app gives the companion, and what it doesn't
//   3. MODE                 – only for companions with modes: the one picked
//   4. REMEMBERED PATTERNS  – only for companions with a journal, when the
//                             visitor keeps patterns and has memory on
//   5. CONVERSATION         – this visit's turns, oldest first
//
// 1–4 are system blocks; 5 is the messages array. 1–2 are the same on every
// turn and cached; 3–4 change. Nothing is stored: the browser sends the whole
// conversation (and any kept patterns) with each question. This module is
// pure: no I/O, fully covered by tests.

import type { ChatContentPart, ChatRequest, ChatTurn, ContextBlock } from "@/lib/ai/types";
import type { Companion, CompanionMode } from "@/lib/companions/types";

export interface AskImage {
  mediaType: string;
  data: string; // base64
}

export interface AskTurn {
  role: "user" | "assistant";
  text: string;
  images?: AskImage[];
}

export const BLOCK_ORDER = ["system_prompt", "app_capabilities", "mode", "memory"] as const;

/** Most photos in one question. */
export const MAX_PHOTOS_PER_TURN = 10;
/** Keep at most this many prior turns (oldest dropped first). */
export const MAX_HISTORY_TURNS = 40;
/** Most remembered patterns sent with a question, and the longest one. */
export const MAX_PATTERNS = 20;
export const MAX_PATTERN_LENGTH = 300;

export function capabilitiesBlock(companion: Companion, webSearch: boolean): ContextBlock {
  return {
    label: "app_capabilities",
    title: "APP CAPABILITIES",
    body: companion.capabilities(webSearch).join("\n"),
    cacheable: true,
  };
}

export function modeBlock(mode: CompanionMode): ContextBlock {
  return { label: "mode", title: "MODE", body: `${mode.label}: ${mode.instruction}` };
}

export function memoryBlock(patterns: string[]): ContextBlock | null {
  const kept = patterns
    .map((p) => p.trim().slice(0, MAX_PATTERN_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_PATTERNS);
  if (!kept.length) return null;
  return {
    label: "memory",
    title: "REMEMBERED PATTERNS",
    body: [
      "Patterns this person chose to keep from earlier visits, in their own edit. Use them only where they bear on what's asked.",
      ...kept.map((p) => `- ${p}`),
    ].join("\n"),
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
  /** A mode of this companion; ignored if it has none. */
  mode?: CompanionMode;
  /** Kept patterns; ignored unless the companion has a journal. */
  memory?: string[];
}): Omit<ChatRequest, "signal"> {
  const { companion } = input;
  const webSearch = input.webSearch ?? true;
  const mode = input.mode && companion.modes?.includes(input.mode) ? modeBlock(input.mode) : null;
  const memory = companion.journal && input.memory ? memoryBlock(input.memory) : null;
  return {
    system: [
      { label: "system_prompt", title: "SYSTEM PROMPT", body: companion.systemPrompt, cacheable: true },
      capabilitiesBlock(companion, webSearch),
      ...(mode ? [mode] : []),
      ...(memory ? [memory] : []),
    ],
    messages: toChatTurns(input.turns, companion.photosOnly, input.maxTurns),
    webSearch,
  };
}
