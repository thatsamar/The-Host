// After each reply, the background model proposes durable memories and
// decisions from what Courtney and Amar said. Nothing is stored as known:
// proposals wait in the right panel for Approve, Edit or Dismiss.

import { z } from "zod";
import type { BackgroundModel } from "@/lib/ai/types";
import { MEMORY_TYPES, type MemoryType } from "@/lib/db/types";
import type { HumanSpeaker } from "@/lib/gio/speakers";
import { evidenceSupported, isDuplicate, isPreferenceType, preferenceTypeFor, resolveHolder } from "./attribution";

export const MAX_MEMORY_PROPOSALS = 4;
export const MAX_DECISION_PROPOSALS = 3;

export const ExtractionSchema = z.object({
  memories: z.array(
    z.object({
      type: z.enum(MEMORY_TYPES),
      content: z.string(),
      holder: z.enum(["Courtney", "Amar", "Both", "none"]),
      scope: z.enum(["project", "household"]),
      evidence: z.string(),
    }),
  ),
  decisions: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
      status: z.enum(["approved", "keep_looking", "rejected", "pending"]),
      evidence: z.string(),
    }),
  ),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export const EXTRACTION_SYSTEM = `You maintain the long-term memory of Gio, Courtney and Amar's interior designer. From one exchange, propose only durable facts and decisions worth remembering for years. Courtney and Amar will review every proposal, so be conservative: an empty list is the usual, correct answer.

Record only what Courtney or Amar themselves said in their message. Gio's reply is context, not evidence. Never record Gio's advice, recommendations or opinions as their preference or decision. The one exception: when their message explicitly accepts or rejects something Gio proposed ("yes, let's do the walnut", "no, the brass is wrong"), record that decision.

Worth remembering: lasting tastes and dislikes, rejected ideas, approved decisions, constraints (dimensions, budget limits, children, pets, climate, rental rules), budget philosophy, materials, vendors, paint colors, and furniture they are seriously considering.
Not worth remembering: questions, moods, hypotheticals, one-off requests, things already in the existing memory list, and anything uncertain.

Memory types:
- courtney_preference / amar_preference / shared_preference: a taste or dislike. Use design_preference only if you can't tell whose it is.
- rejected_idea: something they ruled out.
- approved_decision: something they decided to do (also add it to decisions).
- project_constraint: a hard fact about this home (a dimension, rule, limitation).
- budget_philosophy: how they want to spend or save.
- material, vendor, paint_color, dimension: specific facts they gave.
- furniture_under_consideration: a specific piece they are weighing.

Attribution: the message is labeled with its speaker. A preference belongs to the speaker. Mark holder "Both" only when the message was sent by Both or the speaker says it is shared ("we love", "both of us"). If the speaker reports the other person's view by name ("Courtney wants the linen"), the holder is that person.

Scope: "household" for tastes and philosophies that apply to every home; "project" for facts about this home.

For each proposal, "evidence" must be words copied exactly from Courtney's or Amar's message. Write "content" as one short, standalone sentence in the third person (for example "Amar dislikes lacquered finishes."). At most ${MAX_MEMORY_PROPOSALS} memories and ${MAX_DECISION_PROPOSALS} decisions.`;

export interface TurnContext {
  speaker: HumanSpeaker;
  userText: string;
  assistantText: string;
  projectName: string;
  roomName?: string | null;
  existingMemories: string[];
  existingDecisions: string[];
}

export interface MemoryProposal {
  type: MemoryType;
  content: string;
  attributedTo: HumanSpeaker;
  scope: "project" | "household";
  evidence: string;
}

export interface DecisionProposal {
  title: string;
  detail: string;
  status: "approved" | "keep_looking" | "rejected" | "pending";
  decidedBy: HumanSpeaker;
  evidence: string;
}

export function extractionPrompt(ctx: TurnContext): string {
  const existing = [...ctx.existingMemories, ...ctx.existingDecisions.map((d) => `Decision: ${d}`)];
  return [
    `Project: ${ctx.projectName}${ctx.roomName ? ` · Room: ${ctx.roomName}` : ""}`,
    "",
    "Already remembered (don't repeat these):",
    existing.length ? existing.slice(0, 80).map((m) => `- ${m}`).join("\n") : "(nothing yet)",
    "",
    `Message from ${ctx.speaker === "Both" ? "Both (Courtney and Amar together)" : ctx.speaker}:`,
    `"""${ctx.userText.slice(0, 6000)}"""`,
    "",
    "Gio's reply (context only, not evidence):",
    `"""${ctx.assistantText.slice(0, 4000)}"""`,
  ].join("\n");
}

/** Applies the evidence, attribution and duplicate rules to raw model output. */
export function normalizeProposals(
  raw: Extraction,
  ctx: TurnContext,
): { memories: MemoryProposal[]; decisions: DecisionProposal[] } {
  const memories: MemoryProposal[] = [];
  const seenMemories = [...ctx.existingMemories];
  for (const m of raw.memories) {
    const content = m.content.trim();
    if (!content || !evidenceSupported(m.evidence, ctx.userText)) continue;
    if (isDuplicate(content, seenMemories)) continue;
    const holder = resolveHolder(m.holder, ctx.speaker, ctx.userText, m.evidence);
    const type = isPreferenceType(m.type) ? preferenceTypeFor(holder) : m.type;
    memories.push({ type, content, attributedTo: holder, scope: m.scope, evidence: m.evidence.trim() });
    seenMemories.push(content);
    if (memories.length >= MAX_MEMORY_PROPOSALS) break;
  }

  const decisions: DecisionProposal[] = [];
  const seenDecisions = [...ctx.existingDecisions];
  for (const d of raw.decisions) {
    const title = d.title.trim();
    if (!title || !evidenceSupported(d.evidence, ctx.userText)) continue;
    if (isDuplicate(title, seenDecisions)) continue;
    decisions.push({
      title,
      detail: d.detail.trim(),
      status: d.status,
      decidedBy: ctx.speaker,
      evidence: d.evidence.trim(),
    });
    seenDecisions.push(title);
    if (decisions.length >= MAX_DECISION_PROPOSALS) break;
  }
  return { memories, decisions };
}

export async function proposeFromTurn(
  model: BackgroundModel,
  ctx: TurnContext,
): Promise<{ memories: MemoryProposal[]; decisions: DecisionProposal[] }> {
  if (ctx.userText.trim().length < 3) return { memories: [], decisions: [] };
  const raw = await model.extract({
    system: EXTRACTION_SYSTEM,
    content: [{ type: "text", text: extractionPrompt(ctx) }],
    schema: ExtractionSchema,
    maxTokens: 1500,
  });
  return normalizeProposals(raw, ctx);
}
