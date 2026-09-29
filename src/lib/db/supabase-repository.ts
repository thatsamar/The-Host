import "server-only";
import type { ChatRepository } from "@/lib/chat/repository";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/gio/default-system-prompt";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { ChatRow, DecisionRow, MemoryRow, MessageMetadata, MessageRow, ProjectRow, RoomRow } from "./types";

function check<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data as T;
}

export const SYSTEM_PROMPT_KEY = "system_prompt";

/** Reads the live system prompt, seeding the verbatim default if missing. */
export async function getOrSeedSystemPrompt(supabase: ServerSupabase, userId: string): Promise<string> {
  const row = check(
    await supabase.from("settings").select("value").eq("key", SYSTEM_PROMPT_KEY).maybeSingle(),
    "load system prompt",
  );
  const value = (row as { value: unknown } | null)?.value;
  if (typeof value === "string" && value.trim()) return value;
  check(
    await supabase
      .from("settings")
      .upsert({ user_id: userId, key: SYSTEM_PROMPT_KEY, value: DEFAULT_SYSTEM_PROMPT }),
    "seed system prompt",
  );
  return DEFAULT_SYSTEM_PROMPT;
}

export class SupabaseChatRepository implements ChatRepository {
  constructor(
    private readonly supabase: ServerSupabase,
    private readonly userId: string,
  ) {}

  getSystemPrompt() {
    return getOrSeedSystemPrompt(this.supabase, this.userId);
  }

  async getProject(id: string) {
    return check(
      await this.supabase.from("projects").select("*").eq("id", id).maybeSingle(),
      "load project",
    ) as ProjectRow | null;
  }

  async getRoom(id: string) {
    return check(
      await this.supabase.from("rooms").select("*").eq("id", id).maybeSingle(),
      "load room",
    ) as RoomRow | null;
  }

  async listRooms(projectId: string) {
    return check(
      await this.supabase.from("rooms").select("*").eq("project_id", projectId).order("created_at"),
      "list rooms",
    ) as RoomRow[];
  }

  async getChat(id: string) {
    return check(
      await this.supabase.from("chats").select("*").eq("id", id).maybeSingle(),
      "load chat",
    ) as ChatRow | null;
  }

  async createChat(input: { projectId: string; roomId: string | null }) {
    return check(
      await this.supabase
        .from("chats")
        .insert({ user_id: this.userId, project_id: input.projectId, room_id: input.roomId })
        .select("*")
        .single(),
      "create chat",
    ) as ChatRow;
  }

  async setChatTitle(chatId: string, title: string) {
    check(await this.supabase.from("chats").update({ title }).eq("id", chatId), "set chat title");
  }

  async listMessages(chatId: string) {
    return check(
      await this.supabase
        .from("messages")
        .select("*")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true }),
      "list messages",
    ) as MessageRow[];
  }

  async insertMessage(input: Parameters<ChatRepository["insertMessage"]>[0]) {
    return check(
      await this.supabase
        .from("messages")
        .insert({
          user_id: this.userId,
          chat_id: input.chatId,
          role: input.role,
          speaker: input.speaker,
          content: input.content,
          attachments: input.attachments ?? [],
          metadata: input.metadata ?? {},
        })
        .select("*")
        .single(),
      "save message",
    ) as MessageRow;
  }

  async setLastSpeaker(speaker: string) {
    check(
      await this.supabase.from("users").update({ last_speaker: speaker }).eq("id", this.userId),
      "save speaker",
    );
  }

  async updateMessageMetadata(messageId: string, metadata: MessageMetadata) {
    check(await this.supabase.from("messages").update({ metadata }).eq("id", messageId), "update message");
  }

  async createImageAssets(input: Parameters<ChatRepository["createImageAssets"]>[0]) {
    if (!input.images.length) return [];
    const rows = check(
      await this.supabase
        .from("image_assets")
        .insert(
          input.images.map((img) => ({
            user_id: this.userId,
            project_id: input.projectId,
            room_id: input.roomId,
            storage_path: img.storagePath,
            mime_type: img.mimeType,
            source: "chat",
            metadata: img.name ? { name: img.name } : {},
          })),
        )
        .select("id, storage_path"),
      "save photos",
    ) as { id: string; storage_path: string }[];
    // Return ids in the same order as the input.
    return input.images.map((img) => rows.find((r) => r.storage_path === img.storagePath)!.id);
  }

  async linkImageAssets(ids: string[], messageId: string) {
    check(
      await this.supabase.from("image_assets").update({ message_id: messageId }).in("id", ids),
      "link photos",
    );
  }

  async listKnownMemory(projectId: string) {
    const [memories, decisions] = await Promise.all([
      this.supabase.from("memories").select("content").or(`project_id.eq.${projectId},project_id.is.null`),
      this.supabase.from("decisions").select("title").eq("project_id", projectId),
    ]);
    const m = check(memories, "list memories") as { content: string }[];
    const d = check(decisions, "list decisions") as { title: string }[];
    return { memories: m.map((r) => r.content), decisions: d.map((r) => r.title) };
  }

  async insertProposals(input: Parameters<ChatRepository["insertProposals"]>[0]) {
    if (input.memories.length) {
      check(
        await this.supabase.from("memories").insert(
          input.memories.map((m) => ({
            user_id: this.userId,
            project_id: m.scope === "household" ? null : input.projectId,
            room_id: m.scope === "household" ? null : input.roomId,
            type: m.type,
            content: m.content,
            attributed_to: m.attributedTo,
            evidence: m.evidence,
            review_state: "proposed",
            source: "extracted",
            source_message_id: input.sourceMessageId,
          })),
        ),
        "save memory proposals",
      );
    }
    if (input.decisions.length) {
      check(
        await this.supabase.from("decisions").insert(
          input.decisions.map((d) => ({
            user_id: this.userId,
            project_id: input.projectId,
            room_id: input.roomId,
            title: d.title,
            detail: d.detail || null,
            status: d.status,
            decided_by: d.decidedBy,
            evidence: d.evidence,
            review_state: "proposed",
            source: "extracted",
            source_message_id: input.sourceMessageId,
          })),
        ),
        "save decision proposals",
      );
    }
  }

  async listApprovedMemories(projectId: string) {
    return check(
      await this.supabase
        .from("memories")
        .select("*")
        .eq("review_state", "approved")
        .or(`project_id.eq.${projectId},project_id.is.null`)
        .order("created_at"),
      "list memories",
    ) as MemoryRow[];
  }

  async listDecisions(projectId: string) {
    return check(
      await this.supabase
        .from("decisions")
        .select("*")
        .eq("project_id", projectId)
        .eq("review_state", "approved")
        .order("created_at"),
      "list decisions",
    ) as DecisionRow[];
  }
}
