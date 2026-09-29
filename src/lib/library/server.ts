import "server-only";
import { toVectorLiteral } from "@/lib/db/library-store";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { ChatPhotoStore } from "./chat-photos";
import { prepareImage } from "./images";
import type { NewChunk } from "./indexer";
import type { MatchedChunk, RetrievalStore } from "./retrieval";

/** Downloads a stored image and prepares it for the model (base64 JPEG). */
export async function loadModelImage(supabase: ServerSupabase, storagePath: string, maxEdge?: number) {
  const { data, error } = await supabase.storage.from("images").download(storagePath);
  if (error || !data) throw new Error(`Couldn't load image ${storagePath}: ${error?.message ?? "missing"}`);
  const prepared = await prepareImage(Buffer.from(await data.arrayBuffer()), maxEdge);
  return { mediaType: prepared.mediaType, data: prepared.data.toString("base64") };
}

// Reference images ride along with the question, so keep them a little smaller.
const REFERENCE_IMAGE_EDGE = 1024;

export function supabaseRetrievalStore(supabase: ServerSupabase): RetrievalStore {
  return {
    async matchChunks({ embedding, projectIds, count, minSimilarity, preferRoomId }) {
      const { data, error } = await supabase.rpc("match_chunks", {
        query_embedding: toVectorLiteral(embedding),
        project_ids: projectIds,
        match_count: count,
        min_similarity: minSimilarity,
        prefer_room_id: preferRoomId,
      });
      if (error) throw new Error(`match_chunks: ${error.message}`);
      return (data ?? []) as MatchedChunk[];
    },
    loadImage: (path) => loadModelImage(supabase, path, REFERENCE_IMAGE_EDGE),
  };
}

export function supabaseChatPhotoStore(supabase: ServerSupabase): ChatPhotoStore {
  return {
    loadImage: (path) => loadModelImage(supabase, path),
    async setImageDescription(id, description) {
      const { error } = await supabase.from("image_assets").update({ description }).eq("id", id);
      if (error) throw new Error(`save description: ${error.message}`);
    },
    async insertChunks(rows: NewChunk[]) {
      const { error } = await supabase
        .from("chunks")
        .insert(rows.map((r) => ({ ...r, embedding: toVectorLiteral(r.embedding) })));
      if (error) throw new Error(`save chunks: ${error.message}`);
    },
  };
}

/** Project ids searched for a turn: the current project plus the General Design Brain. */
export async function retrievalProjectIds(supabase: ServerSupabase, projectId: string): Promise<string[]> {
  const { data, error } = await supabase.from("projects").select("id").eq("is_default", true).maybeSingle();
  if (error) throw new Error(error.message);
  const defaultId = (data as { id: string } | null)?.id;
  return defaultId && defaultId !== projectId ? [projectId, defaultId] : [projectId];
}

/** Whether any searchable chunks exist, to skip the embedding call when empty. */
export async function hasIndexedChunks(supabase: ServerSupabase, projectIds: string[]): Promise<boolean> {
  const { count, error } = await supabase
    .from("chunks")
    .select("id", { count: "exact", head: true })
    .in("project_id", projectIds)
    .not("embedding", "is", null);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}
