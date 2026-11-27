/**
 * Operational measurements for Cinq by text (Phase 0 baseline). One record
 * per incoming text and one per text Cinq sends: timings, counts, kinds and
 * statuses only. Never a message's words, a photo, a phone number or an
 * error message. A number is kept only as a keyed hash, so one number's
 * texts can be grouped (bursts, overlaps) without storing the number.
 *
 * Recording never changes what the person receives: every write is best
 * effort, after or alongside the work, and a failure is logged by class only.
 */

import { createHmac } from "node:crypto";
import { ACK_TEXTS, FALLBACK_TEXT, STALLED_TEXT, STILL_THINKING_TEXT } from "./handler";
import { SMS_ADVISORS } from "./navigation";

/** How long measurement records are kept, then deleted: long enough to see trends and returning people. */
export const RETENTION_DAYS = 90;
/** On average, one webhook in this many also deletes expired records, so retention needs no scheduler. */
export const PRUNE_ONE_IN = 50;

export type OutboundKind = "ack" | "still_thinking" | "answer" | "fallback" | "stalled" | "system";
export type Outcome = "answered" | "fallback" | "stalled" | "system" | "duplicate" | "opted_out" | "error";
export type ModelPurpose = "answer" | "router" | "condense" | "leak_rewrite";

export interface ModelCall {
  purpose: ModelPurpose;
  model?: string;
  ms: number;
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  searches?: number;
  failed?: boolean;
  /** For an answer: the advisor's architecture (docs/foundations.md), labels and timing only. */
  architecture?: "legacy" | "c2";
  foundation_ms?: number;
  /** C2 fell back to the current architecture for this answer: the fixed reason code. */
  foundation_fallback?: string;
  /** The leak guard found the answer repeating its foundation. */
  leak_guard?: boolean;
}

/** A number as a short keyed hash: the same number always gives the same key, and the key never gives the number back. */
export function numberKey(phone: string, secret: string): string {
  return createHmac("sha256", secret || "cinq-sms-metrics").update(phone).digest("hex").slice(0, 16);
}

const ACKS = new Set<string>(ACK_TEXTS);
const LABELS = SMS_ADVISORS.map((a) => `${a.name}: `);

/** What kind of text Cinq sent, from its words, so no words need to be kept. */
export function outboundKind(text: string): OutboundKind {
  if (ACKS.has(text)) return "ack";
  if (text === STILL_THINKING_TEXT) return "still_thinking";
  if (text === FALLBACK_TEXT) return "fallback";
  if (text === STALLED_TEXT) return "stalled";
  if (LABELS.some((label) => text.startsWith(label))) return "answer";
  return "system";
}

/** How a request ended, from the texts it sent. */
export function outcomeOf(kinds: OutboundKind[], duplicate: boolean): Outcome {
  if (duplicate) return "duplicate";
  if (kinds.includes("stalled")) return "stalled";
  if (kinds.includes("fallback")) return "fallback";
  if (kinds.includes("answer")) return "answered";
  if (kinds.length === 0) return "opted_out";
  return "system";
}

/** Token counts from a model's usage, under the names the record keeps. */
export function usageCounts(usage: Record<string, unknown> | undefined): Pick<ModelCall, "input" | "output" | "cache_read" | "cache_write" | "searches"> {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const tool = usage?.server_tool_use as Record<string, unknown> | undefined;
  return {
    input: n(usage?.input_tokens),
    output: n(usage?.output_tokens),
    cache_read: n(usage?.cache_read_input_tokens),
    cache_write: n(usage?.cache_creation_input_tokens),
    searches: n(tool?.web_search_requests),
  };
}

export interface RequestRow {
  message_sid: string;
  number_key: string;
  received_at: string;
  finished_at: string | null;
  has_text: boolean;
  photo_count: number;
  outcome: Outcome | null;
  advisor_id: string | null;
  ack_ms: number | null;
  still_thinking_ms: number | null;
  answer_ms: number | null;
  texts_sent: number;
  segments_sent: number;
  send_failures: number;
  save_failures: number;
  model_calls: ModelCall[];
  error_class: string | null;
}

export interface OutboundRow {
  sid: string;
  request_sid: string;
  kind: OutboundKind;
  segments: number | null;
  submitted_at: string;
}

/** One incoming text's record, filled in as the request runs. */
export class RequestMeasure {
  readonly row: RequestRow;
  private kinds: OutboundKind[] = [];
  duplicate = false;

  constructor(
    opts: { messageSid: string; numberKey: string; receivedAt: number; hasText: boolean; photoCount: number },
    private now: () => number = Date.now,
  ) {
    this.row = {
      message_sid: opts.messageSid,
      number_key: opts.numberKey,
      received_at: new Date(opts.receivedAt).toISOString(),
      finished_at: null,
      has_text: opts.hasText,
      photo_count: opts.photoCount,
      outcome: null,
      advisor_id: null,
      ack_ms: null,
      still_thinking_ms: null,
      answer_ms: null,
      texts_sent: 0,
      segments_sent: 0,
      send_failures: 0,
      save_failures: 0,
      model_calls: [],
      error_class: null,
    };
  }

  private elapsed(): number {
    return Math.max(0, this.now() - Date.parse(this.row.received_at));
  }

  /** A text Twilio accepted: its kind, and for the first ack, update and answer, how long after receipt. */
  sent(text: string, sid: string | undefined, segments: number | undefined): OutboundRow | null {
    const kind = outboundKind(text);
    this.kinds.push(kind);
    this.row.texts_sent += 1;
    this.row.segments_sent += segments ?? 0;
    const ms = this.elapsed();
    if (kind === "ack" && this.row.ack_ms === null) this.row.ack_ms = ms;
    if (kind === "still_thinking" && this.row.still_thinking_ms === null) this.row.still_thinking_ms = ms;
    if (kind !== "ack" && kind !== "still_thinking") this.row.answer_ms = ms;
    return sid ? { sid, request_sid: this.row.message_sid, kind, segments: segments ?? null, submitted_at: new Date(this.now()).toISOString() } : null;
  }

  /** A text Twilio didn't accept; it still counts toward how the request ended. */
  sendFailed(text: string): void {
    this.kinds.push(outboundKind(text));
    this.row.send_failures += 1;
  }

  model(call: ModelCall): void {
    this.row.model_calls.push(call);
  }

  finish(error?: string): RequestRow {
    this.row.finished_at = new Date(this.now()).toISOString();
    this.row.outcome = error ? "error" : outcomeOf(this.kinds, this.duplicate);
    if (error) this.row.error_class = error;
    return this.row;
  }
}

/** Where records go. Every method is best effort and must never throw into the conversation. */
export interface MetricsSink {
  started(row: RequestRow): Promise<void>;
  finished(row: RequestRow): Promise<void>;
  outbound(row: OutboundRow): Promise<void>;
  delivery(update: { sid: string; status: string; errorCode: string | null; at: string }): Promise<void>;
  prune?(now?: number): Promise<void>;
}

const STATUS_RANK: Record<string, number> = { accepted: 1, queued: 1, sending: 2, sent: 3, delivered: 4, undelivered: 4, failed: 4, read: 5 };

/** Whether a delivery report should replace the status already kept (reports can arrive out of order). */
export function newerStatus(current: string | null | undefined, next: string): boolean {
  return (STATUS_RANK[next] ?? 0) >= (STATUS_RANK[current ?? ""] ?? 0);
}

/** Twilio's error code for a failed delivery, kept only if it looks like one (digits). */
export function twilioErrorCode(value: string | undefined): string | null {
  return value && /^\d{1,6}$/.test(value) ? value : null;
}
