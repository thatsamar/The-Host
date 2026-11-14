import { beforeEach, describe, expect, it } from "vitest";
import {
  ACK_TEXTS,
  nextAck,
  FALLBACK_TEXT,
  NO_QUESTION_TEXT,
  HELP_TEXT,
  OPT_OUT_TEXT,
  WELCOME_TEXT,
  processSms,
  splitReply,
  toSmsText,
  ADVISOR_LIST_TEXT,
  answerTexts,
  type SmsInbound,
} from "../src/lib/sms/handler";
import { MemorySmsStore } from "../src/lib/sms/store";
import { MAX_SEGMENTS, SMS_MAX_SEGMENTS, plainPunctuation, smsEncoding, smsSegments } from "../src/lib/sms/segments";

const ACK_TEXT = ACK_TEXTS[0];
import type { SmsTurn } from "../src/lib/sms/store";

const FROM = "+15551234567";
let sidCounter = 0;

function inbound(body: string, extra: Partial<SmsInbound> = {}): SmsInbound {
  sidCounter += 1;
  return { from: FROM, body, media: [], messageSid: `SMtest${sidCounter}`, ...extra };
}

interface AskCall {
  advisorId: string;
  turns: SmsTurn[];
}

function makeAsk() {
  const calls: AskCall[] = [];
  let nextAnswer = "Canned answer.";
  let failNext = false;
  return {
    calls,
    setAnswer(text: string) {
      nextAnswer = text;
    },
    failOnce() {
      failNext = true;
    },
    async ask(advisorId: string, turns: SmsTurn[]): Promise<string> {
      calls.push({ advisorId, turns: JSON.parse(JSON.stringify(turns)) });
      if (failNext) {
        failNext = false;
        throw new Error("provider down");
      }
      return nextAnswer;
    },
  };
}

describe("START, STOP, HELP", () => {
  it("welcomes a new number with all five advisors and how to choose", async () => {
    const store = new MemorySmsStore();
    const ask = makeAsk();
    const replies = await processSms(inbound("START"), { store, ask: ask.ask });
    expect(replies).toEqual([WELCOME_TEXT]);
    // The welcome names the five roles; the advisors' names are in the SWITCH list.
    expect(WELCOME_TEXT).toContain("5 advisors:\ntravel\nstyle\ndesign\ndrinks\nsounding board\n");
    expect(WELCOME_TEXT).toContain("SWITCH for their names.");
    expect(WELCOME_TEXT).toContain("Message frequency varies with usage.");
    expect(WELCOME_TEXT).toContain("Message & data rates may apply.");
    const session = await store.getSession(FROM);
    expect(session?.optedIn).toBe(true);
    expect(session?.advisorId).toBeNull();
    expect(ask.calls).toHaveLength(0);
  });

  it("sends the welcome, with its opt-out and rates terms, first to every new number", async () => {
    for (const first of ["3", "Gio", "START", "hi", "What sofa fits a small room?"]) {
      const store = new MemorySmsStore();
      const ask = makeAsk();
      const replies = await processSms(inbound(first), { store, ask: ask.ask });
      expect(replies[0]).toBe(WELCOME_TEXT);
      expect(WELCOME_TEXT).toContain("STOP to opt out\nHELP for help.");
      // Only a question is answered, after the welcome.
      expect(ask.calls).toHaveLength(first.endsWith("?") ? 1 : 0);
      expect((await store.getSession(FROM))?.optedIn).toBe(true);
    }
    const store = new MemorySmsStore();
    expect(await processSms(inbound("3"), { store, ask: makeAsk().ask })).toEqual([
      WELCOME_TEXT,
      "You're with Gio (design). Send your question as a text or a photo.",
    ]);
    expect((await store.getSession(FROM))?.advisorId).toBe("gio");
  });

  it("opts out on STOP, stays silent after, answers HELP, and re-welcomes on START", async () => {
    const store = new MemorySmsStore();
    const ask = makeAsk();
    await processSms(inbound("START"), { store, ask: ask.ask });
    expect(await processSms(inbound("STOP"), { store, ask: ask.ask })).toEqual([OPT_OUT_TEXT]);
    expect(OPT_OUT_TEXT).toContain("Cinq");
    expect(OPT_OUT_TEXT).toContain("No further messages will be sent");
    expect(await processSms(inbound("Are you there?"), { store, ask: ask.ask })).toEqual([]);
    expect(await processSms(inbound("HELP"), { store, ask: ask.ask })).toEqual([HELP_TEXT]);
    expect(await processSms(inbound("START"), { store, ask: ask.ask })).toEqual([WELCOME_TEXT]);
    expect(ask.calls).toHaveLength(0);
  });

  it("answers HELP with commands and contact", async () => {
    const store = new MemorySmsStore();
    const ask = makeAsk();
    const replies = await processSms(inbound("HELP"), { store, ask: ask.ask });
    expect(replies).toEqual([HELP_TEXT]);
    expect(HELP_TEXT).toContain("amar@cinqcollective.com");
  });
});

