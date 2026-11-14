import { beforeEach, describe, expect, it, vi } from "vitest";

// The real webhook, with Twilio, Supabase and the model stood in for: the ack
// must reach Twilio while the answer is still being written, then the answer.
const state = vi.hoisted(() => ({
  pending: [] as Promise<unknown>[],
  releaseAnswer: null as null | (() => void),
  sent: [] as string[],
  channels: [] as ({ label: string; body: string } | undefined)[],
}));

vi.mock("next/server", () => ({ after: (fn: () => Promise<unknown>) => state.pending.push(fn()) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/sms/supabase-store", async () => {
  const { MemorySmsStore } = await import("@/lib/sms/store");
  const shared = new MemorySmsStore();
  return { SupabaseSmsStore: class { constructor() { return shared; } } };
});
vi.mock("@/lib/sms/twilio", () => ({
  validTwilioSignature: () => true,
  downloadTwilioMedia: async () => null,
  createTwilioSender: () => ({
    send: async (_to: string, body: string) => {
      state.sent.push(body);
      return { sid: `SM${state.sent.length}`, segments: 1 };
    },
  }),
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
});
