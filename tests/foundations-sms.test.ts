import { beforeEach, describe, expect, it, vi } from "vitest";

// Cinq by text with an advisor on C2: acknowledgments, delivery and the
// conversation work exactly as before; the architecture reaches the answer;
// a reply that repeats the foundation is rewritten before it is sent.
// Stand-in text only.
const FOUNDATION = "STAND-IN FOUNDATION: a lantern is better judged at dusk than at noon because the light depends on the dark.";

const state = vi.hoisted(() => ({
  pending: [] as Promise<unknown>[],
  sent: [] as string[],
  deps: [] as Record<string, unknown>[],
  answer: "Go at dusk.",
  rewrite: "Evening is when lamps show what they can do.",
  finished: [] as Record<string, unknown>[],
  rewrites: 0,
  requesters: [] as unknown[],
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
vi.mock("@/lib/sms/supabase-metrics", () => ({
  SupabaseMetricsSink: class {
    async started() {}
    async finished(row: Record<string, unknown>) {
      state.finished.push(JSON.parse(JSON.stringify(row)));
    }
    async outbound() {}
    async prune() {}
  },
}));
vi.mock("@/lib/foundations/loader", () => ({
  foundationLoader: () => ({
    quick: () => null,
    resolve: async (_advisor: string, requester: { owner?: boolean }) => (state.requesters.push(requester), { kind: "c2", identity: "STAND-IN IDENTITY.", foundation: FOUNDATION, versions: { identity: 1, foundation: 2, layer2: null }, loadMs: 3 }),
  }),
  photoNoteEnabled: () => false,
  recordLeakGuard: () => {},
}));
vi.mock("@/lib/ai", () => ({
  getChatProvider: () => ({}),
  getRouterProvider: () => ({
    streamChat: async function* (req: { system: { label: string }[] }) {
      if (req.system[0].label === "rewrite") {
        state.rewrites++;
        yield { type: "text", text: state.rewrite };
      } else yield { type: "text", text: "tony" };
      yield { type: "done", usage: {}, model: "m" };
    },
  }),
}));
vi.mock("@/lib/ask/ask", () => ({
  ask: async function* (deps: Record<string, unknown>) {
    state.deps.push(deps);
    yield { type: "text", text: state.answer };
    yield { type: "done" };
  },
}));

const { POST } = await import("@/app/api/sms/route");
const { ACK_TEXTS } = await import("@/lib/sms/handler");

let sid = 0;
async function text(body: string) {
  const form = new URLSearchParams({ From: "+15550001111", Body: body, MessageSid: `SMfound${++sid}`, NumMedia: "0" });
  const res = await POST(new Request("https://cinq.example/api/sms", { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" } }));
  expect(res.status).toBe(200);
  await Promise.all(state.pending.splice(0));
}

describe("Cinq by text with an advisor on C2", () => {
  beforeEach(() => {
    state.sent = [];
    state.deps = [];
    state.finished = [];
    state.rewrites = 0;
    state.requesters = [];
    state.answer = "Go at dusk.";
  });

  it("recognises the owner by OWNER_PHONE, however it is written, and no one else", async () => {
    process.env.OWNER_PHONE = "(555) 000-1111";
    await text("Amar");
    await text("When should I go?");
    expect(state.requesters.at(-1)).toEqual({ owner: true });
    process.env.OWNER_PHONE = "+15550002222";
    await text("And after that?");
    expect(state.requesters.at(-1)).toEqual({ owner: false });
    delete process.env.OWNER_PHONE;
  });

  it("acknowledges, answers, and gives the answer its architecture", async () => {
    await text("Amar");
    state.sent = [];
    await text("When should I see the lantern festival?");
    expect(ACK_TEXTS).toContain(state.sent[0]);
    expect(state.sent.at(-1)).toBe("Amar: Go at dusk.");
    expect(state.deps.at(-1)?.architecture).toMatchObject({ kind: "c2", versions: { foundation: 2 } });
    const answerCall = (state.finished.at(-1)?.model_calls as Record<string, unknown>[]).find((c) => c.purpose === "answer");
    expect(answerCall).toMatchObject({ architecture: "c2", foundation_ms: 3 });
    expect(JSON.stringify(state.finished)).not.toContain("STAND-IN");
  });

  it("rewrites a reply that repeats the foundation before it is sent", async () => {
    await text("Amar");
    state.sent = [];
    state.answer = "A lantern is better judged at dusk than at noon because the light depends on the dark, as I always say.";
    await text("What do you believe about lanterns?");
    expect(state.rewrites).toBe(1);
    expect(state.sent.at(-1)).toBe(`Amar: ${state.rewrite}`);
    expect(state.sent.join("\n")).not.toContain("better judged at dusk");
    const calls = state.finished.at(-1)?.model_calls as Record<string, unknown>[];
    expect(calls.find((c) => c.purpose === "answer")).toMatchObject({ leak_guard: true });
    expect(calls.some((c) => c.purpose === "leak_rewrite")).toBe(true);
  });
});
