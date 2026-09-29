"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getEmbeddingProvider } from "@/lib/ai";
import { toVectorLiteral } from "@/lib/db/library-store";
import { getOrSeedSystemPrompt, SYSTEM_PROMPT_KEY } from "@/lib/db/supabase-repository";
import { requireSession } from "@/lib/db/workspace";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/gio/default-system-prompt";
import { promptChangePlan } from "@/lib/gio/prompt-versions";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (error: unknown): { ok: false; error: string } => ({ ok: false, error: error instanceof Error ? error.message : String(error) });

async function changePrompt(next: string, label: "edited" | "restored" | "reset", note?: string | null): Promise<Result> {
  const { supabase, userId } = await requireSession();
  const live = await getOrSeedSystemPrompt(supabase, userId);
  const { count, error: countError } = await supabase.from("system_prompt_versions").select("id", { count: "exact", head: true });
  if (countError) return fail(countError.message);
  const plan = promptChangePlan({ live, next, hasHistory: (count ?? 0) > 0, label, note });
  if (!plan.length) return { ok: true };
  const { error } = await supabase.from("settings").upsert({ user_id: userId, key: SYSTEM_PROMPT_KEY, value: next });
  if (error) return fail(error.message);
  // Keep the order of creation: the snapshot of the old prompt comes first.
  for (const row of plan) {
    const { error: vError } = await supabase.from("system_prompt_versions").insert({ ...row, user_id: userId });
    if (vError) return fail(vError.message);
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function saveSystemPrompt(content: string, note?: string): Promise<Result> {
  const parsed = z.string().trim().min(50, "The prompt looks too short to be Gio's.").max(60000).safeParse(content);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  return changePrompt(content.replace(/\s+$/, ""), "edited", note);
}

export async function restorePromptVersion(versionId: string): Promise<Result> {
  if (!z.string().uuid().safeParse(versionId).success) return fail("Bad version");
  const { supabase } = await requireSession();
  const { data, error } = await supabase.from("system_prompt_versions").select("content, created_at").eq("id", versionId).maybeSingle();
  if (error || !data) return fail(error?.message ?? "Version not found");
  const v = data as { content: string; created_at: string };
  return changePrompt(v.content, "restored", `Restored the version from ${v.created_at.slice(0, 16).replace("T", " ")} UTC`);
}

export async function resetSystemPrompt(): Promise<Result> {
  return changePrompt(DEFAULT_SYSTEM_PROMPT, "reset", "Back to the original Gio prompt");
}

/** Queues every indexed or failed file (or just one project's) to be indexed again. */
export async function reindexAllFiles(projectId?: string | null): Promise<Result<{ count: number }>> {
  const { supabase } = await requireSession();
  let query = supabase
    .from("files")
    .update({ status: "pending", progress: {}, attempts: 0, error: null, lease_until: null })
    .in("status", ["indexed", "failed"]);
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query.select("id");
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  return { ok: true, data: { count: (data ?? []).length } };
}

/**
 * Embeds approved memories that don't have an embedding yet (after an
 * import, or if Voyage was unavailable when they were approved).
 */
export async function embedMissingMemories(): Promise<Result<{ embedded: number; remaining: number }>> {
  const { supabase } = await requireSession();
  const { data, error } = await supabase
    .from("memories")
    .select("id, content")
    .eq("review_state", "approved")
    .is("embedding", null)
    .limit(256);
  if (error) return fail(error.message);
  const rows = (data ?? []) as { id: string; content: string }[];
  if (!rows.length) return { ok: true, data: { embedded: 0, remaining: 0 } };
  try {
    const vectors = await getEmbeddingProvider().embed(rows.map((r) => r.content), "document");
    for (const [i, r] of rows.entries()) {
      await supabase.from("memories").update({ embedding: toVectorLiteral(vectors[i]) }).eq("id", r.id);
    }
  } catch (err) {
    return fail(err);
  }
  const { count } = await supabase
    .from("memories")
    .select("id", { count: "exact", head: true })
    .eq("review_state", "approved")
    .is("embedding", null);
  return { ok: true, data: { embedded: rows.length, remaining: count ?? 0 } };
}

/** Re-queues memory extraction for imported chats that failed. */
export async function retryFailedExtraction(): Promise<Result<{ count: number }>> {
  const { supabase } = await requireSession();
  const { data, error } = await supabase
    .from("chats")
    .update({ extraction_status: "pending", extraction_error: null, extraction_lease_until: null })
    .eq("extraction_status", "failed")
    .select("id");
  if (error) return fail(error.message);
  return { ok: true, data: { count: (data ?? []).length } };
}
