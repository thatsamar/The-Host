import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatProvider, ChatRequest, ChatStreamEvent } from "@/lib/ai/types";
import type { AnswerSnapshot } from "@/lib/ask/relay";

const state = vi.hoisted(() => ({ provider: null as unknown, background: [] as Promise<unknown>[] }));

// Outside Vercel, run what the route hands to after() and keep it to await.
vi.mock("next/server", () => ({ after: (task: () => unknown) => state.background.push(Promise.resolve(task())) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}), getUserId: async () => "u1" }));
vi.mock("@/lib/ai", () => ({ getChatProvider: () => state.provider }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({}) }));

const { POST } = await import("@/app/api/ask/route");
const { GET, DELETE } = await import("@/app/api/ask/[id]/route");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Writes its answer a piece at a time, like the model, and honours Stop. */
class SlowProvider implements ChatProvider {
  constructor(
    private readonly pieces: string[],
    private readonly delayMs: number,
  ) {}

  async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    yield { type: "phase", phase: "thinking" };
    yield { type: "phase", phase: "writing" };
    for (const piece of this.pieces) {
      await sleep(this.delayMs);
      if (request.signal?.aborted) {
        const err = new Error("Stopped.");
        err.name = "AbortError";
        throw err;
      }
      yield { type: "text", text: piece };
    }
    const text = this.pieces.join("");
    yield { type: "done", text, model: "m", stopReason: "end_turn", usage: {}, webSearches: [], webSources: [] };
  }
}

/** Writes a little, then thinks in silence until stopped, like a long answer with photos. */
class SilentProvider implements ChatProvider {
  constructor(private readonly before = "") {}

  async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    yield { type: "phase", phase: "thinking" };
    if (this.before) {
      yield { type: "phase", phase: "writing" };
      yield { type: "text", text: this.before };
      yield { type: "phase", phase: "thinking" };
    }
    await new Promise<void>((resolve) => request.signal?.addEventListener("abort", () => resolve(), { once: true }));
    const err = new Error("Stopped.");
    err.name = "AbortError";
    throw err;
  }
}

const QUESTION = "Which chair for the reading corner?";
const post = (id: string) =>
  POST(
    new Request("http://localhost/api/ask", {
      method: "POST",
      body: JSON.stringify({ id, turns: [{ role: "user", text: QUESTION, images: [{ mediaType: "image/jpeg", data: "aW1n" }] }] }),
    }),
  );
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const collect = async (id: string) => {
  const res = await GET(new Request(`http://localhost/api/ask/${id}`), params(id));
  return { status: res.status, body: res.status === 200 ? ((await res.json()) as AnswerSnapshot) : null };
};

describe("answer recovery", () => {
  beforeEach(() => {
    state.background = [];
  });

  it("keeps answering after the page disconnects, and the page can collect the answer", async () => {
    state.provider = new SlowProvider(["The low ", "walnut one, ", "with the ", "linen seat."], 5);
    const id = crypto.randomUUID();
    const res = await post(id);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel(); // the phone suspended the page

    await Promise.all(state.background);
    const { status, body } = await collect(id);
    expect(status).toBe(200);
    expect(body).toEqual({
      phase: "writing",
      text: "The low walnut one, with the linen seat.",
      sources: [],
      done: true,
      updatedAt: expect.any(Number),
    });
  });

  it("saves the answer only, never the question or photos", async () => {
    state.provider = new SlowProvider(["Short answer."], 1);
    const id = crypto.randomUUID();
    await (await post(id)).text();
    await Promise.all(state.background);
    const saved = JSON.stringify((await collect(id)).body);
    expect(saved).not.toContain(QUESTION);
    expect(saved).not.toContain("aW1n");
  });

  it("makes the answer collectable as soon as the question arrives", async () => {
    state.provider = new SlowProvider(["Slow."], 50);
    const id = crypto.randomUUID();
    await post(id);
    await sleep(5);
    expect((await collect(id)).body).toMatchObject({ text: "", done: false });
    await Promise.all(state.background);
  });

  it("Stop ends the answer on the server, not just on the page", async () => {
    const pieces = Array.from({ length: 150 }, (_, i) => `${i} `);
    state.provider = new SlowProvider(pieces, 10);
    const id = crypto.randomUUID();
    const res = await post(id);
    await res.body!.cancel();
    expect((await DELETE(new Request(`http://localhost/api/ask/${id}`), params(id))).status).toBe(204);

    await Promise.all(state.background);
    const { body } = await collect(id);
    expect(body).toMatchObject({ done: true, error: "Stopped." });
    expect(body!.text.length).toBeLessThan(pieces.join("").length);
  });

  it("ends an answer that runs too long with a message, before Vercel cuts the function off", async () => {
    vi.useFakeTimers();
    try {
      state.provider = new SilentProvider("Start with the south bed. ");
      const id = crypto.randomUUID();
      const res = await post(id);
      const read = res.text();
      await vi.advanceTimersByTimeAsync(279_000);
      expect((await collect(id)).body).toMatchObject({ done: false });
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.all(state.background);

      const lines = (await read).trim().split("\n").map((l) => JSON.parse(l));
      expect(lines.at(-1)).toEqual({ type: "error", message: "Gio ran out of time before finishing this answer. Try again." });
      // What was written stays, with the reason it ended.
      expect((await collect(id)).body).toMatchObject({
        text: "Start with the south bed. ",
        done: true,
        error: "Gio ran out of time before finishing this answer. Try again.",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends a heartbeat while the model thinks in silence, and keeps the saved answer fresh", async () => {
    vi.useFakeTimers();
    try {
      state.provider = new SilentProvider();
      const id = crypto.randomUUID();
      const res = await post(id);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let received = "";
      const pump = (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += decoder.decode(value);
        }
      })();
      await vi.advanceTimersByTimeAsync(1_000);
      const first = (await collect(id)).body!.updatedAt!;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(received.match(/"alive"/g)?.length).toBe(2);
      expect((await collect(id)).body!.updatedAt).toBeGreaterThan(first);

      // Stop reaches the server even before the first word is written.
      await DELETE(new Request(`http://localhost/api/ask/${id}`), params(id));
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.all(state.background);
      await pump;
      expect((await collect(id)).body).toMatchObject({ done: true, error: "Stopped." });
    } finally {
      vi.useRealTimers();
    }
  });

  it("says which store answered, so a deployment can be checked", async () => {
    const id = crypto.randomUUID();
    const res = await GET(new Request(`http://localhost/api/ask/${id}`), params(id));
    expect(res.status).toBe(404);
    // Outside Vercel there's no Runtime Cache, so this is the instance's own memory.
    expect(res.headers.get("X-Answer-Store")).toBe("instance-memory");
    expect(await res.json()).toEqual({ error: "Not found", store: "instance-memory" });
  });

  it("has nothing for unknown or malformed ids", async () => {
    expect((await collect(crypto.randomUUID())).status).toBe(404);
    expect((await collect("not-an-id")).status).toBe(404);
    expect((await DELETE(new Request("http://localhost/api/ask/x"), params("../x"))).status).toBe(404);
  });

  it("rejects an answer id that isn't a random uuid", async () => {
    const res = await POST(
      new Request("http://localhost/api/ask", { method: "POST", body: JSON.stringify({ id: "1", turns: [{ role: "user", text: "Hi" }] }) }),
    );
    expect(res.status).toBe(400);
  });
});
