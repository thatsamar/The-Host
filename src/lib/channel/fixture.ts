// Stand-ins for local testing, labeled as such everywhere they speak. The
// fixture adapter is not a messaging provider: its payloads and limits are
// Cinq's own test shapes, not any provider's. The fixture engine calls no
// model; its replies say so.

import { createHmac, timingSafeEqual } from "node:crypto";
import { COMPANIONS } from "@/lib/companions";
import type {
  AttachmentRef,
  Engine,
  InboundEvent,
  MessagingAdapter,
  OutboundMessage,
  ProviderLimits,
  SendResult,
  SupportResult,
} from "./types";

export const FIXTURE_LABEL = "[Fixture reply: no model was called]";

/** Answers with a labeled placeholder that shows which advisor would answer and what it was given. */
export function fixtureEngine(): Engine & { calls: { advisor: string; turns: number; photos: number }[] } {
  const calls: { advisor: string; turns: number; photos: number }[] = [];
  return {
    calls,
    async answer(advisor, turns) {
      const latest = turns.at(-1);
      const photos = latest?.images?.length ?? 0;
      calls.push({ advisor, turns: turns.length, photos });
      const asked = latest?.text.trim() ? `"${latest.text.trim().slice(0, 200)}"` : "no text";
      return {
        text: `${FIXTURE_LABEL} ${COMPANIONS[advisor].name} would answer here. This advisor's conversation has ${turns.length} turn${turns.length === 1 ? "" : "s"}; the latest has ${asked} and ${photos} photo${photos === 1 ? "" : "s"}.`,
      };
    },
  };
}

export const FIXTURE_LIMITS: ProviderLimits = { maxTextChars: 2000, preferredTextChars: 900, fixture: true };

export interface FixtureOptions {
  /** Signs fixture webhooks (HMAC-SHA256 of the body, hex, in x-fixture-signature). Test value only. */
  secret: string;
  limits?: ProviderLimits;
  support?: SupportResult;
  /** Drop a resend with an idempotency key already delivered, as some providers do. Off by default so tests see Cinq's own duplicates. */
  dedupe?: boolean;
}

/** A fake provider for tests and the harness. Webhook body: `{ "events": InboundEvent[] }`. */
export class FixtureAdapter implements MessagingAdapter {
  readonly name = "fixture";
  readonly limits: ProviderLimits;
  readonly sent: { conversationId: string; message: OutboundMessage; key: string }[] = [];
  readonly typingLog: boolean[] = [];
  readonly attachments = new Map<string, Uint8Array>();
  readonly supportRequests: string[] = [];
  /** Results for the next send calls, in order; then success. */
  readonly sendResults: (SendResult | Error)[] = [];
  private readonly keys = new Set<string>();

  constructor(private readonly options: FixtureOptions) {
    this.limits = options.limits ?? FIXTURE_LIMITS;
  }

  sign(rawBody: string): string {
    return createHmac("sha256", this.options.secret).update(rawBody).digest("hex");
  }

  async verify({ headers, rawBody }: { headers: Headers; rawBody: string }) {
    const given = Buffer.from(headers.get("x-fixture-signature") ?? "", "utf8");
    const expected = Buffer.from(this.sign(rawBody), "utf8");
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  async normalize({ rawBody }: { rawBody: string }): Promise<InboundEvent[]> {
    const body = JSON.parse(rawBody) as { events?: InboundEvent[] };
    if (!Array.isArray(body.events)) throw new Error("No events");
    return body.events;
  }

  async send(conversationId: string, message: OutboundMessage, key: string): Promise<SendResult> {
    const next = this.sendResults.shift();
    if (next instanceof Error) throw next;
    if (next && !next.ok) return next;
    if (!this.options.dedupe || !this.keys.has(key)) this.sent.push({ conversationId, message, key });
    this.keys.add(key);
    return { ok: true };
  }

  async typing(_conversationId: string, on: boolean) {
    this.typingLog.push(on);
  }

  async fetchAttachment(ref: AttachmentRef): Promise<Uint8Array> {
    const bytes = this.attachments.get(ref.ref);
    if (!bytes) throw new Error("Unknown attachment");
    return bytes;
  }

  async requestSupport(conversationId: string): Promise<SupportResult> {
    this.supportRequests.push(conversationId);
    return this.options.support ?? { status: "unavailable" };
  }
}
