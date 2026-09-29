import type { BackgroundModel, ChatProvider, ChatStreamEvent, WebSourceRef } from "@/lib/ai/types";
import type { MessageAttachment, MessageReference, MessageRow } from "@/lib/db/types";
import {
  assemblePrompt,
  type PromptHistoryMessage,
  type PromptMemory,
} from "@/lib/gio/prompt";
import type { ChatMode } from "@/lib/gio/modes";
import type { HumanSpeaker } from "@/lib/gio/speakers";
import { proposeFromTurn } from "@/lib/memory/extract";
import { buildRetrievalQuery, type RetrievedReference } from "@/lib/library/retrieval";
import type { ChatRepository } from "./repository";

export interface ChatAttachmentInput {
  /** Path in the private `images` bucket, under "<user_id>/chat/". */
  storagePath: string;
  mimeType: string;
  name?: string;
}

export interface ChatTurnInput {
  chatId?: string | null;
  projectId: string;
  roomId?: string | null;
  speaker: HumanSpeaker;
  text: string;
  attachments?: ChatAttachmentInput[];
  /** A command-button mode (compare, analyze photo, shopping brief, keep looking). */
  mode?: ChatMode | null;
}

/** Events streamed to the browser as newline-delimited JSON. */
export type ChatServerEvent =
  | { type: "meta"; chatId: string; projectId: string; roomId: string | null; userMessage: MessageRow }
  | { type: "text"; text: string }
  | { type: "web_search"; query: string }
  | { type: "web_results"; sources: WebSourceRef[] }
  | { type: "done"; message: MessageRow }
  | { type: "title"; chatId: string; title: string }
  | { type: "proposals"; memories: number; decisions: number }
  | { type: "error"; message: string };

export interface ChatTurnDeps {
  repo: ChatRepository;
  provider: ChatProvider;
  background: BackgroundModel;
  /** Library retrieval for this turn. Without it, Gio gets no references. */
  retrieve?: (query: string, scope: { projectId: string; roomId: string | null }) => Promise<RetrievedReference[]>;
  /** Loads a stored photo, ready for the model. Required for attachments. */
  loadImage?: (storagePath: string) => Promise<{ mediaType: string; data: string }>;
  /**
   * Picks the memories most relevant to the query (ids, best first). Used
   * only when there are too many approved memories to include them all.
   */
  rankMemories?: (query: string, projectId: string) => Promise<string[]>;
  /** Propose memories and decisions after each reply (default true). */
  proposeMemories?: boolean;
  signal?: AbortSignal;
}

export class ChatInputError extends Error {}

export const MAX_ATTACHMENTS = 6;
/** Approved memories are all included up to this many; beyond it, the most relevant. */
export const MEMORY_PROMPT_LIMIT = 40;
export const DECISION_PROMPT_LIMIT = 30;
/** Photos from earlier turns that are re-sent so follow-ups can see them. */
export const MAX_HISTORY_IMAGES = 4;
const HISTORY_IMAGE_WINDOW = 8;

