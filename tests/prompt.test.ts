import { describe, expect, it } from "vitest";
import type { ChatContentPart } from "@/lib/ai/types";
import { APP_OUTPUT_LIMITS, BLOCK_ORDER, assemblePrompt, capabilitiesBlock, toChatTurns } from "@/lib/ask/prompt";
import { COMPANIONS } from "@/lib/companions";
import { alden } from "@/lib/companions/alden";
import { gio } from "@/lib/companions/gio";
import { jack } from "@/lib/companions/jack";
import { martini } from "@/lib/companions/martini";
import { tony } from "@/lib/companions/tony";
import { goldie } from "@/lib/companions/goldie";

const textOf = (parts: ChatContentPart[]) =>
  parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
const img = (data = "aW1n") => ({ mediaType: "image/jpeg", data });

describe("assemblePrompt", () => {
  it.each(Object.values(COMPANIONS))("puts $name's prompt first, verbatim, then its capabilities", (companion) => {
    const req = assemblePrompt({ companion, turns: [{ role: "user", text: "Hi" }] });
    expect(req.system.map((b) => b.label)).toEqual([...BLOCK_ORDER]);
    expect(req.system[0].body).toBe(companion.systemPrompt);
    expect(req.system[1].body).toBe([...companion.capabilities(true), APP_OUTPUT_LIMITS].join("\n"));
    expect(req.system.every((b) => b.cacheable)).toBe(true);
    expect(req.webSearch).toBe(true);
  });
});

