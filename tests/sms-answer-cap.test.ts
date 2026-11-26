import { beforeEach, describe, expect, it } from "vitest";
import { assemblePrompt, BLOCK_ORDER } from "@/lib/ask/prompt";
import { COMPANIONS } from "@/lib/companions";
import { shortTextVoice, textChannelNotes } from "../src/lib/sms/handoff";
import { processSms, type SmsInbound } from "../src/lib/sms/handler";
import { INTRODUCTIONS } from "../src/lib/sms/router";
import { SMS_MAX_SEGMENTS, SMS_TEXT_CHARS, smsEncoding, smsSegments } from "../src/lib/sms/segments";
import { answerBudget, condensePrompt, roomForAnswer, shortAnswerText } from "../src/lib/sms/short";
import { MemorySmsStore, type SmsTurn } from "../src/lib/sms/store";

// A long, web-style answer: whole sentences, an address, far more than one capped text holds.
const SENTENCES = [
  "Stay in Shibuya for the first two nights; it is the easiest base for a first visit.",
  "Book the Trunk Hotel if you can, and ask for a room facing the park.",
  "For dinner on the first night, go to Den in Jingumae: https://www.jimbochoden.com/en/ and book a month ahead.",
  "Then spend a day in Yanaka for the old streets and the cemetery walk, and finish at a standing bar in Ebisu.",
  "On day three take the early train to Kamakura, see the Great Buddha before the crowds, and walk the Daibutsu trail.",
  "Back in town, spend an evening in Golden Gai; pick the bar with six seats and the owner who talks to you.",
  "For the last two nights move to the Aman for the view, the bath and the quiet; it is a different city from up there.",
  "Leave a morning for Tsukiji's outer market and eat standing, then a slow lunch at a kaiseki counter before the flight.",
];
const LONG = SENTENCES.join(" ");

/** The whole sentences of LONG that fit after a label, in order: what the last-resort trim keeps. */
function sentencesThatFit(label: string): string {
  let kept = "";
  for (const s of SENTENCES) {
    const next = kept ? `${kept} ${s}` : s;
    if (smsSegments(label + next) > SMS_MAX_SEGMENTS) break;
    kept = next;
  }
  return kept;
}

describe("the cap", () => {
  it("is three segments, as a named constant: 456 plain characters on toll-free", () => {
    expect(SMS_MAX_SEGMENTS).toBe(3);
    expect(SMS_TEXT_CHARS).toBe(456);
    expect(smsSegments("a".repeat(SMS_TEXT_CHARS))).toBe(3);
    expect(smsSegments("a".repeat(SMS_TEXT_CHARS + 1))).toBe(4);
  });

  it("leaves the advisor the cap minus the label, and minus the introduction on a first or handoff answer", () => {
    expect(answerBudget("Martine: ", null)).toBe(SMS_TEXT_CHARS - 9);
    expect(answerBudget("Martine: ", INTRODUCTIONS.martini)).toBe(SMS_TEXT_CHARS - 9 - 27 - 1);
  });

  it("condenses a long answer to the whole sentences that fit, never cutting a word or an address", () => {
    expect(LONG.length).toBeGreaterThan(SMS_TEXT_CHARS * 1.5);
    const { text, sent } = shortAnswerText({ label: "Amar: ", intro: null, answer: LONG, offer: null });
    expect(smsSegments(text)).toBeLessThanOrEqual(SMS_MAX_SEGMENTS);
    expect(text.length).toBeLessThanOrEqual(SMS_TEXT_CHARS);
    expect(text).toBe(`Amar: ${sent}`);
    expect(sent).toBe(sentencesThatFit("Amar: "));
    // More than one beat: several whole sentences, ending on a full stop, the address intact.
    expect(sent.split(/(?<=\.) /).length).toBeGreaterThanOrEqual(3);
    expect(sent).toContain("https://www.jimbochoden.com/en/");
    expect(sent.endsWith(".")).toBe(true);
  });

  it("keeps an address whole or leaves it out, when even one sentence is too long", () => {
    const answer = `Go to Den, ${"a really very ".repeat(30)}good place, here: https://www.jimbochoden.com/en/reservations/tokyo/jingumae and book early.`;
    const { text, sent } = shortAnswerText({ label: "Amar: ", intro: null, answer, offer: null });
    expect(smsSegments(text)).toBeLessThanOrEqual(SMS_MAX_SEGMENTS);
    expect(sent.endsWith("...")).toBe(true);
    const kept = sent.slice(0, -3);
    expect(answer.startsWith(kept)).toBe(true);
    if (kept.includes("https")) expect(kept).toContain("https://www.jimbochoden.com/en/reservations/tokyo/jingumae");
  });

  it("keeps a Unicode text (an emoji) within three 66-character segments", () => {
    const answer = Array.from({ length: 8 }, (_, i) => `Point ${i}: paint the hall white 🌿, it opens the room.`).join(" ");
    const { text } = shortAnswerText({ label: "Gio: ", intro: null, answer, offer: null });
    expect(smsEncoding(text)).toBe("UCS-2");
    expect(smsSegments(text)).toBeLessThanOrEqual(SMS_MAX_SEGMENTS);
    expect(text.length).toBeLessThanOrEqual(SMS_MAX_SEGMENTS * 66);
  });

  it("fits label, introduction, an answer with some meat and the YES line in one capped text", () => {
    const answer =
      "Say the boundary out loud once, calmly, and don't relitigate it. Most of the tension is the waiting, not the conversation. " +
      "Martine can help you look the part when you do it.";
    const { text } = shortAnswerText({ label: "Goldie: ", intro: INTRODUCTIONS.goldie, answer, offer: "Want me to bring in Martine?" });
    expect(text).toBe(`Goldie: ${INTRODUCTIONS.goldie}\n${answer}\nWant me to bring in Martine?`);
    expect(smsSegments(text)).toBeLessThanOrEqual(SMS_MAX_SEGMENTS);
  });

  it("shortens the answer, never drops the YES line, when label, introduction and offer leave too little room", () => {
    const { text, sent } = shortAnswerText({
      label: "Goldie: ",
      intro: INTRODUCTIONS.goldie,
      answer: LONG,
      offer: "Want me to bring in Martine?",
    });
    expect(LONG.startsWith(sent)).toBe(true);
    expect(sent.endsWith(".")).toBe(true);
    expect(text.endsWith("\nWant me to bring in Martine?")).toBe(true);
    expect(smsSegments(text)).toBeLessThanOrEqual(SMS_MAX_SEGMENTS);
  });
});

