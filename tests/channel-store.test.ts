import { afterAll, describe, expect, it, vi } from "vitest";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createPostgresClient } from "@/lib/channel/postgres-client";

vi.setConfig({ testTimeout: 30_000 });
import { PGlite } from "@electric-sql/pglite";
import { MemoryStore } from "@/lib/channel/memory-store";
import { PostgresStore } from "@/lib/channel/postgres-store";
import { retention } from "@/lib/channel/retention";
import { newSession, type ChannelStore, type InboundEvent } from "@/lib/channel/types";

// The contract every channel store keeps. Run against the in-memory store and
// against Postgres (PGlite, a real Postgres in this process).

const R = retention("24");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ev = (id: string, sentAt: number, text = id, conversationId = "c1"): InboundEvent => ({
  id,
  conversationId,
  sentAt,
  payload: { kind: "message", text, attachments: [] },
});

const stores: [string, () => Promise<ChannelStore>][] = [
  ["memory", async () => new MemoryStore(R)],
  [
    "postgres",
    async () => {
      // One Postgres for the file, emptied for each test: starting one is slow under a full parallel run.
      db ??= new PGlite();
      const store = new PostgresStore(db, R);
      await store.migrate();
      await db.query("truncate channel_inbound, channel_sessions, channel_locks, channel_outbox");
      return store;
    },
  ],
];
let db: PGlite | undefined;

// The production driver (postgres.js) over the Postgres wire protocol, against
// PGlite's socket server: the same SQL, parameters and JSON handling as a
// hosted database. One connection, since PGlite is a single session.
let wire: { server: PGLiteSocketServer; client: ReturnType<typeof createPostgresClient>; db: PGlite } | undefined;
stores.push([
  "postgres over the wire (postgres.js)",
  async () => {
    if (!wire) {
      const pg = new PGlite();
      const server = new PGLiteSocketServer({ db: pg, port: 0, maxConnections: 1 });
      await server.start();
      const conn = server.getServerConn();
      wire = { server, db: pg, client: createPostgresClient(`postgres://postgres@${conn}/postgres?sslmode=disable`, { max: 1 }) };
    }
    const store = new PostgresStore(wire.client, R);
    await store.migrate();
    await wire.client.query("truncate channel_inbound, channel_sessions, channel_locks, channel_outbox");
    return store;
  },
]);
afterAll(async () => {
  await wire?.client.end();
  await wire?.server.stop();
});

