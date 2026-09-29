import { describe, expect, it } from "vitest";
import { askGio, errorMessage } from "@/lib/gio/ask";
import { ScriptedProvider, collect, replyWith } from "./helpers/fakes";

describe("askGio", () => {
  it("streams the answer for the latest question with the whole visit as context", async () => {
    const provider = new ScriptedProvider(replyWith("Hang it lower."));
    const events = await collect(
      askGio({ provider, systemPrompt: "You are Gio." }, [
        { role: "user", text: "Where should the art go?" },
        { role: "assistant", text: "Over the sofa." },
        { role: "user", text: "How high?", images: [{ mediaType: "image/jpeg", data: "aW1n" }] },
      ]),
    );
    expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("")).toBe("Hang it lower.");
    expect(events.at(-1)).toEqual({ type: "done" });
    const req = provider.requests[0];
    expect(req.system[0].body).toBe("You are Gio.");
    expect(req.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(req.messages[2].content[0]).toEqual({ type: "image", mediaType: "image/jpeg", data: "aW1n" });
  });

  it("passes web searches and sources through", async () => {
    const provider = new ScriptedProvider(() => [
      { type: "web_search", query: "vintage lounge chair" },
      { type: "web_results", sources: [{ title: "1stDibs", url: "https://example.com" }] },
      ...replyWith("Found one.")(),
    ]);
    const events = await collect(askGio({ provider, systemPrompt: "x" }, [{ role: "user", text: "Find a chair" }]));
    expect(events.slice(0, 2)).toEqual([
      { type: "searching", query: "vintage lounge chair" },
      { type: "sources", sources: [{ title: "1stDibs", url: "https://example.com" }] },
    ]);
  });

  it("reports failures as an error event", async () => {
    const provider = new ScriptedProvider(() => new Error("Gio is busy right now. Try again in a minute."));
    const events = await collect(askGio({ provider, systemPrompt: "x" }, [{ role: "user", text: "Hi" }]));
    expect(events).toEqual([{ type: "error", message: "Gio is busy right now. Try again in a minute." }]);
  });

  it("refuses a conversation that doesn't end with a question", async () => {
    const provider = new ScriptedProvider(replyWith("x"));
    const events = await collect(askGio({ provider, systemPrompt: "x" }, [{ role: "user", text: " " }]));
    expect(events).toEqual([{ type: "error", message: "Add a photo or a question." }]);
    expect(provider.requests).toHaveLength(0);
  });
});

describe("errorMessage", () => {
  it("passes the provider's plain message through, and names a stop", () => {
    expect(errorMessage(new Error("Gio is busy right now. Try again in a minute."))).toMatch(/busy/);
    expect(errorMessage(Object.assign(new Error("x"), { name: "AbortError" }))).toBe("Stopped.");
    expect(errorMessage("weird")).toBe("Something went wrong. Try again.");
  });
});
