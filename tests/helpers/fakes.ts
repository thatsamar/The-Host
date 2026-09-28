import type { BackgroundModel, ChatProvider, ChatRequest, ChatStreamEvent } from "@/lib/ai/types";
import type { ChatRepository } from "@/lib/chat/repository";
import type { ChatRow, DecisionRow, MemoryRow, MessageRow, ProjectRow, RoomRow } from "@/lib/db/types";

let n = 0;
export const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

export class MemoryRepo implements ChatRepository {
  systemPrompt = "You are Gio.";
  projects: ProjectRow[] = [];
  rooms: RoomRow[] = [];
  chats: ChatRow[] = [];
  messages: MessageRow[] = [];
  memories: MemoryRow[] = [];
  decisions: DecisionRow[] = [];
  lastSpeaker: string | null = null;
  imageAssets: { id: string; projectId: string; roomId: string | null; storagePath: string; messageId: string | null }[] = [];

  addProject(p: Partial<ProjectRow> = {}): ProjectRow {
    const row: ProjectRow = {
      id: uid(),
      user_id: "u",
      name: "General Design Brain",
      location: null,
      brief: null,
      is_default: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...p,
    };
    this.projects.push(row);
    return row;
  }

  addRoom(projectId: string, name: string, notes: string | null = null): RoomRow {
    const row: RoomRow = { id: uid(), project_id: projectId, name, notes, created_at: new Date().toISOString() };
    this.rooms.push(row);
    return row;
  }

  async getSystemPrompt() {
    return this.systemPrompt;
  }
  async getProject(id: string) {
    return this.projects.find((p) => p.id === id) ?? null;
  }
  async getRoom(id: string) {
    return this.rooms.find((r) => r.id === id) ?? null;
  }
  async listRooms(projectId: string) {
    return this.rooms.filter((r) => r.project_id === projectId);
  }
  async getChat(id: string) {
    return this.chats.find((c) => c.id === id) ?? null;
  }
  async createChat(input: { projectId: string; roomId: string | null }) {
    const now = new Date().toISOString();
    const row: ChatRow = {
      id: uid(),
      project_id: input.projectId,
      room_id: input.roomId,
      title: null,
      source: "app",
      created_at: now,
      updated_at: now,
    };
    this.chats.push(row);
    return row;
  }
  async setChatTitle(chatId: string, title: string) {
    const chat = this.chats.find((c) => c.id === chatId);
    if (chat) chat.title = title;
  }
  async listMessages(chatId: string) {
    return this.messages.filter((m) => m.chat_id === chatId);
  }
  async insertMessage(input: Parameters<ChatRepository["insertMessage"]>[0]) {
    const row: MessageRow = {
      id: uid(),
      chat_id: input.chatId,
      role: input.role,
      speaker: input.speaker,
      content: input.content,
      attachments: input.attachments ?? [],
      metadata: input.metadata ?? {},
      created_at: new Date().toISOString(),
    };
    this.messages.push(row);
    return row;
  }
  async setLastSpeaker(speaker: string) {
    this.lastSpeaker = speaker;
  }
  async createImageAssets(input: Parameters<ChatRepository["createImageAssets"]>[0]) {
    return input.images.map((img) => {
      const id = uid();
      this.imageAssets.push({ id, projectId: input.projectId, roomId: input.roomId, storagePath: img.storagePath, messageId: null });
      return id;
    });
  }
  async linkImageAssets(ids: string[], messageId: string) {
    for (const a of this.imageAssets) if (ids.includes(a.id)) a.messageId = messageId;
  }
  async listApprovedMemories(projectId: string) {
    return this.memories.filter(
      (m) => m.review_state === "approved" && (m.project_id === projectId || m.project_id === null),
    );
  }
  async listDecisions(projectId: string) {
    return this.decisions.filter((d) => d.project_id === projectId && d.review_state === "approved");
  }
}

export class ScriptedProvider implements ChatProvider {
  requests: ChatRequest[] = [];
  constructor(private readonly script: (req: ChatRequest) => ChatStreamEvent[] | Error) {}

  async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    this.requests.push(request);
    const result = this.script(request);
    if (result instanceof Error) throw result;
    for (const event of result) yield event;
  }
}

export function replyWith(text: string, extra: Partial<Extract<ChatStreamEvent, { type: "done" }>> = {}) {
  const chunks = text.match(/[\s\S]{1,8}/g) ?? [];
  return (): ChatStreamEvent[] => [
    ...chunks.map((t) => ({ type: "text" as const, text: t })),
    {
      type: "done",
      text,
      model: "test-model",
      stopReason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
      webSearches: [],
      webSources: [],
      ...extra,
    },
  ];
}

export class FakeBackground implements BackgroundModel {
  calls: Parameters<BackgroundModel["complete"]>[0][] = [];
  constructor(private readonly answer: string | Error = "Reading Corner Chair") {}
  async complete(input: Parameters<BackgroundModel["complete"]>[0]) {
    this.calls.push(input);
    if (this.answer instanceof Error) throw this.answer;
    return this.answer;
  }
}

export async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}
