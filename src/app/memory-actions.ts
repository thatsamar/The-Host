"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getBackgroundModel, getEmbeddingProvider } from "@/lib/ai";
import { toVectorLiteral } from "@/lib/db/library-store";
import { MEMORY_TYPES, type MemoryType } from "@/lib/db/types";
import { requireSession } from "@/lib/db/workspace";
import { HUMAN_SPEAKERS, type HumanSpeaker } from "@/lib/gio/speakers";
import { isPreferenceType, preferenceTypeFor } from "@/lib/memory/attribution";
import { draftDecision, draftMemory, ProductDraftSchema, type DecisionDraft, type MemoryDraft } from "@/lib/memory/drafts";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const id = z.string().uuid();
const speaker = z.enum(HUMAN_SPEAKERS);
const decisionStatus = z.enum(["approved", "keep_looking", "rejected", "pending"]);
const productStatus = z.enum(["considering", "approved", "rejected", "purchased"]);

// A tracked piece follows its decision: approved → approved, pending →
// considering, rejected or keep looking → passed.
const PRODUCT_STATUS_FOR_DECISION = {
  approved: "approved",
  pending: "considering",
  rejected: "rejected",
  keep_looking: "rejected",
} as const;

function fail(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

function done<T>(data?: T): Result<T> {
  revalidatePath("/", "layout");
  return { ok: true, data };
}

/** A person-specific preference type always matches who holds it. */
function consistentType(type: MemoryType, holder: HumanSpeaker | null): MemoryType {
  return holder && isPreferenceType(type) && type !== "design_preference" ? preferenceTypeFor(holder) : type;
}

/** Embeds a memory for relevance search. Without Voyage the memory still works. */
async function embedMemory(supabase: Awaited<ReturnType<typeof requireSession>>["supabase"], memoryId: string, content: string) {
  try {
    const [vector] = await getEmbeddingProvider().embed([content], "document");
    await supabase.from("memories").update({ embedding: toVectorLiteral(vector) }).eq("id", memoryId);
  } catch (err) {
    console.warn("Memory embedding skipped:", err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

const memoryEdits = z.object({
  type: z.enum(MEMORY_TYPES),
  content: z.string().trim().min(1).max(2000),
  attributedTo: speaker.nullable(),
  household: z.boolean(),
});

export async function approveMemory(memoryId: string, edits?: z.input<typeof memoryEdits>, projectId?: string): Promise<Result> {
  if (!id.safeParse(memoryId).success) return fail("Bad memory");
  const parsed = edits ? memoryEdits.safeParse(edits) : null;
  if (parsed && !parsed.success) return fail("Check the memory fields.");
  const { supabase } = await requireSession();
  const { data: current, error } = await supabase.from("memories").select("*").eq("id", memoryId).maybeSingle();
  if (error || !current) return fail(error?.message ?? "Memory not found");
  const patch: Record<string, unknown> = { review_state: "approved" };
  if (parsed?.success) {
    const e = parsed.data;
    patch.content = e.content;
    patch.attributed_to = e.attributedTo;
    patch.type = consistentType(e.type, e.attributedTo);
    if (e.household) {
      patch.project_id = null;
      patch.room_id = null;
    } else if (!current.project_id && projectId && id.safeParse(projectId).success) {
      patch.project_id = projectId;
    }
  }
  const { error: updateError } = await supabase.from("memories").update(patch).eq("id", memoryId);
  if (updateError) return fail(updateError.message);
  await embedMemory(supabase, memoryId, (patch.content as string) ?? current.content);
  return done();
}

export async function dismissMemory(memoryId: string): Promise<Result> {
  if (!id.safeParse(memoryId).success) return fail("Bad memory");
  const { supabase } = await requireSession();
  // Dismissed proposals are kept (hidden) so the same thing isn't proposed again.
  const { error } = await supabase.from("memories").update({ review_state: "dismissed" }).eq("id", memoryId);
  return error ? fail(error.message) : done();
}

const decisionEdits = z.object({
  title: z.string().trim().min(1).max(300),
  detail: z.string().trim().max(4000).nullable(),
  status: decisionStatus,
});

export async function approveDecision(decisionId: string, edits?: z.input<typeof decisionEdits>): Promise<Result> {
  if (!id.safeParse(decisionId).success) return fail("Bad decision");
  const parsed = edits ? decisionEdits.safeParse(edits) : null;
  if (parsed && !parsed.success) return fail("Check the decision fields.");
  const { supabase } = await requireSession();
  const patch: Record<string, unknown> = { review_state: "approved" };
  if (parsed?.success) Object.assign(patch, { title: parsed.data.title, detail: parsed.data.detail || null, status: parsed.data.status });
  const { error } = await supabase.from("decisions").update(patch).eq("id", decisionId);
  return error ? fail(error.message) : done();
}

export async function dismissDecision(decisionId: string): Promise<Result> {
  if (!id.safeParse(decisionId).success) return fail("Bad decision");
  const { supabase } = await requireSession();
  const { error } = await supabase.from("decisions").update({ review_state: "dismissed" }).eq("id", decisionId);
  return error ? fail(error.message) : done();
}

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

const newMemory = memoryEdits.extend({
  projectId: id,
  roomId: id.nullable(),
  sourceMessageId: id.nullable(),
});

export async function createMemory(input: z.input<typeof newMemory>): Promise<Result<{ id: string }>> {
  const parsed = newMemory.safeParse(input);
  if (!parsed.success) return fail("Check the memory fields.");
  const m = parsed.data;
  const { supabase, userId } = await requireSession();
  const { data, error } = await supabase
    .from("memories")
    .insert({
      user_id: userId,
      project_id: m.household ? null : m.projectId,
      room_id: m.household ? null : m.roomId,
      type: consistentType(m.type, m.attributedTo),
      content: m.content,
      attributed_to: m.attributedTo,
      review_state: "approved",
      source: "manual",
      source_message_id: m.sourceMessageId,
    })
    .select("id")
    .single();
  if (error) return fail(error.message);
  await embedMemory(supabase, (data as { id: string }).id, m.content);
  return done({ id: (data as { id: string }).id });
}

export async function updateMemory(memoryId: string, edits: z.input<typeof memoryEdits>, projectId: string): Promise<Result> {
  return approveMemory(memoryId, edits, projectId);
}

export async function deleteMemory(memoryId: string): Promise<Result> {
  if (!id.safeParse(memoryId).success) return fail("Bad memory");
  const { supabase } = await requireSession();
  const { error } = await supabase.from("memories").delete().eq("id", memoryId);
  return error ? fail(error.message) : done();
}

// ---------------------------------------------------------------------------
// Decisions and products
// ---------------------------------------------------------------------------

const productInput = ProductDraftSchema.extend({
  name: z.string().trim().min(1).max(300),
  status: productStatus,
});

const newDecision = z.object({
  projectId: id,
  roomId: id.nullable(),
  title: z.string().trim().min(1).max(300),
  detail: z.string().trim().max(4000).nullable(),
  status: decisionStatus,
  decidedBy: speaker.nullable(),
  sourceMessageId: id.nullable(),
  product: productInput.nullable(),
});

export async function createDecision(input: z.input<typeof newDecision>): Promise<Result<{ id: string }>> {
  const parsed = newDecision.safeParse(input);
  if (!parsed.success) return fail("Check the decision fields.");
  const d = parsed.data;
  const { supabase, userId } = await requireSession();
  let productId: string | null = null;
  if (d.product) {
    const { status: _ignored, ...fields } = d.product;
    void _ignored;
    const { data, error } = await supabase
      .from("products")
      .insert({
        ...fields,
        user_id: userId,
        project_id: d.projectId,
        room_id: d.roomId,
        status: PRODUCT_STATUS_FOR_DECISION[d.status],
        source_message_id: d.sourceMessageId,
      })
      .select("id")
      .single();
    if (error) return fail(error.message);
    productId = (data as { id: string }).id;
  }
  const { data, error } = await supabase
    .from("decisions")
    .insert({
      user_id: userId,
      project_id: d.projectId,
      room_id: d.roomId,
      title: d.title,
      detail: d.detail || null,
      status: d.status,
      decided_by: d.decidedBy,
      review_state: "approved",
      source: "manual",
      product_id: productId,
      source_message_id: d.sourceMessageId,
    })
    .select("id")
    .single();
  if (error) return fail(error.message);
  return done({ id: (data as { id: string }).id });
}

export async function updateDecision(decisionId: string, patch: { status?: string; title?: string; detail?: string | null }): Promise<Result> {
  const parsed = z
    .object({ status: decisionStatus.optional(), title: z.string().trim().min(1).max(300).optional(), detail: z.string().trim().max(4000).nullable().optional() })
    .safeParse(patch);
  if (!id.safeParse(decisionId).success || !parsed.success) return fail("Check the decision fields.");
  const { supabase } = await requireSession();
  const { error } = await supabase.from("decisions").update(parsed.data).eq("id", decisionId);
  if (error) return fail(error.message);
  // Keep a linked product in step with the decision.
  if (parsed.data.status) {
    const { data } = await supabase.from("decisions").select("product_id").eq("id", decisionId).maybeSingle();
    const productId = (data as { product_id: string | null } | null)?.product_id;
    if (productId) await supabase.from("products").update({ status: PRODUCT_STATUS_FOR_DECISION[parsed.data.status] }).eq("id", productId);
  }
  return done();
}

export async function deleteDecision(decisionId: string): Promise<Result> {
  if (!id.safeParse(decisionId).success) return fail("Bad decision");
  const { supabase } = await requireSession();
  const { error } = await supabase.from("decisions").delete().eq("id", decisionId);
  return error ? fail(error.message) : done();
}

export async function updateProduct(productId: string, status: string): Promise<Result> {
  const parsed = productStatus.safeParse(status);
  if (!id.safeParse(productId).success || !parsed.success) return fail("Bad product");
  const { supabase } = await requireSession();
  const { error } = await supabase.from("products").update({ status: parsed.data }).eq("id", productId);
  return error ? fail(error.message) : done();
}

export async function deleteProduct(productId: string): Promise<Result> {
  if (!id.safeParse(productId).success) return fail("Bad product");
  const { supabase } = await requireSession();
  const { error } = await supabase.from("products").delete().eq("id", productId);
  return error ? fail(error.message) : done();
}

// ---------------------------------------------------------------------------
// Drafts for command buttons
// ---------------------------------------------------------------------------

async function draftSource(messageId: string, who: HumanSpeaker) {
  const { supabase } = await requireSession();
  const { data: message } = await supabase.from("messages").select("chat_id, role, speaker, content, created_at").eq("id", messageId).maybeSingle();
  if (!message) throw new Error("Message not found");
  const m = message as { chat_id: string; role: "user" | "assistant"; speaker: string; content: string; created_at: string };
  const { data: prev } = await supabase
    .from("messages")
    .select("speaker, content")
    .eq("chat_id", m.chat_id)
    .eq("role", "user")
    .lt("created_at", m.created_at)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { message: m, previous: (prev as { speaker: string; content: string } | null) ?? null, speaker: who };
}

export async function draftDecisionFromMessage(
  messageId: string,
  who: string,
  preset?: DecisionDraft["status"],
): Promise<Result<DecisionDraft>> {
  const w = speaker.safeParse(who);
  if (!id.safeParse(messageId).success || !w.success) return fail("Bad request");
  try {
    const draft = await draftDecision(getBackgroundModel(), await draftSource(messageId, w.data), preset);
    return { ok: true, data: draft };
  } catch (err) {
    return fail(err);
  }
}

export async function draftMemoryFromMessage(messageId: string, who: string): Promise<Result<MemoryDraft>> {
  const w = speaker.safeParse(who);
  if (!id.safeParse(messageId).success || !w.success) return fail("Bad request");
  try {
    return { ok: true, data: await draftMemory(getBackgroundModel(), await draftSource(messageId, w.data)) };
  } catch (err) {
    return fail(err);
  }
}
