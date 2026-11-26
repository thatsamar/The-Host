import { beforeEach, describe, expect, it, vi } from "vitest";

// The real webhook, with Twilio, Supabase and the model stood in for: the ack
// must reach Twilio while the answer is still being written, then the answer.
const state = vi.hoisted(() => ({
  pending: [] as Promise<unknown>[],
  releaseAnswer: null as null | (() => void),
  sent: [] as string[],
  channels: [] as ({ label: string; body: string } | undefined)[],
  failSaves: false,
  senderOpts: [] as Record<string, unknown>[],
  started: [] as Record<string, unknown>[],
  finished: [] as Record<string, unknown>[],
  outbound: [] as Record<string, unknown>[],
}));

vi.mock("next/server", () => ({ after: (fn: () => Promise<unknown>) => state.pending.push(fn()) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/sms/supabase-store", async () => {
  const { MemorySmsStore } = await import("@/lib/sms/store");
  const shared = new MemorySmsStore();
  const save = shared.saveSession.bind(shared);
  // A Supabase 500 on the upsert, as the real store reports it.
  shared.saveSession = async (session) => {
    if (state.failSaves) throw Object.assign(new Error("sms_store_save_failed: canceling statement due to statement timeout"), { name: "SmsStoreTimeoutError" });
    return save(session);
  };
  return { SupabaseSmsStore: class { constructor() { return shared; } } };
});
vi.mock("@/lib/sms/twilio", () => ({
  validTwilioSignature: () => true,
  downloadTwilioMedia: async () => null,
  createTwilioSender: (opts: Record<string, unknown>) => (state.senderOpts.push(opts), {
    send: async (_to: string, body: string) => {
      state.sent.push(body);
      return { sid: `SM${state.sent.length}`, segments: 1 };
    },
  }),
}));
vi.mock("@/lib/sms/supabase-metrics", () => ({
  SupabaseMetricsSink: class {
    async started(row: Record<string, unknown>) {
      state.started.push(JSON.parse(JSON.stringify(row)));
    }
    async finished(row: Record<string, unknown>) {
      state.finished.push(JSON.parse(JSON.stringify(row)));
    }
    async outbound(row: Record<string, unknown>) {
      state.outbound.push(row);
    }
    async delivery() {}
    async prune() {}
  },
}));
vi.mock("@/lib/ai", () => ({ getChatProvider: () => ({}), getRouterProvider: () => ({}) }));
vi.mock("@/lib/ask/ask", () => ({
  ask: async function* (deps: { channel?: { label: string; body: string } }) {
    state.channels.push(deps.channel);
    await new Promise<void>((resolve) => (state.releaseAnswer = resolve));
    yield { type: "text", text: "Start with a smaller sofa." };
    yield { type: "done" };
  },
}));

const { POST } = await import("@/app/api/sms/route");
const { ACK_TEXTS, answerTexts } = await import("@/lib/sms/handler");
const ACK_TEXT = ACK_TEXTS[0];

let sid = 0;
async function text(body: string) {
  const form = new URLSearchParams({ From: "+15551234567", Body: body, MessageSid: `SMroute${++sid}`, NumMedia: "0" });
  const res = await POST(new Request("https://cinq.example/api/sms", { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" } }));
  expect(res.status).toBe(200);
}
const settle = async () => {
  await Promise.all(state.pending.splice(0));
};

describe("Twilio webhook: Give me a second…", () => {
  beforeEach(() => {
    state.sent = [];
  });

  it("texts the ack while the answer is being written, then the answer", async () => {
    await text("START");
    await settle();
    await text("3");
    await settle();
    state.sent = [];

    await text("What sofa fits a small room?");
    await vi.waitFor(() => expect(state.releaseAnswer).not.toBeNull());
    await vi.waitFor(() => expect(state.sent).toEqual([ACK_TEXT])); // answer still being written
    state.releaseAnswer!();
    await settle();
    expect(state.sent).toEqual([ACK_TEXT, "Gio: Start with a smaller sofa."]);
  });

  it("sends no ack for a pick or HELP", async () => {
    await text("2");
    await text("HELP");
    await settle();
    expect(state.sent).toHaveLength(2);
    expect(state.sent).not.toContain(ACK_TEXT);
  });

  it("logs each text's length, encoding, segments and Twilio SID, never the words or the number", async () => {
    const logs = vi.spyOn(console, "info").mockImplementation(() => {});
    await text("Which white for the hall?");
    await vi.waitFor(() => expect(state.releaseAnswer).not.toBeNull());
    state.releaseAnswer!();
    await settle();
    const lines = logs.mock.calls.map((c) => c.join(" "));
    const replies = lines.find((l) => l.startsWith("SMS replies sent"))!;
    expect(replies).toBeTruthy();
    const logged = JSON.parse(replies.slice("SMS replies sent ".length));
    // The earlier test left this number with Martine, so the text is "Martine: Start with a smaller sofa.".
    const chars = "Martine: Start with a smaller sofa.".length;
    expect(logged).toMatchObject({ texts: 1, chars, sent: 1 });
    expect(logged.parts[0]).toMatchObject({ chars, encoding: "GSM-7", segments: 1, twilioSegments: 1 });
    expect(logged.parts[0].sid).toMatch(/^SM\d+$/);
    expect(lines.some((l) => l.startsWith("SMS ack sent"))).toBe(true);
    for (const l of lines) {
      expect(l).not.toMatch(/sofa|smaller|hall|5551234567/);
    }
    expect(answerTexts("Start with a smaller sofa.")).toEqual(["Start with a smaller sofa."]);
    logs.mockRestore();
  });

  it("gives the advisor the text-only notes, so it can offer to bring in another advisor", async () => {
    await text("Which white for the hall?");
    await vi.waitFor(() => expect(state.releaseAnswer).not.toBeNull());
    state.releaseAnswer!();
    await settle();
    const notes = state.channels.at(-1)!;
    expect(notes.label).toBe("channel_notes");
    expect(notes.body).toContain("[[suggest:ID]]");
  });

  it("still texts the answer when the session save fails, and logs the error class only", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    state.failSaves = true;
    try {
      await text("Which rug for the hall?");
      await vi.waitFor(() => expect(state.releaseAnswer).not.toBeNull());
      state.releaseAnswer!();
      await settle();
      expect(state.sent.at(-1)).toMatch(/^[A-Z][a-z]+: Start with a smaller sofa\.$/);
      const logged = errors.mock.calls.map((call) => call.join(" "));
      expect(logged).toEqual(['SMS session save failed {"error":"SmsStoreTimeoutError"}']);
      expect(logged.join(" ")).not.toMatch(/5551234567|rug|sofa|canceling/);
    } finally {
      state.failSaves = false;
      errors.mockRestore();
    }
  });

  it("records each request for the baseline: timings, counts and kinds, never the words or the number", async () => {
    const logs = vi.spyOn(console, "info").mockImplementation(() => {});
    state.finished = [];
    state.outbound = [];
    try {
      await text("Which lamp for the reading chair?");
      await vi.waitFor(() => expect(state.releaseAnswer).not.toBeNull());
      state.releaseAnswer!();
      await settle();
      const row = state.finished.at(-1)!;
      expect(row).toMatchObject({ outcome: "answered", has_text: true, photo_count: 0, texts_sent: 2, send_failures: 0 });
      expect(typeof row.ack_ms).toBe("number");
      expect(typeof row.answer_ms).toBe("number");
      expect((row.model_calls as { purpose: string }[]).map((c) => c.purpose)).toEqual(["answer"]);
      expect(state.outbound.slice(-2).map((o) => o.kind)).toEqual(["ack", "answer"]);
      // Twilio is asked to report each text's delivery to our status endpoint.
      expect(state.senderOpts.at(-1)!.statusCallback).toBe("https://cinq.example/api/sms/status");
      // Nothing personal in the record or the log line.
      const finishedLog = logs.mock.calls.map((c) => c.join(" ")).find((l) => l.startsWith("SMS request finished"))!;
      for (const out of [JSON.stringify(row), finishedLog]) {
        expect(out).not.toMatch(/5551234567|lamp|reading chair|smaller sofa/);
      }
      expect(finishedLog).not.toContain("number_key");
      expect(finishedLog).not.toContain("SMroute");
    } finally {
      logs.mockRestore();
    }
  });

  it("records a redelivered text once", async () => {
    const before = state.finished.length;
    const form = new URLSearchParams({ From: "+15551234567", Body: "HELP", MessageSid: "SMrepeat1", NumMedia: "0" });
    for (let i = 0; i < 2; i++) {
      await POST(new Request("https://cinq.example/api/sms", { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" } }));
    }
    await settle();
    expect(state.finished.slice(before).map((r) => r.outcome)).toEqual(["system"]);
  });
});
