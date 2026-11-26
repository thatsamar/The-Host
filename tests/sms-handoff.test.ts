import { fitsAnswerCap } from "@/lib/sms/segments";
import { beforeEach, describe, expect, it } from "vitest";
import { assemblePrompt, BLOCK_ORDER, CHANNEL_BLOCK } from "@/lib/ask/prompt";
import { COMPANIONS } from "@/lib/companions";
import { HANDOFF_NOTE_PREFIX, agreesToHandoff, handoffNote, offerText, readSuggestion, textChannelNotes } from "../src/lib/sms/handoff";
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
    expect(offerText("martini")).toBe("Want me to bring in Martine?");
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

  it("explain the marker and the handoff note, and never ask the advisor to write its own label", () => {
    const plain = textChannelNotes("alden").body;
    expect(plain).toContain("[[suggest:ID]]");
    for (const id of ["tony", "martini", "gio", "alden", "goldie"]) expect(plain).toContain(`${id} = `);
    expect(plain).toMatch(/when in doubt, answer it yourself/);
    expect(plain).toContain(HANDOFF_NOTE_PREFIX);
    expect(plain).toMatch(/never write your own name as a label/);
    expect(plain).not.toMatch(/just been handed to you/);
    const handed = textChannelNotes("martini", { from: "alden", answer: "Go with the navy." }).body;
    expect(handed).toMatch(/just been handed to you/);
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
  const SUGGESTING = "A dry Vermentino suits the dinner. The jacket is Martine's call; want me to bring her in?\n[[suggest:martini]]";
  const QUESTION = "Does this linen jacket work for a dinner by the sea?";
  const SUGGESTED = SUGGESTING.replace("\n[[suggest:martini]]", "");
  // The note as the model receives it: its words, without Cinq's bookkeeping fields.
  const sentNote = { role: "user", text: handoffNote({ from: "alden", answer: SUGGESTED }).text };

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
    expect(replies.join("\n")).toContain("want me to bring her in?");
    // The advisor's own question is the offer: no fixed line is added.
    expect(replies.at(-1)!.endsWith(SUGGESTED)).toBe(true);
    expect(replies.join("\n")).not.toMatch(/Reply YES|Want me to bring in/);
    const session = await store.getSession(FROM);
    expect(session?.pendingHandoff).toEqual({ from: "alden", to: "martini" });
    // History keeps the answer without the marker or the offer line.
    expect(session?.turnsByAdvisor.alden?.at(-1)).toMatchObject({ role: "assistant", text: SUGGESTING.replace("\n[[suggest:martini]]", "") });
    events = [];
    return replies;
  }

  it("hands the original question and the first answer to the new advisor on YES, who answers directly", async () => {
    await offer();
    answers.martini = ["Yes, the linen jacket works; roll the sleeves once."];
    const replies = await send("YES");
    // Label, then the fixed introduction, then the answer. No "You're with Martine" confirmation.
    expect(replies).toEqual(["Martine: I'm Martine, style at Cinq.\nYes, the linen jacket works; roll the sleeves once."]);
    // The ack, then the answer.
    expect(events).toEqual([`ack:${ACK_TEXTS[1]}`, "answer:martini"]);
    const handoff = calls.at(-1)!;
    expect(handoff.advisorId).toBe("martini");
    // The handoff note, with Alden's answer, then the question verbatim.
    expect(handoff.turns).toEqual([sentNote, { role: "user", text: QUESTION }]);
    expect(handoff.turns[0].text).toContain(SUGGESTED);
    // The advisors the person has met (other than Martine) go along, for the text-only notes.
    expect(handoff.context).toMatchObject({ handoff: { from: "alden", answer: SUGGESTED }, met: ["alden"] });
    const session = await store.getSession(FROM);
    expect(session?.advisorId).toBe("martini");
    expect(session?.pendingHandoff).toBeUndefined();
    // Martine's history keeps the handoff, the question and her answer; no label or introduction is stored.
    expect(session?.turnsByAdvisor.martini).toMatchObject([
      handoffNote({ from: "alden", answer: SUGGESTED }),
      { role: "user", text: QUESTION },
      { role: "assistant", text: "Yes, the linen jacket works; roll the sleeves once." },
    ]);
    expect(JSON.stringify(session)).not.toMatch(/Martine: |I'm Martine, style/);
    // "YES" itself is never stored as a turn.
    expect(JSON.stringify(session)).not.toContain('"YES"');
  });

  it("keeps the handoff in the new advisor's history, so a later answer knows who brought them in", async () => {
    await offer();
    answers.martini = ["Navy works.", "Alden brought me in for the jacket; for shoes, loafers."];
    await send("yes");
    const replies = await send("Who brought you in, and what shoes?");
    // Second answer: the label, no introduction.
    expect(replies).toEqual(["Martine: Alden brought me in for the jacket; for shoes, loafers."]);
    const later = calls.at(-1)!;
    expect(later.advisorId).toBe("martini");
    expect(later.context).toMatchObject({ met: ["alden"] });
    expect(later.context).not.toHaveProperty("handoff");
    expect(later.turns.map((t) => t.role)).toEqual(["user", "user", "assistant", "user"]);
    expect(later.turns[0].text.startsWith(HANDOFF_NOTE_PREFIX)).toBe(true);
    expect(later.turns[0].text).toContain("Alden");
    expect(later.turns[0].text).toContain(SUGGESTED);
    // The model sees the note and the question as one user message, before Martine's first answer.
    const prompt = assemblePrompt({ companion: COMPANIONS.martini, turns: later.turns, channel: textChannelNotes("martini") });
    expect(prompt.messages[0].content.map((c) => (c.type === "text" ? c.text : ""))).toEqual([later.turns[0].text, QUESTION]);
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
    expect(calls.at(-1)!.turns).toEqual([
      sentNote,
      { role: "user", text: QUESTION, images: [{ data: "cGhvdG8=", mediaType: "image/jpeg" }] },
    ]);
  });

  it("lapses on 'no' or a new question: the person stays with Alden, who answers it", async () => {
    await offer();
    expect(await send("no")).toEqual(["Alden: alden answers."]);
    expect(calls.at(-1)!.advisorId).toBe("alden");
    expect(calls.at(-1)!.context).not.toHaveProperty("handoff");
    const session = await store.getSession(FROM);
    expect(session?.advisorId).toBe("alden");
    expect(session?.pendingHandoff).toBeUndefined();
    // A later YES is just a message to Alden, not a handoff.
    expect(await send("yes")).toEqual(["Alden: alden answers."]);
    expect((await store.getSession(FROM))?.advisorId).toBe("alden");
  });

  it("lapses when the person names a different advisor, who is switched to as usual", async () => {
    await offer();
    expect(await send("Gio")).toEqual(["Gio: I'm Gio, design at Cinq. What's on your mind?"]);
    const session = await store.getSession(FROM);
    expect(session?.advisorId).toBe("gio");
    expect(session?.pendingHandoff).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("never switches without agreement, and ignores an unknown advisor in the marker", async () => {
    answers.alden = ["Try a Vermentino.\n[[suggest:sommelier]]"];
    expect(await send(QUESTION)).toEqual(["Alden: Try a Vermentino."]);
    const session = await store.getSession(FROM);
    expect(session?.pendingHandoff).toBeUndefined();
    expect(session?.advisorId).toBe("alden");
    expect(await send("yes")).toEqual(["Alden: alden answers."]);
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
    answers.martini = ["It works."];
    expect(await send("yes")).toEqual(["Martine: I'm Martine, style at Cinq.\nIt works."]);
    session = await store.getSession(FROM);
    expect(session?.advisorId).toBe("martini");
  });

  it("can offer again from the new advisor, but never to itself", async () => {
    await offer();
    answers.martini = ["Navy works.\n[[suggest:martini]]"];
    expect(await send("yes")).toEqual(["Martine: I'm Martine, style at Cinq.\nNavy works."]);
    expect((await store.getSession(FROM))?.pendingHandoff).toBeUndefined();
  });

  it("opens a handoff with the label and the fixed introduction once; later answers have the label only", async () => {
    await offer();
    answers.martini = ["Navy works.", "Loafers.", "Suede."];
    expect(await send("yes")).toEqual(["Martine: I'm Martine, style at Cinq.\nNavy works."]);
    expect((await store.getSession(FROM))?.introduced).toContain("martini");
    expect(await send("And the shoes?")).toEqual(["Martine: Loafers."]);
    // A later switch back to Alden and on to Martine: still no introduction from her.
    await send("talk to Alden");
    await send("talk to Martine");
    expect(await send("Which leather?")).toEqual(["Martine: Suede."]);
  });

  it("doesn't re-introduce a handed-over advisor the person already knows", async () => {
    // Martine was met earlier: picked, answered, then the person went back to Alden.
    await send("talk to Martine");
    await send("Navy or grey?");
    await send("talk to Alden");
    answers.alden = [SUGGESTING];
    await offer();
    answers.martini = ["The linen works."];
    expect(await send("yes")).toEqual(["Martine: The linen works."]);
    expect(await send("And the shoes?")).toEqual(["Martine: martini answers."]);
  });

  it("asks in one short line when the advisor's own words don't make the offer", async () => {
    answers.alden = ["A dry Vermentino suits the dinner.\n[[suggest:martini]]"];
    const replies = await send(QUESTION);
    expect(replies.at(-1)).toBe("Alden: A dry Vermentino suits the dinner.\nWant me to bring in Martine?");
    expect((await store.getSession(FROM))?.pendingHandoff).toEqual({ from: "alden", to: "martini" });
    // History keeps the advisor's answer, never Cinq's line.
    expect((await store.getSession(FROM))?.turnsByAdvisor.alden?.at(-1)?.text).toBe("A dry Vermentino suits the dinner.");
  });

  it("still asks when trimming to one text cuts the advisor's own offer", async () => {
    const long = Array.from({ length: 12 }, (_, i) => `Sentence ${i + 1} about the wine and the dinner by the sea.`).join(" ");
    answers.alden = [`${long} The jacket is Martine's call; want me to bring her in?\n[[suggest:martini]]`];
    const [reply] = await send(QUESTION);
    expect(reply.endsWith("\nWant me to bring in Martine?")).toBe(true);
    expect(fitsAnswerCap(reply)).toBe(true);
  });

  it("works for a routed first question too, and the welcome no longer says to pick first", async () => {
    const fresh = new MemorySmsStore();
    const d = { ...deps(), store: fresh, route: async () => "alden" };
    answers.alden = [SUGGESTING];
    await processSms({ from: "+15550001111", body: "START", media: [], messageSid: "SMfresh1" }, d);
    const replies = await processSms({ from: "+15550001111", body: QUESTION, media: [], messageSid: "SMfresh2" }, d);
    expect(replies[0].startsWith("Alden: I'm Alden, wine & spirits at Cinq.")).toBe(true);
    expect(replies.at(-1)!.endsWith(SUGGESTED)).toBe(true);
    expect(WELCOME_TEXT).not.toContain("Pick any advisor");
  });
});
