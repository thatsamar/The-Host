import { beforeEach, describe, expect, it } from "vitest";
import { addressedAdvisor, readNavigation } from "../src/lib/sms/navigation";
import { ADVISOR_LIST_TEXT, HELP_TEXT, WELCOME_TEXT, processSms, type SmsInbound } from "../src/lib/sms/handler";
import { MemorySmsStore, type SmsTurn } from "../src/lib/sms/store";
import { smsSegments } from "../src/lib/sms/segments";

const sw = (id: string) => ({ kind: "switch", advisorId: id });

describe("reading a text as navigation", () => {
  it("SWITCH, MENU and 'switch' alone show the advisors, in any case", () => {
    for (const t of ["SWITCH", "switch", "Switch.", "MENU", "menu please", "switch advisors", "Change advisor", "advisors", "who else?"]) {
      expect(readNavigation(t), t).toEqual({ kind: "list" });
    }
  });

  it("switches on every switch verb, by name or number, in any case", () => {
    const cases: [string, string][] = [
      ["talk to Gio", "gio"],
      ["switch to Martine", "martini"],
      ["ask Alden", "alden"],
      ["let me talk to Goldie", "goldie"],
      ["bring in Martine", "martini"],
      ["switch to 2", "martini"],
      ["SWITCH TO 3", "gio"],
      ["change to amar", "tony"],
      ["speak to Gio", "gio"],
      ["speak with Goldie", "goldie"],
      ["chat with Alden", "alden"],
      ["go to 5", "goldie"],
      ["hand me to Martine", "martini"],
      ["put me through to Amar", "tony"],
      ["connect me to Gio", "gio"],
      ["connect me with Alden!", "alden"],
      ["Can I talk to Martine please?", "martini"],
      ["I'd like to speak to Gio", "gio"],
      ["ok switch me to goldie", "goldie"],
    ];
    for (const [t, id] of cases) expect(readNavigation(t), t).toEqual(sw(id));
  });

  it("switches on a bare name or number, with filler", () => {
    for (const [t, id] of [["Martine please", "martini"], ["gio", "gio"], ["3", "gio"], ["Alden!", "alden"], ["please Amar", "tony"], ["style", "martini"]]) {
      expect(readNavigation(t), t).toEqual(sw(id));
    }
  });

  it("never switches on a name inside another sentence", () => {
    for (const t of [
      "I'm having dinner with Gio",
      "What would Martine say about this?",
      "My friend Gio recommended this place",
      "Alden, what do you think of this wine?", // addressed: Alden answers it (below), but it is no bare switch
      "Ask 2 people for directions",
      "I asked Amar's advice yesterday",
      "ask Gio's opinion on this lamp",
      "Is Goldie the right one for this?",
      "Martine said I should wear blue",
    ]) {
      expect(readNavigation(t), t).toBeNull();
    }
  });
});

