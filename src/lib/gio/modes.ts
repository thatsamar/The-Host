// Command modes. A mode is chosen from a command button and travels with the
// user's message: it is stored on the message and rendered as a labeled line
// under the speaker line, so replaying history reproduces it exactly.

export const CHAT_MODES = ["compare", "analyze_photo", "shopping_brief", "keep_looking"] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

export const MODE_LABELS: Record<ChatMode, string> = {
  compare: "Compare options",
  analyze_photo: "Analyze photo",
  shopping_brief: "Create shopping brief",
  keep_looking: "Keep looking",
};

export const MODE_INSTRUCTIONS: Record<ChatMode, string> = {
  compare:
    "Comparison mode. Rank every option from best to worst and name the winner, with one line on why for each. If none of them is right, say \"None of these. Keep looking.\" and say what to look for instead.",
  analyze_photo:
    "Photo analysis. Read the whole space first: experience, architecture, warmth, comfort, sense of place, proportion, circulation, sightlines, scale, light, furniture, materials, art, negative space and adjacent spaces. Lead with the single highest-leverage move. Don't assume the answer is buying something: consider subtracting, moving, lowering, repositioning, changing scale and improving light first.",
  shopping_brief:
    "Shopping brief. State the problem the piece solves, then give target dimensions, material/color, vintage vs. new, and budget with invest/save/skip. Give one strong recommendation and at most two meaningfully different alternatives, each in the purchase format, plus where to look and what to avoid. Search for real listings and give sourced prices with where they came from. If the best move is not buying, say so.",
  keep_looking:
    "Keep looking. Courtney and Amar have passed on the options discussed so far. Don't defend them. Say in a line what was wrong, sharpen the criteria, and propose genuinely different directions or pieces.",
};

export function isChatMode(value: unknown): value is ChatMode {
  return typeof value === "string" && (CHAT_MODES as readonly string[]).includes(value);
}

/** The line added to a user turn for a mode. */
export function modeLine(mode: ChatMode): string {
  return `Request: ${MODE_LABELS[mode]}. ${MODE_INSTRUCTIONS[mode]}`;
}
