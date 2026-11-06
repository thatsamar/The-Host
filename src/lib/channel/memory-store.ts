// A ChannelStore in this process's memory, for tests and the local harness.
// Not durable: a restart forgets everything, and serverless instances don't
// share it. Production needs a durable store (postgres-store.ts).

import type { Retention } from "./retention";
import type { ChannelStore, InboundEvent, OutboundMessage, OutboxItem, Session, StoredInbound } from "./types";

interface Inbound {
  event: InboundEvent;
  /** Content is cleared once handled; the id stays to catch redeliveries. */
  payload?: InboundEvent["payload"];
  arrival: number;
  status: "pending" | "processing" | "done";
  updatedAt: number;
}

interface Outbox {
  id: string;
  conversationId: string;
  order: number;
  message?: OutboundMessage;
  status: "pending" | "sending" | "sent" | "dead" | "cancelled";
  attempts: number;
  nextAttemptAt: number;
  leaseUntil: number;
  updatedAt: number;
}

export class MemoryStore implements ChannelStore {
  private inbound = new Map<string, Inbound>();
  private sessions = new Map<string, { session: Session; expiresAt: number }>();
  private locks = new Map<string, { owner: string; until: number }>();
  private outbox = new Map<string, Outbox>();
  private counter = 0;

  constructor(private readonly retention: Retention) {}

  async recordInbound(event: InboundEvent, now: number) {
    if (this.inbound.has(event.id)) return "duplicate" as const;
    this.inbound.set(event.id, { event, payload: event.payload, arrival: ++this.counter, status: "pending", updatedAt: now });
    return "new" as const;
  }

  async acquire(conversationId: string, owner: string, now: number, leaseMs: number) {
    const lock = this.locks.get(conversationId);
    if (lock && lock.owner !== owner && lock.until > now) return false;
    this.locks.set(conversationId, { owner, until: now + leaseMs });
    return true;
  }

  async release(conversationId: string, owner: string) {
    if (this.locks.get(conversationId)?.owner === owner) this.locks.delete(conversationId);
  }

  async claimNext(conversationId: string, now: number): Promise<StoredInbound | undefined> {
    const mine = [...this.inbound.values()]
      .filter((r) => r.event.conversationId === conversationId && r.status !== "done" && r.payload)
      .sort((a, b) => a.event.sentAt - b.event.sentAt || a.arrival - b.arrival);
    // Whoever held the conversation before stopped mid-event (the lock is ours now).
    const stuck = mine.find((r) => r.status === "processing");
    const next = stuck ?? mine[0];
    if (!next) return undefined;
    next.status = "processing";
    next.updatedAt = now;
    return { event: { ...next.event, payload: next.payload! }, interrupted: !!stuck };
  }

  async peekPending(conversationId: string, limit: number) {
    return [...this.inbound.values()]
      .filter((r) => r.event.conversationId === conversationId && r.status === "pending" && r.payload)
      .sort((a, b) => a.event.sentAt - b.event.sentAt || a.arrival - b.arrival)
      .slice(0, limit)
      .map((r) => structuredClone(r.payload!));
  }

  async queueReplies(conversationId: string, key: string, replies: OutboundMessage[], now: number) {
    replies.forEach((message, i) => this.enqueue(conversationId, `${key}#${i}`, message, now));
  }

  private enqueue(conversationId: string, id: string, message: OutboundMessage, now: number) {
    if (this.outbox.has(id)) return;
    this.outbox.set(id, { id, conversationId, order: ++this.counter, message, status: "pending", attempts: 0, nextAttemptAt: now, leaseUntil: 0, updatedAt: now });
  }

  async getSession(conversationId: string, now: number) {
    const found = this.sessions.get(conversationId);
    if (!found) return undefined;
    if (found.expiresAt <= now) {
      this.sessions.delete(conversationId);
      return undefined;
    }
    return structuredClone(found.session);
  }