describe("navigation in the conversation", () => {
  const FROM = "+15551234567";
  let sid = 0;
  const inbound = (body: string): SmsInbound => ({ from: FROM, body, media: [], messageSid: `SMnav${++sid}` });
  let store: MemorySmsStore;
  let asks: { advisorId: string; turns: SmsTurn[] }[];
  const deps = () => ({
    store,
    ask: async (advisorId: string, turns: SmsTurn[]) => {
      asks.push({ advisorId, turns });
      return `${advisorId} answers.`;
    },
  });
  const send = (body: string) => processSms(inbound(body), deps());

  beforeEach(async () => {
    store = new MemorySmsStore();
    asks = [];
    await send("START");
  });

  it("answers SWITCH and MENU with the numbered list, and HELP with the list plus START/STOP and contact", async () => {
    await send("3");
    expect(await send("SWITCH")).toEqual([ADVISOR_LIST_TEXT]);
    expect(await send("menu")).toEqual([ADVISOR_LIST_TEXT]);
    for (const n of ["1 Amar", "2 Martine", "3 Gio", "4 Alden", "5 Goldie"]) expect(ADVISOR_LIST_TEXT).toContain(n);
    expect(await send("help")).toEqual([HELP_TEXT]);
    for (const part of ["1 Amar", "5 Goldie", "START", "STOP", "amar@cinqcollective.com"]) expect(HELP_TEXT).toContain(part);
    // Still with Gio afterwards, and nothing stored.
    expect((await store.getSession(FROM))?.advisorId).toBe("gio");
    expect(asks).toHaveLength(0);
  });

  it("sends a question that opens with an advisor's name to that advisor, who answers it", async () => {
    await send("3");
    expect(await send("Martine, what shoes for Milan?")).toEqual(["Martine: I'm Martine, style at Cinq.\nmartini answers."]);
    expect((await store.getSession(FROM))?.advisorId).toBe("martini");
    expect(asks.at(-1)!.advisorId).toBe("martini");
    expect(asks.at(-1)!.turns.at(-1)!.text).toBe("Martine, what shoes for Milan?");
    // Back to an advisor already met: no introduction, just the answer.
    expect(await send("hey Gio which rug goes with oak floors")).toEqual(["Gio: gio answers."]);
    expect((await store.getSession(FROM))?.advisorId).toBe("gio");
    // Naming the advisor already on changes nothing.
    expect(await send("Gio, and the curtains?")).toEqual(["Gio: gio answers."]);
  });

  it("has the advisor answer a pick by name: introduced the first time, back after that, still here if already on", async () => {
    await send("3");
    expect(await send("Martine")).toEqual(["Martine: I'm Martine, style at Cinq. What's on your mind?"]);
    await send("What shoes?");
    expect(await send("Gio")).toEqual(["Gio: I'm back. What's on your mind?"]);
    expect(await send("Martine")).toEqual(["Martine: I'm back. What's on your mind?"]);
    expect(await send("Martine")).toEqual(["Martine: Still here. What's on your mind?"]);
    // The pick is not a turn: the advisor's history holds only the conversation.
    expect((await store.getSession(FROM))?.turnsByAdvisor.martini?.map((t) => t.text)).toEqual(["What shoes?", "martini answers."]);
  });

  it("only treats a name as addressing an advisor when it opens the question", () => {
    for (const [t, id] of [
      ["Martine, what shoes for Milan?", "martini"],
      ["martine what shoes", "martini"],
      ["Hey Gio: which rug?", "gio"],
      ["Alden - red or white with salmon?", "alden"],
      ["hi Goldie I need advice", "goldie"],
    ]) {
      expect(addressedAdvisor(t), t).toBe(id);
    }
    for (const t of ["I'm having dinner with Gio", "Gio's sofa looks wrong", "What would Martine say?", "Martine", "Gio!"]) {
      expect(addressedAdvisor(t), t).toBeNull();
    }
  });

  it("shows the list before an advisor is picked too", async () => {
    expect(await send("switch")).toEqual([ADVISOR_LIST_TEXT]);
  });

  it("switches on a natural phrase without answering anything bundled into it", async () => {
    await send("3");
    expect(await send("Talk to Martine about my blazer")).toEqual([
      "Martine: I'm Martine, style at Cinq. What's on your mind?",
    ]);
    expect((await store.getSession(FROM))?.advisorId).toBe("martini");
    expect(asks).toHaveLength(0);
    expect((await store.getSession(FROM))?.turnsByAdvisor).toEqual({});
  });

  it("sends a sentence that only mentions an advisor to the current advisor as a question", async () => {
    await send("4");
    expect(await send("I'm having dinner with Gio, what should we drink?")).toEqual(["Alden: alden answers."]);
    expect((await store.getSession(FROM))?.advisorId).toBe("alden");
    expect(asks[0].advisorId).toBe("alden");
  });

  it("keeps the welcome's switching line, and every system text within 10 segments", () => {
    expect(WELCOME_TEXT).toContain("\nSWITCH for their names.\nSay 'Martine' for style\n'Gio' for design, etc.\n");
    for (const t of [WELCOME_TEXT, HELP_TEXT, ADVISOR_LIST_TEXT]) expect(smsSegments(t)).toBeLessThanOrEqual(10);
  });
});
