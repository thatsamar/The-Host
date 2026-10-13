// Provider-neutral interfaces for the models Gio uses. The Anthropic
// implementation lives in ./anthropic.ts; swapping providers means writing a
// new implementation of these interfaces, not touching the chat pipeline.

export interface ContextBlock {
  /** Short machine label, e.g. "app_capabilities". Rendered as an XML-ish tag. */
  label: string;
  /** Human heading shown inside the block, e.g. "APP CAPABILITIES". */
  title: string;
  body: string;
  /** Hint that this block is stable across turns and worth caching. */
  cacheable?: boolean;
}

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string /* base64 */ };

export interface ChatTurn {
  role: "user" | "assistant";
  content: ChatContentPart[];
}

export interface ChatRequest {
  /** Ordered system blocks: Gio's prompt first, then context blocks. */
  system: ContextBlock[];
  /** Conversation, oldest first, ending with the current user turn. */
  messages: ChatTurn[];
  /** Allow the model to search the web for live prices and availability. */
  webSearch: boolean;
  signal?: AbortSignal;
}

export interface WebSourceRef {
  title: string;
  url: string;
}

/** What the model is doing right now, taken from the stream itself. */
export type AnswerPhase = "thinking" | "searching" | "writing";

export type ChatStreamEvent =
  | { type: "phase"; phase: AnswerPhase }
  | { type: "text"; text: string }
  | { type: "web_search"; query: string }
  | { type: "web_results"; sources: WebSourceRef[] }
  | {
      type: "done";
      text: string;
      model: string;
      stopReason: string | null;
      usage: Record<string, unknown>;
      webSearches: string[];
      webSources: WebSourceRef[];
    };

/** A failed model call as the server log records it: fixed codes and numbers, no message text. */
export interface FailureInfo {
  /** What kind of failure, e.g. "stream_error", "api_status", "connection", "stream_terminated". */
  code: string;
  /** HTTP status of a failed request. */
  status?: number;
  /** The provider's own error type, e.g. "overloaded_error". */
  type?: string;
  /** The provider's id for the failed request, to look it up with them. */
  requestId?: string;
  /** The error's class name, for failures with no better code. */
  error?: string;
  /** What the model was doing when it failed. */
  phase?: AnswerPhase;
  /** Paused turns resumed before the failure. */
  resumes?: number;
  /** Whether another model had taken over the turn. */
  fallback?: boolean;
}

/**
 * A failed model call: a message safe to show anyone, whether the same call may
 * work if made again (the service was overloaded or the stream broke, not a bad
 * request or setup), and what the server log records about it.
 */
export class ChatError extends Error {
  constructor(
    message: string,
    readonly transient = false,
    readonly failure: FailureInfo = { code: "unexpected" },
  ) {
    super(message);
  }
}

export interface ChatProvider {
  streamChat(request: ChatRequest): AsyncIterable<ChatStreamEvent>;
}
