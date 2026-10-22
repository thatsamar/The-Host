// Cinq's messaging channel, end to end and provider-neutral:
//
//   webhook ─► verify ─► normalize ─► record once (idempotent) ─► acknowledge
//                                         │
//                    later, one worker per conversation, oldest event first:
//                    route ─► photos ─► Cinq's engine ─► commit replies to the outbox
//                                         │
//                    outbox, strictly in order, retried on a schedule ─► provider
//
// Each event is answered at most once: a redelivered webhook is a duplicate,
// replies are written to the outbox in the same step that marks the event
// done, and an event a crashed worker left behind is not re-asked (one model
// call per question, as on the website) but told to send again.
// Logs carry codes, counts and timings only: never text, photos, names or
// conversation ids.

import { randomUUID } from "node:crypto";
import { fitToBudget } from "@/lib/ask/budget";
import { prepareServerPhoto } from "@/lib/ask/server-photos";
import { MAX_HISTORY_TURNS, MAX_PHOTOS_PER_TURN, type AskImage, type AskTurn } from "@/lib/ask/prompt";
import { timeLimitMessage } from "@/lib/ask/ask";
import { createRateLimiter, questionsPerHour } from "@/lib/ask/rate-limit";
import { COMPANIONS } from "@/lib/companions";
import { errorClass } from "@/lib/diagnostics";
import * as copy from "./copy";
import { splitMessages, toPlainText } from "./format";
import { MAX_SEND_ATTEMPTS, RETRY_BACKOFF_MS } from "./retention";
import { decide, parseIntent, type Ask } from "./router";
import { newSession, preferredRendition, type ChannelStore, type Engine, type InboundPayload, type MessagingAdapter, type OutboundMessage, type Session } from "./types";

export interface ChannelOptions {
  adapter: MessagingAdapter;
  store: ChannelStore;
  engine: Engine;
  now?: () => number;
  /** Model questions per conversation per hour (QUESTIONS_PER_HOUR, as on the website). */
  questionsPerHour?: number;
  /** An answer is stopped after this long, with a plain message. */
  answerTimeoutMs?: number;
  /** A provider call (send, download, support) is abandoned after this long. */
  providerTimeoutMs?: number;
  /** How often a running answer checks whether a reset or close has arrived. */
  cancelPollMs?: number;
}

const DEFAULT_ANSWER_TIMEOUT_MS = 240_000;
const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;
const SEND_LEASE_MS = 60_000;

const log = (what: string, detail: Record<string, unknown>) => console.info(`Messages: ${what}`, JSON.stringify(detail));

function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return run(controller.signal).finally(() => clearTimeout(timer));
}