export async function* runChatTurn(
  deps: ChatTurnDeps,
  input: ChatTurnInput,
): AsyncGenerator<ChatServerEvent> {
  const { repo } = deps;
  const text = input.text.trim();
  const attachments = input.attachments ?? [];
  if (!text && !attachments.length) throw new ChatInputError("Message is empty");
  if (attachments.length > MAX_ATTACHMENTS) throw new ChatInputError(`Attach at most ${MAX_ATTACHMENTS} photos`);
  if (attachments.length && !deps.loadImage) throw new ChatInputError("Photo attachments aren't available");

  // Resolve chat scope. An existing chat keeps its own project and room.
  let chat = input.chatId ? await repo.getChat(input.chatId) : null;
  if (input.chatId && !chat) throw new ChatInputError("Chat not found");
  const projectId = chat?.project_id ?? input.projectId;
  const roomId = chat ? chat.room_id : (input.roomId ?? null);

  const project = await repo.getProject(projectId);
  if (!project) throw new ChatInputError("Project not found");
  const room = roomId ? await repo.getRoom(roomId) : null;
  if (roomId && (!room || room.project_id !== projectId)) throw new ChatInputError("Room not found");

  // Load the new photos before saving anything, so a bad upload fails cleanly.
  const currentImages = await Promise.all(attachments.map((a) => deps.loadImage!(a.storagePath)));

  chat ??= await repo.createChat({ projectId, roomId });
  const isNewChat = !chat.title;

  const [systemPrompt, history, rooms, memories, decisions] = await Promise.all([
    repo.getSystemPrompt(),
    repo.listMessages(chat.id),
    repo.listRooms(projectId),
    repo.listApprovedMemories(projectId),
    repo.listDecisions(projectId),
  ]);

  // Photos become image assets under the project and room.
  const assetIds = attachments.length
    ? await repo.createImageAssets({
        projectId,
        roomId,
        images: attachments.map((a) => ({ storagePath: a.storagePath, mimeType: a.mimeType, name: a.name })),
      })
    : [];
  const storedAttachments: MessageAttachment[] = attachments.map((a, i) => ({
    image_asset_id: assetIds[i],
    storage_path: a.storagePath,
    mime_type: a.mimeType,
    name: a.name,
  }));

  const userMessage = await repo.insertMessage({
    chatId: chat.id,
    role: "user",
    speaker: input.speaker,
    content: text,
    attachments: storedAttachments,
    ...(input.mode ? { metadata: { mode: input.mode } } : {}),
  });
  if (assetIds.length) await repo.linkImageAssets(assetIds, userMessage.id);
  await repo.setLastSpeaker(input.speaker);
  yield { type: "meta", chatId: chat.id, projectId, roomId, userMessage };

  // Library retrieval. A failure here must not stop Gio from answering.
  let references: RetrievedReference[] = [];
  let retrievalError: string | undefined;
  if (deps.retrieve && text) {
    const previousUser = [...history].reverse().find((m) => m.role === "user")?.content;
    try {
      references = await deps.retrieve(buildRetrievalQuery(text, previousUser), { projectId, roomId });
    } catch (err) {
      retrievalError = err instanceof Error ? err.message : String(err);
      console.warn("Library retrieval failed:", retrievalError);
    }
  }

  const historyImages = deps.loadImage ? await loadHistoryImages(history, deps.loadImage) : new Map();

  const selectedMemories = await selectMemories(memories, text, projectId, deps.rankMemories);
  const promptMemories: PromptMemory[] = [
    ...selectedMemories.map((m) => ({
      type: m.type,
      content: m.content,
      attributedTo: m.attributed_to,
      scope: m.project_id ? ("project" as const) : ("household" as const),
    })),
    ...decisions.slice(-DECISION_PROMPT_LIMIT).map((d) => ({
      type: "decision" as const,
      content: d.detail ? `${d.title}: ${d.detail}` : d.title,
      scope: "project" as const,
      status: d.status,
    })),
  ];

  const request = assemblePrompt({
    systemPrompt,
    project: {
      name: project.name,
      location: project.location,
      brief: project.brief,
      isDefault: project.is_default,
    },
    room: room ? { name: room.name, notes: room.notes } : null,
    otherRooms: rooms.map((r) => r.name),
    memories: promptMemories,
    references,
    history: history.map(
      (m): PromptHistoryMessage => ({
        role: m.role,
        speaker: m.speaker,
        content: m.content,
        images: historyImages.get(m.id),
        mode: m.metadata?.mode ?? null,
      }),
    ),
    current: { speaker: input.speaker, text, images: currentImages, mode: input.mode ?? null },
    webSearch: true,
  });
  const referenceSummary: MessageReference[] = references.map((r) => ({
    file_name: r.fileName,
    file_id: r.fileId,
    page: r.page ?? null,
    source_type: r.sourceType,
    similarity: Math.round(r.similarity * 1000) / 1000,
    with_image: Boolean(r.image),
  }));

  // Text streamed so far, kept so a stopped or failed answer isn't lost.
  let partial = "";
  const webSearches: string[] = [];
  const webSources: WebSourceRef[] = [];
  let assistant: MessageRow | null = null;
  let titled = !isNewChat;
  try {
    let final: Extract<ChatStreamEvent, { type: "done" }> | null = null;
    try {
      for await (const event of deps.provider.streamChat({ ...request, signal: deps.signal })) {
        if (event.type === "done") {
          final = event;
          continue;
        }
        if (event.type === "text") partial += event.text;
        if (event.type === "web_search") webSearches.push(event.query);
        if (event.type === "web_results") webSources.push(...event.sources);
        yield event;
      }
      if (!final) throw new Error("The model stream ended without a final message");
    } catch (err) {
      yield { type: "error", message: errorMessage(err) };
      return;
    }
    assistant = await repo.insertMessage({
      chatId: chat.id,
      role: "assistant",
      speaker: "Gio",
      content: final.text,
      metadata: {
        model: final.model,
        stop_reason: final.stopReason,
        usage: final.usage,
        web_searches: final.webSearches,
        web_sources: dedupeSources(final.webSources),
        references: referenceSummary,
        ...(retrievalError ? { retrieval_error: retrievalError } : {}),
      },
    });
    yield { type: "done", message: assistant };

    if (isNewChat) {
      const title = await generateTitle(deps.background, text, assistant.content);
      await repo.setChatTitle(chat.id, title);
      titled = true;
      yield { type: "title", chatId: chat.id, title };
    }

    // Propose memories and decisions from what they said. Never fatal.
    if (deps.proposeMemories !== false && text) {
      try {
        const known = await repo.listKnownMemory(projectId);
        const proposals = await proposeFromTurn(deps.background, {
          speaker: input.speaker,
          userText: text,
          assistantText: assistant.content,
          projectName: project.name,
          roomName: room?.name,
          existingMemories: known.memories,
          existingDecisions: known.decisions,
        });
        if (proposals.memories.length || proposals.decisions.length) {
          await repo.insertProposals({
            projectId,
            roomId,
            sourceMessageId: userMessage.id,
            memories: proposals.memories,
            decisions: proposals.decisions,
          });
          const counts = { memories: proposals.memories.length, decisions: proposals.decisions.length };
          await repo.updateMessageMetadata(assistant.id, { ...assistant.metadata, proposals: counts });
          yield { type: "proposals", ...counts };
        }
      } catch (err) {
        console.warn("Memory extraction failed:", err instanceof Error ? err.message : err);
      }
    }
  } finally {
    // Runs on success, failure, and when the client disconnects mid-stream.
    if (!assistant && partial.trim()) {
      await repo
        .insertMessage({
          chatId: chat.id,
          role: "assistant",
          speaker: "Gio",
          content: partial,
          metadata: {
            stop_reason: "interrupted",
            web_searches: webSearches,
            web_sources: dedupeSources(webSources),
            references: referenceSummary,
          },
        })
        .catch(() => undefined);
    }
    if (!titled) await repo.setChatTitle(chat.id, fallbackTitle(text)).catch(() => undefined);
  }
}

