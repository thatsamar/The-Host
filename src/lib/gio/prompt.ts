// Prompt assembly for every Gio turn. The context Gio sees is always, in order:
//
//   1. SYSTEM PROMPT      – Gio's editable prompt (settings.system_prompt)
//   2. APP CAPABILITIES   – what this app lets Gio do (web search, speakers)
//   3. PROJECT CONTEXT    – project, location, brief, current room
//   4. MEMORIES           – approved memories and decisions
//   5. REFERENCES         – retrieved chunks from the reference library
//   6. CONVERSATION       – prior turns, then the current turn
//
// 1–5 go in the system prompt as separately labeled blocks; 6 is the messages
// array. Every user turn begins with a speaker line so Gio always knows who is
// talking. This module is pure: no I/O, fully covered by tests.

import type { ChatContentPart, ChatRequest, ChatTurn, ContextBlock } from "@/lib/ai/types";
import type { MemoryType } from "@/lib/db/types";
import { type ChatMode, modeLine } from "./modes";
import { type HumanSpeaker, type Speaker, speakerLabel } from "./speakers";

export interface PromptProject {
  name: string;
  location: string | null;
  brief: string | null;
  isDefault: boolean;
}

export interface PromptRoom {
  name: string;
  notes: string | null;
}

export interface PromptMemory {
  type: MemoryType | "decision";
  content: string;
  attributedTo?: HumanSpeaker | null;
  /** "household" memories apply across every project. */
  scope: "project" | "household";
  status?: string;
}

export interface PromptReference {
  fileName: string;
  content: string;
  page?: number | null;
  sourceType: "text" | "visual_description";
  projectName?: string;
  /** Optional original image for visual references, if the budget allows. */
  image?: { mediaType: string; data: string };
}

export interface PromptHistoryMessage {
  role: "user" | "assistant";
  speaker: Speaker;
  content: string;
  images?: { mediaType: string; data: string }[];
  mode?: ChatMode | null;
}

export interface PromptInput {
  systemPrompt: string;
  project: PromptProject;
  room?: PromptRoom | null;
  otherRooms?: string[];
  memories: PromptMemory[];
  references: PromptReference[];
  history: PromptHistoryMessage[];
  current: {
    speaker: HumanSpeaker;
    text: string;
    images?: { mediaType: string; data: string }[];
    mode?: ChatMode | null;
  };
  webSearch?: boolean;
  /** Keep at most this many prior messages (oldest dropped first). */
  maxHistoryMessages?: number;
}

export const DEFAULT_MAX_HISTORY_MESSAGES = 40;

export const BLOCK_ORDER = [
  "system_prompt",
  "app_capabilities",
  "project_context",
  "memories",
  "retrieved_references",
] as const;

const MEMORY_TYPE_LABELS: Record<PromptMemory["type"], string> = {
  design_preference: "Design preferences",
  courtney_preference: "Courtney's preferences",
  amar_preference: "Amar's preferences",
  shared_preference: "Shared preferences",
  rejected_idea: "Rejected ideas",
  approved_decision: "Approved decisions",
  project_constraint: "Project constraints",
  budget_philosophy: "Budget philosophy",
  material: "Materials",
  vendor: "Vendors",
  dimension: "Dimensions",
  paint_color: "Paint colors",
  furniture_under_consideration: "Furniture under consideration",
  decision: "Decision log",
};

export function capabilitiesBlock(webSearch: boolean): ContextBlock {
  const lines = [
    "Each user message begins with a line naming the speaker: Courtney, Amar, or Both. Attribute preferences to the person who stated them.",
    "Blocks below labeled PROJECT CONTEXT, MEMORIES and RETRIEVED REFERENCES come from Courtney and Amar's own records. Prefer them over general knowledge, and name the file when you draw on a reference.",
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
    "A message may include a \"Request:\" line from a command button. Follow it for that message.",
  );
  return { label: "app_capabilities", title: "APP CAPABILITIES", body: lines.join("\n"), cacheable: true };
}

export function projectContextBlock(
  project: PromptProject,
  room?: PromptRoom | null,
  otherRooms: string[] = [],
): ContextBlock {
  const lines = [`Project: ${project.name}${project.isDefault ? " (household-wide design thinking)" : ""}`];
  if (project.location) lines.push(`Location: ${project.location}`);
  if (room) {
    lines.push(`Current room: ${room.name}`);
    if (room.notes?.trim()) lines.push(`Room notes: ${room.notes.trim()}`);
  } else {
    lines.push("Current room: none selected (project-wide conversation)");
  }
  const others = otherRooms.filter((r) => r !== room?.name);
  if (others.length) lines.push(`Other rooms in this project: ${others.join(", ")}`);
  lines.push("", "Brief:", project.brief?.trim() || "(No brief written yet.)");
  return { label: "project_context", title: "PROJECT CONTEXT", body: lines.join("\n") };
}

