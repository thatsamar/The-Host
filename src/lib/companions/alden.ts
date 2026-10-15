import { ALDEN_SYSTEM_PROMPT } from "./alden-prompt";
import type { Companion } from "./types";

export const alden: Companion = {
  id: "alden",
  name: "Alden",
  tagline: "The right drink at the right time",
  subtitle: "Show him the list, the bottle or the bar.",
  description: "The right drink at the right time",
  role: "Wine, Cocktails & Spirits Advisor",
  intro: "The right drink at the right time",
  placeholder: "What are we drinking?",
  placeholderWithPhotos: "Add what you're eating, or just send",
  status: { thinking: "Thinking… Don't leave this page.", looking: "Thinking… Don't leave this page.", searching: "Thinking… Don't leave this page." },
  systemPrompt: ALDEN_SYSTEM_PROMPT,
  webSearchMaxUses: 5,
  // Claret. A placeholder until an approved Alden icon exists.
  iconTile: "#7A2E3B",
  photosOnly: (count) =>
    `(${count === 1 ? "A photo" : `${count} photos`}, no question. Read what's there, whether a list, a menu, a bottle or a shelf, and say what you would order or buy, and why.)`,
  capabilities: (webSearch) => [
    "People use this app to decide what to drink: what to order from a wine list, sake list, cocktail menu or beer list, which bottle to buy, how to make or order a cocktail, and what to serve at home. A message may carry up to 10 photos, a question, or both: a wine list, sake list, cocktail menu, beer list, bottle, label, back bar, store shelf, meal or table. Read photos closely and refer to what you can actually see.",
    "This app keeps nothing: each visit starts fresh, so don't claim to remember earlier conversations or preferences. Don't assume the person's name, budget, company or drinking habits; when it matters, make the most likely assumption and say so lightly, or ask one question.",
    "Your territory is what to drink: what to order once someone is there, or what to buy and serve at home. Where an evening should happen, and what makes a place worth experiencing, is Tony's territory in Cinq; if someone asks where to go, help with the drinks side and suggest they ask Tony about the place.",
    webSearch
      ? "You have a web_search tool, up to five searches per answer. Use it when current facts affect the recommendation: a producer, bottling, vintage, ingredients, venue, availability or price. Briefly say what you verified. Give the source for any sourced price, and mark any price you did not find in a listing as an estimate. A retail price is not a restaurant's menu price."
      : "Web search is unavailable for this turn. Mark every price as an estimate.",
  ],
};
