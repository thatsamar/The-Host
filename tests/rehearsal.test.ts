/**
 * Non-sending rehearsal of the full SMS journey, mirroring the real-phone
 * sequence: START, advisor selection, questions + follow-ups, a photo,
 * advisor switching, STOP, HELP, failed answers, and duplicate webhooks.
 * Nothing here touches the network or Twilio: ask and media download are
 * stubbed, and replies are asserted, never sent.
 *
 * Persistence across restarts is rehearsed with a file-backed store that
 * implements the same SmsStore interface as the Supabase store: midway
 * through the journey the store instance is replaced (simulating a fresh
 * process) and the conversation must continue from the file, not memory.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_TEXT,
  HELP_TEXT,
  OPT_OUT_TEXT,
  WELCOME_TEXT,
  processSms,
  type SmsInbound,
} from "../src/lib/sms/handler";
import {
  MemorySmsStore,
  type SmsSession,
  type SmsStore,
} from "../src/lib/sms/store";
import type { SmsTurn } from "../src/lib/sms/store";

const FROM = "+15550009999";
let sidCounter = 0;
const sids: string[] = [];

function inbound(body: string, extra: Partial<SmsInbound> = {}): SmsInbound {
  sidCounter += 1;
  const sid = `SMrehearsal${sidCounter}`;
  sids.push(sid);
  return { from: FROM, body, media: [], messageSid: sid, ...extra };
}

function duplicateOf(index: number, body: string): SmsInbound {
  return { from: FROM, body, media: [], messageSid: sids[index] };
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

async function downloadMedia() {
  return { data: "aGVsbG8=", mediaType: "image/jpeg" };
}

/** Minimal persistent store on a JSON file, same interface as Supabase. */
class FileSmsStore implements SmsStore {
  private data: { sessions: Record<string, SmsSession>; sids: Record<string, string> };

  constructor(private filePath: string) {
    this.data = fs.existsSync(filePath)
      ? JSON.parse(fs.readFileSync(filePath, "utf-8"))
      : { sessions: {}, sids: {} };
  }

  private flush() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data));
  }

  async getSession(phone: string): Promise<SmsSession | null> {
    const s = this.data.sessions[phone];
    return s ? JSON.parse(JSON.stringify(s)) : null;
  }

  async saveSession(session: SmsSession): Promise<void> {
    this.data.sessions[session.phone] = JSON.parse(JSON.stringify(session));
    this.flush();
  }

  async claimMessageSid(sid: string, phone: string): Promise<boolean> {
    if (this.data.sids[sid]) return false;
    this.data.sids[sid] = phone;
    this.flush();
    return true;
  }
}

