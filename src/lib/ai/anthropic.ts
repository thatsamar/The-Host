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
import { errorClass, safeToken } from "@/lib/diagnostics";
import {
  ChatError,
  type AnswerPhase,
  type ChatContentPart,
  type ChatProvider,
  type ChatRequest,
  type ChatStreamEvent,
  type FailureInfo,
  type WebSourceRef,
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

/**
 * What a paused turn hands back to resume it. After a fallback partway through
 * the turn, the API requires leaving out what only the declining model can read
 * from before the switch: thinking, tool calls, and server tool calls without
 * their results. Text and paired server tool blocks stay; the fallback marker
 * itself is ignored by the API and is dropped.
 */
export function resumableContent(content: BetaContentBlock[]): BetaContentBlockParam[] {
  const boundary = content.findLastIndex((b) => b.type === "fallback");
  if (boundary < 0) return content as BetaContentBlockParam[];
  const answered = new Set(content.flatMap((b) => ("tool_use_id" in b ? [b.tool_use_id] : [])));
  return content.filter((b, i) => {
    if (i > boundary) return true;
    if (i === boundary || b.type === "thinking" || b.type === "redacted_thinking" || b.type === "tool_use") return false;
    if (b.type === "text") return true;
    if (b.type === "server_tool_use") return answered.has(b.id);
    return "tool_use_id" in b;
  }) as BetaContentBlockParam[];
}

function sourcesFrom(block: BetaContentBlock): WebSourceRef[] {
  if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) return [];
  return block.content.map((r) => ({ title: r.title, url: r.url }));
}

// What the person asking sees. Setup problems (bad key, no credit, unknown
// model) read the same to them; the specifics go to the server log.
export const unavailable = (name: string) => `${name} isn't available right now. Please try again a little later.`;
export const busy = (name: string) => `${name} is busy right now. Try again in a minute.`;

export const interrupted = (name: string) => `${name} was interrupted partway through. Try again.`;

// Errors that say the service, not the request, failed: worth one more try.
const TRANSIENT_STREAM_TYPES = new Set(["overloaded_error", "api_error", "timeout_error"]);
// A stream cut off underneath the SDK surfaces as a plain error from fetch.
const BROKEN_STREAM = /terminated|socket|ECONNRESET|other side closed|premature close/i;
// The SDK's error when it can't read a tool call's input; its message quotes that input.
const TOOL_INPUT_PARSE = /^Unable to parse tool parameter JSON/;
// The SDK's errors for a stream that ended before the model's message was complete.
const STREAM_INCOMPLETE = /^(stream ended without producing|request ended without sending)/;

/** What the server log records about a failure: codes, status, error type and request id. Never message text. */
export function failureInfo(err: unknown): FailureInfo {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return { code: "connection_timeout" };
  if (err instanceof Anthropic.APIConnectionError) return { code: "connection" };
  if (err instanceof Anthropic.APIError) {
    const type = err.type ?? (err.error as { error?: { type?: string } } | undefined)?.error?.type;
    return {
      // Errors sent partway through a stream carry no status.
      code: err.status ? "api_status" : "stream_error",
      ...(err.status ? { status: err.status } : {}),
      ...(safeToken(type) ? { type: safeToken(type) } : {}),
      ...(safeToken(err.requestID) ? { requestId: safeToken(err.requestID) } : {}),
    };
  }
  if (err instanceof Error && TOOL_INPUT_PARSE.test(err.message)) return { code: "tool_input_parse" };
  if (err instanceof Error && STREAM_INCOMPLETE.test(err.message)) return { code: "stream_incomplete" };
  if (err instanceof Error && BROKEN_STREAM.test(err.message)) return { code: "stream_terminated", error: errorClass(err) };
  return { code: "unexpected", error: errorClass(err) };
}

