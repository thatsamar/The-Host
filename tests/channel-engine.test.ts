import { describe, expect, it, vi } from "vitest";
import type { ChatRequest, ChatStreamEvent } from "@/lib/ai/types";
import type { Companion } from "@/lib/companions/types";

// The channel reaches advisors through the website's own engine: the same
// provider factory (model, effort, search settings), the same prompt assembly
// and the same answer handling. Nothing of an advisor is rebuilt for it.

const state = vi.hoisted(() => ({ requests: [] as ChatRequest[], companions: [] as Companion[], fail: false, events: [] as ChatStreamEvent[] }));
vi.mock("@/lib/ai", () => ({
  getChatProvider: (companion: Companion) => {
    if (state.fail) throw new Error("Missing or invalid settings");
    state.companions.push(companion);
    return {
      async *streamChat(request: ChatRequest) {
        state.requests.push(request);
        yield* state.events;
      },
    };
  },
}));

const { cinqEngine } = await import("@/lib/channel/engine");
const { assemblePrompt } = await import("@/lib/ask/prompt");
const { COMPANIONS, ACTIVE_LINEUP } = await import("@/lib/companions");

const done: ChatStreamEvent = { type: "done", text: "", model: "m", stopReason: "end_turn", usage: {}, webSearches: [], webSources: [] };

describe("the channel's engine", () => {
  it("sends each advisor exactly the request the website would", async () => {
    state.events = [{ type: "text", text: "Go early." }, done];
    const turns = [{ role: "user" as const, text: "One night in Bangkok", images: [{ mediaType: "image/png", data: "iVBORw0KGgo=" }] }];
    for (const id of ACTIVE_LINEUP) {
      state.requests = [];
      state.companions = [];
      const result = await cinqEngine().answer(id, turns, new AbortController().signal);
      expect(result).toEqual({ text: "Go early.", error: undefined });
      expect(state.companions[0]).toBe(COMPANIONS[id]);
      const { signal, ...sent } = state.requests[0];
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(sent).toEqual(assemblePrompt({ companion: COMPANIONS[id], turns }));
      expect(sent.webSearch).toBe(true);
    }
  });

  it("passes on the engine's own plain messages", async () => {
    state.events = [{ type: "text", text: "Half" }, { ...done, stopReason: "max_tokens" }];
    expect(await cinqEngine().answer("tony", [{ role: "user", text: "x" }], new AbortController().signal)).toEqual({
      text: "Half",
      error: "This answer reached its length limit before it finished.",
    });
    state.fail = true;
    const result = await cinqEngine().answer("gio", [{ role: "user", text: "x" }], new AbortController().signal);
    state.fail = false;
    expect(result.error).toMatch(/^Gio isn't available right now/);
  });

  it("never answers as a retired advisor", async () => {
    expect((await cinqEngine().answer("jack", [{ role: "user", text: "x" }], new AbortController().signal)).error).toMatch(/no longer one of Cinq's advisors/);
  });
});