describe.each(stores)("%s store", (_name, make) => {
  it("records an event once; a redelivery is a duplicate", async () => {
    const s = await make();
    expect(await s.recordInbound(ev("e1", 1), 0)).toBe("new");
    expect(await s.recordInbound(ev("e1", 1), 5)).toBe("duplicate");
    const first = await s.claimNext("c1", 10);
    await s.commit("c1", "e1", { session: newSession(), replies: [] }, 11);
    // Still a duplicate after it has been handled and its content cleared.
    expect(await s.recordInbound(ev("e1", 1), 20)).toBe("duplicate");
    expect(first?.event.id).toBe("e1");
    expect(await s.claimNext("c1", 30)).toBeUndefined();
  });

  it("hands out a conversation's events oldest first, whatever order they arrived in", async () => {
    const s = await make();
    await s.recordInbound(ev("late", 300), 0);
    await s.recordInbound(ev("early", 100), 1);
    await s.recordInbound(ev("other", 50, "x", "c2"), 2);
    await s.recordInbound(ev("mid", 200), 3);
    const order: string[] = [];
    for (let n = await s.claimNext("c1", 10); n; n = await s.claimNext("c1", 10)) {
      order.push(n.event.id);
      await s.commit("c1", n.event.id, { session: newSession(), replies: [] }, 10);
    }
    expect(order).toEqual(["early", "mid", "late"]);
  });

  it("lets one worker hold a conversation until its lease runs out", async () => {
    const s = await make();
    expect(await s.acquire("c1", "a", 0, 1000)).toBe(true);
    expect(await s.acquire("c1", "b", 500, 1000)).toBe(false);
    expect(await s.acquire("c1", "a", 600, 1000)).toBe(true);
    expect(await s.acquire("c1", "b", 1700, 1000)).toBe(true);
    await s.release("c1", "a");
    expect(await s.acquire("c1", "a", 1800, 1000)).toBe(false);
    await s.release("c1", "b");
    expect(await s.acquire("c1", "a", 1900, 1000)).toBe(true);
  });

  it("reports an event a crashed worker left half-done", async () => {
    const s = await make();
    await s.recordInbound(ev("e1", 1), 0);
    await s.recordInbound(ev("e2", 2), 0);
    expect(await s.claimNext("c1", 10)).toMatchObject({ event: { id: "e1" }, interrupted: false });
    // The worker dies here; the next one finds e1 first, flagged.
    expect(await s.claimNext("c1", 20)).toMatchObject({ event: { id: "e1" }, interrupted: true });
  });

  it("commits replies in order and sends them one at a time, strictly in order", async () => {
    const s = await make();
    await s.recordInbound(ev("e1", 1), 0);
    await s.claimNext("c1", 0);
    const replies = ["one", "two", "three"].map((text) => ({ kind: "text" as const, text }));
    await s.commit("c1", "e1", { session: newSession(), replies }, 0);
    const a = await s.claimOutbox("c1", 1, 60_000);
    expect(a).toMatchObject({ id: "e1#0", message: { text: "one" }, attempts: 1 });
    // The next can't go while the first is out.
    expect(await s.claimOutbox("c1", 2, 60_000)).toBeUndefined();
    await s.markRetry(a!.id, 1000, 3);
    expect(await s.claimOutbox("c1", 500, 60_000)).toBeUndefined();
    expect(await s.dueConversations(500, 10)).toEqual([]);
    expect(await s.dueConversations(1000, 10)).toEqual(["c1"]);
    const again = await s.claimOutbox("c1", 1000, 60_000);
    expect(again).toMatchObject({ id: "e1#0", attempts: 2 });
    await s.markSent(again!.id, 1001);
    const b = await s.claimOutbox("c1", 1002, 60_000);
    expect(b).toMatchObject({ id: "e1#1", message: { text: "two" } });
    await s.markDead(b!.id, 1003);
    expect(await s.claimOutbox("c1", 1004, 60_000)).toMatchObject({ id: "e1#2" });
  });

  it("offers a send again when the worker sending it disappeared", async () => {
    const s = await make();
    await s.recordInbound(ev("e1", 1), 0);
    await s.claimNext("c1", 0);
    await s.commit("c1", "e1", { session: newSession(), replies: [{ kind: "text", text: "hi" }] }, 0);
    await s.claimOutbox("c1", 0, 60_000);
    expect(await s.claimOutbox("c1", 30_000, 60_000)).toBeUndefined();
    expect(await s.claimOutbox("c1", 60_000, 60_000)).toMatchObject({ id: "e1#0", attempts: 2 });
  });

  it("closing a conversation cancels everything still waiting to go out", async () => {
    const s = await make();
    await s.recordInbound(ev("e1", 1), 0);
    await s.claimNext("c1", 0);
    await s.commit("c1", "e1", { session: newSession(), replies: [{ kind: "text", text: "a" }, { kind: "text", text: "b" }] }, 0);
    await s.recordInbound({ id: "end", conversationId: "c1", sentAt: 2, payload: { kind: "conversation_end" } }, 1);
    await s.claimNext("c1", 1);
    await s.commit("c1", "end", { session: null, replies: [], cancelQueued: true }, 1);
    expect(await s.claimOutbox("c1", 2, 60_000)).toBeUndefined();
    expect(await s.getSession("c1", 2)).toBeUndefined();
  });

  it("forgets a session when its context window passes, on read and in the sweep", async () => {
    const s = await make();
    await s.recordInbound(ev("e1", 1), 0);
    await s.claimNext("c1", 0);
    const session = { ...newSession(), active: "tony" as const };
    await s.commit("c1", "e1", { session, replies: [] }, 0);
    expect(await s.getSession("c1", DAY - 1)).toMatchObject({ active: "tony" });
    expect(await s.getSession("c1", DAY)).toBeUndefined();
  });

  it("clears content and old records on the retention schedule", async () => {
    const s = await make();
    // Never handled within the context window: dropped, not answered a day late.
    await s.recordInbound(ev("stale", 1), 0);
    await s.sweep(DAY);
    expect(await s.claimNext("c1", DAY)).toBeUndefined();
    expect(await s.pendingConversations(DAY, 10)).toEqual([]);
    // Its id still catches a redelivery for a week, then goes.
    expect(await s.recordInbound(ev("stale", 1), DAY + 1)).toBe("duplicate");
    await s.sweep(DAY + 7 * DAY);
    expect(await s.recordInbound(ev("stale", 1), DAY + 7 * DAY + 1)).toBe("new");
    // A reply that could never be sent is abandoned once the context window passes.
    const t = 10 * DAY;
    await s.recordInbound(ev("e9", t), t);
    await s.claimNext("c1", t);
    await s.claimNext("c1", t); // the "stale" redelivery above
    await s.commit("c1", "e9", { session: newSession(), replies: [{ kind: "text", text: "x" }] }, t);
    await s.sweep(t + DAY);
    expect(await s.claimOutbox("c1", t + DAY, 60_000)).toBeUndefined();
  });
});

