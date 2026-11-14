import { beforeEach, describe, expect, it } from "vitest";
import { assemblePrompt, BLOCK_ORDER, CHANNEL_BLOCK } from "@/lib/ask/prompt";
import { COMPANIONS } from "@/lib/companions";
import { agreesToHandoff, offerText, readSuggestion, textChannelNotes } from "../src/lib/sms/handoff";
import { ACK_TEXTS, FALLBACK_TEXT, WELCOME_TEXT, processSms, type SmsInbound } from "../src/lib/sms/handler";
import { MemorySmsStore, type SmsTurn } from "../src/lib/sms/store";

describe("the suggestion marker", () => {
  it("is removed from the answer and read as the suggested advisor, by id or name", () => {
    expect(readSuggestion("Pair it with a Barolo.\n\nMartine is the one for the jacket; want me to bring her in?\n[[suggest:martini]]", "alden")).toEqual({
      text: "Pair it with a Barolo.\n\nMartine is the one for the jacket; want me to bring her in?",
      suggest: "martini",
    });
    expect(readSuggestion("Answer.\n[[ suggest : Martine ]]", "alden").suggest).toBe("martini");
  });

  it("means no suggestion for an unknown advisor, the advisor answering, or two different advisors, and is still removed", () => {
    for (const [answer, self] of [
      ["Answer.\n[[suggest:jack]]", "alden"],
      ["Answer.\n[[suggest:bob]]", "alden"],
      ["Answer.\n[[suggest:alden]]", "alden"],
      ["Answer.\n[[suggest:gio]]\n[[suggest:martini]]", "alden"],
    ] as const) {
      expect(readSuggestion(answer, self)).toEqual({ text: "Answer.", suggest: null });
    }
    expect(readSuggestion("No marker here.", "gio")).toEqual({ text: "No marker here.", suggest: null });
  });

  it("is offered with one short line", () => {
    expect(offerText("martini")).toBe("Reply YES to bring in Martine, or carry on with me.");
  });
});

describe("agreeing to a handoff", () => {
  it("accepts a yes, 'bring her in', the advisor's name or a switch to them", () => {
    for (const t of ["YES", "yes", "Yeah", "ok", "Sure!", "yes please", "go ahead", "bring her in", "Bring him in please", "bring them in", "Martine", "yes Martine", "talk to Martine", "switch to 2", "Martine please"]) {
      expect(agreesToHandoff(t, "martini"), t).toBe(true);
    }
  });

  it("does not take a no, a question, or another advisor as agreement", () => {
    for (const t of ["no", "No thanks", "What about a Barolo instead?", "Gio", "talk to Gio", "yes but what about red?", ""]) {
      expect(agreesToHandoff(t, "martini"), t).toBe(false);
    }
  });
});

describe("the text-only notes", () => {
  it("are a third block only when given, so the website's prompt is unchanged", () => {
    const companion = COMPANIONS.alden;
    const web = assemblePrompt({ companion, turns: [{ role: "user", text: "Hi" }] });
    expect(web.system.map((b) => b.label)).toEqual([...BLOCK_ORDER]);
    const text = assemblePrompt({ companion, turns: [{ role: "user", text: "Hi" }], channel: textChannelNotes("alden") });
    expect(text.system.map((b) => b.label)).toEqual([...BLOCK_ORDER, CHANNEL_BLOCK]);
    expect(text.system.slice(0, 2)).toEqual(web.system);
  });

  it("explain the marker with every advisor's id, and carry the previous answer only on a handoff", () => {
    const plain = textChannelNotes("alden").body;
    expect(plain).toContain("[[suggest:ID]]");
    for (const id of ["tony", "martini", "gio", "alden", "goldie"]) expect(plain).toContain(`${id} = `);
    expect(plain).toMatch(/when in doubt, answer it yourself/);
    expect(plain).not.toContain("previous_answer");
    const handed = textChannelNotes("martini", { from: "alden", answer: "Go with the navy." }).body;
    expect(handed).toContain('<previous_answer advisor="Alden">\nGo with the navy.\n</previous_answer>');
    expect(handed).toMatch(/not a generic greeting/);
  });
});

