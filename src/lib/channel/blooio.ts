// Blooio as the messaging service provider, for Apple Messages for Business
// only. Written from Blooio's public documentation (docs.blooio.com, read
// October 2026): webhook signatures, the v4 event envelope, sending to a
// chat, list pickers, typing and conversation close. Where the docs are
// silent the adapter does the safe thing and says so:
//   - Starting a human handoff has no documented API (only handoff.*
//     events), so requestSupport reports "unavailable" until Blooio confirms one.
//   - No per-message text limit is documented for Apple Messages, so it comes
//     from MESSAGES_MAX_TEXT_CHARS (default below) until Blooio confirms it.
// Only Apple Messages for Business events (channel_type "amb") are accepted;
// Blooio's ordinary iMessage, SMS and other channels are ignored, so nothing
// here can reply through them.

import { createHmac, timingSafeEqual } from "node:crypto";
import { MAX_INPUT_BYTES } from "@/lib/ask/server-photos";
import type { AttachmentRef, InboundEvent, MessagingAdapter, OutboundMessage, ProviderLimits, SendResult, SupportResult } from "./types";

export const BLOOIO_API = "https://api.blooio.com";
/** Blooio's documented replay window for signed webhooks. */
export const SIGNATURE_TOLERANCE_S = 300;
/** Until Blooio states Apple Messages' limit, a conservative length that reads well on a phone. */
export const DEFAULT_MAX_TEXT_CHARS = 2000;

export interface BlooioOptions {
  apiKey: string;
  webhookSecret: string;
  /** Hosts Blooio serves attachment downloads from (its signed URLs). Nothing else is fetched. */
  attachmentHosts: string[];
  maxTextChars?: number;
  apiBase?: string;
  fetch?: typeof fetch;
  /** Seconds since epoch, for tests. */
  nowSeconds?: () => number;
}

interface BlooioAttachment {
  url?: string;
  media_type?: string;
  size?: number;
}

interface BlooioEnvelope {
  id?: string;
  type?: string;
  created_at?: number;
  data?: {
    chat_id?: string;
    channel_type?: string;
    direction?: string;
    text?: string | null;
    attachments?: BlooioAttachment[];
    metadata?: { interactive?: { role?: string; kind?: string; chosen?: string[] } };
  };
}

/** Parses `t=…,v1=…`. */
function parseSignature(header: string | null): { t: string; v1: string } | undefined {
  if (!header) return undefined;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  return parts.t && parts.v1 ? { t: parts.t, v1: parts.v1 } : undefined;
}

export class BlooioAdapter implements MessagingAdapter {
  readonly name = "blooio";
  readonly limits: ProviderLimits;
  private readonly api: string;
  private readonly fetch: typeof fetch;
  private readonly nowSeconds: () => number;