describe("the database's own retention job", () => {
  it("deletes expired context on its own schedule, with the database's clock", async () => {
    const { sweepSchedule } = await import("@/lib/channel/postgres-store");
    const pg = new PGlite();
    const store = new PostgresStore(pg, R);
    await store.migrate();
    const t = Date.now() - 25 * HOUR;
    await store.recordInbound(ev("e1", t, "private question"), t);
    await store.claimNext("c1", t);
    await store.commit("c1", "e1", { session: { ...newSession(), active: "tony" }, replies: [{ kind: "text", text: "private answer" }] }, t);
    const schedule = sweepSchedule(R);
    expect(schedule).toMatch(/^select cron\.schedule\('cinq-messages-sweep', '\*\/15 \* \* \* \*', /);
    // Run the job's statement as pg_cron would.
    await pg.query(schedule.match(/\$job\$(.*)\$job\$/)![1]);
    const left = JSON.stringify([(await pg.query("select * from channel_sessions")).rows, (await pg.query("select * from channel_outbox")).rows]);
    expect(left).not.toContain("private");
    expect((await pg.query("select * from channel_sessions")).rows).toEqual([]);
  });
});

describe("the migration files", () => {
  it("match the code that owns them (npm run messages:sql)", async () => {
    const { readFileSync } = await import("node:fs");
    const { CHANNEL_SCHEMA, sweepSchedule } = await import("@/lib/channel/postgres-store");
    const file = (name: string) => readFileSync(new URL(`../db/messages/${name}`, import.meta.url), "utf8");
    expect(file("0001_channel.sql")).toContain(CHANNEL_SCHEMA.trim());
    expect(file("0002_retention_schedule.sql")).toContain(sweepSchedule(R));
  });

  it("apply cleanly, with row-level security on every table", async () => {
    const { readFileSync } = await import("node:fs");
    const { splitSql } = await import("@/lib/channel/postgres-store");
    const pg = new PGlite();
    for (const statement of splitSql(readFileSync(new URL("../db/messages/0001_channel.sql", import.meta.url), "utf8"))) await pg.query(statement);
    const { rows } = await pg.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('channel_inbound', 'channel_sessions', 'channel_locks', 'channel_outbox') order by relname",
    );
    expect(rows).toEqual([
      { relname: "channel_inbound", relrowsecurity: true },
      { relname: "channel_locks", relrowsecurity: true },
      { relname: "channel_outbox", relrowsecurity: true },
      { relname: "channel_sessions", relrowsecurity: true },
    ]);
  });
});
