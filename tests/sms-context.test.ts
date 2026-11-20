import { beforeEach, describe, expect, it } from "vitest";
import { CONTEXT_WINDOW_MS, recentTurns } from "../src/lib/sms/context";
import { HANDOFF_NOTE_PREFIX, handoffNote, textChannelNotes } from "../src/lib/sms/handoff";
import { processSms, type SmsInbound } from "../src/lib/sms/handler";
import { MemorySmsStore, type SmsTurn } from "../src/lib/sms/store";

const HOUR = 60 * 60 * 1000;

describe("the one-day window", () => {
  const now = Date.UTC(2026, 10, 14, 20);

  it("is 24 hours, as a named constant", () => {
    expect(CONTEXT_WINDOW_MS).toBe(24 * HOUR);
  });

  it("sends today's turns and leaves out older ones and ones stored with no time", () => {
    const turns: SmsTurn[] = [
      { role: "user", text: "Which suitcase for Lisbon?" },
      { role: "assistant", text: "The carry-on." },
      { role: "user", text: "Dinner last night?", at: now - 25 * HOUR },
      { role: "assistant", text: "Try Prado.", at: now - 25 * HOUR },
      { role: "user", text: "And this morning?", at: now - 2 * HOUR },
      { role: "assistant", text: "Coffee at Fábrica.", at: now - 2 * HOUR },
    ];
    expect(recentTurns(turns, now)).toEqual([
      { role: "user", text: "And this morning?" },
      { role: "assistant", text: "Coffee at Fábrica." },
    ]);
    // Exactly at the edge still counts.
    expect(recentTurns([{ role: "user", text: "Edge", at: now - CONTEXT_WINDOW_MS }], now)).toEqual([{ role: "user", text: "Edge" }]);
  });

  it("keeps a handoff note whatever its age, but an old one names only who brought the advisor in", () => {
    const fresh = { ...handoffNote({ from: "alden", answer: "Go with the navy jacket." }), at: now - HOUR };
    const old = { ...fresh, at: now - 30 * HOUR };
    expect(recentTurns([fresh], now)[0].text).toContain("Go with the navy jacket.");
    expect(recentTurns([old], now)).toEqual([{ role: "user", text: `${HANDOFF_NOTE_PREFIX} Alden brought you in earlier, more than a day ago.` }]);
    // A note stored before notes carried their own fields or a time.
    const legacy: SmsTurn = { role: "user", text: `${HANDOFF_NOTE_PREFIX} Gio (homes and interiors) brought you in for the question that follows. Gio's answer to it was:\n\nThe big lamp.` };
    expect(recentTurns([legacy], now)).toEqual([{ role: "user", text: `${HANDOFF_NOTE_PREFIX} Gio brought you in earlier, more than a day ago.` }]);
  });

  it("is explained to the advisor, with the advisors the person has met", () => {
    const notes = textChannelNotes("martini", undefined, ["tony", "alden"]).body;
    expect(notes).toMatch(/Only the last day of this conversation is shown to you/);
    expect(notes).toContain("This person has met these Cinq advisors before: Amar, Alden.");
    expect(textChannelNotes("martini").body).not.toContain("has met these");
  });
});

describe("the one-day window in the conversation", () => {
  const FROM = "+15551234567";
  let sid = 0;
  const inbound = (body: string, extra: Partial<SmsInbound> = {}): SmsInbound => ({ from: FROM, body, media: [], messageSid: `SMday${++sid}`, ...extra });
  let store: MemorySmsStore;
  let clock: number;
  let calls: { advisorId: string; turns: SmsTurn[]; context?: unknown }[];
  let answers: Record<string, string[]>;
  const deps = () => ({
    store,
    now: () => clock,
    ask: async (advisorId: string, turns: SmsTurn[], context?: unknown) => {
      calls.push({ advisorId, turns: JSON.parse(JSON.stringify(turns)), context });
      return answers[advisorId]?.shift() ?? `${advisorId} answers.`;
    },
  });
  const send = (body: string) => processSms(inbound(body), deps());

  beforeEach(async () => {
    store = new MemorySmsStore();
    clock = Date.UTC(2026, 10, 13, 9);
    calls = [];
    answers = {};
    await send("START");
    await send("1");
  });

  it("starts a new day fresh on specifics, stores only the last day, and remembers who the person has met", async () => {
    await send("Which suitcase for a week in Lisbon?");
    clock += 2 * HOUR;
    await send("And for the flight?");
    // Two hours later, the same day: the earlier question and answer are still sent.
    expect(calls.at(-1)!.turns.map((t) => t.text)).toEqual(["Which suitcase for a week in Lisbon?", "tony answers.", "And for the flight?"]);

    clock += 26 * HOUR;
    await send("Where should we eat tonight?");
    expect(calls.at(-1)!.turns).toEqual([{ role: "user", text: "Where should we eat tonight?" }]);
    // Turns no advisor will see again are not kept: the row stays small (compact.ts).
    const stored = (await store.getSession(FROM))!.turnsByAdvisor.tony!;
    expect(stored.map((t) => t.text)).toEqual(["Where should we eat tonight?", "tony answers."]);
    expect(stored.every((t) => typeof t.at === "number")).toBe(true);
    // And the same advisor carries on: label, no introduction.
    expect(await send("A bar after?")).toEqual(["Amar: tony answers."]);
  });

  it("still works when the person brings an old specific up again in a new message", async () => {
    await send("Which suitcase for a week in Lisbon?");
    clock += 30 * HOUR;
    answers.tony = ["The 40-litre carry-on still works for four days."];
    expect(await send("About that suitcase for Lisbon: is it still right if I go for four days?")).toEqual([
      "Amar: The 40-litre carry-on still works for four days.",
    ]);
    // The advisor saw the specific because it is in the new message, not from yesterday.
    expect(calls.at(-1)!.turns).toEqual([{ role: "user", text: "About that suitcase for Lisbon: is it still right if I go for four days?" }]);
  });

  it("gives existing sessions, whose turns have no time, a one-time fresh start", async () => {
    const session = (await store.getSession(FROM))!;
    session.turnsByAdvisor.tony = [
      { role: "user", text: "Old question from before times were kept" },
      { role: "assistant", text: "Old answer" },
    ];
    await store.saveSession(session);
    await send("New question");
    expect(calls.at(-1)!.turns).toEqual([{ role: "user", text: "New question" }]);
    // The old turns go at the next save; the advisor still counts as met.
    const saved = (await store.getSession(FROM))!;
    expect(saved.turnsByAdvisor.tony!.map((t) => t.text)).toEqual(["New question", "tony answers."]);
    expect(saved.introduced).toContain("tony");
  });
});
