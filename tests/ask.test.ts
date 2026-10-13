import { describe, expect, it } from "vitest";
import { LENGTH_LIMIT, NO_ANSWER, ask, errorMessage, type AskEvent } from "@/lib/ask/ask";
import { gio } from "@/lib/companions/gio";
import { tony } from "@/lib/companions/tony";
import { ChatError, type ChatProvider, type ChatRequest, type ChatStreamEvent } from "@/lib/ai/types";
import { ScriptedProvider, collect, replyWith } from "./helpers/fakes";

/** Fails each call in turn with the given errors (after the given events), then answers. */
class FlakyProvider implements ChatProvider {
  calls = 0;
  constructor(
    private readonly failures: { before?: ChatStreamEvent[]; error: Error }[],
    private readonly answer = "The south bed first.",
  ) {}
  async *streamChat(_request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const failure = this.failures[this.calls++];
    if (failure) {
      for (const event of failure.before ?? []) yield event;
      throw failure.error;
    }
    yield* replyWith(this.answer)();
  }
}
const overloadedFailure = { code: "stream_error", type: "overloaded_error", requestId: "req_1" };
const overloaded = () => new ChatError("Gio is busy right now. Try again in a minute.", true, overloadedFailure);
const thinking: ChatStreamEvent = { type: "phase", phase: "thinking" };

describe("ask", () => {
  it("streams the answer for the latest question with the whole visit as context", async () => {
    const provider = new ScriptedProvider(replyWith("Hang it lower."));
    const events = await collect(
      ask({ provider, companion: gio }, [
        { role: "user", text: "Where should the art go?" },
        { role: "assistant", text: "Over the sofa." },
        { role: "user", text: "How high?", images: [{ mediaType: "image/jpeg", data: "aW1n" }] },
      ]),
    );
    expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("")).toBe("Hang it lower.");
    expect(events.at(-1)).toEqual({ type: "done" });
    const req = provider.requests[0];
    expect(req.system[0].body).toBe(gio.systemPrompt);
    expect(req.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(req.messages[2].content[0]).toEqual({ type: "image", mediaType: "image/jpeg", data: "aW1n" });
  });

  it("passes web searches and sources through", async () => {
    const provider = new ScriptedProvider(() => [
      { type: "web_search", query: "vintage lounge chair" },
      { type: "web_results", sources: [{ title: "1stDibs", url: "https://example.com" }] },
      ...replyWith("Found one.")(),
    ]);
    const events = await collect(ask({ provider, companion: tony }, [{ role: "user", text: "Find a chair" }]));
    expect(events.slice(0, 2)).toEqual([
      { type: "searching", query: "vintage lounge chair" },
      { type: "sources", sources: [{ title: "1stDibs", url: "https://example.com" }] },
    ]);
  });

  it("reports failures as an error event", async () => {
    const provider = new ScriptedProvider(() => new Error("Gio is busy right now. Try again in a minute."));
    const events = await collect(ask({ provider, companion: tony }, [{ role: "user", text: "Hi" }]));
    expect(events).toEqual([{ type: "error", message: "Gio is busy right now. Try again in a minute." }]);
  });

  it("says so when the model finishes without writing anything", async () => {
    const provider = new ScriptedProvider(replyWith(""));
    const events = await collect(ask({ provider, companion: tony }, [{ role: "user", text: "Hi" }]));
    expect(events).toEqual([{ type: "error", message: NO_ANSWER }]);
  });

  it("marks an answer cut off at its length limit as unfinished, keeping what was written", async () => {
    const provider = new ScriptedProvider(replyWith("Plant the south bed with", { stopReason: "max_tokens" }));
    const finished: unknown[] = [];
    const events = await collect(
      ask({ provider, companion: tony, onFinish: (info) => finished.push(info) }, [{ role: "user", text: "Plan" }]),
    );
    expect(events.filter((e) => e.type === "text").length).toBeGreaterThan(0);
    expect(events.at(-1)).toEqual({ type: "error", message: LENGTH_LIMIT });
    expect(finished).toEqual([{ stopReason: "max_tokens", outputTokens: 5, searches: 0, model: "test-model" }]);
  });

  it("refuses a conversation that doesn't end with a question", async () => {
    const provider = new ScriptedProvider(replyWith("x"));
    const events = await collect(ask({ provider, companion: tony }, [{ role: "user", text: " " }]));
    expect(events).toEqual([{ type: "error", message: "Add a photo or a question." }]);
    expect(provider.requests).toHaveLength(0);
  });
});

describe("a model call that fails partway through", () => {
  const turns = [{ role: "user" as const, text: "Plan both sides of the house" }];
  const text = (events: AskEvent[]) => events.map((e) => (e.type === "text" ? e.text : "")).join("");

  it("is made once more when nothing has been shown yet and there's time, and then answers", async () => {
    const provider = new FlakyProvider([{ before: [thinking], error: overloaded() }]);
    const failures: unknown[] = [];
    const events = await collect(
      ask(
        { provider, companion: tony, canRetry: () => true, onFailure: (f, attempt, retrying) => failures.push([f, attempt, retrying]) },
        turns,
      ),
    );
    expect(provider.calls).toBe(2);
    expect(text(events)).toBe("The south bed first.");
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(failures).toEqual([[overloadedFailure, 1, true]]);
  });

  it("is made at most once more", async () => {
    const provider = new FlakyProvider([{ error: overloaded() }, { error: overloaded() }]);
    const events = await collect(ask({ provider, companion: tony, canRetry: () => true }, turns));
    expect(provider.calls).toBe(2);
    expect(events.at(-1)).toEqual({ type: "error", message: "Gio is busy right now. Try again in a minute." });
  });

  it("is not made again once part of the answer has been shown", async () => {
    const provider = new FlakyProvider([{ before: [{ type: "text", text: "Start with" }], error: overloaded() }]);
    const events = await collect(ask({ provider, companion: tony, canRetry: () => true }, turns));
    expect(provider.calls).toBe(1);
    expect(events.at(-1)).toMatchObject({ type: "error" });
  });

  it("is not made again when time is short, or when the request itself was refused", async () => {
    const late = new FlakyProvider([{ error: overloaded() }]);
    await collect(ask({ provider: late, companion: tony, canRetry: () => false }, turns));
    expect(late.calls).toBe(1);
    const refused = new FlakyProvider([{ error: new ChatError("Gio isn't available right now.", false, { code: "api_status", status: 400 }) }]);
    await collect(ask({ provider: refused, companion: tony, canRetry: () => true }, turns));
    expect(refused.calls).toBe(1);
  });
});

describe("errorMessage", () => {
  it("passes the provider's plain message through, and names a stop", () => {
    expect(errorMessage(new Error("Gio is busy right now. Try again in a minute."))).toMatch(/busy/);
    expect(errorMessage(Object.assign(new Error("x"), { name: "AbortError" }))).toBe("Stopped.");
    expect(errorMessage("weird")).toBe("Something went wrong. Try again.");
  });
});
