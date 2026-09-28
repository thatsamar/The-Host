// Retrieval before every Gio reply: embed the question, match chunks from the
// current project and the General Design Brain, and attach the original image
// for the best visual matches while the image budget allows.

import type { EmbeddingProvider } from "@/lib/ai/types";
import type { PromptReference } from "@/lib/gio/prompt";

export interface MatchedChunk {
  id: string;
  file_id: string | null;
  image_asset_id: string | null;
  project_id: string;
  source_type: "text" | "visual_description";
  content: string;
  page: number | null;
  similarity: number;
  file_name: string;
  project_name: string;
  image_storage_path: string | null;
}

export interface RetrievalStore {
  matchChunks(params: {
    embedding: number[];
    projectIds: string[];
    count: number;
    minSimilarity: number;
    preferRoomId: string | null;
  }): Promise<MatchedChunk[]>;
  /** Returns the stored image, ready for the model (base64 JPEG). */
  loadImage(storagePath: string): Promise<{ mediaType: string; data: string }>;
}

export interface RetrievedReference extends PromptReference {
  chunkId: string;
  fileId: string | null;
  similarity: number;
}

export interface RetrievalOptions {
  topK: number;
  minSimilarity: number;
  maxImages: number;
}

const SHORT_QUERY = 80;

/**
 * Short follow-ups ("what about the other one?") carry little meaning alone,
 * so they borrow the previous user message.
 */
export function buildRetrievalQuery(current: string, previousUserText?: string | null): string {
  const text = current.trim();
  if (text.length >= SHORT_QUERY || !previousUserText?.trim()) return text;
  return `${previousUserText.trim().slice(0, 600)}\n\n${text}`.trim();
}

export async function retrieveReferences(
  deps: { embedder: EmbeddingProvider; store: RetrievalStore },
  query: string,
  scope: { projectIds: string[]; roomId: string | null },
  options: RetrievalOptions,
): Promise<RetrievedReference[]> {
  if (query.trim().length < 3 || options.topK <= 0 || !scope.projectIds.length) return [];
  const [embedding] = await deps.embedder.embed([query], "query");
  const matches = await deps.store.matchChunks({
    embedding,
    projectIds: [...new Set(scope.projectIds)],
    count: options.topK,
    minSimilarity: options.minSimilarity,
    preferRoomId: scope.roomId,
  });

  let imagesLeft = options.maxImages;
  const references: RetrievedReference[] = [];
  for (const m of matches) {
    const ref: RetrievedReference = {
      chunkId: m.id,
      fileId: m.file_id,
      similarity: m.similarity,
      fileName: m.file_name,
      content: m.content,
      page: m.page,
      sourceType: m.source_type,
      projectName: m.project_name,
    };
    if (m.source_type === "visual_description" && m.image_storage_path && imagesLeft > 0) {
      try {
        ref.image = await deps.store.loadImage(m.image_storage_path);
        imagesLeft--;
      } catch {
        // The description alone still helps; skip the image.
      }
    }
    references.push(ref);
  }
  return references;
}
