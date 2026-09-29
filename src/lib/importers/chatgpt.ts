import type { DataStore } from "@/lib/portability/store";
import type { HumanSpeaker } from "@/lib/gio/speakers";

// Reads ChatGPT's data export (conversations.json) into plain conversations.
//
// Each conversation is a tree of message nodes (`mapping`), because edits and
// regenerations branch it. The conversation as last seen is the path from
// `current_node` back to the root. Only visible user and assistant text is
// kept: system prompts, tool calls, browsing results and hidden messages are
// dropped. Conversations with a custom GPT carry its `gizmo_id`, which is how
// Gio's conversations can be picked out as a group.

export interface ChatGptMessage {
  role: "user" | "assistant";
  text: string;
  createdAt: string | null;
}

export interface ChatGptConversation {
  id: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  gizmoId: string | null;
  messages: ChatGptMessage[];
}

interface RawNode {
  id?: string;
  parent?: string | null;
  children?: string[];
  message?: {
    author?: { role?: string };
    create_time?: number | null;
    content?: { content_type?: string; parts?: unknown[]; text?: string };
    metadata?: Record<string, unknown>;
    recipient?: string;
  } | null;
}

interface RawConversation {
  id?: string;
  conversation_id?: string;
  title?: string | null;
  create_time?: number | null;
  update_time?: number | null;
  mapping?: Record<string, RawNode>;
  current_node?: string | null;
  gizmo_id?: string | null;
}

/** Longest message kept; a pasted document beyond this is cut. */
export const MAX_IMPORTED_MESSAGE_CHARS = 40_000;

