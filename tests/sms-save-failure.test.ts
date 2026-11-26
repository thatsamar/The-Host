import { describe, expect, it } from "vitest";
import { ACK_TEXTS, FALLBACK_TEXT, WELCOME_TEXT, processSms, type SmsDeps, type SmsInbound } from "../src/lib/sms/handler";
import { compactSession } from "../src/lib/sms/compact";
import { CONTEXT_WINDOW_MS } from "../src/lib/sms/context";
import { HANDOFF_NOTE_PREFIX } from "../src/lib/sms/handoff";
import { MemorySmsStore, type SmsSession, type SmsTurn } from "../src/lib/sms/store";
import { SMS_MAX_SEGMENTS, smsSegments } from "../src/lib/sms/segments";

// A Supabase 500 on the sms_sessions upsert, as the store reports it.
function supabase500(): Error {
  const err = new Error("sms_store_save_failed");
  err.name = "SmsStoreSaveError";
  return err;
}

/** The memory store, with saves that fail on demand and leave the stored row untouched. */
class FlakyStore extends MemorySmsStore {
  failSaves = false;
  saves = 0;
  async saveSession(session: SmsSession): Promise<void> {
    if (this.failSaves) throw supabase500();
    this.saves += 1;
    return super.saveSession(session);
  }
}

const HOUR = 60 * 60 * 1000;
const PHOTO = { data: "cGhvdG8=", mediaType: "image/jpeg" };
let sid = 0;
let phones = 0;

/** A number with Gio picked and saves working, ready for a failing turn. */
async function setup(opts: { answers?: string[]; failAsk?: () => boolean } = {}) {
  const store = new FlakyStore();
  const phone = `+1555900${String(++phones).padStart(4, "0")}`;
  const acks: string[] = [];
  const saveErrors: unknown[] = [];
  const asked: SmsTurn[][] = [];
  const answers = opts.answers ?? [];
  let clock = Date.UTC(2026, 10, 20, 3);
  const deps: SmsDeps = {
    store,
    now: () => clock,
    ask: async (_advisorId, turns) => {
      asked.push(JSON.parse(JSON.stringify(turns)));
      if (opts.failAsk?.()) throw new Error("ask_error");
      return answers.shift() ?? "Go for a low linen sofa in oat.";
    },
    downloadMedia: async () => PHOTO,
    acknowledge: (text) => {
      acks.push(text);
    },
    onSaveError: (err) => saveErrors.push(err),
  };
  const send = (body: string, extra: Partial<SmsInbound> = {}) =>
    processSms({ from: phone, body, media: [], messageSid: `SMsave${++sid}`, ...extra }, deps);
  await send("START");
  await send("3");
  return { store, phone, acks, saveErrors, asked, send, deps, tick: (ms: number) => (clock += ms) };
}

const withinCap = (reply: string) => smsSegments(reply) <= SMS_MAX_SEGMENTS;

