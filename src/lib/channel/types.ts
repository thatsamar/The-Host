// Cinq in a messaging app: the provider-neutral shapes. A provider adapter
// (one per messaging service provider) turns its webhooks into InboundEvents
// and delivers OutboundMessages; everything between those two edges, routing
// to an advisor, the advisor's judgment and how answers are split, is the
// same whichever provider carries the conversation.

import type { AskTurn } from "@/lib/ask/prompt";
import type { CompanionId } from "@/lib/companions/types";

/**
 * A photo the provider holds for us. `ref` is the provider's own reference,
 * downloaded only through the adapter's authenticated call; a URL typed by
 * the sender is never fetched.
 */
export interface AttachmentRef {
  ref: string;
  /** What the provider says it is. The bytes decide (images.ts). */
  mediaType?: string;
  /** Size in bytes, when the provider says. */
  size?: number;
}

/** What a person did, as Cinq needs to know it. */
export type InboundPayload =
  | {
      kind: "message";
      text: string;
      attachments: AttachmentRef[];
      /** The option id when the message answers a picker. */
      selection?: string;
    }
  /** The person closed or deleted the conversation, or opted out. Nothing more may be sent. */
  | { kind: "conversation_end" }
  /** A person from Cinq's team has handed the conversation back. */
  | { kind: "support_ended" };

export interface InboundEvent {
  /** The provider's id for this event, unique per event; the idempotency key. */
  id: string;
  /** The provider's id for the conversation (never a phone number or Apple ID in Cinq's logs). */
  conversationId: string;
  /** When the person sent it, in ms since epoch, as the provider reports it. Orders a conversation's events. */
  sentAt: number;
  payload: InboundPayload;
}

export interface PickerOption {
  id: string;
  title: string;
  subtitle: string;
}

export type OutboundMessage =
  | { kind: "text"; text: string }
  /** A list of choices (a list picker where the provider has one, numbered text otherwise). */
  | { kind: "picker"; prompt: string; options: PickerOption[] };

export type SendResult =
  | { ok: true }
  /** Worth trying again later: a timeout, a rate limit, the provider briefly down. */
  | { ok: false; retryable: true; code: string }
  /** Will never succeed: the conversation is closed, the message was rejected. */
  | { ok: false; retryable: false; code: string };

/** What the provider reported when Cinq asked for a person to join. Only these facts are told to the person. */
export type SupportResult =
  | { status: "queued"; estimatedWaitMinutes?: number }
  | { status: "closed"; hours?: string }
  /** No human support is connected to this channel. */
  | { status: "unavailable" };

export interface ProviderLimits {
  /** Longest text the provider will deliver in one message. */
  maxTextChars: number;
  /** Comfortable length for one message on a phone; answers are grouped by paragraph up to this. */
  preferredTextChars: number;
  /** Whether a fixture: its limits and behavior are not a real provider's. */
  fixture?: boolean;
}

/**
 * Everything provider-specific. Implement one per messaging service provider,
 * from that provider's documentation; nothing outside the adapter may assume
 * a provider's payloads, endpoints or credentials.
 */
export interface MessagingAdapter {
  readonly name: string;
  readonly limits: ProviderLimits;
  /** Checks the webhook really came from the provider (signature, token), before anything is read from it. */
  verify(request: { headers: Headers; rawBody: string }): Promise<boolean>;
  /** The webhook's events in Cinq's terms. Events Cinq doesn't act on (read receipts, typing) are left out. */
  normalize(request: { headers: Headers; rawBody: string }): Promise<InboundEvent[]>;
  /** Delivers one message. `idempotencyKey` is stable across retries of the same message. */
  send(conversationId: string, message: OutboundMessage, idempotencyKey: string, signal: AbortSignal): Promise<SendResult>;
  /** Shows or hides the typing indicator. Best effort. */
  typing(conversationId: string, on: boolean): Promise<void>;
  /** Downloads an attachment through the provider's authenticated API. */
  fetchAttachment(ref: AttachmentRef, signal: AbortSignal): Promise<Uint8Array>;
  /** Asks the provider to bring a person from Cinq's team into the conversation. */
  requestSupport(conversationId: string): Promise<SupportResult>;
}

