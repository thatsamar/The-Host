import { beforeEach, describe, expect, it } from "vitest";
import { assemblePrompt, BLOCK_ORDER } from "@/lib/ask/prompt";
import { COMPANIONS } from "@/lib/companions";
import { shortTextVoice, textChannelNotes } from "../src/lib/sms/handoff";
import { processSms, type SmsInbound } from "../src/lib/sms/handler";
import { INTRODUCTIONS } from "../src/lib/sms/router";
import { SMS_MAX_SEGMENTS, SMS_TEXT_CHARS, smsEncoding, smsSegments } from "../src/lib/sms/segments";
import { answerBudget, shortAnswerText } from "../src/lib/sms/short";
import { MemorySmsStore, type SmsTurn } from "../src/lib/sms/store";

// A long, web-style answer: several sentences, a link, more than any one text holds.
const LONG =
  "Stay in Shibuya for the first two nights; it is the easiest base for a first visit. " +
  "Book the Trunk Hotel if you can, and ask for a room facing the park. " +
  "For dinner on the first night, go to Den in Jingumae: https://www.jimbochoden.com/en/ " +
  "Then spend a day in Yanaka for the old streets, and finish at a standing bar in Ebisu.";

describe("the cap", () => {
  it("is one segment, as a named constant: 160 plain characters", () => {
    expect(SMS_MAX_SEGMENTS).toBe(1);
    expect(SMS_TEXT_CHARS).toBe(160);
  });

  it("leaves the advisor 160 characters minus the label, and minus the introduction on a first or handoff answer", () => {
    expect(answerBudget("Martine: ", null)).toBe(160 - 9);
    expect(answerBudget("Martine: ", INTRODUCTIONS.martini)).toBe(160 - 9 - 27 - 1);
  });

  it("condenses a long answer to the whole sentences that fit, never cutting a word or an address", () => {
    const { text, sent } = shortAnswerText({ label: "Amar: ", intro: null, answer: LONG, offer: null });
    expect(smsSegments(text)).toBe(1);
    expect(text.length).toBeLessThanOrEqual(160);
    expect(text).toBe(`Amar: ${sent}`);
    // Two whole sentences fit (157 characters with the label); the third would not.
    expect(sent).toBe(
      "Stay in Shibuya for the first two nights; it is the easiest base for a first visit. Book the Trunk Hotel if you can, and ask for a room facing the park.",
    );
    expect(LONG.startsWith(sent)).toBe(true);
  });

  it("keeps an address whole or leaves it out, when even one sentence is too long", () => {
    const answer = `Go to Den, ${"a really very ".repeat(6)}good place, here: https://www.jimbochoden.com/en/reservations/tokyo/jingumae and book early.`;
    const { text, sent } = shortAnswerText({ label: "Amar: ", intro: null, answer, offer: null });
    expect(smsSegments(text)).toBe(1);
    expect(sent.endsWith("...")).toBe(true);
    // Cut between words, just before the address (which wouldn't fit whole); the colon gives way to "...".
    expect(sent).toBe(`Go to Den, ${"a really very ".repeat(6)}good place, here...`);
    expect(sent).not.toContain("https");
  });

  it("keeps a Unicode text (an emoji) within its one 70-character segment", () => {
    const { text } = shortAnswerText({ label: "Gio: ", intro: null, answer: "Paint it white 🌿. It opens the room. It warms the light. It ties the floor to the walls.", offer: null });
    expect(smsEncoding(text)).toBe("UCS-2");
    expect(smsSegments(text)).toBe(1);
  });

  it("fits label, introduction, a short answer and the YES line in one text", () => {
    const { text } = shortAnswerText({
      label: "Goldie: ",
      intro: INTRODUCTIONS.goldie,
      answer: "Say the boundary once. Martine can dress you for it.",
      offer: "Reply YES to bring in Martine, or carry on with me.",
    });
    expect(text).toBe(
      "Goldie: I'm Goldie, Cinq's sounding board.\nSay the boundary once. Martine can dress you for it.\nReply YES to bring in Martine, or carry on with me.",
    );
    expect(text.length).toBeLessThanOrEqual(160);
    expect(smsSegments(text)).toBe(1);
  });

  it("shortens the answer, never drops the YES line, when label, introduction and offer leave little room", () => {
    const { text, sent } = shortAnswerText({
      label: "Goldie: ",
      intro: INTRODUCTIONS.goldie,
      answer: "Say the boundary out loud once. Martine can help with what to wear to it.",
      offer: "Reply YES to bring in Martine, or carry on with me.",
    });
    expect(sent).toBe("Say the boundary out loud once.");
    expect(text.endsWith("\nReply YES to bring in Martine, or carry on with me.")).toBe(true);
    expect(smsSegments(text)).toBe(1);
  });
});

