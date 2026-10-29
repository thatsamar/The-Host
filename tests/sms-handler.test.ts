import { beforeEach, describe, expect, it } from "vitest";
import {
  FALLBACK_TEXT,
  HELP_TEXT,
  OPT_OUT_TEXT,
  WELCOME_TEXT,
  processSms,
  splitReply,
  type SmsInbound,
} from "../src/lib/sms/handler";
import { MemorySmsStore } from "../src/lib/sms/store";
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
    expect(WELCOME_TEXT).toContain("Amar");
    expect(WELCOME_TEXT).toContain("Martine");
    expect(WELCOME_TEXT).toContain("Gio");
    expect(WELCOME_TEXT).toContain("Alden");
    expect(WELCOME_TEXT).toContain("Goldie");
    const session = await store.getSession(FROM);
    expect(session?.optedIn).toBe(true);
    expect(session?.advisorId).toBeNull();
    expect(ask.calls).toHaveLength(0);
  });

  it("opts out on STOP, stays silent after, answers HELP, and re-welcomes on START", async () => {
    const store = new MemorySmsStore();
    const ask = makeAsk();
    await processSms(inbound("START"), { store, ask: ask.ask });
    expect(await processSms(inbound("STOP"), { store, ask: ask.ask })).toEqual([OPT_OUT_TEXT]);
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
      "Gio's answer.",
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

  it("asks for an advisor before answering a question", async () => {
    const replies = await processSms(inbound("Where should I go?"), { store, ask: ask.ask });
    expect(replies[0]).toContain("Pick an advisor first");
    expect(ask.calls).toHaveLength(0);
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
    expect(replies).toEqual(["Martine's take on the outfit."]);
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
    expect(await processSms(inbound("Try again"), { store, ask: ask.ask })).toEqual(["Gio recovered."]);
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
    expect(await processSms(first, { store, ask: ask.ask })).toEqual(["Gio's answer."]);
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
