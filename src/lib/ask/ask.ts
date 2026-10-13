import { ChatError, type AnswerPhase, type ChatProvider, type WebSourceRef } from "@/lib/ai/types";
import type { Companion } from "@/lib/companions/types";
import { assemblePrompt, type AskTurn } from "./prompt";

export type AskEvent =
  | { type: "phase"; phase: AnswerPhase }
  | { type: "text"; text: string }
  | { type: "searching"; query: string }
  | { type: "sources"; sources: WebSourceRef[] }
  | { type: "done" }
  | { type: "error"; message: string };

/** What the page reads: the answer's events, plus a heartbeat while nothing else is happening. */
export type StreamEvent = AskEvent | { type: "alive" };

/** How an answer ended, for the server log. Never any of the conversation's content. */
export interface AnswerInfo {
  stopReason: string | null;
  outputTokens?: number;
  searches: number;
}

export const NO_ANSWER = "No answer came back. Try again.";
export const timeLimitMessage = (name: string) => `${name} ran out of time before finishing this answer. Try again.`;
export const LENGTH_LIMIT = "This answer reached its length limit before it finished.";

/**
 * Answers the latest question in a visit's conversation. Nothing is read from
 * or written to storage: the conversation arrives whole with each request.
 */
export async function* ask(
  deps: {
    provider: ChatProvider;
    companion: Companion;
    webSearch?: boolean;
    signal?: AbortSignal;
    onFinish?: (info: AnswerInfo) => void;
    /**
     * Whether there's still time for one more attempt after a transient failure.
     * Without it, a failure is reported as is.
     */
    canRetry?: () => boolean;
    /** Each failed attempt's log-safe reason, and whether it is being retried. */
    onFailure?: (reason: string, retrying: boolean) => void;
  },
  turns: AskTurn[],
): AsyncGenerator<AskEvent> {
  const request = assemblePrompt({ companion: deps.companion, turns, webSearch: deps.webSearch });
  if (request.messages.at(-1)?.role !== "user") {
    yield { type: "error", message: "Add a photo or a question." };
    return;
  }
  let wrote = false;
  for (let attempt = 1; ; attempt++) {
    try {
      for await (const event of deps.provider.streamChat({ ...request, signal: deps.signal })) {
        if (event.type === "text" || event.type === "phase") {
          if (event.type === "text" && event.text) wrote = true;
          yield event;
        } else if (event.type === "web_search") yield { type: "searching", query: event.query };
        else if (event.type === "web_results") yield { type: "sources", sources: event.sources };
        else if (event.type === "done") {
          const outputTokens = event.usage.output_tokens;
          deps.onFinish?.({
            stopReason: event.stopReason,
            outputTokens: typeof outputTokens === "number" ? outputTokens : undefined,
            searches: event.webSearches.length,
          });
          // An answer that never started, or was cut off, must say so rather than look finished.
          if (!wrote) {
            yield { type: "error", message: NO_ANSWER };
            return;
          }
          if (event.stopReason === "max_tokens") {
            yield { type: "error", message: LENGTH_LIMIT };
            return;
          }
        }
      }
      yield { type: "done" };
      return;
    } catch (err) {
      // One more attempt is safe only when the failed call has ended, nothing of
      // it has been shown, the service (not the request) failed, and there's time.
      const retrying =
        err instanceof ChatError &&
        err.transient &&
        attempt === 1 &&
        !wrote &&
        !deps.signal?.aborted &&
        (deps.canRetry?.() ?? false);
      if (err instanceof ChatError) deps.onFailure?.(err.reason, retrying);
      if (retrying) continue;
      yield { type: "error", message: errorMessage(err) };
      return;
    }
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.name === "AbortError") return "Stopped.";
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Try again.";
}
