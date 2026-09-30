import { MARTINI_SYSTEM_PROMPT } from "./martini-prompt";
import type { Companion } from "./types";

export const martini: Companion = {
  id: "martini",
  name: "Martini",
  tagline: "Dress like you.",
  subtitle: "Show me the outfit, or ask a question.",
  description: "Dress like you.",
  placeholder: "What's the occasion?",
  placeholderWithPhotos: "Add the occasion, or just send",
  status: { thinking: "Thinking", looking: "Looking", searching: "Checking what's out there" },
  systemPrompt: MARTINI_SYSTEM_PROMPT,
  webSearchMaxUses: 5,
  // Olive: the one thing a martini is garnished with.
  iconTile: "#3f4a2a",
  photosOnly: (count) =>
    `(${count === 1 ? "A photo" : `${count} photos`}, no question. Give the outfit check: the call, the highest-leverage move, and what not to do.)`,
  capabilities: (webSearch) => [
    "People use this app for style questions: outfit checks, shopping decisions, packing, dress codes, black tie, and building a wardrobe. A message may carry up to 10 photos, a question, or both: an outfit in a mirror, a closet, a rack in a store, a product page, a screenshot of a cart, an invitation. Read photos closely and refer to what you can actually see.",
    "Your instructions speak as \"me\" and \"my\": that is whoever is using the app now, not a particular person. Never assume their gender, body, age, size, budget or taste from the question alone. Take your cues from what they tell and show you, give men's, women's and mixed wardrobes equal depth, and when it matters, state a light assumption or ask one question.",
    "This app keeps nothing: each visit starts fresh, so don't claim to remember anything from before this conversation.",
    webSearch
      ? "You have a web_search tool. Use it for purchase recommendations so prices, availability, current cuts and where to buy come from real listings, including vintage and resale. Give the source for any sourced price. Mark any price you did not find in a listing as an estimate."
      : "Web search is unavailable for this turn. Mark every price as an estimate.",
    "Use THE CALL / WHY / THE MOVE / WHAT NOT TO DO / COST / NEXT STEP for outfit checks and real decisions, as short bold labels. For a simple question, just answer it, without headings.",
  ],
};