  async commit(
    conversationId: string,
    eventId: string,
    change: { session: Session | null; replies: OutboundMessage[]; cancelQueued?: boolean },
    now: number,
  ) {
    const record = this.inbound.get(eventId);
    // Already finished by another worker (this one was presumed dead): change nothing.
    if (!record || record.status !== "processing") return false;
    Object.assign(record, { status: "done", payload: undefined, updatedAt: now });
    if (change.session) this.sessions.set(conversationId, { session: structuredClone(change.session), expiresAt: now + this.retention.contextMs });
    else this.sessions.delete(conversationId);
    if (change.cancelQueued)
      for (const item of this.outbox.values())
        if (item.conversationId === conversationId && (item.status === "pending" || item.status === "sending"))
          Object.assign(item, { status: "cancelled", message: undefined, updatedAt: now });
    change.replies.forEach((message, i) => this.enqueue(conversationId, `${eventId}#${i}`, message, now));
    return true;
  }

  async claimOutbox(conversationId: string, now: number, leaseMs: number): Promise<OutboxItem | undefined> {
    // Strict order: nothing goes out while an earlier reply is still waiting.
    const head = [...this.outbox.values()]
      .filter((i) => i.conversationId === conversationId && (i.status === "pending" || i.status === "sending"))
      .sort((a, b) => a.order - b.order)[0];
    if (!head || head.nextAttemptAt > now || (head.status === "sending" && head.leaseUntil > now)) return undefined;
    Object.assign(head, { status: "sending", leaseUntil: now + leaseMs, attempts: head.attempts + 1, updatedAt: now });
    return { id: head.id, conversationId, message: head.message!, attempts: head.attempts };
  }

  async markSent(itemId: string, now: number) {
    this.finish(itemId, "sent", now);
  }

  async markDead(itemId: string, now: number) {
    this.finish(itemId, "dead", now);
  }

  async markRetry(itemId: string, nextAttemptAt: number, now: number) {
    const item = this.outbox.get(itemId);
    if (item?.status === "sending") Object.assign(item, { status: "pending", nextAttemptAt, leaseUntil: 0, updatedAt: now });
  }

  private finish(itemId: string, status: "sent" | "dead", now: number) {
    const item = this.outbox.get(itemId);
    if (item?.status === "sending") Object.assign(item, { status, message: undefined, updatedAt: now });
  }

  async dueConversations(now: number, limit: number) {
    // Only a conversation's next reply counts: later ones wait behind it.
    const heads = new Map<string, Outbox>();
    for (const i of [...this.outbox.values()].sort((a, b) => a.order - b.order))
      if ((i.status === "pending" || i.status === "sending") && !heads.has(i.conversationId)) heads.set(i.conversationId, i);
    return [...heads.values()]
      .filter((i) => (i.status === "pending" && i.nextAttemptAt <= now) || (i.status === "sending" && i.leaseUntil <= now))
      .map((i) => i.conversationId)
      .slice(0, limit);
  }

  async pendingConversations(_now: number, limit: number) {
    const pending = new Set<string>();
    for (const r of this.inbound.values()) if (r.status !== "done" && r.payload) pending.add(r.event.conversationId);
    return [...pending].slice(0, limit);
  }

  async sweep(now: number) {
    const { contextMs, eventIdMs, outboxRecordMs } = this.retention;
    for (const [id, s] of this.sessions) if (s.expiresAt <= now) this.sessions.delete(id);
    for (const [id, r] of this.inbound) {
      if (r.status === "done" && now - r.updatedAt >= eventIdMs) this.inbound.delete(id);
      // Never handled within the context window: too stale to answer. Its content goes; its id stays.
      else if (r.status !== "done" && now - r.updatedAt >= contextMs) Object.assign(r, { status: "done", payload: undefined, updatedAt: now });
    }
    for (const [id, i] of this.outbox) {
      if (["sent", "dead", "cancelled"].includes(i.status) && now - i.updatedAt >= outboxRecordMs) this.outbox.delete(id);
      else if ((i.status === "pending" || i.status === "sending") && now - i.updatedAt >= contextMs)
        Object.assign(i, { status: "dead", message: undefined, updatedAt: now });
    }
    for (const [id, l] of this.locks) if (l.until <= now) this.locks.delete(id);
  }
}