function isoFromEpoch(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function textOf(node: RawNode): string {
  const content = node.message?.content;
  if (!content) return "";
  const type = content.content_type ?? "text";
  if (type !== "text" && type !== "multimodal_text") return "";
  const parts = content.parts ?? (typeof content.text === "string" ? [content.text] : []);
  const pieces: string[] = [];
  let images = 0;
  for (const part of parts) {
    if (typeof part === "string") {
      if (part.trim()) pieces.push(part);
    } else if (part && typeof part === "object") {
      const kind = (part as { content_type?: string }).content_type ?? "";
      if (kind.includes("image")) images++;
      else if (typeof (part as { text?: unknown }).text === "string") pieces.push((part as { text: string }).text);
    }
  }
  const text = pieces.join("\n").trim();
  const note = images ? `[${images === 1 ? "A photo was" : `${images} photos were`} attached in ChatGPT]` : "";
  return [note, text].filter(Boolean).join("\n\n");
}

function isVisible(node: RawNode): node is RawNode & { message: NonNullable<RawNode["message"]> } {
  const m = node.message;
  if (!m) return false;
  const role = m.author?.role;
  if (role !== "user" && role !== "assistant") return false;
  if (m.metadata?.is_visually_hidden_from_conversation) return false;
  // Assistant messages addressed to a tool (browsing, code) aren't replies.
  if (role === "assistant" && m.recipient && m.recipient !== "all") return false;
  return true;
}

/** The active branch, root first. */
function activePath(conv: RawConversation): RawNode[] {
  const mapping = conv.mapping ?? {};
  let nodeId = conv.current_node ?? null;
  if (!nodeId || !mapping[nodeId]) {
    // No current node: follow first children from the root.
    const root = Object.values(mapping).find((n) => !n.parent);
    const path: RawNode[] = [];
    let node = root;
    const seen = new Set<string>();
    while (node && !seen.has(node.id ?? "")) {
      seen.add(node.id ?? "");
      path.push(node);
      node = node.children?.length ? mapping[node.children[node.children.length - 1]] : undefined;
    }
    return path;
  }
  const path: RawNode[] = [];
  const seen = new Set<string>();
  while (nodeId && mapping[nodeId] && !seen.has(nodeId)) {
    seen.add(nodeId);
    path.push(mapping[nodeId]);
    nodeId = mapping[nodeId].parent ?? null;
  }
  return path.reverse();
}

export function parseConversation(raw: RawConversation, index = 0): ChatGptConversation {
  const messages: ChatGptMessage[] = [];
  for (const node of activePath(raw)) {
    if (!isVisible(node)) continue;
    const text = textOf(node).slice(0, MAX_IMPORTED_MESSAGE_CHARS);
    if (!text) continue;
    const role = node.message.author!.role as "user" | "assistant";
    const createdAt = isoFromEpoch(node.message.create_time);
    const prev = messages[messages.length - 1];
    // A reply split around tool calls becomes one message.
    if (prev && prev.role === role) {
      prev.text = `${prev.text}\n\n${text}`.slice(0, MAX_IMPORTED_MESSAGE_CHARS);
    } else {
      messages.push({ role, text, createdAt });
    }
  }
  return {
    id: raw.conversation_id ?? raw.id ?? `conversation-${index}`,
    title: raw.title?.trim() || "Untitled conversation",
    createdAt: isoFromEpoch(raw.create_time),
    updatedAt: isoFromEpoch(raw.update_time),
    gizmoId: raw.gizmo_id ?? null,
    messages,
  };
}

export class ChatGptFormatError extends Error {}

/** Parses the text of conversations.json. Throws ChatGptFormatError if it isn't one. */
export function parseChatGptExport(json: string | unknown): ChatGptConversation[] {
  let data: unknown = json;
  if (typeof json === "string") {
    try {
      data = JSON.parse(json);
    } catch {
      throw new ChatGptFormatError("That file isn't valid JSON. Choose conversations.json from the ChatGPT export.");
    }
  }
  if (!Array.isArray(data) || data.some((c) => !c || typeof c !== "object" || !("mapping" in c))) {
    throw new ChatGptFormatError("That doesn't look like ChatGPT's conversations.json.");
  }
  return (data as RawConversation[]).map(parseConversation).filter((c) => c.messages.length > 0);
}

/** Conversations grouped by custom GPT, largest group first. */
export function groupByGpt(conversations: ChatGptConversation[]): { gizmoId: string | null; count: number }[] {
  const counts = new Map<string | null, number>();
  for (const c of conversations) counts.set(c.gizmoId, (counts.get(c.gizmoId) ?? 0) + 1);
  return [...counts.entries()]
    .map(([gizmoId, count]) => ({ gizmoId, count }))
    .sort((a, b) => (a.gizmoId === null ? 1 : b.gizmoId === null ? -1 : b.count - a.count));
}

// ---------------------------------------------------------------------------
// Writing selected conversations into a project
// ---------------------------------------------------------------------------


export interface ChatGptImportOptions {
  userId: string;
  projectId: string;
  roomId?: string | null;
  /** Who the user messages are attributed to (ChatGPT doesn't know). */
  speaker: HumanSpeaker;
  /** Queue memory extraction over the imported chats. */
  extractMemories: boolean;
  newId?: () => string;
}

export interface ChatGptImportReport {
  imported: number;
  skipped: number;
  messages: number;
  chatIds: string[];
}

export async function importChatGptConversations(
  store: DataStore,
  conversations: ChatGptConversation[],
  options: ChatGptImportOptions,
): Promise<ChatGptImportReport> {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const existing = new Set((await store.selectAll("chats", "id,external_id")).map((c) => c.external_id).filter(Boolean));
  const report: ChatGptImportReport = { imported: 0, skipped: 0, messages: 0, chatIds: [] };

  for (const conv of conversations) {
    const externalId = `chatgpt:${conv.id}`;
    if (existing.has(externalId) || !conv.messages.length) {
      report.skipped++;
      continue;
    }
    existing.add(externalId);
    const chatId = newId();
    const started = conv.createdAt ?? conv.messages.find((m) => m.createdAt)?.createdAt ?? new Date().toISOString();
    await store.insert("chats", [
      {
        id: chatId,
        user_id: options.userId,
        project_id: options.projectId,
        room_id: options.roomId ?? null,
        title: conv.title,
        source: "chatgpt",
        external_id: externalId,
        created_at: started,
        updated_at: conv.updatedAt ?? started,
        extraction_status: options.extractMemories ? "pending" : null,
      },
    ]);

    // Messages sort by time, so make timestamps strictly increasing.
    let last = new Date(started).getTime() - 1;
    const rows = conv.messages.map((m) => {
      const t = m.createdAt ? new Date(m.createdAt).getTime() : NaN;
      last = Number.isFinite(t) && t > last ? t : last + 1;
      return {
        id: newId(),
        user_id: options.userId,
        chat_id: chatId,
        role: m.role,
        speaker: m.role === "assistant" ? "Gio" : options.speaker,
        content: m.text,
        metadata: { imported_from: "chatgpt" },
        created_at: new Date(last).toISOString(),
      };
    });
    await store.insert("messages", rows);
    report.imported++;
    report.messages += rows.length;
    report.chatIds.push(chatId);
  }
  return report;
}