describe("advisor choice, questions, history, switching", () => {
  let store: MemorySmsStore;
  let ask: ReturnType<typeof makeAsk>;

  beforeEach(async () => {
    store = new MemorySmsStore();
    ask = makeAsk();
    await processSms(inbound("START"), { store, ask: ask.ask });
  });

  it("asks the chosen advisor and keeps follow-up context", async () => {
    expect(await processSms(inbound("3"), { store, ask: ask.ask })).toEqual([
      "You're with Gio (design). Send your question as a text or a photo.",
    ]);
    ask.setAnswer("Gio's answer.");
    expect(await processSms(inbound("What sofa fits a small room?"), { store, ask: ask.ask })).toEqual([
      "Gio: Gio's answer.",
    ]);
    expect(ask.calls).toHaveLength(1);
    expect(ask.calls[0].advisorId).toBe("gio");
    expect(ask.calls[0].turns).toEqual([
      { role: "user", text: "What sofa fits a small room?", images: undefined },
    ]);

    ask.setAnswer("A loveseat, in a light fabric.");
    await processSms(inbound("What about the fabric?"), { store, ask: ask.ask });
    expect(ask.calls).toHaveLength(2);
    expect(ask.calls[1].turns).toEqual([
      { role: "user", text: "What sofa fits a small room?", images: undefined },
      { role: "assistant", text: "Gio's answer." },
      { role: "user", text: "What about the fabric?", images: undefined },
    ]);
  });

  it("switches advisors without mixing histories or replies", async () => {
    await processSms(inbound("3"), { store, ask: ask.ask });
    ask.setAnswer("Gio's answer.");
    await processSms(inbound("Sofa question"), { store, ask: ask.ask });
    await processSms(inbound("1"), { store, ask: ask.ask });
    ask.setAnswer("Amar's answer.");
    await processSms(inbound("Trip question"), { store, ask: ask.ask });
    expect(ask.calls.map((c) => c.advisorId)).toEqual(["gio", "tony"]);
    expect(ask.calls[1].turns).toEqual([{ role: "user", text: "Trip question", images: undefined }]);

    // Switching back resumes Gio's own history, not Amar's.
    await processSms(inbound("gio"), { store, ask: ask.ask });
    ask.setAnswer("Gio follow-up.");
    await processSms(inbound("And the fabric?"), { store, ask: ask.ask });
    const gioCalls = ask.calls.filter((c) => c.advisorId === "gio");
    expect(gioCalls).toHaveLength(2);
    expect(gioCalls[1].turns).toEqual([
      { role: "user", text: "Sofa question", images: undefined },
      { role: "assistant", text: "Gio's answer." },
      { role: "user", text: "And the fabric?", images: undefined },
    ]);
  });

  it("never asks for an advisor first: an unpicked question is routed and answered", async () => {
    const replies = await processSms(inbound("Where should I go?"), { store, ask: ask.ask });
    expect(replies.join(" ")).not.toContain("Pick an advisor");
    // With no router to ask, it goes to Goldie.
    expect(ask.calls.map((c) => c.advisorId)).toEqual(["goldie"]);
  });

  it("accepts names and switch phrases, not just numbers", async () => {
    expect(await processSms(inbound("Martine"), { store, ask: ask.ask })).toEqual([
      "You're with Martine (style). Send your question as a text or a photo.",
    ]);
    expect(await processSms(inbound("switch to alden"), { store, ask: ask.ask })).toEqual([
      "You're with Alden (wine, cocktails & spirits). Send your question as a text or a photo.",
    ]);
  });
});