/**
 * All approved memories when there are few; otherwise the most relevant ones
 * (by embedding search) topped up with the most recent.
 */
export async function selectMemories<T extends { id: string }>(
  memories: T[],
  query: string,
  projectId: string,
  rank?: (query: string, projectId: string) => Promise<string[]>,
): Promise<T[]> {
  if (memories.length <= MEMORY_PROMPT_LIMIT) return memories;
  const chosen = new Set<string>();
  if (rank && query.trim()) {
    try {
      for (const id of await rank(query, projectId)) {
        if (chosen.size >= MEMORY_PROMPT_LIMIT * 0.75) break;
        if (memories.some((m) => m.id === id)) chosen.add(id);
      }
    } catch (err) {
      console.warn("Memory ranking failed:", err instanceof Error ? err.message : err);
    }
  }
  for (const m of [...memories].reverse()) {
    if (chosen.size >= MEMORY_PROMPT_LIMIT) break;
    chosen.add(m.id);
  }
  // Keep the original (chronological) order in the prompt.
  return memories.filter((m) => chosen.has(m.id));
}

/** Re-sends the most recent earlier photos so follow-up questions can see them. */
async function loadHistoryImages(
  history: MessageRow[],
  load: (storagePath: string) => Promise<{ mediaType: string; data: string }>,
): Promise<Map<string, { mediaType: string; data: string }[]>> {
  const wanted: { messageId: string; path: string }[] = [];
  for (const m of history.slice(-HISTORY_IMAGE_WINDOW).reverse()) {
    for (const a of m.attachments ?? []) {
      if (wanted.length < MAX_HISTORY_IMAGES) wanted.push({ messageId: m.id, path: a.storage_path });
    }
  }
  const byMessage = new Map<string, { mediaType: string; data: string }[]>();
  // Restore chronological order within each message.
  for (const w of wanted.reverse()) {
    try {
      const image = await load(w.path);
      byMessage.set(w.messageId, [...(byMessage.get(w.messageId) ?? []), image]);
    } catch {
      // A missing old photo shouldn't block the reply.
    }
  }
  return byMessage;
}

export function dedupeSources(sources: WebSourceRef[]): WebSourceRef[] {
  const seen = new Set<string>();
  return sources.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
}

export function fallbackTitle(text: string): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").slice(0, 7).join(" ");
  return words.length > 60 ? `${words.slice(0, 57)}…` : words || "New conversation";
}

export async function generateTitle(
  background: BackgroundModel,
  userText: string,
  assistantText: string,
): Promise<string> {
  try {
    const raw = await background.complete({
      system:
        "You name conversations for a private interior-design notebook. Reply with a 3 to 6 word title only: no quotes, no trailing punctuation, no emoji.",
      content: [
        {
          type: "text",
          text: `First message:\n${userText.slice(0, 1500)}\n\nDesigner's reply (start):\n${assistantText.slice(0, 800)}`,
        },
      ],
      maxTokens: 40,
    });
    const title = raw.split("\n")[0].replace(/^["'“”]+|["'“”.]+$/g, "").trim();
    return title && title.length <= 80 ? title : fallbackTitle(userText);
  } catch {
    return fallbackTitle(userText);
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.name === "AbortError") return "Stopped.";
  if (err instanceof Error) return err.message;
  return "Something went wrong talking to Gio.";
}
