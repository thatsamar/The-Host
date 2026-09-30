import { describe, expect, it } from "vitest";
import type { ChatContentPart } from "@/lib/ai/types";
import { BLOCK_ORDER, assemblePrompt, capabilitiesBlock, toChatTurns } from "@/lib/ask/prompt";
import { COMPANIONS } from "@/lib/companions";
import { gio } from "@/lib/companions/gio";
import { martini } from "@/lib/companions/martini";
import { tony } from "@/lib/companions/tony";

const textOf = (parts: ChatContentPart[]) =>
  parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
const img = (data = "aW1n") => ({ mediaType: "image/jpeg", data });

describe("assemblePrompt", () => {
  it.each(Object.values(COMPANIONS))("puts $name's prompt first, verbatim, then its capabilities", (companion) => {
    const req = assemblePrompt({ companion, turns: [{ role: "user", text: "Hi" }] });
    expect(req.system.map((b) => b.label)).toEqual([...BLOCK_ORDER]);
    expect(req.system[0].body).toBe(companion.systemPrompt);
    expect(req.system[1].body).toBe(companion.capabilities(true).join("\n"));
    expect(req.system.every((b) => b.cacheable)).toBe(true);
    expect(req.webSearch).toBe(true);
  });
});

describe("Gio", () => {
  it("isn't addressed to any one household", () => {
    const req = assemblePrompt({ companion: gio, turns: [{ role: "user", text: "Hi" }] });
    for (const block of req.system) expect(block.body).not.toMatch(/Courtney|Amar\b|speaker|memories are provided|uploaded library/i);
    expect(gio.systemPrompt).toMatch(/Always imagine the room at midnight/);
    expect(gio.systemPrompt).toMatch(/Could this be in almost anyone's expensive house\?/);
  });

  it("knows the app keeps nothing, doesn't assume who is asking, and prices from real listings", () => {
    const body = capabilitiesBlock(gio, true).body;
    expect(body).toMatch(/keeps nothing/);
    expect(body).toMatch(/Don't assume their name, their taste or a home you haven't seen/);
    expect(body).toMatch(/up to 10 photos/);
    expect(body).toMatch(/web_search/);
    expect(body).toMatch(/Invest \/ save \/ skip/);
    expect(body).toMatch(/"Don't buy anything"/);
    expect(capabilitiesBlock(gio, false).body).toMatch(/Mark every price as an estimate/);
  });
});

describe("Tony", () => {
  it("carries the travel point of view, with the owner's wording kept", () => {
    expect(tony.systemPrompt).toMatch(/^You are Amar Lalvani’s private travel intelligence/);
    expect(tony.systemPrompt).toMatch(/Travel is attention\./);
    expect(tony.systemPrompt).toMatch(/Never invent access, relationships, secret doors, bookings, or insider knowledge\./);
    expect(tony.systemPrompt).toMatch(/No em dashes\.\n\nBe irreverent, even profane\./);
    expect(tony.systemPrompt).not.toMatch(/em--|Boardain|a rooms/);
    expect(tony.systemPrompt).not.toContain("—");
  });

  it("checks places before sending anyone, and doesn't treat the traveler as Amar", () => {
    const body = capabilitiesBlock(tony, true).body;
    expect(body).toMatch(/keeps nothing/);
    expect(body).toMatch(/don't call them Amar/);
    expect(body).toMatch(/web_search tool\. Use it to check that a place still exists/);
    expect(body).toMatch(/Never use em dashes/);
    expect(body).not.toContain("—");
    expect(capabilitiesBlock(tony, false).body).toMatch(/from memory and worth checking/);
  });

  it("reads a place from photos alone", () => {
    const [turn] = toChatTurns([{ role: "user", text: "", images: [img(), img()] }], tony.photosOnly);
    expect(textOf(turn.content)).toMatch(/^\(2 photos, no question\. Read the place/);
  });
});

describe("Martini", () => {
  it("carries the style brief as written", () => {
    expect(martini.systemPrompt).toMatch(/^You are Martini, my personal style advisor\./);
    expect(martini.systemPrompt).toMatch(/Do not treat men’s style as an afterthought or women’s style as the default\./);
    for (const label of ["THE CALL", "WHY", "THE MOVE", "WHAT NOT TO DO", "COST", "NEXT STEP"]) {
      expect(martini.systemPrompt).toContain(`${label} — `);
    }
    expect(martini.systemPrompt).toMatch(/INVEST:\n[\s\S]*SAVE:\n[\s\S]*SKIP:\n/);
    expect(martini.systemPrompt).toMatch(/Could this be on anyone with money\?\n\nIf yes, look harder\./);
    expect(martini.systemPrompt).toMatch(/never generic\.$/);
  });

  it("serves anyone, keeps headings for real decisions, and prices from listings", () => {
    const body = capabilitiesBlock(martini, true).body;
    expect(body).toMatch(/Never assume their gender, body, age, size, budget or taste/);
    expect(body).toMatch(/give men's, women's and mixed wardrobes equal depth/);
    expect(body).toMatch(/keeps nothing/);
    expect(body).toMatch(/For a simple question, just answer it, without headings/);
    expect(body).toMatch(/including vintage and resale/);
    expect(capabilitiesBlock(martini, false).body).toMatch(/Mark every price as an estimate/);
  });

  it("gives an outfit check from photos alone", () => {
    const [turn] = toChatTurns([{ role: "user", text: "", images: [img()] }], martini.photosOnly);
    expect(textOf(turn.content)).toBe("(A photo, no question. Give the outfit check: the call, the highest-leverage move, and what not to do.)");
  });
});

describe("toChatTurns", () => {
  it("sends photos before the question", () => {
    const [turn] = toChatTurns([{ role: "user", text: "What's off here?", images: [img("a"), img("b")] }], gio.photosOnly);
    expect(turn.content.map((p) => p.type)).toEqual(["image", "image", "text"]);
    expect(textOf(turn.content)).toBe("What's off here?");
  });

  it("asks for an assessment when photos arrive without a question", () => {
    const [one] = toChatTurns([{ role: "user", text: "  ", images: [img()] }], gio.photosOnly);
    expect(textOf(one.content)).toBe("(A photo, no question. Assess what you see.)");
    const [three] = toChatTurns([{ role: "user", text: "", images: [img(), img(), img()] }], gio.photosOnly);
    expect(textOf(three.content)).toBe("(3 photos, no question. Assess what you see.)");
  });

  it("replays the visit in order, skipping empty turns and merging neighbours", () => {
    const turns = toChatTurns(
      [
        { role: "assistant", text: "orphan" },
        { role: "user", text: "First" },
        { role: "assistant", text: "" },
        { role: "user", text: "Second" },
        { role: "assistant", text: "Answer" },
        { role: "user", text: "Third" },
      ],
      gio.photosOnly,
    );
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
    expect(textOf(turns[0].content)).toBe("First\nSecond");
  });

  it("keeps only the most recent turns", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `t${i}` }) as const);
    const turns = toChatTurns(many, gio.photosOnly, 10);
    expect(textOf(turns[0].content)).toBe("t40");
  });
});
