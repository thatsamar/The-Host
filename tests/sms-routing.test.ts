import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTE_TIMEOUT_MS, ROUTER_PROMPT, INTRODUCTIONS, readRoute, routeQuestion, routeShortcut } from "../src/lib/sms/router";
import { ACK_TEXTS, WELCOME_TEXT, processSms, type SmsInbound } from "../src/lib/sms/handler";
import { MemorySmsStore, type SmsTurn } from "../src/lib/sms/store";

describe("the router", () => {
  it("sends a question that opens by naming an advisor to them, without asking the model", async () => {
    const classify = vi.fn(async () => "goldie");
    expect(await routeQuestion("Martine, what shoes for Milan?", 0, classify)).toBe("martini");
    expect(await routeQuestion("Hey Gio, is this lamp too big?", 0, classify)).toBe("gio");
    expect(classify).not.toHaveBeenCalled();
    expect(routeShortcut("What would Martine wear?")).toBeNull();
  });

  it("sends a greeting to Goldie, who orients", async () => {
    for (const g of ["hi", "Hello!", "hey there", "Good morning"]) expect(routeShortcut(g), g).toBe("goldie");
  });

  it("asks the model otherwise, and reads its one-word answer", async () => {
    const classify = vi.fn(async () => "alden");
    expect(await routeQuestion("What goes with oysters?", 0, classify)).toBe("alden");
    expect(classify).toHaveBeenCalledWith("What goes with oysters?");
    expect(readRoute("tony")).toBe("tony");
    expect(readRoute(" Martini.\n")).toBe("martini");
    expect(readRoute("Gio")).toBe("gio");
  });

  it("sends an unclear answer, a failure or a slow router to Goldie", async () => {
    expect(await routeQuestion("Hmm", 0, async () => "not sure, maybe someone")).toBe("goldie");
    expect(await routeQuestion("Hmm", 0, async () => Promise.reject(new Error("down")))).toBe("goldie");
    expect(await routeQuestion("Hmm", 0)).toBe("goldie");
    vi.useFakeTimers();
    const slow = routeQuestion("Hmm", 0, () => new Promise<string>(() => {}));
    await vi.advanceTimersByTimeAsync(ROUTE_TIMEOUT_MS + 1);
    expect(await slow).toBe("goldie");
    vi.useRealTimers();
  });

  it("describes every advisor's area and makes Goldie the default", () => {
    for (const id of ["tony:", "martini:", "gio:", "alden:", "goldie:"]) expect(ROUTER_PROMPT).toContain(id);
    expect(ROUTER_PROMPT).toMatch(/fits none of the first four clearly, reply goldie/);
  });
});

