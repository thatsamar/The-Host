import { describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  options: [] as Record<string, unknown>[],
  writes: [] as { key: string; value: unknown; options: Record<string, unknown> }[],
}));

vi.mock("@vercel/functions", () => ({
  getCache: (options: { keyHashFunction: (k: string) => string; namespace: string }) => {
    store.options.push(options);
    return {
      get: async () => null,
      set: async (key: string, value: unknown, opts: Record<string, unknown>) => {
        store.writes.push({ key: options.keyHashFunction(key), value, options: opts });
      },
    };
  },
}));

const { ANSWER_TTL_SECONDS, AnswerRelay, applyEvent, isAnswerId } = await import("@/lib/ask/relay");

describe("answer relay", () => {
  it("stores under the answer id itself, with a 15-minute expiry and no visible name", async () => {
    const id = crypto.randomUUID();
    const relay = new AnswerRelay(id, () => {});
    relay.begin();
    relay.push({ type: "text", text: "Hello." });
    relay.push({ type: "done" });
    await relay.finish();

    expect(ANSWER_TTL_SECONDS).toBe(900);
    expect(store.options[0]).toMatchObject({ namespace: "answer" });
    expect(store.writes.length).toBeGreaterThan(0);
    for (const write of store.writes) {
      expect(write.key).toBe(id);
      expect(write.options).toEqual({ ttl: 900, name: "" });
    }
    expect(store.writes.at(-1)!.value).toEqual({ phase: null, text: "Hello.", sources: [], done: true });
  });

  it("marks an answer that ended without finishing as stopped", async () => {
    store.writes = [];
    const relay = new AnswerRelay(crypto.randomUUID(), () => {});
    relay.push({ type: "text", text: "Half" });
    await relay.finish();
    expect(store.writes.at(-1)!.value).toMatchObject({ text: "Half", done: true, error: "Stopped." });
  });

  it("follows the answer's events", () => {
    let s = { phase: null, text: "", sources: [], done: false } as Parameters<typeof applyEvent>[0];
    s = applyEvent(s, { type: "phase", phase: "thinking" });
    s = applyEvent(s, { type: "searching", query: "q" });
    expect(s.phase).toBe("searching");
    s = applyEvent(s, { type: "sources", sources: [{ title: "A", url: "https://a.example" }] });
    s = applyEvent(s, { type: "phase", phase: "writing" });
    s = applyEvent(s, { type: "text", text: "Hi" });
    s = applyEvent(s, { type: "error", message: "Gio is busy right now. Try again in a minute." });
    expect(s).toEqual({
      phase: "writing",
      text: "Hi",
      sources: [{ title: "A", url: "https://a.example" }],
      done: true,
      error: "Gio is busy right now. Try again in a minute.",
    });
  });

  it("accepts only random uuids as answer ids", () => {
    expect(isAnswerId(crypto.randomUUID())).toBe(true);
    expect(isAnswerId("00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(isAnswerId("../etc")).toBe(false);
    expect(isAnswerId(42)).toBe(false);
  });
});
