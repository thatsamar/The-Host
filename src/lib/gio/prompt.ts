// Prompt assembly for every Gio turn. The context Gio sees is always, in order:
//
//   1. SYSTEM PROMPT     – Gio's prompt, verbatim (default-system-prompt.ts)
//   2. APP CAPABILITIES  – what this app gives Gio, and what it doesn't
//   3. CONVERSATION      – this visit's turns, oldest first
//
// 1–2 are system blocks; 3 is the messages array. Nothing is stored: the
// browser sends the whole conversation with each question. This module is
// pure: no I/O, fully covered by tests.

import type { ChatContentPart, ChatRequest, ChatTurn, ContextBlock } from "@/lib/ai/types";

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

export function capabilitiesBlock(webSearch: boolean): ContextBlock {
  const lines = [
    "People use this app for design questions about their own homes. A message may carry up to 10 photos, a question, or both. With photos and no question, assess what you see: what's working, what isn't, and what to change first.",
    "Look closely at every photo before you judge, and refer to specific things you can see so the advice is clearly about these photos.",
    "This app keeps nothing: each visit starts fresh, so don't claim to remember anything from before this conversation. You know only what the person tells you and shows you. Don't assume their name, their taste or a home you haven't seen; when it matters, make the most likely assumption and say so, or ask one question.",
  ];
  if (webSearch) {
    lines.push(
      "You have a web_search tool. Use it for purchase recommendations, shopping briefs and comparisons so dimensions, prices and availability come from real listings. Give the source for any sourced price. Mark any price you did not find in a listing as an estimate.",
    );
  } else {
    lines.push("Web search is unavailable for this turn. Mark every price as an estimate.");
  }
  lines.push(
    "When you recommend a purchase, give for each piece: Dimensions; Material/color; Vintage vs. new; Approximate price (sourced, with where it came from, or marked as an estimate); Placement; Why it belongs; Invest / save / skip.",
    "\"Don't buy anything\" is a legitimate answer. Say it when the highest-leverage move is subtraction, repositioning, lighting, scale or editing.",
  );
  return { label: "app_capabilities", title: "APP CAPABILITIES", body: lines.join("\n"), cacheable: true };
}

function userContent(text: string, images: AskImage[] = []): ChatContentPart[] {
  const parts: ChatContentPart[] = images.map((img) => ({ type: "image", mediaType: img.mediaType, data: img.data }));
  const count = images.length;
  const body =
    text.trim() ||
    (count ? `(${count === 1 ? "A photo" : `${count} photos`}, no question. Assess what you see.)` : "");
  if (body) parts.push({ type: "text", text: body });
  return parts;
}

/** Turns the visit's conversation into model turns: photos before words, no empty turns. */
export function toChatTurns(turns: AskTurn[], maxTurns = MAX_HISTORY_TURNS): ChatTurn[] {
  const kept = turns.slice(-maxTurns);
  const out: ChatTurn[] = [];
  for (const t of kept) {
    const content = t.role === "user" ? userContent(t.text, t.images) : t.text.trim() ? [{ type: "text" as const, text: t.text }] : [];
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
  systemPrompt: string;
  turns: AskTurn[];
  webSearch?: boolean;
  maxTurns?: number;
}): Omit<ChatRequest, "signal"> {
  const webSearch = input.webSearch ?? true;
  return {
    system: [
      { label: "system_prompt", title: "SYSTEM PROMPT", body: input.systemPrompt, cacheable: true },
      capabilitiesBlock(webSearch),
    ],
    messages: toChatTurns(input.turns, input.maxTurns),
    webSearch,
  };
}
