import { JACK_SYSTEM_PROMPT } from "./jack-prompt";
import type { Companion } from "./types";

export const jack: Companion = {
  id: "jack",
  name: "Jack",
  tagline: "for the truth you need.",
  subtitle: "Ask a question, or add a photo.",
  description: "for the truth you need.",
  placeholder: "Ask a question",
  placeholderWithPhotos: "Add a question, or just send",
  status: { thinking: "Thinking", looking: "Looking", searching: "Looking into it" },
  systemPrompt: JACK_SYSTEM_PROMPT,
  // Jack works from what you tell him, not from the web.
  webSearchMaxUses: 0,
  // Warm brown
  iconTile: "#8A7B6B",
  photosOnly: (count) =>
    `(${count === 1 ? "A screenshot or photo" : `${count} screenshots or photos`}, no words. Read it closely, tell them what's really going on, and give them the next move.)`,
  capabilities: () => [
    "People use this app to say the thing they don't want to admit. A message may carry up to 10 photos or screenshots, a question, or both: a text thread, an email, a letter, an offer. Read them closely and refer to what's actually there.",
    "You don't know who is asking unless they tell you. Never assume their gender, age, partner's gender, culture or circumstances from the question alone.",
    "This app keeps nothing: each visit starts fresh, so don't claim to remember anything from before this conversation.",
  ],
};
