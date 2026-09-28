import { after } from "next/server";
import { z } from "zod";
import { getBackgroundModel, getChatProvider, getEmbeddingProvider } from "@/lib/ai";
import { ChatInputError, MAX_ATTACHMENTS, runChatTurn, type ChatServerEvent } from "@/lib/chat/service";
import { SupabaseChatRepository } from "@/lib/db/supabase-repository";
import { serverEnv } from "@/lib/env";
import { HUMAN_SPEAKERS } from "@/lib/gio/speakers";
import { indexChatPhotos, type ChatPhoto } from "@/lib/library/chat-photos";
import { IMAGE_MIME_TYPES } from "@/lib/library/file-types";
import { retrieveReferences } from "@/lib/library/retrieval";
import {
  hasIndexedChunks,
  loadModelImage,
  retrievalProjectIds,
  supabaseChatPhotoStore,
  supabaseRetrievalStore,
} from "@/lib/library/server";
import { createClient, getUserId } from "@/lib/supabase/server";

// Long design answers with web search can take a while.
export const maxDuration = 300;

const bodySchema = z.object({
  chatId: z.string().uuid().nullish(),
  projectId: z.string().uuid(),
  roomId: z.string().uuid().nullish(),
  speaker: z.enum(HUMAN_SPEAKERS),
  text: z.string().max(20000),
  attachments: z
    .array(
      z.object({
        storagePath: z.string().min(1).max(300),
        mimeType: z.enum(IMAGE_MIME_TYPES),
        name: z.string().max(200).optional(),
      }),
    )
    .max(MAX_ATTACHMENTS)
    .default([]),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;
  // Chat photos must be ones this user uploaded to their own chat folder.
  const chatPrefix = `${userId}/chat/`;
  if (input.attachments.some((a) => !a.storagePath.startsWith(chatPrefix) || a.storagePath.includes(".."))) {
    return Response.json({ error: "Invalid attachment" }, { status: 400 });
  }

  const env = serverEnv();
  const background = getBackgroundModel();
  const events = runChatTurn(
    {
      repo: new SupabaseChatRepository(supabase, userId),
      provider: getChatProvider(),
      background,
      loadImage: (path) => loadModelImage(supabase, path),
      retrieve: async (query, scope) => {
        const projectIds = await retrievalProjectIds(supabase, scope.projectId);
        if (!(await hasIndexedChunks(supabase, projectIds))) return [];
        return retrieveReferences(
          { embedder: getEmbeddingProvider(), store: supabaseRetrievalStore(supabase) },
          query,
          { projectIds, roomId: scope.roomId },
          { topK: env.RETRIEVAL_TOP_K, minSimilarity: env.RETRIEVAL_MIN_SIMILARITY, maxImages: env.RETRIEVAL_MAX_IMAGES },
        );
      },
      signal: request.signal,
    },
    input,
  );

  // Pull the first event before committing to a 200 so validation errors
  // (bad chat, room, project or photo) come back as proper HTTP errors.
  let first: IteratorResult<ChatServerEvent>;
  try {
    first = await events.next();
  } catch (err) {
    const status = err instanceof ChatInputError ? 400 : 500;
    return Response.json({ error: err instanceof Error ? err.message : "Failed" }, { status });
  }

  // After the reply is sent, add this turn's photos to the library.
  let photos: ChatPhoto[] = [];
  let chatId: string | null = null;
  if (!first.done && first.value.type === "meta") {
    const meta = first.value;
    chatId = meta.chatId;
    photos = meta.userMessage.attachments
      .filter((a) => a.image_asset_id)
      .map((a) => ({
        imageAssetId: a.image_asset_id!,
        storagePath: a.storage_path,
        userId,
        projectId: meta.projectId,
        roomId: meta.roomId,
      }));
  }
  if (photos.length) {
    after(async () => {
      try {
        // By now the chat has its title; use it to label the photos.
        const { data } = await supabase.from("chats").select("title").eq("id", chatId!).maybeSingle();
        const chatLabel = data?.title ? `Photo shared in "${data.title}"` : "Photo shared in chat";
        const result = await indexChatPhotos(
          { store: supabaseChatPhotoStore(supabase), background, embedder: getEmbeddingProvider() },
          photos,
          chatLabel,
        );
        if (result.errors.length) console.warn("Chat photo indexing:", result.errors);
      } catch (err) {
        console.warn("Chat photo indexing failed:", err instanceof Error ? err.message : err);
      }
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatServerEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        if (!first.done) send(first.value);
        for await (const event of events) send(event);
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Something went wrong" });
      } finally {
        controller.close();
      }
    },
    async cancel() {
      await events.return(undefined);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
