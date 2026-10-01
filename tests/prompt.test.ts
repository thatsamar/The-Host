import { describe, expect, it } from "vitest";
import type { ChatContentPart } from "@/lib/ai/types";
import { BLOCK_ORDER, MAX_PATTERNS, assemblePrompt, capabilitiesBlock, toChatTurns } from "@/lib/ask/prompt";
import { COMPANIONS } from "@/lib/companions";
import { gio } from "@/lib/companions/gio";
import { jack } from "@/lib/companions/jack";
import { martini } from "@/lib/companions/martini";
import { tony } from "@/lib/companions/tony";

const textOf = (parts: ChatContentPart[]) =>
  parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
const img = (data = "aW1n") => ({ mediaType: "image/jpeg", data });

describe("assemblePrompt", () => {
  it.each(Object.values(COMPANIONS))("puts $name's prompt first, verbatim, then its capabilities", (companion) => {
    const req = assemblePrompt({ companion, turns: [{ role: "user", text: "Hi" }] });
    expect(req.system.map((b) => b.label)).toEqual(BLOCK_ORDER.slice(0, 2));
    expect(req.system[0].body).toBe(companion.systemPrompt);
    expect(req.system[1].body).toBe(companion.capabilities(true).join("\n"));
    expect(req.system.every((b) => b.cacheable)).toBe(true);
    expect(req.webSearch).toBe(true);
  });

  it("adds the mode, then remembered patterns, after the stable blocks and uncached", () => {
    const req = assemblePrompt({
      companion: jack,
      turns: [{ role: "user", text: "I want to text my ex." }],
      mode: jack.modes![3],
      memory: ["You keep choosing unavailable people and calling it chemistry.", "  "],
    });
    expect(req.system.map((b) => b.label)).toEqual([...BLOCK_ORDER]);
    expect(req.system[2]).toMatchObject({ title: "MODE", body: expect.stringMatching(/^Love, Lust & Wreckage: Focus on attachment/) });
    expect(req.system[3].title).toBe("REMEMBERED PATTERNS");
    expect(req.system[3].body).toMatch(/\n- You keep choosing unavailable people and calling it chemistry\.$/);
    expect(req.system.slice(2).some((b) => b.cacheable)).toBe(false);
  });

  it("leaves out a mode the companion doesn't have, memory it doesn't keep, and empty memory", () => {
    const labels = (input: Partial<Parameters<typeof assemblePrompt>[0]>) =>
      assemblePrompt({ companion: jack, turns: [{ role: "user", text: "Hi" }], ...input }).system.map((b) => b.label);
    expect(labels({ companion: gio, mode: jack.modes![0], memory: ["A pattern."] })).toEqual(BLOCK_ORDER.slice(0, 2));
    expect(labels({ mode: { id: "x", label: "X", instruction: "Lie." } })).toEqual(BLOCK_ORDER.slice(0, 2));
    expect(labels({ memory: ["", " "] })).toEqual(BLOCK_ORDER.slice(0, 2));
    const many = assemblePrompt({ companion: jack, turns: [{ role: "user", text: "Hi" }], memory: Array(30).fill("p") });
    expect(many.system[2].body.match(/^- p$/gm)).toHaveLength(MAX_PATTERNS);
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

describe("Jack", () => {
  it("carries the owner's core prompt, renamed, with the response pattern, safety and both examples", () => {
    expect(jack.systemPrompt).toMatch(/^You are Jack: a worldly, irreverent, emotionally intelligent advisor/);
    expect(jack.systemPrompt).not.toMatch(/Most Interesting Man/);
    expect(jack.systemPrompt).toMatch(/You protect the user’s agency\./);
    expect(jack.systemPrompt).toMatch(/1\. A direct opening[\s\S]*2\. A hard truth\.[\s\S]*4\. One concrete next move[\s\S]*5\. A memorable closing line\./);
    expect(jack.systemPrompt).toMatch(/self-harm, suicide, abuse, violence, stalking, a medical emergency, psychosis, credible threats, legal exposure or financial catastrophe/);
    expect(jack.systemPrompt).toMatch(/call or text 988/);
    expect(jack.systemPrompt).toMatch(/never pretend to be one/);
    expect(jack.systemPrompt).toMatch(/You don't want them to need you\./);
    expect(jack.systemPrompt).toMatch(/No emoji unless they use emoji first\./);
    expect(jack.systemPrompt).toContain("Stop negotiating with a life you already know is too small.");
    expect(jack.systemPrompt).toContain("Do not hand matches to the part of you that misses the fire.");
    expect(jack.systemPrompt).toMatch(/You are not that character\. Don't quote the film/);
  });

  it("has the owner's seven modes, with only the ledge marked careful", () => {
    expect(jack.modes!.map((m) => m.label)).toEqual([
      "Hard Truth",
      "Talk Me Off the Ledge",
      "Career Bloodletting",
      "Love, Lust & Wreckage",
      "Family Ghosts",
      "Make the Move",
      "Write It for Me",
    ]);
    expect(jack.modes!.filter((m) => m.plain).map((m) => m.id)).toEqual(["ledge"]);
    expect(jack.modes![1].instruction).toMatch(/No swagger\. No theatrics\.$/);
  });

  it("knows what the app keeps, and how to write the notes the page reads", () => {
    const body = capabilitiesBlock(jack, true).body;
    expect(body).toMatch(/keeps no conversations/);
    expect(body).toMatch(/REMEMBERED PATTERNS/);
    expect(body).toMatch(/<notes>\n\{"thing_under_the_thing": "\.\.\.", "one_sentence": "\.\.\.", "next_move": "\.\.\.", "safety_flag": "none", "suggested_memory_pattern": null, "draft_message": null\}\n<\/notes>/);
    expect(body).toMatch(/never write those in the answer itself/);
    expect(body).toMatch(/softer, sharper, shorter, warmer or more formal/);
    expect(body).not.toMatch(/web_search/);
    expect(jack.webSearchMaxUses).toBe(0);
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
