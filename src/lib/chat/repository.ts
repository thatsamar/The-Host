import type { HumanSpeaker } from "@/lib/gio/speakers";
import type { DecisionProposal, MemoryProposal } from "@/lib/memory/extract";
import type {
  ChatRow,
  DecisionRow,
  MemoryRow,
  MessageAttachment,
  MessageMetadata,
  MessageRow,
  ProjectRow,
  RoomRow,
} from "@/lib/db/types";

/** Everything a chat turn needs from storage. Mocked in tests. */
export interface ChatRepository {
  getSystemPrompt(): Promise<string>;
  getProject(id: string): Promise<ProjectRow | null>;
  getRoom(id: string): Promise<RoomRow | null>;
  listRooms(projectId: string): Promise<RoomRow[]>;
  getChat(id: string): Promise<ChatRow | null>;
  createChat(input: { projectId: string; roomId: string | null }): Promise<ChatRow>;
  setChatTitle(chatId: string, title: string): Promise<void>;
  listMessages(chatId: string): Promise<MessageRow[]>;
  insertMessage(input: {
    chatId: string;
    role: "user" | "assistant";
    speaker: HumanSpeaker | "Gio";
    content: string;
    attachments?: MessageAttachment[];
    metadata?: MessageMetadata;
  }): Promise<MessageRow>;
  setLastSpeaker(speaker: HumanSpeaker): Promise<void>;
  updateMessageMetadata(messageId: string, metadata: MessageMetadata): Promise<void>;
  /** Records chat photos as image assets; returns their ids in order. */
  createImageAssets(input: {
    projectId: string;
    roomId: string | null;
    images: { storagePath: string; mimeType: string; name?: string }[];
  }): Promise<string[]>;
  linkImageAssets(ids: string[], messageId: string): Promise<void>;
  /** Approved memories for the project plus household-wide ones. */
  listApprovedMemories(projectId: string): Promise<MemoryRow[]>;
  /**
   * Everything already known or already proposed (including dismissed items),
   * so extraction doesn't propose it again.
   */
  listKnownMemory(projectId: string): Promise<{ memories: string[]; decisions: string[] }>;
  insertProposals(input: {
    projectId: string;
    roomId: string | null;
    sourceMessageId: string;
    memories: MemoryProposal[];
    decisions: DecisionProposal[];
  }): Promise<void>;
  /** Approved-into-the-log decisions for the project. */
  listDecisions(projectId: string): Promise<DecisionRow[]>;
}