describe("photos", () => {
  it("passes downloaded photos to the advisor, including photo-only turns", async () => {
    const store = new MemorySmsStore();
    const ask = makeAsk();
    await processSms(inbound("START"), { store, ask: ask.ask });
    await processSms(inbound("2"), { store, ask: ask.ask });
    const downloadMedia = async () => ({ data: "aGVsbG8=", mediaType: "image/jpeg" });
    ask.setAnswer("Martine's take on the outfit.");
    const replies = await processSms(
      inbound("", {
        media: [{ url: "https://api.twilio.com/media/1", contentType: "image/jpeg" }],
      }),
      { store, ask: ask.ask, downloadMedia },
    );
    expect(replies).toEqual(["Martine: Martine's take on the outfit."]);
    expect(ask.calls).toHaveLength(1);
    expect(ask.calls[0].advisorId).toBe("martini");
    expect(ask.calls[0].turns[0].images).toEqual([{ data: "aGVsbG8=", mediaType: "image/jpeg" }]);
  });

  it("asks for a question when there is no text and no usable photo", async () => {
    const store = new MemorySmsStore();
    const ask = makeAsk();
    await processSms(inbound("START"), { store, ask: ask.ask });
    await processSms(inbound("2"), { store, ask: ask.ask });
    const downloadMedia = async () => null;
    const replies = await processSms(
      inbound("", {
        media: [{ url: "https://api.twilio.com/media/1", contentType: "image/jpeg" }],
      }),
      { store, ask: ask.ask, downloadMedia },
    );
    expect(replies).toEqual(["Add a photo or a question."]);
    expect(ask.calls).toHaveLength(0);
  });
});

describe("failures and duplicates", () => {
  it("sends the fallback reply on a failed answer and keeps the session usable", async () => {
    const store = new MemorySmsStore();
    const ask = makeAsk();
    await processSms(inbound("START"), { store, ask: ask.ask });
    await processSms(inbound("3"), { store, ask: ask.ask });
    ask.failOnce();
    expect(await processSms(inbound("Sofa question"), { store, ask: ask.ask })).toEqual([FALLBACK_TEXT]);
    ask.setAnswer("Gio recovered.");
    expect(await processSms(inbound("Try again"), { store, ask: ask.ask })).toEqual(["Gio: Gio recovered."]);
    const lastCall = ask.calls[ask.calls.length - 1];
    expect(lastCall.turns).toEqual([{ role: "user", text: "Try again", images: undefined }]);
  });

  it("drops a duplicate MessageSid without a second reply", async () => {
    const store = new MemorySmsStore();
    const ask = makeAsk();
    await processSms(inbound("START"), { store, ask: ask.ask });
    await processSms(inbound("3"), { store, ask: ask.ask });
    ask.setAnswer("Gio's answer.");
    const first = inbound("Sofa question", { messageSid: "SMdup" });
    const second = inbound("Sofa question", { messageSid: "SMdup" });
    expect(await processSms(first, { store, ask: ask.ask })).toEqual(["Gio: Gio's answer."]);
    expect(await processSms(second, { store, ask: ask.ask })).toEqual([]);
    expect(ask.calls).toHaveLength(1);
  });
});