describe("what a reply can be", () => {
  it.each(Object.values(COMPANIONS))("tells $name it can't make or send files, with or without web search", (companion) => {
    for (const webSearch of [true, false]) {
      const body = capabilitiesBlock(companion, webSearch).body;
      expect(body.split("\n").at(-1)).toBe(APP_OUTPUT_LIMITS);
    }
  });

  it("forbids claiming a file was made, and says what to do when one is asked for", () => {
    expect(APP_OUTPUT_LIMITS).toMatch(/cannot create, attach, export, upload or send files/);
    expect(APP_OUTPUT_LIMITS).toMatch(/PNG, PDF/);
    expect(APP_OUTPUT_LIMITS).toMatch(/never say or imply that you have/);
    expect(APP_OUTPUT_LIMITS).toMatch(/If someone asks for a file, say plainly that this app can't produce one, then give them the content you can/);
  });

  it("keeps the substance: the full plan in the reply, with layouts labeled as text", () => {
    expect(APP_OUTPUT_LIMITS).toMatch(/Put the substance in the reply itself, in full/);
    expect(APP_OUTPUT_LIMITS).toMatch(/plans, measurements, quantities, schedules, lists and tables/);
    expect(APP_OUTPUT_LIMITS).toMatch(/labeled as a text layout rather than a drawing or map/);
    // Nothing that would cut an answer short.
    expect(APP_OUTPUT_LIMITS).not.toMatch(/\b(brief|short|concise|shorter|limit your)\b/i);
  });

  it("is the same for every companion and names none of them", () => {
    for (const c of Object.values(COMPANIONS)) expect(APP_OUTPUT_LIMITS).not.toContain(c.name);
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
    expect(martini.systemPrompt).toMatch(/^You are Martine, my personal style advisor\./);
    expect(martini.systemPrompt).not.toMatch(/\bMartini\b/);
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
  it("carries the owner's core prompt, renamed, with the response pattern, focus, safety and both examples", () => {
    expect(jack.systemPrompt).toMatch(/^You are Jack: a worldly, irreverent, emotionally intelligent advisor/);
    expect(jack.systemPrompt).not.toMatch(/Most Interesting Man/);
    expect(jack.systemPrompt).toMatch(/1\. A direct opening[\s\S]*5\. A memorable closing line\./);
    expect(jack.systemPrompt).toMatch(/Do not romanticize chaos\. Do not shame longing\./);
    expect(jack.systemPrompt).toMatch(/the difference between love and obedience/);
    expect(jack.systemPrompt).toMatch(/call or text 988/);
    expect(jack.systemPrompt).toMatch(/You don't want them to need you\./);
    expect(jack.systemPrompt).toContain("Stop negotiating with a life you already know is too small.");
    expect(jack.systemPrompt).toContain("Do not hand matches to the part of you that misses the fire.");
  });

  it("knows the app keeps nothing and doesn't assume who is asking", () => {
    const body = capabilitiesBlock(jack, true).body;
    expect(body).toMatch(/keeps nothing/);
    expect(body).toMatch(/Never assume their gender, age/);
    expect(jack.webSearchMaxUses).toBe(0);
  });
});

describe("Alden", () => {
  it("carries the owner's brief as written, as an original advisor", () => {
    expect(alden.systemPrompt).toMatch(/^You are Alden, Cinq’s advisor on wine, cocktails, and spirits\. Your knowledge also runs deep in sake and beer\./);
    expect(alden.systemPrompt).toContain("Your governing question is: What is worth drinking, for this person, at this price, in this moment?");
    for (const heading of ["START WITH THE PERSON AND THE OCCASION", "KNOW FAR MORE THAN YOU SAY", "EXERCISE JUDGMENT", "READ THE EVIDENCE", "VOICE AND RESPONSE"]) {
      expect(alden.systemPrompt).toContain(`\n${heading}\n`);
    }
    expect(alden.systemPrompt).toMatch(/Give one strong recommendation\. Offer at most two meaningfully different alternatives/);
    expect(alden.systemPrompt).toMatch(/The call: What to order or buy\.\nWhy: [\s\S]*\nThe move: [\s\S]*\nAlternative: /);
    expect(alden.systemPrompt).toMatch(/Do not claim to know a bottle’s condition from a photo of a list\./);
    expect(alden.systemPrompt).toMatch(/Never encourage excessive drinking, drinking and driving, or drinking by someone under the legal drinking age\./);
    expect(alden.systemPrompt).toMatch(/Do not give personalized medical assurances about alcohol, medication, pregnancy, or recovery\.$/);
    // No real person's name or endorsement.
    for (const block of assemblePrompt({ companion: alden, turns: [{ role: "user", text: "Hi" }] }).system) {
      expect(block.body).not.toMatch(/Aldo|Sohm/);
    }
  });

  it("reads lists, bottles and bars, keeps nothing, and searches up to five times with sourced prices", () => {
    const body = capabilitiesBlock(alden, true).body;
    expect(body).toMatch(/up to 10 photos/);
    for (const thing of ["wine list", "sake list", "cocktail menu", "beer list", "bottle", "label", "back bar", "store shelf", "meal or table"]) {
      expect(body).toContain(thing);
    }
    expect(body).toMatch(/keeps nothing/);
    expect(body).toMatch(/Don't assume the person's name, budget, company or drinking habits/);
    expect(body).toMatch(/web_search tool, up to five searches per answer/);
    expect(body).toMatch(/Briefly say what you verified/);
    expect(body).toMatch(/Give the source for any sourced price, and mark any price you did not find in a listing as an estimate/);
    expect(body.split("\n").at(-1)).toBe(APP_OUTPUT_LIMITS);
    expect(capabilitiesBlock(alden, false).body).toMatch(/Mark every price as an estimate/);
    expect(alden.webSearchMaxUses).toBe(5);
  });

  it("makes the call from a photo alone", () => {
    const [turn] = toChatTurns([{ role: "user", text: "", images: [img()] }], alden.photosOnly);
    expect(textOf(turn.content)).toMatch(/^\(A photo, no question\. Read what's there, whether a list, a menu, a bottle or a shelf, and make the call/);
  });
});

describe("Tony and Alden", () => {
  it("each knows the other's territory: where to go is Tony's, what to drink is Alden's", () => {
    const toAlden = capabilitiesBlock(alden, true).body;
    const toTony = capabilitiesBlock(tony, true).body;
    expect(toAlden).toMatch(/Your territory is what to drink/);
    expect(toAlden).toMatch(/is Tony's territory in Cinq/);
    expect(toTony).toMatch(/Your territory is where to go/);
    expect(toTony).toMatch(/is Alden's territory in Cinq/);
    expect(toTony).not.toContain("—");
  });
});

describe("Goldie", () => {
  it("is named Goldie at the start of her brief", () => {
    expect(goldie.systemPrompt).toMatch(/^You are Goldie: /);
    expect(goldie.systemPrompt).not.toMatch(/^You are Untangled/);
  });

  it("separates facts from assumptions, control from non-control, labor from fruits", () => {
    expect(goldie.systemPrompt).toMatch(/^You are Untangled: a thinking tool for consequential human situations/);
    expect(goldie.systemPrompt).toMatch(/What's Actually Happening/);
    expect(goldie.systemPrompt).toMatch(/The People Involved/);
    expect(goldie.systemPrompt).toMatch(/The Facts/);
    expect(goldie.systemPrompt).toMatch(/The Assumptions/);
    expect(goldie.systemPrompt).toMatch(/The Noise/);
    expect(goldie.systemPrompt).toMatch(/What You Control/);
    expect(goldie.systemPrompt).toMatch(/What You Don't Control/);
    expect(goldie.systemPrompt).toMatch(/The Ghosts/);
    expect(goldie.systemPrompt).toMatch(/The Real Decision/);
    expect(goldie.systemPrompt).toMatch(/You own the labor\. You do not own the fruits of the labor\./);
  });

  it("does not make the decision for the user", () => {
    const body = capabilitiesBlock(goldie, true).body;
    expect(body).toMatch(/not to tell people what to do/);
    expect(body).toMatch(/restore their ability to decide/);
    expect(body).toMatch(/not therapy, coaching, or an advice column/);
    expect(goldie.webSearchMaxUses).toBe(0);
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
