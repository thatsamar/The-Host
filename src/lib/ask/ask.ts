import type { ChatProvider, WebSourceRef } from "@/lib/ai/types";
import type { Companion, CompanionMode } from "@/lib/companions/types";
import { assemblePrompt, type AskTurn } from "./prompt";

export type AskEvent =
  | { type: "text"; text: string }
  | { type: "searching"; query: string }
  | { type: "sources"; sources: WebSourceRef[] }
  | { type: "done" }
  | { type: "error"; message: string };

/**
 * Answers the latest question in a visit's conversation. Nothing is read from
 * or written to storage: the conversation arrives whole with each request.
 */
export async function* ask(
  deps: {
    provider: ChatProvider;
    companion: Companion;
    webSearch?: boolean;
    mode?: CompanionMode;
    memory?: string[];
    signal?: AbortSignal;
  },
  turns: AskTurn[],
): AsyncGenerator<AskEvent> {
  const { companion, webSearch, mode, memory } = deps;
  const request = assemblePrompt({ companion, turns, webSearch, mode, memory });
  if (request.messages.at(-1)?.role !== "user") {
    yield { type: "error", message: "Add a photo or a question." };
    return;
  }
  try {
    for await (const event of deps.provider.streamChat({ ...request, signal: deps.signal })) {
      if (event.type === "text") yield event;
      else if (event.type === "web_search") yield { type: "searching", query: event.query };
      else if (event.type === "web_results") yield { type: "sources", sources: event.sources };
    }
    yield { type: "done" };
  } catch (err) {
    yield { type: "error", message: errorMessage(err) };
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.name === "AbortError") return "Stopped.";
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Try again.";
}