describe("splitReply", () => {
  it("splits long answers into bounded consecutive messages", () => {
    const long = ["a".repeat(1400), "b".repeat(1400), "c".repeat(1400)].join("\n\n");
    const parts = splitReply(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(1500);
    expect(parts[0]).toContain("a");
    expect(parts[parts.length - 1]).toContain("c");
  });

  it("keeps short answers whole", () => {
    expect(splitReply("Short answer.")).toEqual(["Short answer."]);
  });
});

describe("\"Give me a second…\" while an answer is written", () => {
  let store: MemorySmsStore;
  let ask: ReturnType<typeof makeAsk>;
  let acks: string[];
  const acknowledge = (text: string) => {
    acks.push(text);
  };
  const deps = () => ({ store, ask: ask.ask, acknowledge });

  beforeEach(async () => {
    store = new MemorySmsStore();
    ask = makeAsk();
    acks = [];
    await processSms(inbound("START"), deps());
  });

  it("acks a question once, before the answer is ready, and keeps it out of history", async () => {
    await processSms(inbound("3"), deps());
    let ackedBeforeAnswer = false;
    const slowAsk = async (advisorId: string, turns: SmsTurn[]) => {
      await new Promise((r) => setTimeout(r, 5));
      ackedBeforeAnswer = acks.length === 1;
      return ask.ask(advisorId, turns);
    };
    ask.setAnswer("Gio's answer.");
    const replies = await processSms(inbound("What sofa fits a small room?"), { store, ask: slowAsk, acknowledge });
    expect(ackedBeforeAnswer).toBe(true);
    expect(acks).toEqual([ACK_TEXT]);
    expect(ACK_TEXT).toBe("Give me a second…");
    expect(replies).toEqual(["Gio: Gio's answer."]);

    const session = await store.getSession(FROM);
    expect(session?.turnsByAdvisor.gio).toMatchObject([
      { role: "user", text: "What sofa fits a small room?" },
      { role: "assistant", text: "Gio's answer." },
    ]);
    // The next question's history carries no ack either.
    await processSms(inbound("And a rug?"), deps());
    expect(ask.calls.at(-1)!.turns.map((t) => t.text)).toEqual(["What sofa fits a small room?", "Gio's answer.", "And a rug?"]);
    for (const line of ACK_TEXTS) expect(JSON.stringify(await store.getSession(FROM))).not.toContain(line);
  });

  it("sends no ack for picks, STOP, START, HELP, the welcome or an empty message", async () => {
    await processSms(inbound("2"), deps());
    await processSms(inbound("switch to gio"), deps());
    await processSms(inbound("HELP"), deps());
    expect(await processSms(inbound(""), deps())).toEqual([NO_QUESTION_TEXT]);
    await processSms(inbound("START"), deps());
    await processSms(inbound("STOP"), deps());
    await processSms(inbound("START"), deps());
    expect(acks).toEqual([]);
    expect(ask.calls).toHaveLength(0);
    // A brand-new number's first question gets the welcome in the ack's place, then its answer.
    await processSms(inbound("What sofa?", { from: "+15550000000" }), deps());
    expect(acks).toEqual([WELCOME_TEXT]);
    expect(ask.calls).toHaveLength(1);
  });

  it("acks once and then sends the fallback when the answer fails", async () => {
    await processSms(inbound("3"), deps());
    ask.failOnce();
    expect(await processSms(inbound("What sofa?"), deps())).toEqual([FALLBACK_TEXT]);
    expect(acks).toEqual([ACK_TEXT]);
  });

  it("returns the answer only after the ack has gone, and a failed ack never holds it up", async () => {
    await processSms(inbound("3"), deps());
    const order: string[] = [];
    const slowAck = () => new Promise<void>((r) => setTimeout(() => (order.push("ack"), r()), 20));
    const replies = await processSms(inbound("What sofa?"), { store, ask: ask.ask, acknowledge: slowAck });
    order.push("answer");
    expect(order).toEqual(["ack", "answer"]);
    expect(replies).toEqual(["Gio: Canned answer."]);

    const failing = () => Promise.reject(new Error("twilio down"));
    expect(await processSms(inbound("And a rug?"), { store, ask: ask.ask, acknowledge: failing })).toEqual(["Gio: Canned answer."]);
  });

  it("acks a photo sent alone once the photo is in, but not when no photo could be read", async () => {
    await processSms(inbound("3"), deps());
    const photo = { media: [{ url: "https://media/1", contentType: "image/jpeg" }] };
    const readable = async () => ({ data: "aGk=", mediaType: "image/jpeg" });
    await processSms(inbound("", photo), { ...deps(), downloadMedia: readable });
    expect(acks).toEqual([ACK_TEXT]);

    const unreadable = async () => null;
    expect(await processSms(inbound("", photo), { ...deps(), downloadMedia: unreadable })).toEqual([NO_QUESTION_TEXT]);
    expect(acks).toEqual([ACK_TEXT]);
  });

  it("sends nothing at all for a duplicate delivery", async () => {
    await processSms(inbound("3"), deps());
    const first = inbound("What sofa?", { messageSid: "SMackdup" });
    await processSms(first, deps());
    await processSms(first, deps());
    expect(acks).toEqual([ACK_TEXT]);
  });
});

describe("answers as plain text messages", () => {
  it("drops Markdown markers and keeps the words", () => {
    const answer = [
      "## The call",
      "",
      "**Book the Rosewood.** It is *quiet*, __calm__ and _central_. ***Really.*** ~~No.~~",
      "",
      "### Where to eat ###",
      "- Contramar for lunch",
      "* Rosetta for dinner",
      "+ Máximo if you can",
      "  - the tasting menu",
      "1. Arrive before six",
      "2. Ask for the terrace",
      "",
      "---",
      "* * *",
      "> Go early; it fills up.",
      "",
      "",
      "",
      "Use `Uber` there.   ",
      "```",
      "no fences",
      "```",
    ].join("\n");
    expect(toSmsText(answer)).toBe(
      [
        "The call",
        "",
        "Book the Rosewood. It is quiet, calm and central. Really. No.",
        "",
        "Where to eat",
        "• Contramar for lunch",
        "• Rosetta for dinner",
        "• Máximo if you can",
        "  • the tasting menu",
        "1. Arrive before six",
        "2. Ask for the terrace",
        "",
        "Go early; it fills up.",
        "",
        "Use Uber there.",
        "no fences",
      ].join("\n"),
    );
  });

  it("turns links into words plus a tappable address, and never mangles an address", () => {
    expect(toSmsText("Book [Rosewood](https://www.rosewoodhotels.com/en/mexico-city) today.")).toBe(
      "Book Rosewood (https://www.rosewoodhotels.com/en/mexico-city) today.",
    );
    expect(toSmsText("[https://a.example](https://a.example)")).toBe("https://a.example");
    expect(toSmsText("See <https://a.example/x_y_z>.")).toBe("See https://a.example/x_y_z.");
    // Underscores, asterisks and brackets inside addresses survive; closing punctuation stays outside.
    expect(toSmsText("Read https://en.wikipedia.org/wiki/Roma_(film) and https://a.example/__init__*x*.")).toBe(
      "Read https://en.wikipedia.org/wiki/Roma_(film) and https://a.example/__init__*x*.",
    );
    expect(toSmsText("**[The guide](https://a.example/guide_one)**")).toBe("The guide (https://a.example/guide_one)");
  });

  it("leaves snake_case words, escaped symbols and plain sentences alone", () => {
    expect(toSmsText("Use file_name_here and 5 \\* 3, not 5*3.")).toBe("Use file_name_here and 5 * 3, not 5*3.");
    expect(toSmsText("Just a sentence.")).toBe("Just a sentence.");
  });

  it("is what gets texted, as one plain short text, and history keeps what was sent", async () => {
    const store = new MemorySmsStore();
    const ask = makeAsk();
    await processSms(inbound("START"), { store, ask: ask.ask });
    await processSms(inbound("3"), { store, ask: ask.ask });
    const markdown = "## The call\n\n**Paint it white.** See [this](https://a.example).\n\n- One coat\n- Two coats";
    ask.setAnswer(markdown);
    const sent = "The call\nPaint it white. See this (https://a.example).\n- One coat\n- Two coats";
    expect(await processSms(inbound("Hall colour?"), { store, ask: ask.ask })).toEqual([`Gio: ${sent}`]);
    expect((await store.getSession(FROM))?.turnsByAdvisor.gio?.at(-1)).toMatchObject({ role: "assistant", text: sent });
  });
});

describe("splitting long answers cleanly", () => {
  const same = (parts: string[], text: string) =>
    expect(parts.join(" ").replace(/\s+/g, " ").trim()).toBe(text.replace(/\s+/g, " ").trim());

  it("breaks a long paragraph at a space, never mid-word, and loses nothing", () => {
    const words = Array.from({ length: 700 }, (_, i) => `word${i}`).join(" ");
    const parts = splitReply(words);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(1500);
      expect(part).toMatch(/^word\d+/);
      expect(part).toMatch(/word\d+$/);
    }
    same(parts, words);
  });

  it("never splits an address: the break comes before it", () => {
    const url = "https://www.example.com/" + "a".repeat(200);
    const text = `${"filler ".repeat(200)}${url} and more words after it.`;
    const parts = splitReply(text);
    expect(parts.some((p) => p.includes(url))).toBe(true);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(1500);
    same(parts, text);
  });

  it("prefers a line break inside a long list", () => {
    const list = Array.from({ length: 60 }, (_, i) => `• Item ${i} with a few words of detail here`).join("\n");
    const parts = splitReply(list);
    for (const p of parts) {
      expect(p.startsWith("• ")).toBe(true);
      expect(p).toMatch(/detail here$/);
    }
    same(parts, list);
  });

  it("cuts only a single word longer than a whole message", () => {
    const giant = "x".repeat(3200);
    const parts = splitReply(`Before. ${giant} After.`);
    expect(parts.every((p) => p.length <= 1500)).toBe(true);
    expect(parts.join("").replace(/\s+/g, "")).toBe(`Before.${giant}After.`);
  });

  it("keeps paragraphs together where they fit", () => {
    const text = ["a".repeat(700), "b".repeat(700), "c".repeat(700)].join("\n\n");
    expect(splitReply(text)).toEqual([`${"a".repeat(700)}\n\n${"b".repeat(700)}`, "c".repeat(700)]);
  });
});

