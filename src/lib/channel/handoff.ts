// Sharing context between advisors, only when the person asks. Switching
// advisors offers a short summary; the person sees exactly what would be
// shared before anything is, nothing is shared by default, and photos stay
// out unless they say otherwise. The summary is built from the conversation
// itself (the person's own words and the advisor's latest reply), never
// written by a model, so it can't add anything that wasn't said.

import { COMPANIONS } from "@/lib/companions";
import type { CompanionId } from "@/lib/companions/types";
import type { AskImage, AskTurn } from "@/lib/ask/prompt";
import { MAX_PHOTOS_PER_TURN } from "@/lib/ask/prompt";
import { toPlainText } from "./format";

const MAX_QUESTIONS = 4;
const QUESTION_CHARS = 240;
const REPLY_CHARS = 320;

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
};

/** The first sentences of a reply, up to a limit. */
function opening(text: string, max: number): string {
  const plain = toPlainText(text).replace(/\s+/g, " ").trim();
  const sentences = plain.match(/[^.!?]+[.!?]+/g) ?? [plain];
  let out = "";
  for (const s of sentences) {
    if ((out + s).length > max) break;
    out += s;
  }
  return clip(out || plain, max);
}

/** What would be shared from one advisor's conversation: the person's recent questions and the advisor's latest reply. */
export function summarize(from: CompanionId, history: AskTurn[]): string {
  const { name, category } = COMPANIONS[from];
  const asked = history
    .filter((t) => t.role === "user")
    .slice(-MAX_QUESTIONS)
    .map((t) => {
      const photos = t.images?.length ? ` (with ${t.images.length} photo${t.images.length === 1 ? "" : "s"})` : "";
      return `• ${t.text.trim() ? clip(t.text, QUESTION_CHARS) : "A photo"}${photos}`;
    });
  const reply = history.filter((t) => t.role === "assistant").at(-1);
  return [
    `From my conversation with ${name} (${category}):`,
    asked.length ? `What I asked:\n${asked.join("\n")}` : "",
    reply?.text.trim() ? `${name}'s latest reply, in short: ${opening(reply.text, REPLY_CHARS)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The photos in a conversation, newest last, as many as one question can carry. */
export function photosIn(history: AskTurn[]): AskImage[] {
  return history.flatMap((t) => (t.role === "user" ? (t.images ?? []) : [])).slice(-MAX_PHOTOS_PER_TURN);
}

/** The turn added to the new advisor's conversation when the person shares. It is the person's own message. */
export function sharedTurn(summary: string, images: AskImage[]): AskTurn {
  return { role: "user", text: `I'm sharing a summary from another Cinq advisor so you have the context:\n\n${summary}`, images: images.length ? images : undefined };
}

export type OfferReply = "show" | "share" | "share_with_photos" | "decline" | "other";

const SHOW = new Set(["yes", "y", "yeah", "yep", "sure", "ok", "okay", "please", "yes please", "show", "show me", "show it"]);
const SHARE = new Set(["share", "share it", "yes share", "send", "send it", "yes send it", "share the summary"]);
const SHARE_PHOTOS = new Set(["share with photos", "share with the photos", "share photos", "share it with photos", "share with pictures"]);
const DECLINE = new Set(["no", "n", "nope", "no thanks", "no thank you", "don't", "dont", "keep it", "not now", "skip"]);

/** How a reply to the offer reads. Anything else means the person moved on, and nothing is shared. */
export function readOfferReply(text: string): OfferReply {
  const said = text.trim().toLowerCase().replace(/[.!]+$/, "").trim();
  if (SHARE_PHOTOS.has(said)) return "share_with_photos";
  if (SHARE.has(said)) return "share";
  if (SHOW.has(said)) return "show";
  if (DECLINE.has(said)) return "decline";
  return "other";
}
