import type { ChatProvider, WebSourceRef } from "@/lib/ai/types";
import type { Companion } from "@/lib/companions/types";
import { createUserMessage, createAssistantMessage, updateAssistantMessage } from "@/lib/ephemeral/db";
import { assemblePrompt, type AskTurn } from "./prompt";
import { errorMessage } from "./ask";

/**
 * Start a persistent generation that completes server-side even if the browser closes.
 * Returns immediately with message IDs; generation continues in the background.
 */
export async function persistentAsk(
  sessionId: string,
  deps: { provider: ChatProvider; companion: Companion; webSearch?: boolean },
  turns: AskTurn[],
  question: string,
) {
  // Store user message immediately
  const userMsg = await createUserMessage(sessionId, question);

  // Create assistant message with pending status
  const assistantMsg = await createAssistantMessage(sessionId);

  // Fire-and-forget background generation
  generateInBackground(sessionId, assistantMsg.id, deps, turns);

  return { userMessageId: userMsg.id, assistantMessageId: assistantMsg.id };
}

async function generateInBackground(
  sessionId: string,
  messageId: string,
  deps: { provider: ChatProvider; companion: Companion; webSearch?: boolean },
  turns: AskTurn[],
) {
  try {
    const request = assemblePrompt({ companion: deps.companion, turns, webSearch: deps.webSearch });
    if (request.messages.at(-1)?.role !== "user") {
      await updateAssistantMessage(messageId, { status: "failed", error: "Add a photo or a question." });
      return;
    }

    let fullContent = "";
    let lastUpdateTime = Date.now();

    try {
      // Generate response without depending on request signal
      const abortController = new AbortController();
      for await (const event of deps.provider.streamChat({ ...request, signal: abortController.signal })) {
        if (event.type === "text") {
          fullContent += event.text;
          // Update at most every 2 seconds to avoid overwhelming the database
          const now = Date.now();
          if (now - lastUpdateTime > 2000) {
            await updateAssistantMessage(messageId, { content: fullContent, status: "pending" });
            lastUpdateTime = now;
          }
        }
      }

      // Mark as completed with final content
      await updateAssistantMessage(messageId, { content: fullContent, status: "completed" });
    } catch (err) {
      const error = errorMessage(err);
      await updateAssistantMessage(messageId, {
        status: "failed",
        error,
        content: fullContent,
      });
    }
  } catch (err) {
    console.error(`Failed to persist generation for message ${messageId}:`, err);
    try {
      await updateAssistantMessage(messageId, {
        status: "failed",
        error: "Generation failed. Try again.",
      });
    } catch (updateErr) {
      console.error("Failed to update message with error:", updateErr);
    }
  }
}