describe("a failed session save never silences an answer", () => {
  it("still sends the complete, labelled answer within the cap when the sms_sessions save returns 500", async () => {
    const t = await setup();
    t.store.failSaves = true;
    const replies = await t.send("What sofa for a small living room?");
    expect(replies).toEqual(["Gio: Go for a low linen sofa in oat."]);
    expect(replies.every(withinCap)).toBe(true);
    expect(t.acks).toEqual([ACK_TEXTS[0]]);
    expect(t.saveErrors).toHaveLength(1);
    expect((t.saveErrors[0] as Error).name).toBe("SmsStoreSaveError");
  });

  it("still sends the fallback when the answer fails and the ack-rotation save fails too", async () => {
    const t = await setup({ failAsk: () => true });
    t.store.failSaves = true;
    expect(await t.send("What sofa for a small living room?")).toEqual([FALLBACK_TEXT]);
    expect(t.acks).toEqual([ACK_TEXTS[0]]);
    expect(t.saveErrors).toHaveLength(1);
  });

  it("answers the shapes that failed on Nov 19 (a Yes to a handoff, a Hello follow-up) while saves fail", async () => {
    const t = await setup({ answers: ["A rug anchors it.\n[[suggest:martini]]", "Martine here: wear the navy.", "Hello again: what next?"] });
    const offered = await t.send("What rug for the bedroom?");
    expect(offered[0]).toMatch(/^Gio: A rug anchors it\./);
    expect(offered[0]).toMatch(/Want me to bring in Martine\?$/);
    t.store.failSaves = true;
    const handed = await t.send("Yes");
    expect(handed).toHaveLength(1);
    expect(handed[0]).toMatch(/^Martine: /);
    expect(handed[0]).toContain("wear the navy.");
    expect(handed.every(withinCap)).toBe(true);
    // The handoff wasn't stored, so the number is still with Gio, who answers the hello.
    expect(await t.send("Hello")).toEqual(["Gio: Hello again: what next?"]);
  });

  it("varies the ack across consecutive turns whose saves fail, and neither turn is silent", async () => {
    const t = await setup();
    t.store.failSaves = true;
    expect(await t.send("First question?")).toEqual(["Gio: Go for a low linen sofa in oat."]);
    expect(await t.send("Second question?")).toEqual(["Gio: Go for a low linen sofa in oat."]);
    expect(t.acks).toHaveLength(2);
    expect(t.acks[0]).not.toBe(t.acks[1]);
    // Once saves work again, the rotation carries on from the line last sent.
    t.store.failSaves = false;
    await t.send("Third question?");
    expect(t.acks).toEqual([ACK_TEXTS[0], ACK_TEXTS[1], ACK_TEXTS[2]]);
    expect((await t.store.getSession(t.phone))!.lastAck).toBe(2);
  });

  it("leaves the stored session exactly as it was after a failed save: no partial turn, no duplicate", async () => {
    const t = await setup();
    await t.send("What sofa for a small living room?");
    const before = await t.store.getSession(t.phone);
    t.store.failSaves = true;
    await t.send("And the rug?");
    expect(await t.store.getSession(t.phone)).toEqual(before);
    // The next turn simply doesn't see the unsaved one: nothing is rebuilt or replayed.
    t.store.failSaves = false;
    await t.send("And the lamp?");
    expect(t.asked.at(-1)!.map((turn) => turn.text)).toEqual([
      "What sofa for a small living room?",
      "Go for a low linen sofa in oat.",
      "And the lamp?",
    ]);
  });

  it("still drops a retried delivery of the same MessageSid after a failed save", async () => {
    const t = await setup();
    t.store.failSaves = true;
    const message = { from: t.phone, body: "What sofa?", media: [], messageSid: "SMretry1" };
    expect(await processSms(message, t.deps)).toEqual(["Gio: Go for a low linen sofa in oat."]);
    expect(await processSms(message, t.deps)).toEqual([]);
    expect(t.asked).toHaveLength(1);
  });

  it("still persists history as before when the save succeeds", async () => {
    const t = await setup();
    await t.send("What sofa for a small living room?");
    const saved = (await t.store.getSession(t.phone))!;
    expect(saved.advisorId).toBe("gio");
    expect(saved.turnsByAdvisor.gio!.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: "user", text: "What sofa for a small living room?" },
      { role: "assistant", text: "Go for a low linen sofa in oat." },
    ]);
    expect(saved.turnsByAdvisor.gio!.every((turn) => typeof turn.at === "number")).toBe(true);
    expect(saved.lastAck).toBe(0);
    expect(t.saveErrors).toEqual([]);
  });

  it("still sends the welcome and a pick's confirmation when their saves fail", async () => {
    const store = new FlakyStore();
    store.failSaves = true;
    const deps: SmsDeps = { store, ask: async () => "unused", onSaveError: () => {} };
    expect(await processSms({ from: "+15559990001", body: "START", media: [], messageSid: "SMw1" }, deps)).toEqual([WELCOME_TEXT]);
    const pick = await processSms({ from: "+15559990001", body: "3", media: [], messageSid: "SMw2" }, deps);
    expect(pick.at(-1)).toBe("Gio: I'm Gio, design at Cinq. What's on your mind?");
  });

  it("never lets a throwing error reporter cost the reply", async () => {
    const t = await setup();
    t.deps.onSaveError = () => {
      throw new Error("reporter broke");
    };
    t.store.failSaves = true;
    expect(await t.send("What sofa?")).toEqual(["Gio: Go for a low linen sofa in oat."]);
  });
});

