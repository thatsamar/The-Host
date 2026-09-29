// Drafts for the "Save as decision", "Keep looking" and "Add to memory"
// command buttons: the background model reads the message and fills in a form
// that Courtney or Amar then edit and save. Nothing is saved from a draft
// without their confirmation.

import { z } from "zod";
import type { BackgroundModel } from "@/lib/ai/types";
import { MEMORY_TYPES } from "@/lib/db/types";
import type { HumanSpeaker } from "@/lib/gio/speakers";
import { isPreferenceType, preferenceTypeFor } from "./attribution";

export const ProductDraftSchema = z.object({
  name: z.string(),
  designer: z.string().nullable(),
  vendor: z.string().nullable(),
  url: z.string().nullable(),
  dimensions: z.string().nullable(),
  material_color: z.string().nullable(),
  provenance: z.enum(["vintage", "new", "antique", "custom", "unknown"]),
  price_amount: z.number().nullable(),
  price_currency: z.string().nullable(),
  price_basis: z.enum(["sourced", "estimated"]).nullable(),
  price_source_url: z.string().nullable(),
  placement: z.string().nullable(),
  rationale: z.string().nullable(),
  verdict: z.enum(["invest", "save", "skip"]).nullable(),
});
export type ProductDraft = z.infer<typeof ProductDraftSchema>;

export const DecisionDraftSchema = z.object({
  title: z.string(),
  detail: z.string(),
  status: z.enum(["approved", "keep_looking", "rejected", "pending"]),
  product: ProductDraftSchema.nullable(),
});
export type DecisionDraft = z.infer<typeof DecisionDraftSchema>;

export const MemoryDraftSchema = z.object({
  type: z.enum(MEMORY_TYPES),
  content: z.string(),
  holder: z.enum(["Courtney", "Amar", "Both"]),
  scope: z.enum(["project", "household"]),
});
export type MemoryDraft = z.infer<typeof MemoryDraftSchema>;

export interface DraftSource {
  /** The message the button was pressed on. */
  message: { role: "user" | "assistant"; speaker: string; content: string };
  /** The user message it answered, for context. */
  previous?: { speaker: string; content: string } | null;
  /** Who is using the app right now (the speaker toggle). */
  speaker: HumanSpeaker;
}

function sourceText(src: DraftSource): string {
  const lines: string[] = [];
  if (src.previous) lines.push(`${src.previous.speaker} asked:\n"""${src.previous.content.slice(0, 3000)}"""`, "");
  lines.push(
    `${src.message.role === "assistant" ? "Gio" : src.message.speaker} wrote:\n"""${src.message.content.slice(0, 8000)}"""`,
    "",
    `The person saving this is ${src.speaker === "Both" ? "Courtney and Amar together" : src.speaker}.`,
  );
  return lines.join("\n");
}

export const DECISION_DRAFT_SYSTEM = `You fill in a decision-log entry for Courtney and Amar's interior design notebook from the message they chose. Write a short title naming the thing decided (for example "Dining pendant: Poul Henningsen PH 5, brushed brass"), and a one or two sentence detail with the reasoning. If the message recommends or discusses a specific piece of furniture, lighting or object, fill in "product" with what the message states: dimensions, material/color, vintage vs. new, price, where the price came from, placement, why it belongs, and invest/save/skip. Use null for anything the message doesn't state; don't invent prices or links. Mark price_basis "sourced" only when the message cites a real listing, otherwise "estimated".`;

export const MEMORY_DRAFT_SYSTEM = `You draft one memory for Courtney and Amar's interior design notebook from the message they chose to remember. Write it as one short, standalone third-person sentence that will still make sense in a year (for example "Courtney and Amar prefer pools of warm lamplight to overhead lighting."). Pick the closest type. The holder is the person saving it unless the message clearly states someone else's view. Scope is "household" for tastes and principles that apply to every home, "project" for facts about this home.`;

export async function draftDecision(model: BackgroundModel, src: DraftSource, preset?: DecisionDraft["status"]) {
  const draft = await model.extract({
    system: DECISION_DRAFT_SYSTEM,
    content: [{ type: "text", text: sourceText(src) }],
    schema: DecisionDraftSchema,
    maxTokens: 1200,
  });
  return { ...draft, status: preset ?? draft.status };
}

export async function draftMemory(model: BackgroundModel, src: DraftSource) {
  const draft = await model.extract({
    system: MEMORY_DRAFT_SYSTEM,
    content: [{ type: "text", text: sourceText(src) }],
    schema: MemoryDraftSchema,
    maxTokens: 400,
  });
  // Keep preference types consistent with who holds them.
  return isPreferenceType(draft.type) ? { ...draft, type: preferenceTypeFor(draft.holder) } : draft;
}
