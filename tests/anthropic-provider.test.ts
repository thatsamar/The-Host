import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicChatProvider, busy, describeAnthropicError, interrupted, resumableContent, toAnthropicSystem, unavailable } from "@/lib/ai/anthropic";
import { ChatError } from "@/lib/ai/types";
import { gio } from "@/lib/companions/gio";
import type { ChatRequest, ChatStreamEvent } from "@/lib/ai/types";
import { assemblePrompt } from "@/lib/ask/prompt";
import { collect } from "./helpers/fakes";

type Block = Record<string, unknown> & { type: string };
interface ScriptedTurn {
  content: Block[];
  stop_reason: string;
}

/** Minimal stand-in for client.beta.messages.stream that replays scripted turns. */
function fakeClient(turns: ScriptedTurn[]) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>) {
          calls.push(structuredClone(params));
          const turn = turns.shift()!;
          const current = { content: [] as Block[] };
          const message = {
            model: "claude-opus-5-5",
            stop_reason: turn.stop_reason,
            usage: { input_tokens: 100, output_tokens: 20 },
            content: turn.content,
          };
          return {
            get currentMessage() {
              return current;
            },
            async *[Symbol.asyncIterator]() {
              for (const [index, block] of turn.content.entries()) {
                current.content[index] = block;
                yield { type: "content_block_start", index, content_block: block };
                if (block.type === "text") {
                  for (const piece of String(block.text).match(/[\s\S]{1,5}/g) ?? []) {
                    yield { type: "content_block_delta", index, delta: { type: "text_delta", text: piece } };
                  }
                }
                yield { type: "content_block_stop", index };
              }
            },
            finalMessage: async () => message,
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

const request: ChatRequest = assemblePrompt({
  companion: { ...gio, systemPrompt: "You are Gio." },
  turns: [
    { role: "user", text: "Find us a vintage lounge chair under $2,000.", images: [{ mediaType: "image/png", data: "aW1n" }] },
  ],
});

const options = { effort: "high" as const, webSearchMaxUses: 5 };

describe("AnthropicChatProvider", () => {
  it("streams text, surfaces web searches and sources, and reports a final message", async () => {
    const { client, calls } = fakeClient([
      {
        stop_reason: "end_turn",
        content: [
          { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "vintage lounge chair" } },
          {
            type: "web_search_tool_result",
            tool_use_id: "s1",
            content: [{ type: "web_search_result", title: "1stDibs chair", url: "https://example.com/a", encrypted_content: "x", page_age: null }],
          },
          { type: "text", text: "THE CALL — this one." },
        ],
      },
    ]);
    const provider = new AnthropicChatProvider(client, "claude-opus-5-5", options);
    const events = await collect(provider.streamChat(request));

    expect(events.filter((e) => e.type === "web_search")).toEqual([{ type: "web_search", query: "vintage lounge chair" }]);
    expect(events.find((e) => e.type === "web_results")).toEqual({
      type: "web_results",
      sources: [{ title: "1stDibs chair", url: "https://example.com/a" }],
    });
    const text = events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("");
    expect(text).toBe("THE CALL — this one.");
    const done = events.at(-1) as Extract<ChatStreamEvent, { type: "done" }>;
    expect(done).toMatchObject({ type: "done", text: "THE CALL — this one.", stopReason: "end_turn", webSearches: ["vintage lounge chair"] });

    const params = calls[0];
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 5 }]);
    expect(params.output_config).toEqual({ effort: "high" });
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params).not.toHaveProperty("thinking");
    const messages = params.messages as { role: string; content: Block[] }[];
    expect(messages[0].content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "aW1n" } });
  });

  it("reports progress phases in the order the model works", async () => {
    const { client } = fakeClient([
      {
        stop_reason: "end_turn",
        content: [
          { type: "thinking", thinking: "", signature: "s" },
          { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "chair" } },
          { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
          { type: "thinking", thinking: "", signature: "s" },
          { type: "text", text: "Here it is." },
        ],
      },
    ]);
    const provider = new AnthropicChatProvider(client, "claude-opus-5-5", options);
    const events = await collect(provider.streamChat(request));
    expect(events.filter((e) => e.type === "phase").map((e) => (e as { phase: string }).phase)).toEqual([
      "thinking",
      "searching",
      "thinking",
      "writing",
    ]);
  });

  it("resumes a paused server-tool turn by sending the partial assistant turn back", async () => {
    const { client, calls } = fakeClient([
      { stop_reason: "pause_turn", content: [{ type: "text", text: "Searching. " }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] },
    ]);
    const provider = new AnthropicChatProvider(client, "claude-opus-5-5", options);
    const events = await collect(provider.streamChat(request));
    expect(calls).toHaveLength(2);
    const second = calls[1].messages as { role: string }[];
    expect(second.at(-1)!.role).toBe("assistant");
    const done = events.at(-1) as Extract<ChatStreamEvent, { type: "done" }>;
    expect(done.text).toBe("Searching. Done.");
    expect(done.usage.output_tokens).toBe(40);
  });

  it("resumes after a mid-turn fallback without what only the declining model can read", async () => {
    const paused: Block[] = [
      { type: "thinking", thinking: "", signature: "sig-a" },
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "clay soil shrubs" } },
      { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
      { type: "server_tool_use", id: "s2", name: "web_search", input: { query: "drip kits" } },
      { type: "text", text: "Start with drainage. " },
      { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-5" } },
      { type: "thinking", thinking: "", signature: "sig-b" },
      { type: "server_tool_use", id: "s3", name: "web_search", input: { query: "mulch" } },
    ];
    const { client, calls } = fakeClient([
      { stop_reason: "pause_turn", content: paused },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Then plant." }] },
    ]);
    const provider = new AnthropicChatProvider(client, "claude-opus-5-5", options);
    await collect(provider.streamChat(request));
    const resumed = (calls[1].messages as { role: string; content: Block[] }[]).at(-1)!;
    expect(resumed.role).toBe("assistant");
    expect(resumed.content.map((b) => (b.type === "server_tool_use" ? `${b.type}:${b.id}` : b.type))).toEqual([
      "server_tool_use:s1",
      "web_search_tool_result",
      "text",
      "thinking", // after the switch: echoed as is
      "server_tool_use:s3",
    ]);
  });

  it("resumes without a fallback by sending the paused turn back unchanged", () => {
    const content = [
      { type: "thinking", thinking: "", signature: "x" },
      { type: "text", text: "a", citations: null },
    ] as Parameters<typeof resumableContent>[0];
    expect(resumableContent(content)).toBe(content);
  });

  it("turns a refusal into a readable notice", async () => {
    const { client } = fakeClient([{ stop_reason: "refusal", content: [] }]);
    const provider = new AnthropicChatProvider(client, "claude-opus-5-5", options);
    const done = (await collect(provider.streamChat(request))).at(-1) as Extract<ChatStreamEvent, { type: "done" }>;
    expect(done.stopReason).toBe("refusal");
    expect(done.text).toMatch(/couldn't answer/);
  });

  it("omits the web search tool when disabled", async () => {
    const { client, calls } = fakeClient([{ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }]);
    const provider = new AnthropicChatProvider(client, "m", options);
    await collect(provider.streamChat({ ...request, webSearch: false }));
    expect(calls[0].tools).toEqual([]);
  });
});

