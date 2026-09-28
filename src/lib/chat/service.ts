import type { BackgroundModel, ChatProvider, ChatStreamEvent, WebSourceRef } from "@/lib/ai/types";
import type { MessageRow } from "@/lib/db/types";
import {
  assemblePrompt,
  type PromptHistoryMessage,
  type PromptMemory,
  type PromptReference,
} from "@/lib/gio/prompt";
import type { HumanSpeaker } from "@/lib/gio/speakers";
import type { ChatRepository } from "./repository";

export interface ChatTurnInput {
  chatId?: string | null;
  projectId: string;
  roomId?: string | null;
  speaker: HumanSpeaker;
  text: string;
}

/** Events streamed to the browser as newline-delimited JSON. */
export type ChatServerEvent =
  | { type: "meta"; chatId: string; projectId: string; roomId: string | null; userMessage: MessageRow }
  | { type: "text"; text: string }
  | { type: "web_search"; query: string }
  | { type: "web_results"; sources: WebSourceRef[] }
  | { type: "done"; message: MessageRow }
  | { type: "title"; chatId: string; title: string }
  | { type: "error"; message: string };

export interface ChatTurnDeps {
  repo: ChatRepository;
  provider: ChatProvider;
  background: BackgroundModel;
  /** Library retrieval. Arrives in Phase 2; defaults to no references. */
  retrieve?: (query: string, scope: { projectId: string; roomId: string | null }) => Promise<PromptReference[]>;
  signal?: AbortSignal;
}

export class ChatInputError extends Error {}

export async function* runChatTurn(
  deps: ChatTurnDeps,
  input: ChatTurnInput,
): AsyncGenerator<ChatServerEvent> {
  const { repo } = deps;
  const text = input.text.trim();
  if (!text) throw new ChatInputError("Message is empty");

  // Resolve chat scope. An existing chat keeps its own project and room.
  let chat = input.chatId ? await repo.getChat(input.chatId) : null;
  if (input.chatId && !chat) throw new ChatInputError("Chat not found");
  const projectId = chat?.project_id ?? input.projectId;
  const roomId = chat ? chat.room_id : (input.roomId ?? null);

  const project = await repo.getProject(projectId);
  if (!project) throw new ChatInputError("Project not found");
  const room = roomId ? await repo.getRoom(roomId) : null;
  if (roomId && (!room || room.project_id !== projectId)) throw new ChatInputError("Room not found");

  chat ??= await repo.createChat({ projectId, roomId });
  const isNewChat = !chat.title;

  const [systemPrompt, history, rooms, memories, decisions] = await Promise.all([
    repo.getSystemPrompt(),
    repo.listMessages(chat.id),
    repo.listRooms(projectId),
    repo.listApprovedMemories(projectId),
    repo.listDecisions(projectId),
  ]);

  const userMessage = await repo.insertMessage({
    chatId: chat.id,
    role: "user",
    speaker: input.speaker,
    content: text,
  });
  await repo.setLastSpeaker(input.speaker);
  yield { type: "meta", chatId: chat.id, projectId, roomId, userMessage };

  const references = deps.retrieve ? await deps.retrieve(text, { projectId, roomId }) : [];

  const promptMemories: PromptMemory[] = [
    ...memories.map((m) => ({
      type: m.type,
      content: m.content,
      attributedTo: m.attributed_to,
      scope: m.project_id ? ("project" as const) : ("household" as const),
    })),
    ...decisions.map((d) => ({
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
      (m): PromptHistoryMessage => ({ role: m.role, speaker: m.speaker, content: m.content }),
    ),
    current: { speaker: input.speaker, text },
    webSearch: true,
  });

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
      },
    });
    yield { type: "done", message: assistant };

    if (isNewChat) {
      const title = await generateTitle(deps.background, text, assistant.content);
      await repo.setChatTitle(chat.id, title);
      titled = true;
      yield { type: "title", chatId: chat.id, title };
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
          },
        })
        .catch(() => undefined);
    }
    if (!titled) await repo.setChatTitle(chat.id, fallbackTitle(text)).catch(() => undefined);
  }
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