describe("capped answers in the conversation", () => {
  const FROM = "+15551234567";
  let sid = 0;
  const inbound = (body: string): SmsInbound => ({ from: FROM, body, media: [], messageSid: `SMcap${++sid}` });
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

  it("never sends more than the cap, first answer (label + intro) or later, and tells the advisor its budget", async () => {
    answers = [LONG, LONG, "Short and sweet."];
    for (const q of ["Tokyo for a week?", "Where to eat?", "And breakfast?"]) {
      const replies = await send(q);
      expect(replies).toHaveLength(1);
      expect(smsSegments(replies[0])).toBeLessThanOrEqual(SMS_MAX_SEGMENTS);
      expect(replies[0].length).toBeLessThanOrEqual(SMS_TEXT_CHARS);
      expect(replies[0].startsWith("Amar: ")).toBe(true);
    }
    expect(calls[0].context?.budget).toBe(SMS_TEXT_CHARS - "Amar: ".length - INTRODUCTIONS.tony.length - 1);
    expect(calls[1].context?.budget).toBe(SMS_TEXT_CHARS - "Amar: ".length);
  });

  it("opens a first answer with label and introduction, then the answer", async () => {
    answers = ["Shibuya for a first visit; it is easy and lively, and everything is a short walk or one train away."];
    expect(await send("Tokyo for a week?")).toEqual([
      "Amar: I'm Amar, travel at Cinq.\nShibuya for a first visit; it is easy and lively, and everything is a short walk or one train away.",
    ]);
  });

  it("lets a follow-up carry on: history keeps what was sent, so the next text adds the next piece", async () => {
    answers = [LONG, "Book the Trunk Hotel, room facing the park."];
    await send("Tokyo for a week?");
    const replies = await send("Where should I stay?");
    expect(replies).toEqual(["Amar: Book the Trunk Hotel, room facing the park."]);
    const followUp = calls.at(-1)!.turns;
    const firstSent = sentencesThatFit(`Amar: ${INTRODUCTIONS.tony}\n`);
    expect(followUp.map((t) => t.text)).toEqual(["Tokyo for a week?", firstSent, "Where should I stay?"]);
  });
});

