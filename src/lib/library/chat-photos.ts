// Photos attached in chat are also added to the library: the background
// model describes each one and the description is embedded, so later
// questions ("that hallway photo from last week") can find it.

import type { BackgroundModel, EmbeddingProvider } from "@/lib/ai/types";
import { describeImage } from "./describe";
import { embedText, type NewChunk } from "./indexer";

export interface ChatPhoto {
  imageAssetId: string;
  storagePath: string;
  userId: string;
  projectId: string;
  roomId: string | null;
}

export interface ChatPhotoStore {
  loadImage(storagePath: string): Promise<{ mediaType: string; data: string }>;
  setImageDescription(imageAssetId: string, description: string): Promise<void>;
  insertChunks(rows: NewChunk[]): Promise<void>;
}

export async function indexChatPhotos(
  deps: { store: ChatPhotoStore; background: BackgroundModel; embedder: EmbeddingProvider },
  photos: ChatPhoto[],
  label: string,
): Promise<{ indexed: number; errors: string[] }> {
  const errors: string[] = [];
  const drafts: Omit<NewChunk, "embedding">[] = [];
  for (const photo of photos) {
    try {
      const image = await deps.store.loadImage(photo.storagePath);
      const description = await describeImage(deps.background, image, { source: label });
      await deps.store.setImageDescription(photo.imageAssetId, description);
      drafts.push({
        user_id: photo.userId,
        file_id: null,
        image_asset_id: photo.imageAssetId,
        project_id: photo.projectId,
        room_id: photo.roomId,
        source_type: "visual_description",
        content: description,
        page: null,
        unit: 0,
        chunk_index: 0,
        token_count: Math.ceil(description.length / 4),
        metadata: { label, image_source: "chat" },
      });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (drafts.length) {
    const vectors = await deps.embedder.embed(
      drafts.map((d) => embedText({ name: label }, d)),
      "document",
    );
    await deps.store.insertChunks(drafts.map((d, i) => ({ ...d, embedding: vectors[i] })));
  }
  return { indexed: drafts.length, errors };
}