/** Turns SDK errors into short messages that are safe to show to anyone. */
export function describeAnthropicError(err: unknown, name = "Gio"): Error {
  if (err instanceof Anthropic.APIUserAbortError) {
    const e = new Error("Stopped.");
    e.name = "AbortError";
    return e;
  }
  const reason = failureInfo(err);
  if (err instanceof Anthropic.APIConnectionError) {
    return new ChatError(`Couldn't reach ${name}. Check your connection and try again.`, true, reason);
  }
  if (err instanceof Anthropic.RateLimitError) return new ChatError(busy(name), false, reason);
  if (err instanceof Anthropic.APIError) {
    if (!err.status) {
      // Sent partway through the answer, e.g. the model was overloaded mid-stream.
      const type = err.type ?? "";
      if (type === "overloaded_error") return new ChatError(busy(name), true, reason);
      if (TRANSIENT_STREAM_TYPES.has(type)) return new ChatError(interrupted(name), true, reason);
      return new ChatError(unavailable(name), false, reason);
    }
    // The SDK has already retried overloaded and server errors before this point.
    if (err.status === 529 || err.status === 503) return new ChatError(busy(name), false, reason);
    if (err.status === 413) return new ChatError("That's too much to send at once. Try fewer photos.", false, reason);
    return new ChatError(unavailable(name), false, reason);
  }
  if (err instanceof Error && err.name === "AbortError") return err;
  if (err instanceof Error && BROKEN_STREAM.test(err.message)) return new ChatError(interrupted(name), true, reason);
  // Anything else (a mangled key failing inside fetch, a bug) reads the same
  // to the person asking; the specifics go to the server log.
  return new ChatError(unavailable(name), false, reason);
}

/** How far a turn got, for the log if it fails. */
interface Progress {
  resumes: number;
  fallback: boolean;
  phase?: AnswerPhase;
}

export class AnthropicChatProvider implements ChatProvider {
  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
    private readonly options: { effort: Effort; webSearchMaxUses: number; name?: string },
  ) {}

  async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const progress: Progress = { resumes: 0, fallback: false };
    try {
      yield* this.run(request, progress);
    } catch (err) {
      const described = describeAnthropicError(err, this.options.name);
      if (described.name === "AbortError") throw described;
      // Where in the turn it failed: a resumed request or a fallback point to their own causes.
      const failure: FailureInfo = {
        ...(described instanceof ChatError ? described.failure : failureInfo(err)),
        ...(progress.phase ? { phase: progress.phase } : {}),
        resumes: progress.resumes,
        fallback: progress.fallback,
      };
      // The person asking sees a plain message; the log gets codes, never the error's text.
      console.error("Anthropic chat error", JSON.stringify(failure));
      throw described instanceof ChatError ? new ChatError(described.message, described.transient, failure) : described;
    }
  }

  private async *run(request: ChatRequest, progress: Progress): AsyncIterable<ChatStreamEvent> {
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
        if (event.type === "content_block_start") {
          const kind = event.content_block.type;
          const phase: AnswerPhase | undefined =
            kind === "thinking" || kind === "redacted_thinking"
              ? "thinking"
              : kind === "server_tool_use"
                ? "searching"
                : kind === "text"
                  ? "writing"
                  : undefined;
          if (phase) {
            progress.phase = phase;
            yield { type: "phase", phase };
          }
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
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
          `_${this.options.name ?? "Gio"} couldn't answer this one. Try asking another way._`;
        text += notice;
        yield { type: "text", text: notice };
        break;
      }
      if (message.usage?.iterations?.some((i) => i.type === "fallback_message")) progress.fallback = true;
      if (message.stop_reason !== "pause_turn") break;
      // Server tool turn paused mid-flight: hand the partial turn back to resume.
      messages.push({ role: "assistant", content: resumableContent(message.content) });
      progress.resumes++;
    }

    yield { type: "done", text, model, stopReason, usage, webSearches, webSources, resumes: progress.resumes };
  }
}