describe("handoffs in the conversation", () => {
  const FROM = "+15551234567";
  let sid = 0;
  const inbound = (body: string, extra: Partial<SmsInbound> = {}): SmsInbound => ({ from: FROM, body, media: [], messageSid: `SMhand${++sid}`, ...extra });
  let store: MemorySmsStore;
  let calls: { advisorId: string; turns: SmsTurn[]; context?: { handoff?: { from: string; answer: string } } }[];
  let answers: Record<string, string[]>;
  let events: string[];
  let failNext: boolean;
  const deps = () => ({
    store,
    ask: async (advisorId: string, turns: SmsTurn[], context?: { handoff?: { from: string; answer: string } }) => {
      calls.push({ advisorId, turns: JSON.parse(JSON.stringify(turns)), context });
      if (failNext) {
        failNext = false;
        throw new Error("down");
      }
      // Writing an answer takes a moment; the ack goes out meanwhile.
      await new Promise((r) => setTimeout(r, 1));
      events.push(`answer:${advisorId}`);
      return answers[advisorId]?.shift() ?? `${advisorId} answers.`;
    },
    acknowledge: (line: string) => void events.push(`ack:${line}`),
    downloadMedia: async () => ({ data: "cGhvdG8=", mediaType: "image/jpeg" }),
  });
  const send = (body: string, extra: Partial<SmsInbound> = {}) => processSms(inbound(body, extra), deps());
  const SUGGESTING = "A dry Vermentino suits the dinner.\n\nFor the jacket itself, Martine is your person. Want me to bring her in?\n[[suggest:martini]]";
  const QUESTION = "Does this linen jacket work for a dinner by the sea?";

  beforeEach(async () => {
    store = new MemorySmsStore();
    calls = [];
    events = [];
    failNext = false;
    answers = { alden: [SUGGESTING] };
    await send("START");
    await send("4");
  });

  async function offer() {
    const replies = await send(QUESTION);
    expect(replies.join("\n")).not.toContain("[[");
    expect(replies.join("\n")).toContain("Want me to bring her in?");
    expect(replies.at(-1)!.endsWith("Reply YES to bring in Martine, or carry on with me.")).toBe(true);
    const session = await store.getSession(FROM);
    expect(session?.pendingHandoff).toEqual({ from: "alden", to: "martini" });
    // History keeps the answer without the marker or the offer line.
    expect(session?.turnsByAdvisor.alden?.at(-1)).toEqual({ role: "assistant", text: SUGGESTING.replace("\n[[suggest:martini]]", "") });
    events = [];
    return replies;
  }

  it("hands the original question and the first answer to the new advisor on YES, who answers directly", async () => {
    await offer();
    answers.martini = ["Alden brought me in. Yes, the linen jacket works; roll the sleeves once."];
    const replies = await send("YES");
    expect(replies).toEqual(["Alden brought me in. Yes, the linen jacket works; roll the sleeves once."]);
    // The ack, then the answer. No "You're with Martine" confirmation.
    expect(events).toEqual([`ack:${ACK_TEXTS[1]}`, "answer:martini"]);
    const handoff = calls.at(-1)!;
    expect(handoff.advisorId).toBe("martini");
    expect(handoff.turns).toEqual([{ role: "user", text: QUESTION }]);
    expect(handoff.context).toEqual({ handoff: { from: "alden", answer: SUGGESTING.replace("\n[[suggest:martini]]", "") } });
    const session = await store.getSession(FROM);
    expect(session?.advisorId).toBe("martini");
    expect(session?.pendingHandoff).toBeUndefined();
    expect(session?.turnsByAdvisor.martini).toEqual([
      { role: "user", text: QUESTION },
      { role: "assistant", text: "Alden brought me in. Yes, the linen jacket works; roll the sleeves once." },
    ]);
    // "YES" itself is never stored as a turn.
    expect(JSON.stringify(session)).not.toContain('"YES"');
  });

  it("hands over on the advisor's name or a switch phrase naming them", async () => {
    for (const reply of ["Martine", "talk to Martine", "bring her in"]) {
      store = new MemorySmsStore();
      answers = { alden: [SUGGESTING] };
      await send("START");
      await send("4");
      await offer();
      await send(reply);
      expect((await store.getSession(FROM))?.advisorId, reply).toBe("martini");
      expect(calls.at(-1)!.context?.handoff?.from).toBe("alden");
    }
  });

  it("brings the photo along when the original question had one", async () => {
    answers.alden = [SUGGESTING];
    await send(QUESTION, { media: [{ url: "https://media/1", contentType: "image/jpeg" }] });
    await send("yes");
    expect(calls.at(-1)!.turns).toEqual([{ role: "user", text: QUESTION, images: [{ data: "cGhvdG8=", mediaType: "image/jpeg" }] }]);
  });

  it("lapses on 'no' or a new question: the person stays with Alden, who answers it", async () => {
    await offer();
    expect(await send("no")).toEqual(["alden answers."]);
    expect(calls.at(-1)!.advisorId).toBe("alden");
    expect(calls.at(-1)!.context).toBeUndefined();
    const session = await store.getSession(FROM);
    expect(session?.advisorId).toBe("alden");
    expect(session?.pendingHandoff).toBeUndefined();
    // A later YES is just a message to Alden, not a handoff.
    expect(await send("yes")).toEqual(["alden answers."]);
    expect((await store.getSession(FROM))?.advisorId).toBe("alden");
  });

  it("lapses when the person names a different advisor, who is switched to as usual", async () => {
    await offer();
    expect(await send("Gio")).toEqual(["You're with Gio (design). Send your question as a text or a photo."]);
    const session = await store.getSession(FROM);
    expect(session?.advisorId).toBe("gio");
    expect(session?.pendingHandoff).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("never switches without agreement, and ignores an unknown advisor in the marker", async () => {
    answers.alden = ["Try a Vermentino.\n[[suggest:sommelier]]"];
    expect(await send(QUESTION)).toEqual(["Try a Vermentino."]);
    const session = await store.getSession(FROM);
    expect(session?.pendingHandoff).toBeUndefined();
    expect(session?.advisorId).toBe("alden");
    expect(await send("yes")).toEqual(["alden answers."]);
    expect((await store.getSession(FROM))?.advisorId).toBe("alden");
  });

  it("keeps one pending offer at a time: a newer one replaces it", async () => {
    await offer();
    answers.alden = ["For the room itself, Gio. Shall I bring him in?\n[[suggest:gio]]"];
    await send("And what about the dining room?");
    expect((await store.getSession(FROM))?.pendingHandoff).toEqual({ from: "alden", to: "gio" });
    await send("Martine");
    // Naming the older suggestion is now just a switch, not a handoff.
    expect((await store.getSession(FROM))?.advisorId).toBe("martini");
    expect(calls.at(-1)!.advisorId).toBe("alden");
  });

  it("stays with the first advisor if the handoff answer fails, and YES can try again", async () => {
    await offer();
    failNext = true;
    expect(await send("yes")).toEqual([FALLBACK_TEXT]);
    let session = await store.getSession(FROM);
    expect(session?.advisorId).toBe("alden");
    expect(session?.pendingHandoff).toEqual({ from: "alden", to: "martini" });
    expect(session?.turnsByAdvisor.martini).toBeUndefined();
    answers.martini = ["Alden brought me in. It works."];
    expect(await send("yes")).toEqual(["Alden brought me in. It works."]);
    session = await store.getSession(FROM);
    expect(session?.advisorId).toBe("martini");
  });

  it("can offer again from the new advisor, but never to itself", async () => {
    await offer();
    answers.martini = ["Alden brought me in. Navy works.\n[[suggest:martini]]"];
    expect(await send("yes")).toEqual(["Alden brought me in. Navy works."]);
    expect((await store.getSession(FROM))?.pendingHandoff).toBeUndefined();
  });

  it("opens a handoff in the new advisor's own words, with no fixed introduction, and counts them as met", async () => {
    await offer();
    answers.martini = ["Alden brought me in. Navy works."];
    expect(await send("yes")).toEqual(["Alden brought me in. Navy works."]);
    expect((await store.getSession(FROM))?.introduced).toContain("martini");
    // A later switch back to Alden and on to Martine: no introduction from her.
    await send("talk to Alden");
    await send("talk to Martine");
    expect(await send("And the shoes?")).toEqual(["martini answers."]);
  });

  it("works for a routed first question too, and the welcome no longer says to pick first", async () => {
    const fresh = new MemorySmsStore();
    const d = { ...deps(), store: fresh, route: async () => "alden" };
    answers.alden = [SUGGESTING];
    await processSms({ from: "+15550001111", body: "START", media: [], messageSid: "SMfresh1" }, d);
    const replies = await processSms({ from: "+15550001111", body: QUESTION, media: [], messageSid: "SMfresh2" }, d);
    expect(replies[0].startsWith("I'm Alden")).toBe(true);
    expect(replies.at(-1)!.endsWith("Reply YES to bring in Martine, or carry on with me.")).toBe(true);
    expect(WELCOME_TEXT).not.toContain("Pick any advisor");
  });
});
