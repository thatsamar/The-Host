import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { renderContextBlock } from "./render";
import type {
  ChatContentPart,
  ChatProvider,
  ChatRequest,
  ChatStreamEvent,
  WebSourceRef,
} from "./types";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// Server-side refusal fallback: if the chat model's safety classifiers decline
// a request, the API re-runs it on Anthropic's recommended fallback model.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
// A long web-search turn can pause; we resume it this many times at most.
const MAX_PAUSE_RESUMES = 4;

export function toAnthropicContent(parts: ChatContentPart[]): BetaContentBlockParam[] {
  return parts.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: part.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: part.data,
          },
        },
  );
}

/** System blocks in order; one cache breakpoint after the last stable block. */
export function toAnthropicSystem(request: ChatRequest): BetaTextBlockParam[] {
  let lastCacheable = -1;
  request.system.forEach((b, i) => {
    if (b.cacheable) lastCacheable = i;
  });
  return request.system.map((block, i) => ({
    type: "text",
    text: i === 0 ? block.body : renderContextBlock(block),
    ...(i === lastCacheable ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
}

function sourcesFrom(block: BetaContentBlock): WebSourceRef[] {
  if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) return [];
  return block.content.map((r) => ({ title: r.title, url: r.url }));
}

// What the person asking sees. Setup problems (bad key, no credit, unknown
// model) read the same to them; the specifics go to the server log.
export const UNAVAILABLE = "Gio isn't available right now. Please try again a little later.";
export const BUSY = "Gio is busy right now. Try again in a minute.";

/** Turns SDK errors into short messages that are safe to show to anyone. */
export function describeAnthropicError(err: unknown): Error {
  if (err instanceof Anthropic.APIUserAbortError) {
    const e = new Error("Stopped.");
    e.name = "AbortError";
    return e;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new Error("Couldn't reach Gio. Check your connection and try again.");
  }
  if (err instanceof Anthropic.RateLimitError) return new Error(BUSY);
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529 || err.status === 503) return new Error(BUSY);
    if (err.status === 413) return new Error("That's too much to send at once. Try fewer photos.");
    return new Error(UNAVAILABLE);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export class AnthropicChatProvider implements ChatProvider {
  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
    private readonly options: { effort: Effort; webSearchMaxUses: number },
  ) {}

  async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    try {
      yield* this.run(request);
    } catch (err) {
      // The person asking sees a plain message; this is where the reason goes.
      if (err instanceof Anthropic.APIError) console.error("Anthropic chat error", err.status, err.message);
      throw describeAnthropicError(err);
    }
  }

  private async *run(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const system = toAnthropicSystem(request);
    const messages: BetaMessageParam[] = request.messages.map((m) => ({
      role: m.role,
      content: toAnthropicContent(m.content),
    }));
    // The tool list is identical on every request so the prompt cache holds.
    const tools: BetaToolUnion[] =
      request.webSearch && this.options.webSearchMaxUses > 0
        ? [{ type: "web_search_20260209", name: "web_search", max_uses: this.options.webSearchMaxUses }]
        : [];

    let text = "";
    let model = this.model;
    let stopReason: string | null = null;
    const usage: Record<string, unknown> = {};
    const webSearches: string[] = [];
    const webSources: WebSourceRef[] = [];

    for (let attempt = 0; attempt <= MAX_PAUSE_RESUMES; attempt++) {
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: 32000,
          system,
          messages,
          tools,
          output_config: { effort: this.options.effort },
          fallbacks: "default",
          betas: [FALLBACK_BETA],
        },
        { signal: request.signal },
      );

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          text += event.delta.text;
          yield { type: "text", text: event.delta.text };
        } else if (event.type === "content_block_stop") {
          const block = stream.currentMessage?.content[event.index];
          if (!block) continue;
          if (block.type === "server_tool_use" && block.name === "web_search") {
            const query = typeof block.input?.query === "string" ? block.input.query : "";
            webSearches.push(query);
            yield { type: "web_search", query };
          } else if (block.type === "web_search_tool_result") {
            const found = sourcesFrom(block);
            webSources.push(...found);
            if (found.length) yield { type: "web_results", sources: found };
          }
        }
      }

      const message = await stream.finalMessage();
      model = message.model;
      stopReason = message.stop_reason;
      for (const [k, v] of Object.entries(message.usage ?? {})) {
        usage[k] = typeof v === "number" && typeof usage[k] === "number" ? (usage[k] as number) + v : v;
      }

      if (message.stop_reason === "refusal") {
        const notice =
          (text ? "\n\n" : "") +
          "_Gio couldn't answer this one. Try rephrasing the request._";
        text += notice;
        yield { type: "text", text: notice };
        break;
      }
      if (message.stop_reason !== "pause_turn") break;
      // Server tool turn paused mid-flight: hand the partial turn back to resume.
      messages.push({ role: "assistant", content: message.content as BetaContentBlockParam[] });
    }

    yield { type: "done", text, model, stopReason, usage, webSearches, webSources };
  }
}
