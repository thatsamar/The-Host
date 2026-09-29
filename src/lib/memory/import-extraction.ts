// Runs memory extraction over imported conversations in bounded steps, like
// library indexing: claim a chat with a short lease, work through its
// exchanges a batch at a time, save progress, and let the next step resume.

import type { BackgroundModel } from "@/lib/ai/types";
import type { ChatRepository } from "@/lib/chat/repository";
import type { MessageRow } from "@/lib/db/types";
import type { HumanSpeaker } from "@/lib/gio/speakers";
import { isHumanSpeaker } from "@/lib/gio/speakers";
import { proposeFromConversation, type Exchange } from "./extract";

export interface ExtractionChat {
  id: string;
  project_id: string;
  room_id: string | null;
  project_name: string;
  extraction_next: number;
}

export interface ExtractionStore extends Pick<ChatRepository, "listMessages" | "listKnownMemory" | "insertProposals"> {
  /** Claims the next chat waiting for extraction, or null when none is free. */
  claimChat(leaseSeconds: number): Promise<ExtractionChat | null>;
  updateChat(chatId: string, patch: Record<string, unknown>): Promise<void>;
}

export const EXCHANGES_PER_CALL = 6;

export function toExchanges(messages: MessageRow[]): (Exchange & { messageId: string; speaker: HumanSpeaker })[] {
  const out: (Exchange & { messageId: string; speaker: HumanSpeaker })[] = [];
  messages.forEach((m, i) => {
    if (m.role !== "user") return;
    const reply = messages.slice(i + 1).find((n) => n.role === "assistant" || n.role === "user");
    out.push({
      index: out.length,
      messageId: m.id,
      speaker: isHumanSpeaker(m.speaker) ? m.speaker : "Both",
      userText: m.content,
      assistantText: reply?.role === "assistant" ? reply.content : "",
    });
  });
  return out;
}

export interface ExtractionStepResult {
  chatId: string | null;
  status: "done" | "running" | "failed" | "idle";
  processed: number;
  total: number;
  proposals: number;
  error?: string;
}

export async function runExtractionStep(
  deps: { store: ExtractionStore; background: BackgroundModel; now?: () => number },
  options: { budgetMs: number },
): Promise<ExtractionStepResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const leaseSeconds = Math.ceil(options.budgetMs / 1000) + 60;
  const chat = await deps.store.claimChat(leaseSeconds);
  if (!chat) return { chatId: null, status: "idle", processed: 0, total: 0, proposals: 0 };

  let next = chat.extraction_next;
  let proposals = 0;
  let total = 0;
  try {
    const exchanges = toExchanges(await deps.store.listMessages(chat.id));
    total = exchanges.length;
    let batches = 0;
    while (next < total && (batches++ === 0 || now() - started < options.budgetMs)) {
      const batch = exchanges.slice(next, next + EXCHANGES_PER_CALL);
      const known = await deps.store.listKnownMemory(chat.project_id);
      // Imported chats have one speaker setting, so a batch shares it.
      const results = await proposeFromConversation(
        deps.background,
        { speaker: batch[0].speaker, projectName: chat.project_name, existingMemories: known.memories, existingDecisions: known.decisions },
        batch,
      );
      for (const r of results) {
        const source = batch.find((e) => e.index === r.index)!;
        await deps.store.insertProposals({
          projectId: chat.project_id,
          roomId: chat.room_id,
          sourceMessageId: source.messageId,
          memories: r.memories,
          decisions: r.decisions,
        });
        proposals += r.memories.length + r.decisions.length;
      }
      next += batch.length;
      await deps.store.updateChat(chat.id, {
        extraction_next: next,
        extraction_lease_until: new Date(now() + leaseSeconds * 1000).toISOString(),
      });
    }
    const finished = next >= total;
    await deps.store.updateChat(chat.id, {
      extraction_status: finished ? "done" : "running",
      extraction_lease_until: finished ? null : new Date(now() - 1000).toISOString(),
      extraction_error: null,
    });
    return { chatId: chat.id, status: finished ? "done" : "running", processed: next, total, proposals };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await deps.store.updateChat(chat.id, { extraction_status: "failed", extraction_error: error, extraction_lease_until: null });
    return { chatId: chat.id, status: "failed", processed: next, total, proposals, error };
  }
}