describe("the stored session stays small (compact.ts)", () => {
  it("keeps photos only on the current advisor's latest question, and never leaves a turn empty", async () => {
    const t = await setup();
    const photo = { media: [{ url: "https://media/1", contentType: "image/jpeg" }] };
    await t.send("", photo);
    await t.send("What colour for this wall?", photo);
    const gio = (await t.store.getSession(t.phone))!.turnsByAdvisor.gio!;
    expect(gio.map((turn) => [turn.text, turn.images?.length ?? 0])).toEqual([
      ["(Sent a photo earlier.)", 0],
      ["Go for a low linen sofa in oat.", 0],
      ["What colour for this wall?", 1],
      ["Go for a low linen sofa in oat.", 0],
    ]);
    // A follow-up still has the latest photo.
    await t.send("And the trim?");
    expect(t.asked.at(-1)!.find((turn) => turn.text === "What colour for this wall?")?.images).toEqual([PHOTO]);
  });

  it("drops turns older than a day, keeps a handoff note in its shortened form, and remembers met advisors", () => {
    const now = Date.UTC(2026, 10, 20, 3);
    const old = now - CONTEXT_WINDOW_MS - HOUR;
    const session: SmsSession = {
      phone: "+15550000000",
      optedIn: true,
      advisorId: "martini",
      lastAck: 1,
      turnsByAdvisor: {
        tony: [
          { role: "user", text: "Lisbon?", at: old, images: [PHOTO] },
          { role: "assistant", text: "Alfama.", at: old },
        ],
        martini: [
          { role: "user", text: `${HANDOFF_NOTE_PREFIX} Gio brought you in. Gio said: a rug.`, note: "handoff", from: "gio", at: old },
          { role: "user", text: "Undated, from before turns had times" },
          { role: "user", text: "Navy or black?", at: now - HOUR, images: [PHOTO, PHOTO] },
          { role: "assistant", text: "Navy.", at: now - HOUR },
        ],
      },
    };
    const compact = compactSession(session, now);
    expect(compact.turnsByAdvisor.tony).toBeUndefined();
    expect(compact.introduced).toEqual(expect.arrayContaining(["tony", "martini"]));
    expect(compact.turnsByAdvisor.martini!.map((turn) => turn.text)).toEqual([
      `${HANDOFF_NOTE_PREFIX} Gio brought you in earlier, more than a day ago.`,
      "Navy or black?",
      "Navy.",
    ]);
    expect(compact.turnsByAdvisor.martini![1].images).toHaveLength(2);
    expect(compact.lastAck).toBe(1);
    // The session itself is untouched.
    expect(session.turnsByAdvisor.tony).toHaveLength(2);
  });

  it("strips photos from another advisor's turns once the number has moved on", () => {
    const now = Date.UTC(2026, 10, 20, 3);
    const session: SmsSession = {
      phone: "+15550000000",
      optedIn: true,
      advisorId: "gio",
      turnsByAdvisor: { martini: [{ role: "user", text: "", at: now, images: [PHOTO, PHOTO, PHOTO] }] },
    };
    expect(compactSession(session, now).turnsByAdvisor.martini).toEqual([{ role: "user", text: "(Sent 3 photos earlier.)", at: now }]);
  });
});