/** One answer from an advisor, as the shared engine gives it. */
export interface EngineResult {
  /** What was written, possibly partial when there is an error. */
  text: string;
  /** A plain message to show when the answer failed or stopped short. */
  error?: string;
}

/** Cinq's advisors, as a channel reaches them: the same engine the website uses. */
export interface Engine {
  answer(advisor: CompanionId, turns: AskTurn[], signal: AbortSignal): Promise<EngineResult>;
}

/** What Cinq holds about one conversation, temporarily. */
export interface Session {
  /** The advisor answering now. */
  active?: CompanionId;
  /** Whether Cinq's welcome has been sent in this session. */
  welcomed: boolean;
  /** A question sent before an advisor was chosen, kept for whoever is chosen. */
  pending?: { text: string; attachments: AttachmentRef[] };
  /** Each advisor's own conversation. Never shown to another advisor. */
  histories: Partial<Record<CompanionId, AskTurn[]>>;
  /** Advisors who have already said who they are in this session. */
  introduced: CompanionId[];
  /** A person from Cinq's team has the conversation; advisors stay quiet. */
  withSupport?: boolean;
}

export const newSession = (): Session => ({ welcomed: false, histories: {}, introduced: [] });

export interface StoredInbound {
  event: InboundEvent;
  /** A worker began this event and never finished it (it crashed or was cut off). */
  interrupted: boolean;
}

export interface OutboxItem {
  id: string;
  conversationId: string;
  message: OutboundMessage;
  attempts: number;
}

/**
 * Durable state for a channel. Every implementation must pass
 * tests/channel-store.test.ts: idempotent inbound, per-conversation order and
 * leases, an ordered outbox with retries, and cleanup on schedule.
 */
export interface ChannelStore {
  /** Records an event once. A redelivered event is a duplicate and is not processed again. */
  recordInbound(event: InboundEvent, now: number): Promise<"new" | "duplicate">;
  /** Takes the conversation for one worker until `now + leaseMs`, unless another worker holds it. */
  acquire(conversationId: string, owner: string, now: number, leaseMs: number): Promise<boolean>;
  release(conversationId: string, owner: string): Promise<void>;
  /** The conversation's next event, oldest first by sentAt then arrival; marks it in progress. */
  claimNext(conversationId: string, now: number): Promise<StoredInbound | undefined>;
  /** The session, or nothing when there is none or it has expired. */
  getSession(conversationId: string, now: number): Promise<Session | undefined>;
  /** What is still waiting in a conversation after the event being handled, oldest first (content included, nothing claimed). */
  peekPending(conversationId: string, limit: number): Promise<InboundEvent["payload"][]>;
  /**
   * Queues replies ahead of an event's commit, under ids built from `key`,
   * for a reply that must go out before a slow answer (Apple's five-second
   * first reply). A repeated key is ignored.
   */
  queueReplies(conversationId: string, key: string, replies: OutboundMessage[], now: number): Promise<void>;
  /**
   * Finishes an event in one step: saves or deletes the session, queues the
   * replies in order, and clears the event's content. With `cancelQueued`,
   * first cancels every reply still waiting to be sent (reset, or a closed
   * conversation). Returns false, changing nothing, when the event is no
   * longer in progress: another worker finished it after this one's lease ran out.
   */
  commit(
    conversationId: string,
    eventId: string,
    change: { session: Session | null; replies: OutboundMessage[]; cancelQueued?: boolean },
    now: number,
  ): Promise<boolean>;
  /** The conversation's next message to send, if it is due; marks it as being sent until `now + leaseMs`. */
  claimOutbox(conversationId: string, now: number, leaseMs: number): Promise<OutboxItem | undefined>;
  markSent(itemId: string, now: number): Promise<void>;
  markRetry(itemId: string, nextAttemptAt: number, now: number): Promise<void>;
  markDead(itemId: string, now: number): Promise<void>;
  /** Conversations with a message due to be sent. */
  dueConversations(now: number, limit: number): Promise<string[]>;
  /** Conversations with events waiting to be processed. */
  pendingConversations(now: number, limit: number): Promise<string[]>;
  /** Deletes what has outlived the retention schedule (retention.ts). */
  sweep(now: number): Promise<void>;
}