export function createChannel(options: ChannelOptions) {
  const { adapter, store, engine } = options;
  const now = options.now ?? Date.now;
  const answerTimeoutMs = options.answerTimeoutMs ?? DEFAULT_ANSWER_TIMEOUT_MS;
  const providerTimeoutMs = options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const cancelPollMs = options.cancelPollMs ?? 2_000;
  // Long enough for the longest answer, so a live worker never loses its conversation.
  const leaseMs = answerTimeoutMs + 60_000;
  const limiter = createRateLimiter({ limit: options.questionsPerHour ?? questionsPerHour(), now });
  const lineup = copy.lineup();

  /** Handles one webhook. Answers come later, from `background`, after the provider has its acknowledgement. */
  async function handleWebhook(request: { headers: Headers; rawBody: string }): Promise<{ status: number; background: Promise<void> }> {
    const idle = { background: Promise.resolve() };
    if (!(await adapter.verify(request).catch(() => false))) {
      log("webhook rejected", { provider: adapter.name, code: "unverified" });
      return { status: 401, ...idle };
    }
    let events;
    try {
      events = await adapter.normalize(request);
    } catch (err) {
      log("webhook unreadable", { provider: adapter.name, error: errorClass(err) });
      return { status: 400, ...idle };
    }
    const t = now();
    const conversations = new Set<string>();
    let duplicates = 0;
    for (const event of events) {
      if ((await store.recordInbound(event, t)) === "duplicate") duplicates++;
      conversations.add(event.conversationId);
    }
    log("webhook", { provider: adapter.name, events: events.length, duplicates });
    const background = (async () => {
      await store.sweep(now()).catch((err) => log("sweep failed", { error: errorClass(err) }));
      await Promise.all([...conversations].map((c) => drain(c)));
    })();
    return { status: 200, background };
  }

  /**
   * Works through a conversation's waiting events in order, then sends
   * what's due, all while holding the conversation: replies only go out from
   * the worker that would also see a reset or a close and cancel them.
   */
  async function drain(conversationId: string): Promise<void> {
    const owner = randomUUID();
    // Another worker has it: that worker picks up anything new before letting go.
    while (await store.acquire(conversationId, owner, now(), leaseMs)) {
      let handled = 0;
      try {
        for (let next = await store.claimNext(conversationId, now()); next; next = await store.claimNext(conversationId, now())) {
          await handle(conversationId, next.event.id, next.event.payload, next.interrupted);
          handled++;
          await store.acquire(conversationId, owner, now(), leaseMs);
        }
        await sendDue(conversationId);
      } finally {
        await store.release(conversationId, owner);
      }
      // Something may have arrived between the last check and letting go: look once more.
      if (!handled) break;
    }
  }

  /** Whether something already waiting behind this event cancels it: a reset, or the person closing the conversation. */
  async function cancelledByLater(conversationId: string): Promise<boolean> {
    const isReset = (p: InboundPayload) => {
      if (p.kind !== "message") return false;
      const intent = parseIntent(p.text, p.selection, lineup);
      return intent.kind === "command" && intent.command === "reset";
    };
    return (await store.peekPending(conversationId, 50)).some((p) => p.kind === "conversation_end" || isReset(p));
  }

  async function handle(conversationId: string, eventId: string, event: InboundPayload, interrupted: boolean) {
    const started = now();
    const session = (await store.getSession(conversationId, started)) ?? newSession();
    if (interrupted) {
      log("event interrupted", { code: "interrupted" });
      return store.commit(conversationId, eventId, { session, replies: [{ kind: "text", text: copy.INTERRUPTED }] }, now());
    }
    if (event.kind === "conversation_end") {
      // Closed by the person: clear everything and send nothing more.
      log("conversation ended", {});
      return store.commit(conversationId, eventId, { session: null, replies: [], cancelQueued: true }, now());
    }
    if (event.kind === "support_ended") {
      delete session.withSupport;
      return store.commit(conversationId, eventId, { session, replies: [] }, now());
    }
    // A person from Cinq's team is talking with them; the advisors stay out of it.
    if (session.withSupport) return store.commit(conversationId, eventId, { session, replies: [] }, now());
    // A reset or close is already waiting: don't answer what it cancels.
    if (await cancelledByLater(conversationId)) {
      log("event skipped", { code: "cancelled" });
      return store.commit(conversationId, eventId, { session, replies: [] }, now());
    }

    const decision = decide(session, event, lineup);
    const replies: OutboundMessage[] = [...decision.replies];
    let next = decision.session;

    if (decision.support) {
      const result = await withTimeout(providerTimeoutMs, () => adapter.requestSupport(conversationId)).catch((err) => {
        log("support request failed", { provider: adapter.name, error: errorClass(err) });
        return undefined;
      });
      replies.push({ kind: "text", text: result ? copy.support(result) : copy.SUPPORT_FAILED });
      if (result?.status === "queued" && next) next.withSupport = true;
      log("support requested", { status: result?.status ?? "failed" });
    }

    if (decision.ask && next) {
      if (!session.welcomed) {
        // First contact goes straight to an advisor: say at once, within
        // Apple's five seconds, that this is automated and who is answering.
        await store.queueReplies(conversationId, `${eventId}#notice`, [{ kind: "text", text: copy.firstAnswerNotice(decision.ask.advisor) }], now());
        await sendDue(conversationId);
      }
      const answered = await answer(conversationId, next, decision.ask);
      if (answered.cancelled) {
        log("answer cancelled", { advisor: decision.ask.advisor, code: "cancelled" });
        return store.commit(conversationId, eventId, { session, replies: [] }, now());
      }
      replies.push(...answered.replies);
      next = answered.session;
    }
    if (!(await store.commit(conversationId, eventId, { session: next, replies, cancelQueued: decision.cancelQueued }, now())))
      log("answer dropped", { code: "superseded" });
  }

  async function photos(ask: Ask): Promise<{ images: AskImage[]; small: AskImage[] } | { problem: Parameters<typeof copy.photoProblem>[0] }> {
    if (ask.attachments.length > MAX_PHOTOS_PER_TURN) return { problem: "too_many" };
    const images: AskImage[] = [];
    const small: AskImage[] = [];
    for (const ref of ask.attachments) {
      let bytes: Uint8Array;
      try {
        bytes = await withTimeout(providerTimeoutMs, (signal) => adapter.fetchAttachment(preferredRendition(ref), signal));
      } catch (err) {
        log("attachment download failed", { provider: adapter.name, error: errorClass(err) });
        return { problem: "unreadable" };
      }
      // The same two sizes the website's browser makes; iPhone HEIC included.
      const prepared = await prepareServerPhoto(bytes);
      if (!prepared.ok) return { problem: prepared.reason };
      images.push(prepared.full);
      small.push(prepared.small);
    }
    return { images, small };
  }

  async function answer(conversationId: string, session: Session, ask: Ask): Promise<{ session: Session; replies: OutboundMessage[]; cancelled?: boolean }> {
    const say = (text: string): OutboundMessage => ({ kind: "text", text });
    const name = COMPANIONS[ask.advisor].name;
    const allowed = limiter(conversationId);
    if (!allowed.ok) {
      log("rate limited", { advisor: ask.advisor });
      return { session, replies: [say(copy.TOO_MANY_QUESTIONS)] };
    }
    const found = await photos(ask);
    if ("problem" in found) {
      log("photos refused", { code: found.problem, photos: ask.attachments.length });
      return { session, replies: [say(copy.photoProblem(found.problem))] };
    }
    const history = session.histories[ask.advisor] ?? [];
    const question: AskTurn = { role: "user", text: ask.text, images: found.images.length ? found.images : undefined };
    let turns: AskTurn[];
    try {
      turns = fitToBudget([...history, question]);
    } catch {
      return { session, replies: [say(copy.photoProblem("budget"))] };
    }

    const started = now();
    await adapter.typing(conversationId, true).catch(() => {});
    let timedOut = false;
    let cancelled = false;
    const stop = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      stop.abort();
    }, answerTimeoutMs);
    // A reset or close sent while the answer is being written stops it: no
    // point paying for the rest of an answer that will never be sent.
    const watch = setInterval(() => {
      void cancelledByLater(conversationId).then((yes) => {
        if (yes && !stop.signal.aborted) {
          cancelled = true;
          stop.abort();
        }
      }, () => {});
    }, cancelPollMs);
    const result = await engine
      .answer(ask.advisor, turns, stop.signal)
      .catch((err) => ({ text: "", error: err instanceof Error && err.message ? err.message : copy.UNAVAILABLE }))
      .finally(() => {
        clearTimeout(timer);
        clearInterval(watch);
      });
    await adapter.typing(conversationId, false).catch(() => {});
    if (cancelled) return { session, replies: [], cancelled: true };

    const written = toPlainText(result.text);
    // The advisor's name heads their first reply, and stays with its first paragraph.
    const text = written && ask.introduce ? `${copy.introduction(ask.advisor)}\n\n${written}` : written;
    const parts = text ? splitMessages(text, adapter.limits.preferredTextChars, adapter.limits.maxTextChars) : [];
    log("answer", {
      advisor: ask.advisor,
      outcome: result.error ? (timedOut ? "time-limit" : "error") : "answered",
      ms: now() - started,
      photos: found.images.length,
      textChars: ask.text.length,
      answerChars: result.text.length,
      messages: parts.length,
    });

    if (result.error) {
      // Keep whatever was written, say plainly what happened, and leave the
      // advisor's history as it was so a resend isn't a duplicate turn.
      const message = timedOut ? timeLimitMessage(name) : result.error;
      return { session, replies: [...parts.map(say), say(`${message} ${copy.RETRY_HINT}`)] };
    }

    // Like the website, later questions carry the smaller copies of earlier photos.
    const asked: AskTurn = { ...question, images: found.small.length ? found.small : undefined };
    const kept = fitToBudget([...history, asked, { role: "assistant", text: result.text }]).slice(-MAX_HISTORY_TURNS);
    const next: Session = { ...session, histories: { ...session.histories, [ask.advisor]: kept } };
    if (!next.introduced.includes(ask.advisor)) next.introduced = [...next.introduced, ask.advisor];
    return { session: next, replies: parts.map(say) };
  }

  /** Sends a conversation's due replies, unless another worker holds it (that worker sends them). */
  async function flush(conversationId: string): Promise<void> {
    const owner = randomUUID();
    if (!(await store.acquire(conversationId, owner, now(), leaseMs))) return;
    try {
      await sendDue(conversationId);
    } finally {
      await store.release(conversationId, owner);
    }
  }

  /** Sends due replies in order until one has to wait, or a waiting reset or close will cancel the rest. Call while holding the conversation. */
  async function sendDue(conversationId: string): Promise<void> {
    while (!(await cancelledByLater(conversationId))) {
      const item = await store.claimOutbox(conversationId, now(), SEND_LEASE_MS);
      if (!item) return;
      const result = await withTimeout(providerTimeoutMs, (signal) => adapter.send(conversationId, item.message, item.id, signal)).catch(
        (err) => ({ ok: false as const, retryable: true as const, code: errorClass(err) }),
      );
      if (result.ok) {
        await store.markSent(item.id, now());
        continue;
      }
      if (result.retryable && item.attempts < MAX_SEND_ATTEMPTS) {
        await store.markRetry(item.id, now() + RETRY_BACKOFF_MS[item.attempts - 1], now());
        log("send retry", { provider: adapter.name, code: result.code, attempt: item.attempts });
        return;
      }
      await store.markDead(item.id, now());
      log("send abandoned", { provider: adapter.name, code: result.code, attempts: item.attempts });
    }
  }

  /** For a scheduled job: retries due replies, finishes stranded events and applies the retention schedule. */
  async function runDue(limit = 100): Promise<void> {
    await store.sweep(now());
    for (const c of await store.pendingConversations(now(), limit)) await drain(c);
    for (const c of await store.dueConversations(now(), limit)) await flush(c);
  }

  return { handleWebhook, drain, flush, runDue };
}

export type Channel = ReturnType<typeof createChannel>;
