import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BlooioAdapter, DEFAULT_MAX_TEXT_CHARS } from "@/lib/channel/blooio";
import { createChannel } from "@/lib/channel/service";
import { MemoryStore } from "@/lib/channel/memory-store";
import { retention } from "@/lib/channel/retention";
import { preferredRendition, type Engine } from "@/lib/channel/types";

// Shapes below follow Blooio's public docs (docs.blooio.com: webhooks,
// webhook signatures, interactive messages, conversation lifecycle, errors).

const SECRET = "whsec_test_only";
const NOW = 1_800_000_000;

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

function adapter(fetchImpl?: typeof fetch) {
  return new BlooioAdapter({ apiKey: "bl_test_key", webhookSecret: SECRET, attachmentHosts: ["media.blooio.example"], fetch: fetchImpl, nowSeconds: () => NOW });
}

const sign = (body: string, t = NOW) => `t=${t},v1=${createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex")}`;

const received = (data: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: "evt_1",
    type: "message.received",
    api_version: "2026-10-01",
    created_at: 1_718_000_000_000,
    organization_id: "org_1",
    data: { message_id: "msg_1", chat_id: "chat_1", channel_id: "ch_1", channel_type: "amb", kind: "received", direction: "inbound", text: "Hello", message_type: "text", attachments: [], ...data },
    ...extra,
  });

describe("Blooio webhooks", () => {
  it("accepts only Blooio's signature over the raw body, within five minutes", async () => {
    const a = adapter();
    const body = received({});
    expect(await a.verify({ headers: new Headers({ "x-blooio-signature": sign(body) }), rawBody: body })).toBe(true);
    expect(await a.verify({ headers: new Headers({ "x-blooio-signature": sign(body) }), rawBody: `${body} ` })).toBe(false);
    expect(await a.verify({ headers: new Headers({ "x-blooio-signature": sign(body, NOW - 301) }), rawBody: body })).toBe(false);
    expect(await a.verify({ headers: new Headers(), rawBody: body })).toBe(false);
    expect(await a.verify({ headers: new Headers({ "x-blooio-signature": "t=abc,v1=zz" }), rawBody: body })).toBe(false);
  });

  it("reads an Apple Messages message, its photos, a close and a handback", async () => {
    const a = adapter();
    const photo = received({ message_type: "media", text: "", attachments: [{ url: "https://media.blooio.example/a.heic", media_type: "image/heic" }] });
    expect(await a.normalize({ rawBody: photo })).toEqual([
      { id: "evt_1", conversationId: "chat_1", sentAt: 1_718_000_000_000, payload: { kind: "message", text: "", attachments: [{ ref: "https://media.blooio.example/a.heic", mediaType: "image/heic", size: undefined }] } },
    ]);
    const closed = JSON.stringify({ id: "evt_2", type: "chat.closed", created_at: 1, data: { chat_id: "chat_1", channel_type: "amb" } });
    expect((await a.normalize({ rawBody: closed }))[0].payload).toEqual({ kind: "conversation_end" });
    const back = JSON.stringify({ id: "evt_3", type: "handoff.resolved", created_at: 1, data: { chat_id: "chat_1", channel_type: "amb" } });
    expect((await a.normalize({ rawBody: back }))[0].payload).toEqual({ kind: "support_ended" });
  });

  it("ignores everything that isn't an inbound Apple Messages for Business event", async () => {
    const a = adapter();
    for (const body of [
      received({ channel_type: "blooio" }), // Blooio's ordinary iMessage lines
      received({ channel_type: "twilio" }),
      received({ direction: "outbound" }),
      JSON.stringify({ id: "evt_4", type: "message.delivered", created_at: 1, data: { chat_id: "chat_1", channel_type: "amb" } }),
      JSON.stringify({ id: "evt_5", type: "typing.started", created_at: 1, data: { chat_id: "chat_1", channel_type: "amb" } }),
    ])
      expect(await a.normalize({ rawBody: body })).toEqual([]);
  });
});

