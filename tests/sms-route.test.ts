import { beforeEach, describe, expect, it, vi } from "vitest";

// The real webhook, with Twilio, Supabase and the model stood in for: the ack
// must reach Twilio while the answer is still being written, then the answer.
const state = vi.hoisted(() => ({
  pending: [] as Promise<unknown>[],
  releaseAnswer: null as null | (() => void),
  sent: [] as string[],
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
  createTwilioSender: () => ({ send: async (_to: string, body: string) => void state.sent.push(body) }),
}));
vi.mock("@/lib/ai", () => ({ getChatProvider: () => ({}) }));
vi.mock("@/lib/ask/ask", () => ({
  ask: async function* () {
    await new Promise<void>((resolve) => (state.releaseAnswer = resolve));
    yield { type: "text", text: "Start with a smaller sofa." };
    yield { type: "done" };
  },
}));

const { POST } = await import("@/app/api/sms/route");
const { ACK_TEXT } = await import("@/lib/sms/handler");

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
    expect(state.sent).toEqual([ACK_TEXT, "Start with a smaller sofa."]);
  });

  it("sends no ack for a pick or HELP", async () => {
    await text("2");
    await text("HELP");
    await settle();
    expect(state.sent).toHaveLength(2);
    expect(state.sent).not.toContain(ACK_TEXT);
  });
});
