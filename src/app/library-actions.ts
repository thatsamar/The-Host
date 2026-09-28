"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/db/workspace";
import { detectFileKind, MAX_UPLOAD_BYTES, safeStorageName } from "@/lib/library/file-types";

const id = z.string().uuid();

/** `index` is the position of the file in the request. */
export type UploadSlot = { index: number; name: string; fileId: string; storagePath: string; contentType: string };
export type StartUploadResult = { ok: true; slots: UploadSlot[]; rejected: { name: string; reason: string }[] } | { ok: false; error: string };

/**
 * Step 1 of an upload: validate and create file rows. The browser then
 * uploads straight to the private `files` bucket (Vercel request bodies are
 * too small for large PDFs), and calls finishUploads.
 */
export async function startUploads(input: {
  projectId: string;
  roomId: string | null;
  files: { name: string; size: number; type: string }[];
}): Promise<StartUploadResult> {
  const parsed = z
    .object({
      projectId: id,
      roomId: id.nullable(),
      files: z.array(z.object({ name: z.string().min(1).max(255), size: z.number().int().min(0), type: z.string().max(200) })).min(1).max(50),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid upload request" };
  const { supabase, userId } = await requireSession();

  const rejected: { name: string; reason: string }[] = [];
  const rows: Record<string, unknown>[] = [];
  const slots: UploadSlot[] = [];
  for (const [index, f] of parsed.data.files.entries()) {
    const kind = detectFileKind(f.name, f.type);
    if (!kind) {
      rejected.push({ name: f.name, reason: "Unsupported type. Use PDF, images, .docx, .txt or .md." });
      continue;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      rejected.push({ name: f.name, reason: "Larger than 50 MB." });
      continue;
    }
    if (f.size === 0) {
      rejected.push({ name: f.name, reason: "The file is empty." });
      continue;
    }
    const fileId = randomUUID();
    const storagePath = `${userId}/${parsed.data.projectId}/${fileId}/${safeStorageName(f.name)}`;
    rows.push({
      id: fileId,
      user_id: userId,
      project_id: parsed.data.projectId,
      room_id: parsed.data.roomId,
      name: f.name,
      mime_type: kind.mime,
      size_bytes: f.size,
      storage_path: storagePath,
      status: "uploading",
    });
    slots.push({ index, name: f.name, fileId, storagePath, contentType: kind.mime });
  }
  if (rows.length) {
    const { error } = await supabase.from("files").insert(rows);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true, slots, rejected };
}

/** Step 2: mark uploaded files ready to index, and drop ones that failed. */
export async function finishUploads(input: { uploaded: string[]; failed: string[] }) {
  const parsed = z.object({ uploaded: z.array(id).max(50), failed: z.array(id).max(50) }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid request" };
  const { supabase } = await requireSession();
  if (parsed.data.uploaded.length) {
    await supabase.from("files").update({ status: "pending" }).in("id", parsed.data.uploaded).eq("status", "uploading");
  }
  if (parsed.data.failed.length) {
    await supabase.from("files").delete().in("id", parsed.data.failed).eq("status", "uploading");
  }
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Queues a failed (or finished) file to be indexed again from scratch. */
export async function reindexFile(fileId: string) {
  if (!id.safeParse(fileId).success) return { ok: false as const, error: "Bad file" };
  const { supabase } = await requireSession();
  const { error } = await supabase
    .from("files")
    .update({ status: "pending", progress: {}, attempts: 0, error: null, lease_until: null })
    .eq("id", fileId)
    .in("status", ["failed", "indexed"]);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function deleteFile(fileId: string) {
  if (!id.safeParse(fileId).success) return { ok: false as const, error: "Bad file" };
  const { supabase } = await requireSession();
  const [{ data: file }, { data: images }] = await Promise.all([
    supabase.from("files").select("storage_path").eq("id", fileId).maybeSingle(),
    supabase.from("image_assets").select("storage_path").eq("file_id", fileId),
  ]);
  if (!file) return { ok: false as const, error: "File not found" };
  const { error } = await supabase.from("files").delete().eq("id", fileId);
  if (error) return { ok: false as const, error: error.message };
  // Rows are gone (chunks and image assets cascade); now remove the bytes.
  await supabase.storage.from("files").remove([(file as { storage_path: string }).storage_path]);
  const imagePaths = ((images ?? []) as { storage_path: string }[]).map((i) => i.storage_path);
  if (imagePaths.length) await supabase.storage.from("images").remove(imagePaths);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** A short-lived signed URL to open the original file. */
export async function fileViewUrl(fileId: string) {
  if (!id.safeParse(fileId).success) return { ok: false as const, error: "Bad file" };
  const { supabase } = await requireSession();
  const { data: file } = await supabase.from("files").select("storage_path").eq("id", fileId).maybeSingle();
  if (!file) return { ok: false as const, error: "File not found" };
  const { data, error } = await supabase.storage
    .from("files")
    .createSignedUrl((file as { storage_path: string }).storage_path, 600);
  if (error || !data) return { ok: false as const, error: error?.message ?? "Couldn't sign URL" };
  return { ok: true as const, url: data.signedUrl };
}
