import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import type { ChatProvider, ChatRequest, ChatStreamEvent } from "@/lib/ai/types";

// Server logs may hold codes, numbers and ids, never what someone asked, the
// answer, photos, or the answer id that unlocks a saved answer.

const state = vi.hoisted(() => ({ provider: null as unknown, background: [] as Promise<unknown>[] }));
vi.mock("next/server", () => ({ after: (task: () => unknown) => state.background.push(Promise.resolve(task())) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}), getUserId: async () => "u1" }));
vi.mock("@/lib/ai", () => ({ getChatProvider: () => state.provider }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({}) }));

const { AnthropicChatProvider, failureInfo } = await import("@/lib/ai/anthropic");
const { POST } = await import("@/app/api/ask/route");
const { onRequestError } = await import("@/instrumentation");

const QUESTION = "Plan the clay bed by the Hendricks' fence at 41 Elm Street";
const PRIVATE = "Hendricks";

let logged: string[] = [];
beforeEach(() => {
  logged = [];
  state.background = [];
  for (const level of ["error", "info", "warn", "log"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
  }
});
afterEach(() => vi.restoreAllMocks());

const request: ChatRequest = {
  system: [{ label: "a", title: "A", body: "You are Gio." }],
  messages: [{ role: "user", content: [{ type: "text", text: QUESTION }] }],
  webSearch: true,
};
const options = { effort: "high" as const, webSearchMaxUses: 5, name: "Gio" };

/** The real SDK over a fake network replaying these server-sent events. */
function sdkReplaying(events: [string, unknown][]) {
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  const fetch = async () =>
    new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_abc123" } });
  return new Anthropic({ apiKey: "test", fetch, maxRetries: 0 });
}
const start: [string, unknown] = [
  "message_start",
  {
    type: "message_start",
    message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } },
  },
];
const drain = async (provider: ChatProvider) => {
  try {
    for await (const _ of provider.streamChat(request)) void _;
  } catch {}
};

describe("what the logs say about a failed answer", () => {
  it("records an API error's codes, not its message, even when the message quotes the question", async () => {
    const client = sdkReplaying([
      start,
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }],
      ["error", { type: "error", error: { type: "invalid_request_error", message: `Bad value near "${QUESTION}"` } }],
    ]);
    await drain(new AnthropicChatProvider(client, "m", options));
    expect(logged.join("\n")).not.toContain(PRIVATE);
    expect(logged).toContainEqual(
      'Anthropic chat error {"code":"stream_error","type":"invalid_request_error","requestId":"req_abc123","phase":"thinking","resumes":0,"fallback":false}',
    );
  });

  it("records a tool input the SDK couldn't read as a code, without the input its message quotes", () => {
    const err = new Anthropic.AnthropicError(`Unable to parse tool parameter JSON from model. JSON: {"query": "${PRIVATE} fence`);
    expect(failureInfo(err)).toEqual({ code: "tool_input_parse" });
  });

  it("records a stream that ended early as a code, with nothing from the search it was running", async () => {
    const client = sdkReplaying([
      start,
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", id: "s1", name: "web_search", input: {} } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: `{"query": "${PRIVATE} fence` } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ]);
    await drain(new AnthropicChatProvider(client, "m", options));
    expect(logged.join("\n")).not.toContain(PRIVATE);
    expect(logged).toContainEqual('Anthropic chat error {"code":"stream_incomplete","phase":"searching","resumes":0,"fallback":false}');
  });

  it("keeps the question, the answer and the answer id out of the route's logs", async () => {
    class Failing implements ChatProvider {
      async *streamChat(): AsyncIterable<ChatStreamEvent> {
        yield { type: "phase", phase: "writing" };
        yield { type: "text", text: `About ${PRIVATE}'s fence: ` };
        throw new Error(`exploded while handling ${QUESTION}`);
      }
    }
    state.provider = new Failing();
    const id = crypto.randomUUID();
    const res = await POST(
      new Request("http://localhost/api/ask", {
        method: "POST",
        body: JSON.stringify({ id, turns: [{ role: "user", text: QUESTION, images: [{ mediaType: "image/jpeg", data: "aW1n" }] }] }),
      }),
    );
    await res.text();
    await Promise.all(state.background);
    const all = logged.join("\n");
    expect(all).toContain("Answer finished");
    for (const secret of [PRIVATE, id, "aW1n"]) expect(all).not.toContain(secret);
  });

  it("logs a failed request by its route pattern and error class only", () => {
    const id = crypto.randomUUID();
    void onRequestError(
      new TypeError(`cannot read ${QUESTION}`),
      { path: `/api/ask/${id}?x=1`, method: "GET", headers: {} },
      { routerKind: "App Router", routePath: "/api/ask/[id]", routeType: "route", renderSource: undefined, revalidateReason: undefined, renderType: "dynamic" } as never,
    );
    expect(logged).toEqual(['Request failed {"method":"GET","routePath":"/api/ask/[id]","routeType":"route","error":"TypeError"}']);
  });
});
