import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { PGlite } from "@electric-sql/pglite";
import { createChannel } from "@/lib/channel/service";
import { FixtureAdapter, FIXTURE_LABEL, fixtureEngine } from "@/lib/channel/fixture";
import { MemoryStore } from "@/lib/channel/memory-store";
import { PostgresStore } from "@/lib/channel/postgres-store";
import { retention, RETRY_BACKOFF_MS, MAX_SEND_ATTEMPTS } from "@/lib/channel/retention";
import * as copy from "@/lib/channel/copy";
import type { AskTurn } from "@/lib/ask/prompt";
import type { ChannelStore, Engine, EngineResult, InboundEvent, InboundPayload, ProviderLimits, SupportResult } from "@/lib/channel/types";
import type { CompanionId } from "@/lib/companions/types";

// Starting Postgres in-process is slow under a full parallel run.
vi.setConfig({ testTimeout: 30_000 });

// A real 40 x 30 PNG, made by the same image library the server uses.
const PNG = new Uint8Array(await sharp({ create: { width: 40, height: 30, channels: 3, background: "#3366aa" } }).png().toBuffer());
const HEIC_PHOTO = new Uint8Array(readFileSync(new URL("./fixtures/iphone-photo.heic", import.meta.url)));

let logged: string[] = [];
beforeEach(() => {
  logged = [];
  for (const level of ["error", "info", "warn", "log"] as const)
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

/** An engine that records what each advisor was given and answers from a script. */
function scripted(reply: (advisor: CompanionId, turns: AskTurn[]) => EngineResult | Promise<EngineResult> = (a) => ({ text: `Answer from ${a}.` })) {
  const calls: { advisor: CompanionId; turns: AskTurn[] }[] = [];
  const engine: Engine = {
    async answer(advisor, turns) {
      calls.push({ advisor, turns: structuredClone(turns) });
      return reply(advisor, turns);
    },
  };
  return { engine, calls };
}

const NOTICES = ["tony", "martini", "gio", "alden", "goldie"].map((id) => copy.firstAnswerNotice(id as CompanionId));

function setup(opts: { engine?: Engine; store?: ChannelStore; limits?: ProviderLimits; support?: SupportResult; questionsPerHour?: number; answerTimeoutMs?: number; cancelPollMs?: number } = {}) {
  const clock = { t: 1_000_000_000 };
  const adapter = new FixtureAdapter({ secret: "test-secret", limits: opts.limits, support: opts.support });
  const store = opts.store ?? new MemoryStore(retention("24"));
  const engine = opts.engine ?? scripted().engine;
  const channel = createChannel({ adapter, store, engine, now: () => clock.t, questionsPerHour: opts.questionsPerHour ?? 100, answerTimeoutMs: opts.answerTimeoutMs, cancelPollMs: opts.cancelPollMs });
  let n = 0;
  const event = (payload: InboundPayload, extra: Partial<InboundEvent> = {}): InboundEvent => ({
    id: `ev-${++n}`,
    conversationId: "conv-1",
    sentAt: clock.t + n,
    payload,
    ...extra,
  });
  const say = (text: string, extra: Partial<Extract<InboundPayload, { kind: "message" }>> = {}, event_: Partial<InboundEvent> = {}) =>
    event({ kind: "message", text, attachments: [], ...extra }, event_);
  async function post(...events: InboundEvent[]) {
    const rawBody = JSON.stringify({ events });
    const res = await channel.handleWebhook({ headers: new Headers({ "x-fixture-signature": adapter.sign(rawBody) }), rawBody });
    await res.background;
    return res.status;
  }
  const texts = () => adapter.sent.map((s) => (s.message.kind === "text" ? s.message.text : `[picker: ${s.message.options.map((o) => o.title).join(", ")}]`));
  /** Everything sent except the automated-service notice that opens a conversation started with a named advisor. */
  const answers = () => texts().filter((x) => !NOTICES.includes(x));
  return { clock, adapter, store, channel, event, say, post, texts, answers };
}

describe("choosing an advisor", () => {
  it("welcomes once with a picker, keeps the first question, and the advisor says who they are", async () => {
    const { engine, calls } = scripted();
    const t = setup({ engine });
    await t.post(t.say("One night in Bangkok"));
    expect(t.texts()).toEqual([copy.welcome(true), "[picker: Amar, Martine, Gio, Alden, Goldie]"]);
    expect(calls).toHaveLength(0);
    await t.post(t.say("", { selection: "tony" }));
    expect(calls).toEqual([{ advisor: "tony", turns: [{ role: "user", text: "One night in Bangkok" }] }]);
    expect(t.texts().at(-1)).toBe("Amar · Travel\n\nAnswer from tony.");
    await t.post(t.say("And breakfast?"));
    expect(t.texts().at(-1)).toBe("Answer from tony.");
  });

  it("sends a named request straight to that advisor", async () => {
    const { engine, calls } = scripted();
    const t = setup({ engine });
    await t.post(t.say("Amar: one night in Bangkok"));
    expect(calls[0]).toMatchObject({ advisor: "tony", turns: [{ text: "one night in Bangkok" }] });
    // The automated service says so at once (Apple's five seconds); then the answer.
    expect(t.texts()).toEqual([copy.firstAnswerNotice("tony"), "Amar · Travel\n\nAnswer from tony."]);
    expect(copy.firstAnswerNotice("tony")).toMatch(/automated service.*AI advisors.*Type agent anytime to reach a person/);
  });

  it("keeps each advisor's conversation to that advisor", async () => {
    const { engine, calls } = scripted();
    const t = setup({ engine });
    await t.post(t.say("Amar: my partner and I, one night in Bangkok"));
    await t.post(t.say("Martine: what should I wear to dinner?"));
    // Martine starts fresh: nothing of Amar's conversation reaches her.
    expect(calls[1].advisor).toBe("martini");
    expect(calls[1].turns).toEqual([{ role: "user", text: "what should I wear to dinner?" }]);
    expect(JSON.stringify(calls[1].turns)).not.toMatch(/Bangkok|partner/);
    await t.post(t.say("Amar"));
    expect(t.texts().at(-1)).toMatch(/^Back with Amar · Travel/);
    await t.post(t.say("Which bar after?"));
    expect(calls[2].advisor).toBe("tony");
    expect(calls[2].turns.map((x) => x.text)).toEqual(["my partner and I, one night in Bangkok", "Answer from tony.", "Which bar after?"]);
  });

  it("opens the picker on 'advisors' and runs the real engine path for each of the five", async () => {
    const engine = fixtureEngine();
    const t = setup({ engine });
    await t.post(t.say("advisors"));
    expect(t.texts()).toEqual(["[picker: Amar, Martine, Gio, Alden, Goldie]"]);
    for (const id of ["tony", "martini", "gio", "alden", "goldie"]) await t.post(t.say("", { selection: id }), t.say("Hello"));
    expect(engine.calls.map((c) => c.advisor)).toEqual(["tony", "martini", "gio", "alden", "goldie"]);
    expect(t.texts().filter((x) => x.includes(FIXTURE_LABEL))).toHaveLength(5);
  });
});

describe("delivery guarantees", () => {
  it("answers a redelivered webhook once", async () => {
    const { engine, calls } = scripted();
    const t = setup({ engine });
    const e = t.say("Amar: Lisbon in March?");
    await t.post(e);
    await t.post(e);
    await Promise.all([t.post(e), t.post(e)]);
    expect(calls).toHaveLength(1);
    expect(t.answers()).toHaveLength(1);
    expect(t.adapter.sent).toHaveLength(2);
  });

  it("handles a conversation's events in the order they were sent", async () => {
    const { engine, calls } = scripted();
    const t = setup({ engine });
    const first = t.say("Amar: first", {}, { sentAt: 10 });
    const second = t.say("second", {}, { sentAt: 20 });
    await t.post(second, first);
    expect(calls.map((c) => c.turns.at(-1)!.text)).toEqual(["first", "second"]);
  });

  it("retries a failed send on schedule, in order, without duplicates", async () => {
    const t = setup({ limits: { maxTextChars: 60, preferredTextChars: 60 }, engine: scripted(() => ({ text: "First paragraph is here.\n\nSecond paragraph is here.\n\nThird." })).engine });
    await t.post(t.say("menu"));
    t.adapter.sendResults.push({ ok: false, retryable: true, code: "timeout" });
    await t.post(t.say("Gio: a sofa?"));
    expect(t.answers()).toHaveLength(1);
    t.clock.t += RETRY_BACKOFF_MS[0] - 1;
    await t.channel.runDue();
    expect(t.answers()).toHaveLength(1);
    t.clock.t += 1;
    await t.channel.runDue();
    await t.channel.runDue();
    expect(t.answers().slice(1)).toEqual(["Gio · Design\n\nFirst paragraph is here.", "Second paragraph is here.\n\nThird."]);
    expect(new Set(t.adapter.sent.map((s) => s.key)).size).toBe(t.adapter.sent.length);
  });

  it("abandons a reply after the last retry, or at once when it can never succeed", async () => {
    const t = setup();
    await t.post(t.say("Gio"));
    const before = t.adapter.sent.length;
    for (let i = 0; i < MAX_SEND_ATTEMPTS; i++) t.adapter.sendResults.push({ ok: false, retryable: true, code: "unavailable" });
    await t.post(t.say("A sofa?"));
    for (const wait of RETRY_BACKOFF_MS) {
      t.clock.t += wait;
      await t.channel.runDue();
    }
    t.clock.t += 60 * 60_000;
    await t.channel.runDue();
    expect(t.adapter.sent).toHaveLength(before);
    expect(logged.some((l) => l.includes("send abandoned"))).toBe(true);

    t.adapter.sendResults.push({ ok: false, retryable: false, code: "rejected" });
    await t.post(t.say("And a rug?"));
    expect(t.adapter.sent).toHaveLength(before);
    await t.post(t.say("And a lamp?"));
    expect(t.adapter.sent).toHaveLength(before + 1);
  });

  it("after a restart, tells the person an interrupted answer stopped instead of asking the model again", async () => {
    const db = new PGlite();
    const r = retention("24");
    const store = new PostgresStore(db, r);
    await store.migrate();
    let finishLate!: (r: EngineResult) => void;
    const hanging = scripted(() => new Promise<EngineResult>((resolve) => (finishLate = resolve)));
    const a = setup({ store, engine: hanging.engine, answerTimeoutMs: 60_000 });
    const e = a.say("Amar: one night in Bangkok");
    const rawBody = JSON.stringify({ events: [e] });
    // The first worker takes the event and dies mid-answer (its work is never awaited).
    void a.channel.handleWebhook({ headers: new Headers({ "x-fixture-signature": a.adapter.sign(rawBody) }), rawBody });
    await vi.waitFor(() => expect(hanging.calls).toHaveLength(1));

    const fresh = scripted();
    const b = setup({ store: new PostgresStore(db, r), engine: fresh.engine, answerTimeoutMs: 60_000 });
    b.clock.t = a.clock.t + 10 * 60_000;
    await b.channel.runDue();
    expect(fresh.calls).toHaveLength(0);
    expect(b.texts()).toEqual([copy.INTERRUPTED]);
    // A redelivery of the same webhook is still recognised.
    await b.post(e);
    expect(fresh.calls).toHaveLength(0);
    // The first worker wasn't dead after all, just stuck: its late answer is dropped, not sent as a second reply.
    finishLate({ text: "A late answer." });
    await vi.waitFor(() => expect(logged.some((l) => l.includes("answer dropped"))).toBe(true));
    expect([...a.answers(), ...b.answers()]).toEqual([copy.INTERRUPTED]);
  });
});

describe("photos", () => {
  it("downloads attachments through the provider and passes valid photos to the advisor", async () => {
    const { engine, calls } = scripted();
    const t = setup({ engine });
    t.adapter.attachments.set("att-1", PNG);
    await t.post(t.say("Gio: what's wrong with this room? https://example.com/room.jpg", { attachments: [{ ref: "att-1", mediaType: "image/jpeg" }] }));
    expect(calls[0].turns[0].images).toHaveLength(1);
    expect(calls[0].turns[0].images![0].mediaType).toBe("image/jpeg");
    expect(await sharp(Buffer.from(calls[0].turns[0].images![0].data, "base64")).metadata()).toMatchObject({ format: "jpeg", width: 40, height: 30 });
  });

  it("reads an iPhone HEIC photo, and keeps a smaller copy for follow-ups as the website does", async () => {
    const { engine, calls } = scripted();
    const t = setup({ engine });
    t.adapter.attachments.set("heic", HEIC_PHOTO);
    await t.post(t.say("Gio: what would you change here?", { attachments: [{ ref: "heic", mediaType: "image/heic" }] }));
    const sent = calls[0].turns[0].images![0];
    expect(await sharp(Buffer.from(sent.data, "base64")).metadata()).toMatchObject({ format: "jpeg", width: 1280, height: 960 });
    await t.post(t.say("And the lighting?"));
    const kept = calls[1].turns[0].images![0];
    expect(await sharp(Buffer.from(kept.data, "base64")).metadata()).toMatchObject({ format: "jpeg", width: 512, height: 384 });
  });

  it("refuses photos the website would refuse, without calling the advisor", async () => {
    const { engine, calls } = scripted();
    const t = setup({ engine });
    t.adapter.attachments.set("pdf", new TextEncoder().encode("%PDF-1.7 a document"));
    await t.post(t.say("Gio: this?", { attachments: [{ ref: "pdf", mediaType: "image/jpeg" }] }));
    expect(t.texts().at(-1)).toBe(copy.photoProblem("unsupported"));
    await t.post(t.say("this?", { attachments: [{ ref: "missing" }] }));
    expect(t.texts().at(-1)).toBe(copy.photoProblem("unreadable"));
    t.adapter.attachments.set("p", PNG);
    await t.post(t.say("these?", { attachments: Array.from({ length: 11 }, () => ({ ref: "p" })) }));
    expect(t.texts().at(-1)).toBe(copy.photoProblem("too_many"));
    expect(calls).toHaveLength(0);
  });
});

describe("when an answer fails", () => {
  it("keeps what was written, says what happened, and leaves the history clean for a resend", async () => {
    let fail = true;
    const { engine, calls } = scripted((a) => (fail ? { text: "Partial thought.", error: "Amar is busy right now. Try again in a minute." } : { text: `Answer from ${a}.` }));
    const t = setup({ engine });
    await t.post(t.say("Amar: Tokyo?"));
    expect(t.answers()).toEqual(["Amar · Travel\n\nPartial thought.", `Amar is busy right now. Try again in a minute. ${copy.RETRY_HINT}`]);
    fail = false;
    await t.post(t.say("Tokyo?"));
    expect(calls[1].turns).toEqual([{ role: "user", text: "Tokyo?" }]);
  });

  it("stops an answer at the time limit with a plain message", async () => {
    const t = setup({ engine: { answer: (_a, _t, signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve({ text: "", error: "Stopped." }))) }, answerTimeoutMs: 20 });
    await t.post(t.say("Amar: Tokyo?"));
    expect(t.answers()).toEqual([`Amar ran out of time before finishing this answer. Try again. ${copy.RETRY_HINT}`]);
  });

  it("answers a thrown engine error plainly", async () => {
    const t = setup({ engine: { answer: async () => { throw new Error("Something went wrong. Try again."); } } });
    await t.post(t.say("Amar: Tokyo?"));
    expect(t.answers()).toEqual([`Something went wrong. Try again. ${copy.RETRY_HINT}`]);
  });

  it("caps questions per conversation", async () => {
    const { engine, calls } = scripted();
    const t = setup({ engine, questionsPerHour: 1 });
    await t.post(t.say("Amar: Tokyo?"));
    await t.post(t.say("Osaka?"));
    expect(calls).toHaveLength(1);
    expect(t.texts().at(-1)).toBe(copy.TOO_MANY_QUESTIONS);
  });

  it("delivers a long answer whole, in paragraph groups within the provider's limit", async () => {
    const answer = Array.from({ length: 8 }, (_, i) => `**Stop ${i}.** ${"Detail ".repeat(30)}`).join("\n\n");
    const t = setup({ limits: { maxTextChars: 500, preferredTextChars: 450 }, engine: scripted(() => ({ text: answer })).engine });
    await t.post(t.say("Amar: plan it"));
    const parts = t.texts();
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(500);
    for (let i = 0; i < 8; i++) expect(parts.join("\n\n")).toContain(`Stop ${i}. Detail`);
  });
});

describe("reset, conversation end and expiry", () => {
  it("reset clears Cinq's context and says only what is true", async () => {
    const { engine, calls } = scripted();
    const t = setup({ engine });
    await t.post(t.say("Amar: Tokyo?"));
    await t.post(t.say("reset"));
    expect(t.texts().at(-1)).toBe(copy.RESET);
    expect(copy.RESET).not.toMatch(/deleted from Messages|Apple (has|will) (delete|forget)|disappear/i);
    await t.post(t.say("Osaka?"));
    expect(t.texts().slice(-2)).toEqual([copy.welcome(true), "[picker: Amar, Martine, Gio, Alden, Goldie]"]);
    expect(calls).toHaveLength(1);
  });

  it("a closed conversation clears the session and cancels anything not yet sent", async () => {
    const t = setup();
    t.adapter.sendResults.push({ ok: false, retryable: true, code: "timeout" });
    await t.post(t.say("Amar: Tokyo?"));
    await t.post(t.event({ kind: "conversation_end" }));
    t.clock.t += 60 * 60_000;
    await t.channel.runDue();
    expect(t.adapter.sent).toHaveLength(0);
    expect(await t.store.getSession("conv-1", t.clock.t)).toBeUndefined();
  });

  it("forgets the conversation when the context window passes", async () => {
    const { engine, calls } = scripted();
    const t = setup({ engine });
    await t.post(t.say("Amar: Tokyo?"));
    t.clock.t += 24 * 60 * 60_000;
    await t.post(t.say("And Kyoto?"));
    expect(calls).toHaveLength(1);
    expect(t.texts().slice(-2)[0]).toBe(copy.welcome(true));
  });
});

describe("human support", () => {
  it("asks the provider for a person and reports only what the provider said", async () => {
    const { engine, calls } = scripted();
    const t = setup({ engine, support: { status: "queued", estimatedWaitMinutes: 4 } });
    await t.post(t.say("Amar: Tokyo?"));
    await t.post(t.say("help"));
    expect(t.adapter.supportRequests).toEqual(["conv-1"]);
    expect(t.texts().at(-1)).toBe(copy.support({ status: "queued", estimatedWaitMinutes: 4 }));
    // The advisors stay out of it until the team hands back.
    await t.post(t.say("Is anyone there?"));
    expect(calls).toHaveLength(1);
    await t.post(t.event({ kind: "support_ended" }));
    await t.post(t.say("Kyoto?"));
    expect(calls).toHaveLength(2);
  });

  it("says plainly when no one can be reached", async () => {
    const t = setup();
    await t.post(t.say("help"));
    expect(t.texts()).toEqual(["Human support isn't connected to this chat yet, so no one has been notified."]);
    const closed = setup({ support: { status: "closed", hours: "weekdays 9am to 6pm ET" } });
    await closed.post(closed.say("help"));
    expect(closed.texts()[0]).toBe("Cinq's team isn't available right now, so no one has been notified. They're available weekdays 9am to 6pm ET. Type agent again then.");
  });
});

describe("webhooks and logs", () => {
  it("rejects an unverified webhook before reading it", async () => {
    const { engine, calls } = scripted();
    const t = setup({ engine });
    const rawBody = JSON.stringify({ events: [t.say("Amar: Tokyo?")] });
    const res = await t.channel.handleWebhook({ headers: new Headers({ "x-fixture-signature": "nope" }), rawBody });
    await res.background;
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("logs codes and counts, never what was said, photos or conversation ids", async () => {
    const t = setup({ engine: scripted(() => ({ text: "Try Sorn for the crab curry.", error: "Amar is busy right now." })).engine });
    t.adapter.attachments.set("p", PNG);
    await t.post(t.say("Amar: anniversary dinner with Priya in Bangkok", { attachments: [{ ref: "p" }] }, { conversationId: "conv-secret-77" }));
    await t.post(t.say("help", {}, { conversationId: "conv-secret-77" }));
    const all = logged.join("\n");
    expect(all).toMatch(/Messages: answer/);
    for (const secret of ["Priya", "anniversary", "Sorn", "crab", "conv-secret-77", Buffer.from(PNG).toString("base64")]) expect(all).not.toContain(secret);
  });
});

describe("reset cancels what hasn't gone out", () => {
  it("cancels the rest of a long answer still waiting to send, and confirms the reset", async () => {
    const t = setup({ limits: { maxTextChars: 30, preferredTextChars: 30 }, engine: scripted(() => ({ text: "Part one is here.\n\nPart two is here.\n\nPart three is here." })).engine });
    await t.post(t.say("Amar"));
    // The second part fails to send and waits for a retry.
    t.adapter.sendResults.push({ ok: true }, { ok: false, retryable: true, code: "timeout" });
    await t.post(t.say("Plan it"));
    expect(t.answers().filter((x) => x.includes("Part"))).toEqual(["Part one is here."]);
    await t.post(t.say("reset"));
    t.clock.t += 60 * 60_000;
    await t.channel.runDue();
    expect(t.answers().filter((x) => x.includes("Part"))).toEqual(["Part one is here."]);
    expect(t.texts().at(-1)).toBe(copy.RESET);
  });

  it("stops an answer still being written when a reset arrives, and sends none of it", async () => {
    let aborted = false;
    const engine: Engine = {
      answer: (_a, _t, signal) =>
        new Promise((resolve) =>
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve({ text: "Half an answer", error: "Stopped." });
          }),
        ),
    };
    const t = setup({ engine, cancelPollMs: 10 });
    await t.post(t.say("Amar"));
    const asking = t.post(t.say("One night in Bangkok"));
    // The reset arrives while the answer is being written; another worker records it.
    await new Promise((r) => setTimeout(r, 20));
    await t.post(t.say("reset"));
    await asking;
    expect(aborted).toBe(true);
    expect(t.texts().join("\n")).not.toContain("Half an answer");
    expect(t.texts().at(-1)).toBe(copy.RESET);
  });

  it("answers nothing that a waiting reset cancels, and clears a question kept for an advisor", async () => {
    const { engine, calls } = scripted();
    const t = setup({ engine });
    await t.post(t.say("Amar: first"), t.say("second"), t.say("reset"));
    expect(calls).toEqual([]);
    expect(t.texts()).toEqual([copy.RESET]);
    await t.post(t.say("A question before choosing"));
    await t.post(t.say("reset"));
    await t.post(t.say("Amar"));
    expect(calls).toEqual([]);
  });
});

describe("Apple's standard trigger words", () => {
  it("agent reaches a person, menu opens the picker, stop explains there's nothing to unsubscribe from", async () => {
    const t = setup({ support: { status: "queued" } });
    await t.post(t.say("menu"));
    expect(t.texts()).toEqual(["[picker: Amar, Martine, Gio, Alden, Goldie]"]);
    await t.post(t.say("stop"));
    expect(t.texts().at(-1)).toBe(copy.PREFERENCES);
    await t.post(t.say("agent"));
    expect(t.adapter.supportRequests).toHaveLength(1);
  });
});

describe("the 24-hour deletion policy, checked in the database itself", () => {
  it("leaves no message text, answer or photo in any table once the window passes, and no ids after a week", async () => {
    const db = new PGlite();
    const store = new PostgresStore(db, retention("24"));
    await store.migrate();
    const t = setup({ store, engine: scripted(() => ({ text: "Book the corner table at Sorn." })).engine });
    t.adapter.attachments.set("heic", HEIC_PHOTO);
    t.adapter.sendResults.push({ ok: true }, { ok: false, retryable: true, code: "timeout" });
    await t.post(t.say("Amar: anniversary dinner with Priya", { attachments: [{ ref: "heic" }] }, { conversationId: "opaque-123" }));
    await t.post(t.say("and dessert?", {}, { conversationId: "opaque-123" }));
    const dump = async () =>
      JSON.stringify(
        await Promise.all(["channel_inbound", "channel_sessions", "channel_outbox", "channel_locks"].map(async (table) => (await db.query(`select * from ${table}`)).rows)),
      );
    // While the conversation is live, its context is held (that is what lets it continue).
    expect(await dump()).toContain("Priya");

    t.clock.t += 24 * 60 * 60_000;
    await t.channel.runDue();
    const after = await dump();
    for (const content of ["Priya", "anniversary", "dessert", "Sorn", "corner table", "/9j/"]) expect(after).not.toContain(content);
    expect((await db.query("select * from channel_sessions")).rows).toEqual([]);

    t.clock.t += 7 * 24 * 60 * 60_000;
    await t.channel.runDue();
    expect(await dump()).not.toContain("opaque-123");
  });
});
