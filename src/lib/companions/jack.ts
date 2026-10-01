import { JACK_SYSTEM_PROMPT } from "./jack-prompt";
import type { Companion } from "./types";

export const jack: Companion = {
  id: "jack",
  name: "Jack",
  tagline: "The truth, even when you can’t handle it.",
  subtitle: "What’s the thing you don’t want to admit?",
  description: "The truth, even when you can’t handle it.",
  placeholder: "Say it.",
  placeholderWithPhotos: "Say what’s going on, or just send",
  status: { thinking: "Thinking it over", looking: "Reading", searching: "Looking into it" },
  systemPrompt: JACK_SYSTEM_PROMPT,
  // Jack works from what you tell him, not from the web.
  webSearchMaxUses: 0,
  // Oxblood: a leather banquette in a hotel bar.
  iconTile: "#3a1512",
  photosOnly: (count) =>
    `(${count === 1 ? "A screenshot or photo" : `${count} screenshots or photos`}, no words. Read it closely, tell them what's really going on, and give them the next move.)`,
  capabilities: () => [
    "People use this app to say the thing they don't want to admit. A message may carry up to 10 photos or screenshots, a question, or both: a text thread, an email, a letter, an offer. Read them closely and refer to what's actually there.",
    "You don't know who is asking unless they tell you. Never assume their gender, age, partner's gender, culture or circumstances from the question alone.",
    "This app keeps nothing: each visit starts fresh, so don't claim to remember anything from before this conversation.",
  ],
};