export function memoriesBlock(memories: PromptMemory[]): ContextBlock {
  if (!memories.length) {
    return { label: "memories", title: "MEMORIES", body: "No approved memories yet." };
  }
  const groups = new Map<string, string[]>();
  for (const m of memories) {
    const heading = MEMORY_TYPE_LABELS[m.type] ?? m.type;
    const tags = [
      m.scope === "household" ? "household-wide" : null,
      m.attributedTo ? `from ${m.attributedTo}` : null,
      m.status ? m.status.replace("_", " ") : null,
    ].filter(Boolean);
    const line = `- ${m.content.trim()}${tags.length ? ` [${tags.join(", ")}]` : ""}`;
    groups.set(heading, [...(groups.get(heading) ?? []), line]);
  }
  const body = [...groups.entries()].map(([h, lines]) => `${h}:\n${lines.join("\n")}`).join("\n\n");
  return { label: "memories", title: "MEMORIES", body };
}

export function referencesBlock(references: PromptReference[]): ContextBlock {
  if (!references.length) {
    return {
      label: "retrieved_references",
      title: "RETRIEVED REFERENCES",
      body: "No references from the library matched this message.",
    };
  }
  const body = references
    .map((r, i) => {
      const where = [
        `file: ${r.fileName}`,
        r.page ? `page ${r.page}` : null,
        r.projectName ? `project: ${r.projectName}` : null,
        r.sourceType === "visual_description" ? "visual description of an image" : "text excerpt",
      ]
        .filter(Boolean)
        .join(" · ");
      return `[${i + 1}] ${where}\n${r.content.trim()}`;
    })
    .join("\n\n");
  return { label: "retrieved_references", title: "RETRIEVED REFERENCES", body };
}

function userTurnContent(
  speaker: HumanSpeaker,
  text: string,
  images: { mediaType: string; data: string }[] = [],
  mode?: ChatMode | null,
): ChatContentPart[] {
  const parts: ChatContentPart[] = images.map((img) => ({
    type: "image",
    mediaType: img.mediaType,
    data: img.data,
  }));
  const body = text.trim() || (images.length ? "(Photo attached, no message.)" : "");
  const header = mode ? `${speakerLabel(speaker)}\n${modeLine(mode)}` : speakerLabel(speaker);
  parts.push({ type: "text", text: `${header}\n\n${body}` });
  return parts;
}

/** Converts stored messages to alternating user/assistant turns. */
export function historyToTurns(history: PromptHistoryMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const m of history) {
    let content: ChatContentPart[];
    if (m.role === "user") {
      const speaker = m.speaker === "Gio" ? "Both" : m.speaker;
      content = userTurnContent(speaker, m.content, m.images, m.mode);
    } else {
      if (!m.content.trim()) continue; // failed or empty assistant turn
      content = [{ type: "text", text: m.content }];
    }
    const prev = turns[turns.length - 1];
    if (prev && prev.role === m.role) {
      prev.content.push(...content);
    } else {
      turns.push({ role: m.role, content });
    }
  }
  // The conversation must open with a user turn.
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

/** Visual reference images ride along with the current turn, labeled by index. */
function referenceImageParts(references: PromptReference[]): ChatContentPart[] {
  const parts: ChatContentPart[] = [];
  references.forEach((r, i) => {
    if (!r.image) return;
    parts.push({ type: "text", text: `Reference image [${i + 1}] from ${r.fileName}:` });
    parts.push({ type: "image", mediaType: r.image.mediaType, data: r.image.data });
  });
  return parts;
}

export function assemblePrompt(input: PromptInput): Omit<ChatRequest, "signal"> {
  const webSearch = input.webSearch ?? true;
  const system: ContextBlock[] = [
    { label: "system_prompt", title: "SYSTEM PROMPT", body: input.systemPrompt, cacheable: true },
    capabilitiesBlock(webSearch),
    projectContextBlock(input.project, input.room, input.otherRooms),
    memoriesBlock(input.memories),
    referencesBlock(input.references),
  ];

  const max = input.maxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES;
  const history = max > 0 ? input.history.slice(-max) : [];
  const turns = historyToTurns(history);

  const currentContent = [
    ...referenceImageParts(input.references),
    ...userTurnContent(input.current.speaker, input.current.text, input.current.images, input.current.mode),
  ];
  const last = turns[turns.length - 1];
  if (last && last.role === "user") {
    // A previous user message never got an answer; fold it into this turn.
    last.content.push(...currentContent);
  } else {
    turns.push({ role: "user", content: currentContent });
  }

  return { system, messages: turns, webSearch };
}