describe("sending through Blooio", () => {
  it("posts text to the chat with the idempotency key", async () => {
    const f = fakeFetch(() => Response.json({ id: "msg_9", status: "queued" }, { status: 201 }));
    const result = await adapter(f.fetch).send("chat_1", { kind: "text", text: "Go early." }, "ev-1#0", new AbortController().signal);
    expect(result).toEqual({ ok: true });
    expect(f.calls[0].url).toBe("https://api.blooio.com/v4/chats/chat_1/messages");
    const headers = f.calls[0].init!.headers as Record<string, string>;
    expect(headers).toMatchObject({ Authorization: "Bearer bl_test_key", "Idempotency-Key": "ev-1#0", "Content-Type": "application/json" });
    expect(JSON.parse(f.calls[0].init!.body as string)).toEqual({ text: "Go early." });
  });

  it("sends the advisor picker as an Apple list picker", async () => {
    const f = fakeFetch(() => Response.json({ status: "queued" }, { status: 201 }));
    await adapter(f.fetch).send("chat_1", { kind: "picker", prompt: "Choose an advisor", options: [{ id: "tony", title: "Amar", subtitle: "Travel" }] }, "k", new AbortController().signal);
    expect(JSON.parse(f.calls[0].init!.body as string)).toEqual({
      interactive: {
        kind: "list_picker",
        summary_text: "Choose an advisor: Amar (Travel)",
        received_message: { title: "Choose an advisor", style: "small" },
        reply_message: { title: "Choose an advisor", style: "small" },
        sections: [{ title: "Choose an advisor", multipleSelection: false, items: [{ identifier: "tony", title: "Amar", subtitle: "Travel" }] }],
      },
    });
  });

  it("maps Blooio's outcomes to retry or give up as its docs describe", async () => {
    const outcome = async (res: () => Response) => adapter(fakeFetch(res).fetch).send("chat_1", { kind: "text", text: "x" }, "k", new AbortController().signal);
    expect(await outcome(() => Response.json({ status: "failed", error: { code: "service_unavailable" } }, { status: 201 }))).toEqual({ ok: false, retryable: true, code: "service_unavailable" });
    // "May have been sent": never resent, so never delivered twice.
    expect(await outcome(() => Response.json({ status: "failed", error: { code: "delivery_unconfirmed" } }, { status: 201 }))).toEqual({ ok: true });
    expect(await outcome(() => Response.json({ status: "failed", error: { code: "recipient_blocked" } }, { status: 201 }))).toMatchObject({ ok: false, retryable: false });
    expect(await outcome(() => new Response(null, { status: 409 }))).toEqual({ ok: false, retryable: false, code: "http_409" });
    expect(await outcome(() => new Response(null, { status: 429 }))).toEqual({ ok: false, retryable: false, code: "http_429" });
    expect(await outcome(() => new Response(null, { status: 503 }))).toEqual({ ok: false, retryable: true, code: "http_503" });
    expect(await outcome(() => { throw new TypeError("fetch failed"); })).toEqual({ ok: false, retryable: true, code: "network" });
  });

  it("starts and stops the typing indicator", async () => {
    const f = fakeFetch(() => new Response(null, { status: 204 }));
    const a = adapter(f.fetch);
    await a.typing("chat_1", true);
    await a.typing("chat_1", false);
    expect(f.calls.map((c) => [c.url, JSON.parse(c.init!.body as string)])).toEqual([
      ["https://api.blooio.com/v4/chats/chat_1/typing", { state: "started" }],
      ["https://api.blooio.com/v4/chats/chat_1/typing", { state: "stopped" }],
    ]);
  });

  it("says no one was notified, since Blooio documents no API to start a handoff", async () => {
    expect(await adapter().requestSupport()).toEqual({ status: "unavailable" });
    expect(adapter().limits.maxTextChars).toBe(DEFAULT_MAX_TEXT_CHARS);
  });
});

describe("attachments", () => {
  it("downloads only from Blooio's configured hosts, over https, within the photo limit", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2]);
    const f = fakeFetch(() => new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } }));
    const a = adapter(f.fetch);
    const signal = new AbortController().signal;
    expect(await a.fetchAttachment({ ref: "https://media.blooio.example/p.jpg?sig=1" }, signal)).toEqual(Buffer.from(bytes));
    await expect(a.fetchAttachment({ ref: "https://evil.example/p.jpg" }, signal)).rejects.toThrow(/not allowed/);
    await expect(a.fetchAttachment({ ref: "http://media.blooio.example/p.jpg" }, signal)).rejects.toThrow(/not allowed/);
    await expect(a.fetchAttachment({ ref: "not a url" }, signal)).rejects.toThrow();
    await expect(a.fetchAttachment({ ref: "https://media.blooio.example/big.jpg", size: 31 * 1024 * 1024 }, signal)).rejects.toThrow(/too large/);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].init).toMatchObject({ redirect: "error" });
  });

  it("prefers a JPEG rendition when one is offered", () => {
    const heic = { ref: "https://media.blooio.example/a.heic", mediaType: "image/heic", alternates: [{ ref: "https://media.blooio.example/a.jpg", mediaType: "image/jpeg" }] };
    expect(preferredRendition(heic).ref).toBe("https://media.blooio.example/a.jpg");
    expect(preferredRendition({ ref: "x", mediaType: "image/heic" }).ref).toBe("x");
  });
});

describe("Blooio end to end, with a fixture engine", () => {
  it("answers a signed webhook in the same chat, once", async () => {
    const f = fakeFetch(() => Response.json({ status: "queued" }, { status: 201 }));
    const a = new BlooioAdapter({ apiKey: "bl_test_key", webhookSecret: SECRET, attachmentHosts: ["media.blooio.example"], fetch: f.fetch, nowSeconds: () => Math.floor(Date.now() / 1000) });
    const engine: Engine = { answer: async (advisor) => ({ text: `[fixture] ${advisor}` }) };
    const channel = createChannel({ adapter: a, store: new MemoryStore(retention("24")), engine });
    const body = received({ text: "Amar: one night in Bangkok" });
    const t = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 2; i++) {
      const res = await channel.handleWebhook({ headers: new Headers({ "x-blooio-signature": sign(body, t) }), rawBody: body });
      expect(res.status).toBe(200);
      await res.background;
    }
    const texts = f.calls.filter((c) => c.url.endsWith("/messages")).map((c) => JSON.parse(c.init!.body as string).text);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toMatch(/^Hi, this is Cinq's automated service\./);
    expect(texts[1]).toBe("Amar · Travel\n\n[fixture] tony");
  });
});
