// A durable ChannelStore on Postgres. It needs only a client with `query`
// and `transaction` (PGlite has exactly these; a node-postgres or serverless
// driver needs a few lines of wrapping), so choosing the database stays a
// launch decision. Times are ms since epoch, passed in, so tests control them.
// JSON goes in as text cast to jsonb, so every driver stores an object, not a
// JSON string (postgres.js would otherwise encode a string parameter twice).
// Content (text, attachment references, replies, sessions) is cleared on the
// schedule in retention.ts; ids and statuses outlive it briefly to stop
// redelivered events from being answered twice.

import type { Retention } from "./retention";
import type { ChannelStore, InboundEvent, OutboundMessage, OutboxItem, Session, StoredInbound } from "./types";

export interface SqlQuery {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface SqlClient extends SqlQuery {
  transaction<T>(fn: (tx: SqlQuery) => Promise<T>): Promise<T>;
}

/** Tables for the messaging channel. Review and apply as a migration at launch; nothing applies it automatically. */
export const CHANNEL_SCHEMA = `
create table if not exists channel_inbound (
  event_id text primary key,
  conversation_id text not null,
  arrival bigint generated always as identity,
  sent_at double precision not null,
  status text not null check (status in ('pending', 'processing', 'done')),
  payload jsonb,
  updated_at double precision not null
);
create index if not exists channel_inbound_open on channel_inbound (conversation_id, sent_at, arrival) where status <> 'done';

create table if not exists channel_sessions (
  conversation_id text primary key,
  state jsonb not null,
  expires_at double precision not null
);

create table if not exists channel_locks (
  conversation_id text primary key,
  owner text not null,
  lease_until double precision not null
);

create table if not exists channel_outbox (
  id text primary key,
  conversation_id text not null,
  position bigint generated always as identity,
  status text not null check (status in ('pending', 'sending', 'sent', 'dead', 'cancelled')),
  message jsonb,
  attempts integer not null default 0,
  next_attempt_at double precision not null,
  lease_until double precision not null default 0,
  updated_at double precision not null
);
create index if not exists channel_outbox_open on channel_outbox (conversation_id, position) where status in ('pending', 'sending');

-- Row-level security on, with no policies: only the server's own database
-- role (which bypasses it) can read or write. On Supabase this keeps the
-- tables out of reach of the public API keys.
alter table channel_inbound enable row level security;
alter table channel_sessions enable row level security;
alter table channel_locks enable row level security;
alter table channel_outbox enable row level security;

create or replace function channel_sweep(now_ms double precision, context_ms double precision, event_id_ms double precision, outbox_record_ms double precision)
returns void language sql as $fn$
  delete from channel_sessions where expires_at <= now_ms;
  delete from channel_inbound where status = 'done' and updated_at <= now_ms - event_id_ms;
  update channel_inbound set status = 'done', payload = null, updated_at = now_ms where status <> 'done' and updated_at <= now_ms - context_ms;
  delete from channel_outbox where status in ('sent', 'dead', 'cancelled') and updated_at <= now_ms - outbox_record_ms;
  update channel_outbox set status = 'dead', message = null, updated_at = now_ms where status in ('pending', 'sending') and updated_at <= now_ms - context_ms;
  delete from channel_locks where lease_until <= now_ms;
$fn$;
`;

/**
 * The retention schedule run by the database itself, so deletion doesn't
 * depend on traffic or the host's cron limits. For Postgres with pg_cron
 * (Supabase: Integrations → Cron). Review and apply at launch; every
 * webhook also runs the same sweep.
 */
export function sweepSchedule(retention: Retention, every = "*/15 * * * *"): string {
  return `select cron.schedule('cinq-messages-sweep', '${every}', $job$select channel_sweep(extract(epoch from now()) * 1000, ${retention.contextMs}, ${retention.eventIdMs}, ${retention.outboxRecordMs})$job$);`;
}

/**
 * Splits a migration into statements: at semicolons that end a line,
 * except inside a dollar-quoted body ($fn$ … $fn$), with comment lines dropped.
 */
export function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (const line of sql.split("\n")) {
    if (!quote && /^\s*--/.test(line)) continue;
    current += `${line}\n`;
    for (const tag of line.match(/\$[A-Za-z_]*\$/g) ?? []) quote = quote === tag ? undefined : (quote ?? tag);
    if (!quote && /;\s*$/.test(line)) {
      statements.push(current.trim().replace(/;$/, ""));
      current = "";
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

export class PostgresStore implements ChannelStore {
  constructor(
    private readonly sql: SqlClient,
    private readonly retention: Retention,
  ) {}

  /** Creates the tables for tests and local runs. A hosted database gets them from db/messages/ at launch. */
  async migrate() {
    for (const statement of splitSql(CHANNEL_SCHEMA)) await this.sql.query(statement);
  }

  async recordInbound(event: InboundEvent, now: number) {
    const { rows } = await this.sql.query(
      `insert into channel_inbound (event_id, conversation_id, sent_at, status, payload, updated_at)
       values ($1, $2, $3, 'pending', $4::text::jsonb, $5) on conflict (event_id) do nothing returning event_id`,
      [event.id, event.conversationId, event.sentAt, JSON.stringify(event.payload), now],
    );
    return rows.length ? ("new" as const) : ("duplicate" as const);
  }

  async acquire(conversationId: string, owner: string, now: number, leaseMs: number) {
    const { rows } = await this.sql.query(
      `insert into channel_locks (conversation_id, owner, lease_until) values ($1, $2, $3)
       on conflict (conversation_id) do update set owner = excluded.owner, lease_until = excluded.lease_until
       where channel_locks.owner = excluded.owner or channel_locks.lease_until <= $4
       returning owner`,
      [conversationId, owner, now + leaseMs, now],
    );
    return rows.length > 0;
  }

  async release(conversationId: string, owner: string) {
    await this.sql.query(`delete from channel_locks where conversation_id = $1 and owner = $2`, [conversationId, owner]);
  }

  async claimNext(conversationId: string, now: number): Promise<StoredInbound | undefined> {
    return this.sql.transaction(async (tx) => {
      const { rows } = await tx.query<{ event_id: string; sent_at: number; status: string; payload: InboundEvent["payload"] }>(
        `select event_id, sent_at, status, payload from channel_inbound
         where conversation_id = $1 and status <> 'done' and payload is not null
         order by (status = 'processing') desc, sent_at, arrival limit 1 for update`,
        [conversationId],
      );
      const row = rows[0];
      if (!row) return undefined;
      await tx.query(`update channel_inbound set status = 'processing', updated_at = $2 where event_id = $1`, [row.event_id, now]);
      return {
        event: { id: row.event_id, conversationId, sentAt: Number(row.sent_at), payload: row.payload },
        interrupted: row.status === "processing",
      };
    });
  }

  async peekPending(conversationId: string, limit: number) {
    const { rows } = await this.sql.query<{ payload: InboundEvent["payload"] }>(
      `select payload from channel_inbound where conversation_id = $1 and status = 'pending' and payload is not null
       order by sent_at, arrival limit $2`,
      [conversationId, limit],
    );
    return rows.map((r) => r.payload);
  }

  async queueReplies(conversationId: string, key: string, replies: OutboundMessage[], now: number) {
    await this.sql.transaction(async (tx) => {
      for (const [i, message] of replies.entries()) await this.enqueue(tx, conversationId, `${key}#${i}`, message, now);
    });
  }

  private async enqueue(tx: SqlQuery, conversationId: string, id: string, message: OutboundMessage, now: number) {
    await tx.query(
      `insert into channel_outbox (id, conversation_id, status, message, next_attempt_at, updated_at)
       values ($1, $2, 'pending', $3::text::jsonb, $4, $4) on conflict (id) do nothing`,
      [id, conversationId, JSON.stringify(message), now],
    );
  }

  async getSession(conversationId: string, now: number) {
    const { rows } = await this.sql.query<{ state: Session; expires_at: number }>(
      `select state, expires_at from channel_sessions where conversation_id = $1`,
      [conversationId],
    );
    const row = rows[0];
    if (!row) return undefined;
    if (Number(row.expires_at) <= now) {
      await this.sql.query(`delete from channel_sessions where conversation_id = $1 and expires_at <= $2`, [conversationId, now]);
      return undefined;
    }
    return row.state;
  }

  async commit(
    conversationId: string,
    eventId: string,
    change: { session: Session | null; replies: OutboundMessage[]; cancelQueued?: boolean },
    now: number,
  ) {
    return this.sql.transaction(async (tx) => {
      const { rows } = await tx.query(
        `update channel_inbound set status = 'done', payload = null, updated_at = $2 where event_id = $1 and status = 'processing' returning event_id`,
        [eventId, now],
      );
      // Already finished by another worker (this one was presumed dead): change nothing.
      if (!rows.length) return false;
      if (change.session)
        await tx.query(
          `insert into channel_sessions (conversation_id, state, expires_at) values ($1, $2::text::jsonb, $3)
           on conflict (conversation_id) do update set state = excluded.state, expires_at = excluded.expires_at`,
          [conversationId, JSON.stringify(change.session), now + this.retention.contextMs],
        );
      else await tx.query(`delete from channel_sessions where conversation_id = $1`, [conversationId]);
      if (change.cancelQueued)
        await tx.query(
          `update channel_outbox set status = 'cancelled', message = null, updated_at = $2
           where conversation_id = $1 and status in ('pending', 'sending')`,
          [conversationId, now],
        );
      for (const [i, message] of change.replies.entries()) await this.enqueue(tx, conversationId, `${eventId}#${i}`, message, now);
      return true;
    });
  }

  async claimOutbox(conversationId: string, now: number, leaseMs: number): Promise<OutboxItem | undefined> {
    return this.sql.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string; status: string; message: OutboundMessage; attempts: number; next_attempt_at: number; lease_until: number }>(
        `select id, status, message, attempts, next_attempt_at, lease_until from channel_outbox
         where conversation_id = $1 and status in ('pending', 'sending') order by position limit 1 for update`,
        [conversationId],
      );
      const head = rows[0];
      if (!head || Number(head.next_attempt_at) > now || (head.status === "sending" && Number(head.lease_until) > now)) return undefined;
      await tx.query(
        `update channel_outbox set status = 'sending', lease_until = $2, attempts = attempts + 1, updated_at = $3 where id = $1`,
        [head.id, now + leaseMs, now],
      );
      return { id: head.id, conversationId, message: head.message, attempts: head.attempts + 1 };
    });
  }

