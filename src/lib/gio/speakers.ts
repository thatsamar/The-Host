export const HUMAN_SPEAKERS = ["Courtney", "Amar", "Both"] as const;
export type HumanSpeaker = (typeof HUMAN_SPEAKERS)[number];
export type Speaker = HumanSpeaker | "Gio";

export function isHumanSpeaker(value: unknown): value is HumanSpeaker {
  return typeof value === "string" && (HUMAN_SPEAKERS as readonly string[]).includes(value);
}

/** Label placed at the top of every user turn so Gio always knows who is talking. */
export function speakerLabel(speaker: HumanSpeaker): string {
  return speaker === "Both" ? "Speaker: Both (Courtney and Amar together)" : `Speaker: ${speaker}`;
}
