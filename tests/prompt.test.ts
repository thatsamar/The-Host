import { describe, expect, it } from "vitest";
import type { ChatContentPart } from "@/lib/ai/types";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/gio/default-system-prompt";
import { BLOCK_ORDER, assemblePrompt, capabilitiesBlock, toChatTurns } from "@/lib/gio/prompt";

const textOf = (parts: ChatContentPart[]) =>
  parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
const img = (data = "aW1n") => ({ mediaType: "image/jpeg", data });

describe("assemblePrompt", () => {
  it("puts Gio's prompt first, verbatim, then the app capabilities", () => {
    const req = assemblePrompt({ systemPrompt: DEFAULT_SYSTEM_PROMPT, turns: [{ role: "user", text: "Hi" }] });
    expect(req.system.map((b) => b.label)).toEqual([...BLOCK_ORDER]);
    expect(req.system[0].body).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(req.system.every((b) => b.cacheable)).toBe(true);
    expect(req.webSearch).toBe(true);
  });

  it("tells Gio the app keeps nothing and has no speakers, memories or library", () => {
    const body = capabilitiesBlock(true).body;
    expect(body).toMatch(/keeps nothing/);
    expect(body).toMatch(/no speaker labels, saved memories, projects or uploaded library/);
    expect(body).toMatch(/up to 10 photos/);
    expect(body).toMatch(/web_search/);
    expect(body).toMatch(/Invest \/ save \/ skip/);
    expect(body).toMatch(/"Don't buy anything"/);
    expect(capabilitiesBlock(false).body).toMatch(/Mark every price as an estimate/);
  });
});

describe("toChatTurns", () => {
  it("sends photos before the question", () => {
    const [turn] = toChatTurns([{ role: "user", text: "What's off here?", images: [img("a"), img("b")] }]);
    expect(turn.content.map((p) => p.type)).toEqual(["image", "image", "text"]);
    expect(textOf(turn.content)).toBe("What's off here?");
  });

  it("asks for an assessment when photos arrive without a question", () => {
    const [one] = toChatTurns([{ role: "user", text: "  ", images: [img()] }]);
    expect(textOf(one.content)).toBe("(A photo, no question. Assess what you see.)");
    const [three] = toChatTurns([{ role: "user", text: "", images: [img(), img(), img()] }]);
    expect(textOf(three.content)).toBe("(3 photos, no question. Assess what you see.)");
  });

  it("replays the visit in order, skipping empty turns and merging neighbours", () => {
    const turns = toChatTurns([
      { role: "assistant", text: "orphan" },
      { role: "user", text: "First" },
      { role: "assistant", text: "" },
      { role: "user", text: "Second" },
      { role: "assistant", text: "Answer" },
      { role: "user", text: "Third" },
    ]);
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
    expect(textOf(turns[0].content)).toBe("First\nSecond");
  });

  it("keeps only the most recent turns", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `t${i}` }) as const);
    const turns = toChatTurns(many, 10);
    expect(textOf(turns[0].content)).toBe("t40");
  });
});