describe("error handling", () => {
  it("maps SDK errors to short, readable messages", async () => {
    const failing = {
      beta: {
        messages: {
          stream() {
            throw new Anthropic.APIConnectionError({ message: "socket hang up" });
          },
        },
      },
    } as unknown as Anthropic;
    const provider = new AnthropicChatProvider(failing, "m", options);
    await expect(collect(provider.streamChat(request))).rejects.toThrow("Couldn't reach Gio");
  });
});

/** The real SDK over a fake network: starts thinking, then the API sends an error event mid-stream. */
function midStreamFailure(errorType: string) {
  const sse = [
    ["message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }],
    ["ping", { type: "ping" }],
    ["error", { type: "error", error: { type: errorType, message: "Overloaded" } }],
  ]
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
  const fetch = async () =>
    new Response(sse, { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_test123" } });
  return new Anthropic({ apiKey: "test", fetch, maxRetries: 0 });
}

describe("errors partway through the answer", () => {
  it("reports an overload mid-stream as busy, not as unavailable", async () => {
    const provider = new AnthropicChatProvider(midStreamFailure("overloaded_error"), "m", options);
    const err = await collect(provider.streamChat(request)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChatError);
    expect((err as ChatError).message).toBe(busy("Gio"));
    expect((err as ChatError).failure).toEqual({
      code: "stream_error",
      type: "overloaded_error",
      requestId: "req_test123",
      phase: "thinking",
      resumes: 0,
      fallback: false,
    });
  });

  it("reports an internal error mid-stream as an interruption", async () => {
    const provider = new AnthropicChatProvider(midStreamFailure("api_error"), "m", options);
    const err = (await collect(provider.streamChat(request)).catch((e: unknown) => e)) as ChatError;
    expect(err.message).toBe(interrupted("Gio"));
  });

  it("reports a mid-stream error that says the request itself is wrong as unavailable", async () => {
    const provider = new AnthropicChatProvider(midStreamFailure("invalid_request_error"), "m", options);
    const err = (await collect(provider.streamChat(request)).catch((e: unknown) => e)) as ChatError;
    expect(err.message).toBe(unavailable("Gio"));
  });

  it("treats a stream cut off underneath the SDK as an interruption", () => {
    const err = describeAnthropicError(new TypeError("terminated"), "Gio") as ChatError;
    expect(err.message).toBe(interrupted("Gio"));
  });
});

describe("describeAnthropicError", () => {
  const apiError = (status: number, message: string) =>
    Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message } }, message, new Headers());
  it("keeps setup problems out of the person's view and says when Gio is busy", () => {
    for (const [status, text] of [
      [401, "invalid x-api-key"],
      [400, "Your credit balance is too low"],
      [404, "model: nope"],
      [500, "boom"],
    ] as const) {
      expect(describeAnthropicError(apiError(status, text)).message).toBe(unavailable("Gio"));
    }
    expect(describeAnthropicError(apiError(429, "slow"), "Tony").message).toBe(busy("Tony"));
    expect(describeAnthropicError(apiError(529, "overloaded"), "Tony").message).toBe("Tony is busy right now. Try again in a minute.");
    expect(describeAnthropicError(new Anthropic.APIUserAbortError()).name).toBe("AbortError");
    // e.g. a key saved as Vercel's "●●●●" placeholder fails inside fetch.
    const mangled = new TypeError("Cannot convert argument to a ByteString because the character at index 0 has a value of 9679");
    expect(describeAnthropicError(mangled, "Martini").message).toBe(unavailable("Martini"));
  });
});

describe("toAnthropicSystem", () => {
  it("sends Gio's prompt raw, renders labeled blocks and caches only through the last stable block", () => {
    const system = toAnthropicSystem(request);
    expect(system[0].text).toBe("You are Gio.");
    expect(system[1].text.startsWith("<app_capabilities>\nAPP CAPABILITIES")).toBe(true);
    expect(system.map((b) => Boolean(b.cache_control))).toEqual([false, true]);
  });
});