describe("varied acks", () => {
  const send = (store: MemorySmsStore, ask: ReturnType<typeof makeAsk>, acks: string[], body: string, extra: Partial<SmsInbound> = {}) =>
    processSms(inbound(body, extra), { store, ask: ask.ask, acknowledge: (t: string) => void acks.push(t) });

  it("has exactly the four lines, one short line each, no emoji", () => {
    expect(ACK_TEXTS).toEqual(["Give me a second…", "Working on it…", "Let me think about it…", "Hmm…"]);
    for (const line of ACK_TEXTS) expect(line).not.toMatch(/\n|\p{Extended_Pictographic}/u);
  });

  it("gives consecutive questions different lines, rotating through all four", async () => {
    const store = new MemorySmsStore();
    const ask = makeAsk();
    const acks: string[] = [];
    await send(store, ask, acks, "START");
    await send(store, ask, acks, "3");
    for (let i = 0; i < 9; i++) await send(store, ask, acks, `Question ${i}?`);
    expect(acks).toHaveLength(9);
    for (const a of acks) expect(ACK_TEXTS).toContain(a);
    for (let i = 1; i < acks.length; i++) expect(acks[i]).not.toBe(acks[i - 1]);
    expect(new Set(acks.slice(0, 4)).size).toBe(4);
  });

  it("never repeats a line after a failed answer, an advisor switch, or other texts in between", async () => {
    const store = new MemorySmsStore();
    const ask = makeAsk();
    const acks: string[] = [];
    await send(store, ask, acks, "START");
    await send(store, ask, acks, "3");
    await send(store, ask, acks, "First?");
    ask.failOnce();
    expect(await send(store, ask, acks, "Second?")).toEqual([FALLBACK_TEXT]);
    await send(store, ask, acks, "Third?");
    await send(store, ask, acks, "HELP");
    await send(store, ask, acks, "alden");
    await send(store, ask, acks, "Fourth?");
    expect(acks).toEqual([ACK_TEXTS[0], ACK_TEXTS[1], ACK_TEXTS[2], ACK_TEXTS[3]]);
    // History holds only questions and real answers.
    const session = await store.getSession(FROM);
    const texts = Object.values(session!.turnsByAdvisor).flat().map((t) => t.text);
    for (const line of ACK_TEXTS) expect(texts).not.toContain(line);
  });

  it("keeps each number's rotation separate", async () => {
    const store = new MemorySmsStore();
    const ask = makeAsk();
    const acks: string[] = [];
    for (const from of [FROM, "+15559998888"]) {
      await send(store, ask, acks, "START", { from });
      await send(store, ask, acks, "3", { from });
    }
    await send(store, ask, acks, "Mine?");
    await send(store, ask, acks, "Theirs?", { from: "+15559998888" });
    expect(acks).toEqual([ACK_TEXTS[0], ACK_TEXTS[0]]);
  });

  it("starts at the first line and wraps, whatever was stored", () => {
    expect(nextAck(undefined)).toBe(0);
    expect(nextAck(0)).toBe(1);
    expect(nextAck(3)).toBe(0);
    expect(nextAck(-1)).toBe(0);
    expect(nextAck(2.5)).toBe(0);
  });
});

