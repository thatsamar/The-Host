import "server-only";
import type { LibraryFile, LibraryStore, NewChunk, NewImageAsset } from "@/lib/library/indexer";
import type { ServerSupabase } from "@/lib/supabase/server";

type Result<T> = { data: T | null; error: { message: string } | null };

function check<T>(result: Result<T>, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data as T;
}

/** pgvector accepts the "[x,y,…]" text form; send that explicitly. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

const FILE_COLUMNS = "id,user_id,project_id,room_id,name,mime_type,storage_path,status,progress,attempts,error";

/** Library storage acting as the signed-in user, so RLS applies to every call. */
export class SupabaseLibraryStore implements LibraryStore {
  constructor(private readonly supabase: ServerSupabase) {}

  async getFile(fileId: string) {
    return check(
      await this.supabase.from("files").select(FILE_COLUMNS).eq("id", fileId).maybeSingle(),
      "load file",
    ) as LibraryFile | null;
  }

  async claimFile(fileId: string, leaseSeconds: number) {
    const current = await this.getFile(fileId);
    if (!current) return null;
    if (current.status !== "pending" && current.status !== "processing") return null;
    const now = new Date();
    // Conditional update: only succeeds if nobody else holds a live lease.
    const nowIso = now.toISOString();
    const result = await this.supabase
      .from("files")
      .update({
        status: "processing",
        lease_until: new Date(now.getTime() + leaseSeconds * 1000).toISOString(),
        attempts: current.attempts + 1,
        error: null,
      })
      .eq("id", fileId)
      .or(`status.eq.pending,and(status.eq.processing,lease_until.is.null),and(status.eq.processing,lease_until.lt."${nowIso}")`)
      .select(FILE_COLUMNS)
      .maybeSingle();
    return check(result, "claim file") as LibraryFile | null;
  }

  async download(bucket: "files" | "images", path: string) {
    const { data, error } = await this.supabase.storage.from(bucket).download(path);
    if (error || !data) throw new Error(`download ${path}: ${error?.message ?? "no data"}`);
    return Buffer.from(await data.arrayBuffer());
  }

  async upload(bucket: "images", path: string, data: Buffer, contentType: string) {
    const { error } = await this.supabase.storage.from(bucket).upload(path, data, { contentType, upsert: true });
    if (error) throw new Error(`upload ${path}: ${error.message}`);
  }

  async clearUnitsFrom(fileId: string, unit: number) {
    const assets = check(
      await this.supabase.from("image_assets").select("storage_path").eq("file_id", fileId).gte("unit", unit),
      "list image assets",
    ) as { storage_path: string }[];
    check(await this.supabase.from("chunks").delete().eq("file_id", fileId).gte("unit", unit), "clear chunks");
    check(await this.supabase.from("image_assets").delete().eq("file_id", fileId).gte("unit", unit), "clear images");
    if (assets.length) {
      await this.supabase.storage.from("images").remove(assets.map((a) => a.storage_path));
    }
  }

  async insertImageAsset(row: NewImageAsset) {
    return check(
      await this.supabase.from("image_assets").insert(row).select("id").single(),
      "save image",
    ) as { id: string };
  }

  async insertChunks(rows: NewChunk[]) {
    if (!rows.length) return;
    const payload = rows.map((r) => ({ ...r, embedding: toVectorLiteral(r.embedding) }));
    check(await this.supabase.from("chunks").insert(payload), "save chunks");
  }

  async countChunks(fileId: string) {
    const { count, error } = await this.supabase
      .from("chunks")
      .select("id", { count: "exact", head: true })
      .eq("file_id", fileId);
    if (error) throw new Error(`count chunks: ${error.message}`);
    return count ?? 0;
  }

  async updateFile(fileId: string, patch: Record<string, unknown>) {
    check(await this.supabase.from("files").update(patch).eq("id", fileId), "update file");
  }
}
