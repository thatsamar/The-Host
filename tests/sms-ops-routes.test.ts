import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Twilio's delivery reports and the operations dashboard, with Supabase stood in for.
const state = vi.hoisted(() => ({
  deliveries: [] as Record<string, unknown>[],
  validSignature: true,
  requests: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/sms/twilio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sms/twilio")>()),
  validTwilioSignature: () => state.validSignature,
}));
vi.mock("@/lib/sms/supabase-metrics", () => ({
  SupabaseMetricsSink: class {
    async delivery(update: Record<string, unknown>) {
      state.deliveries.push(update);
    }
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const rows = table === "sms_requests" ? state.requests : [];
      const query = { gte: () => query, order: () => query, limit: async () => ({ data: rows, error: null }), select: () => query };
      return query;
    },
  }),
}));

const { POST: status } = await import("@/app/api/sms/status/route");
const { GET: ops } = await import("@/app/ops/route");

const report = (fields: Record<string, string>) =>
  status(new Request("https://cinq.example/api/sms/status", { method: "POST", body: new URLSearchParams(fields), headers: { "Content-Type": "application/x-www-form-urlencoded" } }));

describe("Twilio delivery reports", () => {
  beforeEach(() => {
    state.deliveries = [];
    state.validSignature = true;
  });

  it("records the status and error code against the text's SID, and answers 204", async () => {
    const res = await report({ MessageSid: "SMabcdef123456", MessageStatus: "undelivered", ErrorCode: "30007", To: "+15551234567", Body: "ignored" });
    expect(res.status).toBe(204);
    expect(state.deliveries).toEqual([{ sid: "SMabcdef123456", status: "undelivered", errorCode: "30007", at: expect.any(String) }]);
    expect(JSON.stringify(state.deliveries)).not.toContain("5551234567");
  });

  it("refuses an unsigned report", async () => {
    state.validSignature = false;
    expect((await report({ MessageSid: "SMabcdef123456", MessageStatus: "delivered" })).status).toBe(403);
    expect(state.deliveries).toEqual([]);
  });

  it("ignores a malformed one without asking Twilio to retry", async () => {
    expect((await report({ MessageSid: "x", MessageStatus: "delivered" })).status).toBe(204);
    expect((await report({ MessageSid: "SMabcdef123456", MessageStatus: "<b>" })).status).toBe(204);
    expect(state.deliveries).toEqual([]);
  });
});

describe("the operations dashboard", () => {
  const get = (auth?: string) => ops(new Request("https://cinq.example/ops?days=7", auth ? { headers: { Authorization: `Basic ${Buffer.from(auth).toString("base64")}` } } : {}));

  afterEach(() => {
    delete process.env.OPS_PASSWORD;
  });

  it("doesn't exist unless OPS_PASSWORD is set", async () => {
    expect((await get("x:anything")).status).toBe(404);
  });

  it("asks for the password, and refuses a wrong one", async () => {
    process.env.OPS_PASSWORD = "right-horse";
    const missing = await get();
    expect(missing.status).toBe(401);
    expect(missing.headers.get("WWW-Authenticate")).toContain("Basic");
    expect((await get("ops:wrong")).status).toBe(401);
  });

  it("shows aggregates to the right password, never stored or indexed", async () => {
    process.env.OPS_PASSWORD = "right-horse";
    state.requests = [
      {
        message_sid: "SMsecret1",
        number_key: "f00dfeedcafe1234",
        received_at: new Date(Date.now() - 60_000).toISOString(),
        finished_at: new Date().toISOString(),
        has_text: true,
        photo_count: 0,
        outcome: "answered",
        advisor_id: "alden",
        ack_ms: 900,
        still_thinking_ms: null,
        answer_ms: 12_000,
        texts_sent: 2,
        segments_sent: 3,
        send_failures: 0,
        save_failures: 0,
        model_calls: [],
        error_class: null,
      },
    ];
    const res = await get("anyone:right-horse");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("Cinq Operations");
    expect(html).toContain("Alden");
    expect(html).not.toContain("SMsecret1");
    expect(html).not.toContain("f00dfeedcafe1234");
  });
});