describe("texts short enough to arrive whole (the missing-head fix)", () => {


  // How the advisors write: curly apostrophes and quotes, em dashes, ellipses.
  const typographic = Array.from(
    { length: 40 },
    (_, i) => `Paragraph ${i}: it’s the “Milanese” way — saffron and butter… and it’s crisp enough to balance the risotto.`,
  ).join("\n\n");

  it("counts segments the way Twilio sends them (toll-free)", () => {
    expect(smsEncoding("Plain text, 'straight' quotes.")).toBe("GSM-7");
    expect(smsEncoding("It’s curly")).toBe("UCS-2");
    expect(smsEncoding("• bullet")).toBe("UCS-2");
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
    expect(smsSegments("a".repeat(1520))).toBe(10);
    expect(smsSegments("{}".repeat(80))).toBe(3); // extension characters take two units
    expect(smsSegments("’".repeat(70))).toBe(1);
    expect(smsSegments("’".repeat(71))).toBe(2);
    expect(smsSegments("’".repeat(660))).toBe(10);
    // The old 1,500-character limit sent typographic answers as ~23 Unicode segments.
    expect(smsSegments(typographic.slice(0, 1500))).toBeGreaterThan(20);
  });

  it("turns typographic punctuation into plain punctuation and leaves words alone", () => {
    expect(plainPunctuation("It’s “crisp” — really… café, Ça, 1–2")).toBe("It's \"crisp\" - really... café, Ça, 1-2");
    expect(smsEncoding(plainPunctuation("It’s “crisp” — really…"))).toBe("GSM-7");
  });

  it("sends a typographic answer as plain GSM-7 texts of at most 10 segments, losing no words", () => {
    const texts = answerTexts(typographic);
    expect(texts.length).toBeGreaterThan(1);
    for (const t of texts) {
      expect(smsEncoding(t)).toBe("GSM-7");
      expect(smsSegments(t)).toBeLessThanOrEqual(MAX_SEGMENTS);
      expect(t).toMatch(/^Paragraph \d+:/);
      expect(t).toMatch(/risotto\.$/);
    }
    expect(texts.join("\n\n")).toBe(plainPunctuation(typographic));
  });

  it("keeps an answer that must stay Unicode (bullets, emoji) within 10 segments per text, split between words", () => {
    const list = Array.from({ length: 80 }, (_, i) => `- Item ${i} is a good choice for the hall 🌿`).join("\n");
    const texts = answerTexts(list);
    expect(texts.length).toBeGreaterThan(2);
    for (const t of texts) {
      expect(smsEncoding(t)).toBe("UCS-2");
      expect(smsSegments(t)).toBeLessThanOrEqual(MAX_SEGMENTS);
      expect(t.startsWith("• Item")).toBe(true);
      expect(t.endsWith("🌿")).toBe(true);
    }
    expect(texts.join("\n").replace(/\s+/g, " ")).toBe(toSmsText(list).replace(/\s+/g, " "));
  });

  it("still uses the full 1,500 characters for a plain answer", () => {
    const plain = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    const texts = answerTexts(plain);
    expect(texts[0].length).toBeGreaterThan(1400);
    for (const t of texts) expect(t.length).toBeLessThanOrEqual(1500);
  });
});