describe("SMS rehearsal: full journey with a restart", () => {
  it("START, questions, photo, switching, STOP, HELP, failures, duplicates", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sms-rehearsal-"));
    const filePath = path.join(dir, "store.json");
    let store: SmsStore = new FileSmsStore(filePath);
    const ask = makeAsk();
    const deps = () => ({ store, ask: ask.ask, downloadMedia });

    // START -> welcome with all five advisors and disclosures.
    expect(await processSms(inbound("START"), deps())).toEqual([WELCOME_TEXT]);
    expect(WELCOME_TEXT).toContain("Message frequency varies with your usage");
    expect(WELCOME_TEXT).toContain("Message and data rates may apply");
    expect(WELCOME_TEXT).toContain("STOP");
    expect(WELCOME_TEXT).toContain("HELP");

    // Advisor selection by number.
    expect(await processSms(inbound("1"), deps())).toEqual([
      "You're with Amar (travel). Send your question as a text or a photo.",
    ]);

    // Question to Amar, then a follow-up that keeps context.
    ask.setAnswer("Marfa answer one.");
    expect(await processSms(inbound("Plan a weekend in Marfa"), deps())).toEqual([
      "Marfa answer one.",
    ]);
    expect(ask.calls[0]).toEqual({
      advisorId: "tony",
      turns: [{ role: "user", text: "Plan a weekend in Marfa", images: undefined }],
    });
    ask.setAnswer("Marfa answer two.");
    expect(await processSms(inbound("Add a second day"), deps())).toEqual([
      "Marfa answer two.",
    ]);
    expect(ask.calls[1].turns).toEqual([
      { role: "user", text: "Plan a weekend in Marfa", images: undefined },
      { role: "assistant", text: "Marfa answer one." },
      { role: "user", text: "Add a second day", images: undefined },
    ]);

    // Photo question to Amar.
    ask.setAnswer("Photo answer.");
    const photoReplies = await processSms(
      inbound("Is this hotel area good?", {
        media: [{ url: "https://example.invalid/photo.jpg", contentType: "image/jpeg" }],
      }),
      deps(),
    );
    expect(photoReplies).toEqual(["Photo answer."]);
    const photoTurn = ask.calls[2].turns[ask.calls[2].turns.length - 1];
    expect(photoTurn.images).toEqual([
      { data: "aGVsbG8=", mediaType: "image/jpeg" },
    ]);

    // ---- Simulated restart: fresh store instance, same file. ----
    store = new FileSmsStore(filePath);

    // Advisor switch: Martine starts with NO Amar history.
    expect(await processSms(inbound("Martine"), deps())).toEqual([
      "You're with Martine (style). Send your question as a text or a photo.",
    ]);
    ask.setAnswer("Style answer.");
    expect(await processSms(inbound("What should I wear to dinner?"), deps())).toEqual([
      "Style answer.",
    ]);
    expect(ask.calls[3]).toEqual({
      advisorId: "martini",
      turns: [{ role: "user", text: "What should I wear to dinner?", images: undefined }],
    });

    // Switch back to Amar: Amar's own history resumes, Martine's absent.
    expect(await processSms(inbound("1"), deps())).toEqual([
      "You're with Amar (travel). Send your question as a text or a photo.",
    ]);
    ask.setAnswer("Marfa answer three.");
    expect(await processSms(inbound("And hotels near there?"), deps())).toEqual([
      "Marfa answer three.",
    ]);
    expect(ask.calls[4].turns).toEqual([
      { role: "user", text: "Plan a weekend in Marfa", images: undefined },
      { role: "assistant", text: "Marfa answer one." },
      { role: "user", text: "Add a second day", images: undefined },
      { role: "assistant", text: "Marfa answer two." },
      {
        role: "user",
        text: "Is this hotel area good?",
        images: [{ data: "aGVsbG8=", mediaType: "image/jpeg" }],
      },
      { role: "assistant", text: "Photo answer." },
      { role: "user", text: "And hotels near there?", images: undefined },
    ]);

    // Long answer splits at 1500 chars.
    ask.setAnswer("z".repeat(1600));
    const split = await processSms(inbound("Tell me everything"), deps());
    expect(split).toHaveLength(2);
    expect(split.every((part) => part.length <= 1500)).toBe(true);

    // STOP blocks further advisor replies; HELP still answers.
    expect(await processSms(inbound("STOP"), deps())).toEqual([OPT_OUT_TEXT]);
    expect(await processSms(inbound("Are you there?"), deps())).toEqual([]);
    expect(await processSms(inbound("Hello?"), deps())).toEqual([]);
    expect(await processSms(inbound("HELP"), deps())).toEqual([HELP_TEXT]);

    // Re-START welcomes again; a fresh advisor starts with empty history.
    expect(await processSms(inbound("START"), deps())).toEqual([WELCOME_TEXT]);
    expect(await processSms(inbound("Gio"), deps())).toEqual([
      "You're with Gio (design). Send your question as a text or a photo.",
    ]);

    // Failed answer: fallback reply, session untouched, retry starts clean.
    ask.failOnce();
    expect(await processSms(inbound("Sofa question"), deps())).toEqual([FALLBACK_TEXT]);
    ask.setAnswer("Sofa answer.");
    expect(await processSms(inbound("Try again"), deps())).toEqual(["Sofa answer."]);
    const lastCall = ask.calls[ask.calls.length - 1];
    expect(lastCall.turns).toEqual([
      { role: "user", text: "Try again", images: undefined },
    ]);

    // Duplicate webhook delivery of the first Amar question: silence, no
    // state change, no second ask call.
    const callsBefore = ask.calls.length;
    expect(await processSms(duplicateOf(2, "Plan a weekend in Marfa"), deps())).toEqual([]);
    expect(ask.calls).toHaveLength(callsBefore);

    // Observed behavior (noted for the report): after STOP + START, picking
    // Amar again resumes Amar's pre-STOP history.
    expect(await processSms(inbound("1"), deps())).toEqual([
      "You're with Amar (travel). Send your question as a text or a photo.",
    ]);
    ask.setAnswer("Resumed answer.");
    await processSms(inbound("Continue Marfa planning"), deps());
    const resumed = ask.calls[ask.calls.length - 1];
    expect(resumed.advisorId).toBe("tony");
    expect(resumed.turns[0]).toEqual({
      role: "user",
      text: "Plan a weekend in Marfa",
      images: undefined,
    });
  });

  it("memory store loses state on a fresh instance (why production needs Supabase)", async () => {
    const storeA = new MemorySmsStore();
    const ask = makeAsk();
    await processSms(inbound("START"), { store: storeA, ask: ask.ask, downloadMedia });
    await processSms(inbound("1"), { store: storeA, ask: ask.ask, downloadMedia });
    const storeB = new MemorySmsStore();
    const session = await storeB.getSession(FROM);
    expect(session).toBeNull();
  });
});