describe("one-segment answers in the conversation", () => {
  const FROM = "+15551234567";
  let sid = 0;
  const inbound = (body: string): SmsInbound => ({ from: FROM, body, media: [], messageSid: `SMone${++sid}` });
  let store: MemorySmsStore;
  let calls: { advisorId: string; turns: SmsTurn[]; context?: { budget?: number } }[];
  let answers: string[];
  const deps = () => ({
    store,
    route: async () => "tony",
    ask: async (advisorId: string, turns: SmsTurn[], context?: { budget?: number }) => {
      calls.push({ advisorId, turns: JSON.parse(JSON.stringify(turns)), context });
      return answers.shift() ?? "Fine.";
    },
  });
  const send = (body: string) => processSms(inbound(body), deps());

  beforeEach(async () => {
    store = new MemorySmsStore();
    calls = [];
    answers = [];
    await send("START");
  });

  it("never sends more than one segment, first answer (label + intro) or later, and tells the advisor its budget", async () => {
    answers = [LONG, LONG, "Short and sweet."];
    for (const q of ["Tokyo for a week?", "Where to eat?", "And breakfast?"]) {
      const replies = await send(q);
      expect(replies).toHaveLength(1);
      expect(smsSegments(replies[0])).toBe(1);
      expect(replies[0].length).toBeLessThanOrEqual(160);
      expect(replies[0].startsWith("Amar: ")).toBe(true);
    }
    expect(calls[0].context?.budget).toBe(160 - "Amar: ".length - INTRODUCTIONS.tony.length - 1);
    expect(calls[1].context?.budget).toBe(160 - "Amar: ".length);
  });

  it("opens a first answer with label and introduction, then a short answer", async () => {
    answers = ["Shibuya for a first visit; it is easy and lively."];
    expect(await send("Tokyo for a week?")).toEqual(["Amar: I'm Amar, travel at Cinq.\nShibuya for a first visit; it is easy and lively."]);
  });

  it("lets a follow-up carry on: history keeps what was sent, so the next text adds the next piece", async () => {
    answers = [LONG, "Book the Trunk Hotel, room facing the park."];
    await send("Tokyo for a week?");
    const replies = await send("Where should I stay?");
    expect(replies).toEqual(["Amar: Book the Trunk Hotel, room facing the park."]);
    const followUp = calls.at(-1)!.turns;
    expect(followUp.map((t) => t.text)).toEqual([
      "Tokyo for a week?",
      "Stay in Shibuya for the first two nights; it is the easiest base for a first visit.",
      "Where should I stay?",
    ]);
  });
});

describe("the voice of a short text, and the website", () => {
  it("is one SMS-only paragraph: brevity and a well-informed friend's voice together", () => {
    const voice = shortTextVoice(151);
    expect(voice).toMatch(/fit in 151 characters/);
    expect(voice).toMatch(/well-informed friend with good taste texting a friend/);
    expect(voice).toMatch(/opinionated where you have a real view/);
    expect(voice).toMatch(/Ask a question only when the answer honestly depends on something; never a forced question or a tacked-on offer to say more/);
    expect(voice).toMatch(/no disclaimers, no hedging, no filler/);
    const notes = textChannelNotes("tony", undefined, undefined, 151).body;
    expect(notes).toContain(voice);
    // Only when Cinq says how much room there is.
    expect(textChannelNotes("tony").body).not.toMatch(/one short text/);
  });

  it("leaves the website's prompt exactly as it was: no channel block, no short-text voice", () => {
    for (const id of ["tony", "martini", "gio", "alden", "goldie"] as const) {
      const web = assemblePrompt({ companion: COMPANIONS[id], turns: [{ role: "user", text: "Hi" }] });
      expect(web.system.map((b) => b.label)).toEqual([...BLOCK_ORDER]);
      expect(web.system.map((b) => b.body).join("\n")).not.toMatch(/one short text|160 characters|well-informed friend/);
    }
  });
});
