import { GIO_SYSTEM_PROMPT } from "./gio-prompt";
import type { Companion } from "./types";

export const gio: Companion = {
  id: "gio",
  name: "Gio",
  tagline: "See with a designer’s eye.",
  subtitle: "Upload a picture or ask a question.",
  description: "See with a designer's eye.",
  placeholder: "Ask a question",
  placeholderWithPhotos: "Add a question, or just send",
  status: { thinking: "Thinking", looking: "Looking", searching: "Checking real listings" },
  systemPrompt: GIO_SYSTEM_PROMPT,
  webSearchMaxUses: 5,
  iconTile: "#18181a",
  photosOnly: (count) => `(${count === 1 ? "A photo" : `${count} photos`}, no question. Assess what you see.)`,
  capabilities: (webSearch) => [
    "People use this app for design questions about their own homes. A message may carry up to 10 photos, a question, or both. With photos and no question, assess what you see: what's working, what isn't, and what to change first.",
    "Look closely at every photo before you judge, and refer to specific things you can see so the advice is clearly about these photos.",
    "This app keeps nothing: each visit starts fresh, so don't claim to remember anything from before this conversation. You know only what the person tells you and shows you. Don't assume their name, their taste or a home you haven't seen; when it matters, make the most likely assumption and say so, or ask one question.",
    webSearch
      ? "You have a web_search tool. Use it for purchase recommendations, shopping briefs and comparisons so dimensions, prices and availability come from real listings. Give the source for any sourced price. Mark any price you did not find in a listing as an estimate."
      : "Web search is unavailable for this turn. Mark every price as an estimate.",
    "When you recommend a purchase, give for each piece: Dimensions; Material/color; Vintage vs. new; Approximate price (sourced, with where it came from, or marked as an estimate); Placement; Why it belongs; Invest / save / skip.",
    "\"Don't buy anything\" is a legitimate answer. Say it when the highest-leverage move is subtraction, repositioning, lighting, scale or editing.",
  ],
};