describe("speaker labels", () => {
  const labels = ["Amar: ", "Martine: ", "Gio: ", "Alden: ", "Goldie: "];

  it("start the one text of every answer, count toward its one segment, and are never stored", async () => {
    const store = new MemorySmsStore();
    const ask = makeAsk();
    await processSms(inbound("START"), { store, ask: ask.ask });
    await processSms(inbound("3"), { store, ask: ask.ask });
    ask.setAnswer("Lower the lamp to eye level when seated; it warms the whole corner.");
    const texts = await processSms(inbound("Lamp?"), { store, ask: ask.ask });
    expect(texts).toEqual(["Gio: Lower the lamp to eye level when seated; it warms the whole corner."]);
    expect(smsSegments(texts[0])).toBeLessThanOrEqual(SMS_MAX_SEGMENTS);
    const session = JSON.stringify(await store.getSession(FROM));
    expect(session).not.toContain("Gio: ");
  });

  it("are removed when the model writes one itself, so it is never doubled or stored", async () => {
    const store = new MemorySmsStore();
    const ask = makeAsk();
    await processSms(inbound("START"), { store, ask: ask.ask });
    await processSms(inbound("3"), { store, ask: ask.ask });
    ask.setAnswer("**Gio:** Lower the lamp.");
    expect(await processSms(inbound("Lamp?"), { store, ask: ask.ask })).toEqual(["Gio: Lower the lamp."]);
    expect((await store.getSession(FROM))?.turnsByAdvisor.gio?.at(-1)?.text).toBe("Lower the lamp.");
  });

  it("never appear on system texts: ack, welcome, list, confirmation, HELP, STOP", async () => {
    const store = new MemorySmsStore();
    const ask = makeAsk();
    const acks: string[] = [];
    const deps = { store, ask: ask.ask, acknowledge: (t: string) => void acks.push(t) };
    const system = [
      ...(await processSms(inbound("START"), deps)),
      ...(await processSms(inbound("SWITCH"), deps)),
      ...(await processSms(inbound("2"), deps)),
      ...(await processSms(inbound("HELP"), deps)),
    ];
    await processSms(inbound("What shoes?"), deps);
    system.push(...acks, ...(await processSms(inbound("STOP"), deps)));
    expect(system).toEqual([WELCOME_TEXT, ADVISOR_LIST_TEXT, "You're with Martine (style). Send your question as a text or a photo.", HELP_TEXT, ACK_TEXTS[0], OPT_OUT_TEXT]);
    for (const t of system) for (const l of labels) expect(t.startsWith(l)).toBe(false);
  });
});
