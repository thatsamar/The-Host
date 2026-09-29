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

export type ChatStreamEvent =
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

export interface ChatProvider {
  streamChat(request: ChatRequest): AsyncIterable<ChatStreamEvent>;
}
