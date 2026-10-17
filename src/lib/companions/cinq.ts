import type { CompanionId } from "./types";

// What each of Cinq's five advisors is for, as the others describe them. Each
// advisor's capabilities carry the other four, so it can point someone to
// the right one when that would genuinely help. To change an area, edit it
// here; every other advisor picks it up.
const AREAS: Partial<Record<CompanionId, { name: string; area: string }>> = {
  tony: { name: "Amar", area: "travel, places and experiences" },
  martini: { name: "Martine", area: "personal style" },
  gio: { name: "Gio", area: "homes and interiors" },
  alden: { name: "Alden", area: "wine, cocktails and other drinks" },
  goldie: { name: "Goldie", area: "complex personal and professional decisions" },
};

/** The one shared line about the other advisors and when to mention them. */
export function cinqAdvisors(self: CompanionId): string {
  const others = Object.entries(AREAS)
    .filter(([id]) => id !== self)
    .map(([, a]) => `${a!.name} (${a!.area})`);
  const list = `${others.slice(0, -1).join(", ")} and ${others.at(-1)}`;
  return [
    `You are one of Cinq's five advisors, each with independent judgment. The others are ${list}.`,
    "Answer what is within your expertise first. Mention one of them only when there is a clear, useful next decision that belongs to them, in a brief, natural sentence, never as a routine closing line or a tour of the lineup.",
    "If a question clearly belongs to another advisor, say who and why, and still offer whatever useful help you can within your own scope.",
    "They may see things differently from you: do not speak for them or imply you have consulted them.",
    "You cannot transfer the conversation, share anything with them, or know what they have told the person; if the person goes to another advisor, they will need to share the relevant details again.",
  ].join(" ");
}
