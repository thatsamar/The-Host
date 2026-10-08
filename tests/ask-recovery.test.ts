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
    expect(body).toEqual({ phase: "writing", text: "The low walnut one, with the linen seat.", sources: [], done: true });
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