  async markSent(itemId: string, now: number) {
    await this.sql.query(`update channel_outbox set status = 'sent', message = null, updated_at = $2 where id = $1 and status = 'sending'`, [itemId, now]);
  }

  async markDead(itemId: string, now: number) {
    await this.sql.query(`update channel_outbox set status = 'dead', message = null, updated_at = $2 where id = $1 and status = 'sending'`, [itemId, now]);
  }

  async markRetry(itemId: string, nextAttemptAt: number, now: number) {
    await this.sql.query(
      `update channel_outbox set status = 'pending', next_attempt_at = $2, lease_until = 0, updated_at = $3 where id = $1 and status = 'sending'`,
      [itemId, nextAttemptAt, now],
    );
  }

  async dueConversations(now: number, limit: number) {
    const { rows } = await this.sql.query<{ conversation_id: string }>(
      `select conversation_id from (
         select distinct on (conversation_id) conversation_id, status, next_attempt_at, lease_until from channel_outbox
         where status in ('pending', 'sending') order by conversation_id, position
       ) head
       where (status = 'pending' and next_attempt_at <= $1) or (status = 'sending' and lease_until <= $1) limit $2`,
      [now, limit],
    );
    return rows.map((r) => r.conversation_id);
  }

  async pendingConversations(_now: number, limit: number) {
    const { rows } = await this.sql.query<{ conversation_id: string }>(
      `select distinct conversation_id from channel_inbound where status <> 'done' and payload is not null limit $1`,
      [limit],
    );
    return rows.map((r) => r.conversation_id);
  }

  async sweep(now: number) {
    const { contextMs, eventIdMs, outboxRecordMs } = this.retention;
    await this.sql.query(`select channel_sweep($1, $2, $3, $4)`, [now, contextMs, eventIdMs, outboxRecordMs]);
  }
}