describe("routing and introductions in the conversation", () => {
  const FROM = "+15551234567";
  let sid = 0;
  const inbound = (body: string, extra: Partial<SmsInbound> = {}): SmsInbound => ({ from: FROM, body, media: [], messageSid: `SMroute${++sid}`, ...extra });
  let store: MemorySmsStore;
  let calls: { advisorId: string; turns: SmsTurn[] }[];
  let routed: string[];
  let early: string[];
  // A stand-in for the router model: what it would answer for each kind of question.
  const model: Record<string, string> = {
    "Best area to stay in Lisbon?": "tony",
    "What shoes with wide-leg trousers?": "martini",
    "Is this sofa too big for the room?": "gio",
    "Which wine with grilled fish?": "alden",
    "Should I take the job offer?": "goldie",
    "Thoughts on the meaning of it all?": "goldie",
  };
  const deps = () => ({
    store,
    ask: async (advisorId: string, turns: SmsTurn[]) => {
      calls.push({ advisorId, turns: JSON.parse(JSON.stringify(turns)) });
      return `${advisorId} answers.`;
    },
    acknowledge: (t: string) => void early.push(t),
    route: async (q: string) => {
      routed.push(q);
      return model[q] ?? "unsure";
    },
  });
  const send = (body: string, extra: Partial<SmsInbound> = {}) => processSms(inbound(body, extra), deps());

  beforeEach(async () => {
    store = new MemorySmsStore();
    calls = [];
    routed = [];
    early = [];
    await send("START");
    early = [];
  });
  afterEach(() => vi.useRealTimers());

  it("routes each kind of first question to its advisor, who introduces themselves", async () => {
    const expected: [string, string][] = [
      ["Best area to stay in Lisbon?", "tony"],
      ["What shoes with wide-leg trousers?", "martini"],
      ["Is this sofa too big for the room?", "gio"],
      ["Which wine with grilled fish?", "alden"],
      ["Should I take the job offer?", "goldie"],
    ];
    for (const [question, id] of expected) {
      store = new MemorySmsStore();
      await send("START");
      const replies = await send(question);
      expect(replies, question).toEqual([`${INTRODUCTIONS[id as "gio"]}\n\n${id} answers.`.replace(" — ", " - ")]);
      expect(replies.join(" ")).not.toContain("Pick an advisor");
      expect(calls.at(-1)!.advisorId).toBe(id);
      expect((await store.getSession(FROM))?.advisorId).toBe(id);
    }
  });

  it("routes a question that names an advisor to them", async () => {
    const replies = await send("Martine, what shoes for Milan?");
    expect(calls[0].advisorId).toBe("martini");
    expect(replies[0].startsWith("I'm Martine - I look after style at Cinq.")).toBe(true);
    expect(routed).toEqual([]);
  });

  it("routes an unclear question to Goldie", async () => {
    await send("Something odd happened today");
    expect(calls[0].advisorId).toBe("goldie");
  });

  it("introduces an advisor once: the second question gets no introduction, and the routing doesn't run again", async () => {
    await send("Is this sofa too big for the room?");
    expect(await send("And the rug?")).toEqual(["gio answers."]);
    expect(routed).toEqual(["Is this sofa too big for the room?"]);
    expect(calls.map((c) => c.advisorId)).toEqual(["gio", "gio"]);
    // The introduction is never stored as part of the answer.
    const turns = (await store.getSession(FROM))!.turnsByAdvisor.gio!;
    expect(turns.map((t) => t.text)).toEqual(["Is this sofa too big for the room?", "gio answers.", "And the rug?", "gio answers."]);
  });

  it("gives an explicit pick the confirmation and no separate introduction", async () => {
    expect(await send("talk to Gio")).toEqual(["You're with Gio (design). Send your question as a text or a photo."]);
    expect(await send("Is this sofa too big for the room?")).toEqual(["gio answers."]);
    expect(routed).toEqual([]);
  });

  it("sends a greeting to Goldie, who orients, without asking the router", async () => {
    const replies = await send("hi");
    expect(calls[0].advisorId).toBe("goldie");
    expect(replies[0].startsWith("I'm Goldie - Cinq's sounding board.")).toBe(true);
    expect(routed).toEqual([]);
  });

  it("acks a routed question as usual, before its answer", async () => {
    await send("Which wine with grilled fish?");
    expect(early).toEqual([ACK_TEXTS[0]]);
  });

  it("routes again after START, but an advisor already met doesn't introduce themselves twice", async () => {
    await send("Is this sofa too big for the room?");
    await send("START");
    expect(await send("Is this sofa too big for the room?")).toEqual(["gio answers."]);
    expect(routed).toHaveLength(2);
  });

  it("answers a brand-new number's first question after the welcome, with the introduction", async () => {
    store = new MemorySmsStore();
    early = [];
    const replies = await send("Best area to stay in Lisbon?");
    expect(early).toEqual([WELCOME_TEXT]);
    expect(replies).toEqual(["I'm Amar - I look after travel at Cinq.\n\ntony answers."]);
    const session = await store.getSession(FROM);
    expect(session?.optedIn).toBe(true);
    expect(session?.advisorId).toBe("tony");
  });

  it("puts the welcome in the replies when it can't go out early", async () => {
    store = new MemorySmsStore();
    const replies = await processSms(inbound("Best area to stay in Lisbon?"), { ...deps(), acknowledge: undefined });
    expect(replies[0]).toBe(WELCOME_TEXT);
    expect(replies[1].startsWith("I'm Amar")).toBe(true);
  });

  it("reads exactly as written: the new welcome", () => {
    expect(WELCOME_TEXT).toBe(
      "Welcome to Cinq by text. Five advisors: 1 Amar — travel, 2 Martine — style, 3 Gio — design, 4 Alden — wine, cocktails & spirits, 5 Goldie — sounding board. What's on your mind? Ask anything and the right advisor will answer. Switch anytime — reply SWITCH for the list, or say 'talk to Martine'. Reply STOP to opt out, HELP for help. Message frequency varies with your usage. Message and data rates may apply.",
    );
  });
});