describe("the voice of a short text, and the website", () => {
  it("is one SMS-only paragraph: brevity and a well-informed friend's voice together", () => {
    const budget = answerBudget("Amar: ", null);
    const voice = shortTextVoice(budget);
    expect(voice).toMatch(new RegExp(`fit in ${budget} characters, about ${Math.floor(budget / 6)} words`));
    expect(voice).toMatch(/well-informed friend with good taste texting a friend/);
    expect(voice).toMatch(/opinionated where you have a real view/);
    expect(voice).toMatch(/Ask a question only when the answer honestly depends on something; never a forced question or a tacked-on offer to say more/);
    expect(voice).toMatch(/no disclaimers, no hedging, no filler/);
    const notes = textChannelNotes("tony", undefined, undefined, budget).body;
    expect(notes).toContain(voice);
    // Only when Cinq says how much room there is.
    expect(textChannelNotes("tony").body).not.toMatch(/one short text/);
  });

  it("leaves the website's prompt exactly as it was: no channel block, no short-text voice", () => {
    for (const id of ["tony", "martini", "gio", "alden", "goldie"] as const) {
      const web = assemblePrompt({ companion: COMPANIONS[id], turns: [{ role: "user", text: "Hi" }] });
      expect(web.system.map((b) => b.label)).toEqual([...BLOCK_ORDER]);
      expect(web.system.map((b) => b.body).join("\n")).not.toMatch(/one short text|well-informed friend/);
    }
  });
});

describe("answers designed for the cap, not cut down", () => {
  const FROM = "+15551234567";
  let sid = 0;
  const inbound = (body: string): SmsInbound => ({ from: FROM, body, media: [], messageSid: `SMfit${++sid}` });
  let store: MemorySmsStore;
  let condensed: { advisorId: string; answer: string; room: number }[];
  let rewrite: (answer: string, room: number) => Promise<string>;
  let answers: string[];
  const REWRITTEN =
    "Base yourself in Shibuya for two nights at the Trunk Hotel, park-side room. Eat at Den in Jingumae the first night; book a month ahead. " +
    "Give a day to Yanaka's old streets, then finish at a standing bar in Ebisu. End the trip at the Aman for the view and the quiet.";
  const deps = () => ({
    store,
    route: async () => "tony",
    ask: async () => answers.shift() ?? "Fine.",
    condense: async (advisorId: string, answer: string, room: number) => {
      condensed.push({ advisorId, answer, room });
      return rewrite(answer, room);
    },
  });
  const send = (body: string) => processSms(inbound(body), deps());

  beforeEach(async () => {
    store = new MemorySmsStore();
    condensed = [];
    answers = [];
    rewrite = async () => REWRITTEN;
    await send("START");
    await send("1");
  });

  it("asks the advisor to design for the length: one complete thought, nothing it can't finish", () => {
    const voice = shortTextVoice(450);
    expect(voice).toMatch(/about 75 words/);
    expect(voice).toMatch(/Design the text for that length; don't shorten a longer answer/);
    expect(voice).toMatch(/one complete thought that stands on its own and ends cleanly/);
    expect(voice).toMatch(/Never start a list, a sequence or a "first" you can't finish/);
  });

  it("rewrites an answer that came back too long into one complete text, instead of cutting it", async () => {
    answers = [LONG];
    const replies = await send("Tokyo for a week?");
    expect(condensed).toEqual([{ advisorId: "tony", answer: LONG, room: SMS_TEXT_CHARS - "Amar: ".length }]);
    expect(replies).toEqual([`Amar: ${REWRITTEN}`]);
    expect(replies[0]).not.toContain("...");
    expect(smsSegments(replies[0])).toBeLessThanOrEqual(SMS_MAX_SEGMENTS);
    // History keeps the text as sent.
    expect((await store.getSession(FROM))!.turnsByAdvisor.tony!.at(-1)!.text).toBe(REWRITTEN);
  });

  it("leaves an answer that already fits alone", async () => {
    answers = [REWRITTEN];
    expect(await send("Tokyo?")).toEqual([`Amar: ${REWRITTEN}`]);
    expect(condensed).toEqual([]);
  });

  it("leaves room for the YES line when the answer offers a handoff", () => {
    expect(roomForAnswer(400, "Want me to bring in Martine?")).toBe(400 - 29);
    expect(roomForAnswer(400, null)).toBe(400);
  });

  it("falls back to the whole sentences that fit if the rewrite fails or is still too long", async () => {
    answers = [LONG, LONG];
    rewrite = async () => Promise.reject(new Error("down"));
    const failed = await send("Tokyo for a week?");
    rewrite = async () => LONG;
    const tooLong = await send("And again?");
    for (const replies of [failed, tooLong]) {
      expect(replies).toEqual([`Amar: ${sentencesThatFit("Amar: ")}`]);
    }
  });

  it("gives the rewrite the advisor's voice to keep, one complete thought, and no trailing off", () => {
    const prompt = condensePrompt("Amar", 450);
    expect(prompt).toMatch(/text message from Amar/);
    expect(prompt).toMatch(/at most 450 characters/);
    expect(prompt).toMatch(/same voice, the same view and the single most useful point/);
    expect(prompt).toMatch(/one complete thought that ends cleanly: not a shortened version that trails off/);
    expect(prompt).toMatch(/keep that offer/);
  });
});