  constructor(private readonly options: BlooioOptions) {
    const max = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
    this.limits = { maxTextChars: max, preferredTextChars: Math.min(max, 900) };
    this.api = options.apiBase ?? BLOOIO_API;
    this.fetch = options.fetch ?? fetch;
    this.nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  /** Blooio's scheme: HMAC-SHA256 (hex) of `{t}.{raw body}` with the webhook's signing secret, within five minutes. */
  async verify({ headers, rawBody }: { headers: Headers; rawBody: string }) {
    const signature = parseSignature(headers.get("x-blooio-signature"));
    if (!signature || !/^\d+$/.test(signature.t)) return false;
    if (Math.abs(this.nowSeconds() - Number(signature.t)) > SIGNATURE_TOLERANCE_S) return false;
    const expected = Buffer.from(createHmac("sha256", this.options.webhookSecret).update(`${signature.t}.${rawBody}`).digest("hex"), "utf8");
    const given = Buffer.from(signature.v1, "utf8");
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  async normalize({ rawBody }: { rawBody: string }): Promise<InboundEvent[]> {
    const event = JSON.parse(rawBody) as BlooioEnvelope;
    const data = event.data;
    if (!event.id || !event.type || !data?.chat_id) return [];
    // Official Apple Messages for Business only.
    if (data.channel_type !== "amb") return [];
    const base = { id: event.id, conversationId: data.chat_id, sentAt: typeof event.created_at === "number" ? event.created_at : Date.now() };
    switch (event.type) {
      case "message.received": {
        if (data.direction && data.direction !== "inbound") return [];
        const attachments: AttachmentRef[] = (data.attachments ?? [])
          .filter((a): a is BlooioAttachment & { url: string } => typeof a.url === "string")
          .map((a) => ({ ref: a.url, mediaType: a.media_type, size: a.size }));
        // A list-picker reply arrives with the chosen option's title as its text.
        return [{ ...base, payload: { kind: "message", text: data.text ?? "", attachments } }];
      }
      case "chat.closed":
        return [{ ...base, payload: { kind: "conversation_end" } }];
      case "handoff.resolved":
        return [{ ...base, payload: { kind: "support_ended" } }];
      default:
        return [];
    }
  }

  private async call(path: string, body: unknown, signal: AbortSignal, idempotencyKey?: string): Promise<Response> {
    return this.fetch(`${this.api}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  }

  async send(conversationId: string, message: OutboundMessage, idempotencyKey: string, signal: AbortSignal): Promise<SendResult> {
    const body =
      message.kind === "text"
        ? { text: message.text }
        : {
            interactive: {
              kind: "list_picker",
              summary_text: `${message.prompt}: ${message.options.map((o) => `${o.title} (${o.subtitle})`).join(", ")}`,
              received_message: { title: message.prompt, style: "small" },
              reply_message: { title: message.prompt, style: "small" },
              sections: [{ title: message.prompt, multipleSelection: false, items: message.options.map((o) => ({ identifier: o.id, title: o.title, subtitle: o.subtitle })) }],
            },
          };
    let res: Response;
    try {
      res = await this.call(`/v4/chats/${encodeURIComponent(conversationId)}/messages`, body, signal, idempotencyKey);
    } catch {
      return { ok: false, retryable: true, code: "network" };
    }
    if (res.status === 200 || res.status === 201) {
      const sent = (await res.json().catch(() => ({}))) as { status?: string; error?: { code?: string | null } };
      if (sent.status !== "failed") return { ok: true };
      const code = sent.error?.code ?? "send_failed";
      // "May have been sent": resending now could deliver it twice (Blooio's guidance).
      if (code === "delivery_unconfirmed") return { ok: true };
      return { ok: false, retryable: code === "service_unavailable", code };
    }
    // 409: chat closed or idempotency reuse. 429: a conversation limit that lifts only when the person replies.
    if (res.status >= 500) return { ok: false, retryable: true, code: `http_${res.status}` };
    return { ok: false, retryable: false, code: `http_${res.status}` };
  }

  async typing(conversationId: string, on: boolean) {
    const res = await this.call(`/v4/chats/${encodeURIComponent(conversationId)}/typing`, { state: on ? "started" : "stopped" }, AbortSignal.timeout(5_000));
    await res.body?.cancel();
  }

  /** Downloads from Blooio's signed attachment URL, only from the configured hosts, only over https, and never more than the photo limit. */
  async fetchAttachment(ref: AttachmentRef, signal: AbortSignal): Promise<Uint8Array> {
    let url: URL;
    try {
      url = new URL(ref.ref);
    } catch {
      throw new Error("Attachment reference is not a URL");
    }
    if (url.protocol !== "https:" || !this.options.attachmentHosts.includes(url.hostname)) throw new Error("Attachment host not allowed");
    if (ref.size && ref.size > MAX_INPUT_BYTES) throw new Error("Attachment too large");
    const res = await this.fetch(url, { signal, redirect: "error" });
    if (!res.ok || !res.body) throw new Error(`Attachment download failed (${res.status})`);
    const declared = Number(res.headers.get("content-length"));
    if (declared > MAX_INPUT_BYTES) throw new Error("Attachment too large");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > MAX_INPUT_BYTES) throw new Error("Attachment too large");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /** No documented API starts a handoff; say so truthfully rather than pretend someone was notified. */
  async requestSupport(): Promise<SupportResult> {
    return { status: "unavailable" };
  }
}
