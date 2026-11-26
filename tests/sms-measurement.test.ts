import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseMetricsSink } from "../src/lib/sms/supabase-metrics";
import { RETENTION_DAYS, type RequestRow } from "../src/lib/sms/metrics";
import { completeDays, twilioDailyCounts } from "../src/lib/ops/twilio-counts";
import { buildReport, type RequestRecord } from "../src/lib/ops/report";
import { renderOpsPage, summaryLines } from "../src/lib/ops/page";

// A stand-in for the two measurement tables that fails on demand.
function fakeClient(failTimes = 0) {
  const calls: { table: string; op: string; args: unknown[] }[] = [];
  let failures = failTimes;
  const result = async () => (failures-- > 0 ? { error: { code: "XX000" } } : { error: null });
  const client = {
    from: (table: string) => ({
      upsert: (...args: unknown[]) => (calls.push({ table, op: "upsert", args }), result()),
      delete: () => ({ lt: (...args: unknown[]) => (calls.push({ table, op: "delete", args }), result()) }),
    }),
  };
  return { calls, client: client as unknown as SupabaseClient };
}

const row = { message_sid: "SM1", number_key: "k", received_at: new Date().toISOString() } as RequestRow;

describe("recording is reliable, and says when it isn't", () => {
  it("tries a failed write a second time before counting it as lost", async () => {
    const { calls, client } = fakeClient(1);
    const lost: string[] = [];
    await new SupabaseMetricsSink(client, (w) => lost.push(w), 0).started(row);
    expect(calls).toHaveLength(2);
    expect(lost).toEqual([]);
  });

  it("reports a write that failed twice", async () => {
    const { client } = fakeClient(2);
    const lost: string[] = [];
    await new SupabaseMetricsSink(client, (w) => lost.push(w), 0).finished(row);
    expect(lost).toEqual(["finish"]);
  });

  it("writes the whole record at the finish, so it lands even if the start was lost", async () => {
    const { calls, client } = fakeClient();
    await new SupabaseMetricsSink(client, () => {}, 0).finished(row);
    expect(calls[0]).toMatchObject({ table: "sms_requests", op: "upsert", args: [row, { onConflict: "message_sid" }] });
  });

  it("deletes records older than the retention period", async () => {
    const { calls, client } = fakeClient();
    const now = Date.UTC(2026, 10, 26);
    await new SupabaseMetricsSink(client, () => {}, 0).prune(now);
    const cutoff = new Date(now - RETENTION_DAYS * 86_400_000).toISOString();
    expect(calls).toEqual(
      expect.arrayContaining([
        { table: "sms_requests", op: "delete", args: ["received_at", cutoff] },
        { table: "sms_outbound", op: "delete", args: ["submitted_at", cutoff] },
      ]),
    );
    expect(RETENTION_DAYS).toBe(90);
  });
});

describe("Twilio's own counts, to check the records are complete", () => {
  it("counts each day's texts in and out across pages, and keeps only counts", async () => {
    const urls: string[] = [];
    const page = (messages: { direction: string }[], next: string | null) => new Response(JSON.stringify({ messages, next_page_uri: next }));
    const counts = await twilioDailyCounts({
      accountSid: "AC1",
      authToken: "t",
      number: "+18550000000",
      days: ["2026-11-25"],
      fetch: async (url) => {
        urls.push(url);
        if (url.includes("To=")) return url.includes("Page=1") ? page([{ direction: "inbound" }], null) : page([{ direction: "inbound" }, { direction: "inbound" }], "/2010-04-01/Accounts/AC1/Messages.json?To=x&Page=1");
        return page([{ direction: "outbound-api" }, { direction: "outbound-reply" }, { direction: "inbound" }], null);
      },
    });
    expect(counts).toEqual({ "2026-11-25": { inbound: 3, outbound: 2 } });
    expect(urls[0]).toContain("DateSent=2026-11-25");
  });

  it("says it couldn't check, rather than reporting zero", async () => {
    expect(await twilioDailyCounts({ accountSid: "AC1", authToken: "t", number: "+1", days: ["2026-11-25"], fetch: async () => new Response("", { status: 500 }) })).toBeNull();
    expect(await twilioDailyCounts({ accountSid: "", authToken: "", number: "", days: ["2026-11-25"] })).toBeNull();
  });

  it("checks only complete days", () => {
    expect(completeDays(Date.UTC(2026, 10, 26, 15), 2)).toEqual(["2026-11-25", "2026-11-24"]);
  });
});

const T = Date.UTC(2026, 10, 26, 12);
const H = 3_600_000;
const rec = (key: string, atMs: number, over: Partial<RequestRecord> = {}): RequestRecord => ({
  message_sid: `SM${key}${atMs}`,
  number_key: key,
  received_at: new Date(atMs).toISOString(),
  finished_at: new Date(atMs + 8_000).toISOString(),
  has_text: true,
  photo_count: 0,
  outcome: "answered",
  advisor_id: "gio",
  ack_ms: 900,
  still_thinking_ms: null,
  answer_ms: 8_000,
  texts_sent: 2,
  segments_sent: 3,
  send_failures: 0,
  save_failures: 0,
  model_calls: [{ purpose: "answer", model: "claude-opus-5-5", ms: 7_000, input: 1000, output: 100 }],
  error_class: null,
  ...over,
});

describe("the owner's view: adoption, recovery, completeness", () => {
  const requests = [
    // Returning: texted three weeks ago, and twice this week on different days.
    rec("ann", T - 21 * 24 * H),
    rec("ann", T - 3 * 24 * H, { advisor_id: "alden" }),
    rec("ann", T - 1 * 24 * H, { advisor_id: "alden" }),
    // New this week; one answer failed, then they tried again 10 minutes later.
    rec("ben", T - 2 * H, { outcome: "fallback", advisor_id: "martini" }),
    rec("ben", T - 2 * H + 10 * 60_000, { advisor_id: "martini" }),
    // New, stalled and never came back.
    rec("cat", T - 5 * H, { outcome: "stalled" }),
  ];
  const report = buildReport({
    requests,
    outbound: [{ sid: "o1", request_sid: null, kind: "answer", segments: 3, submitted_at: new Date(T - 26 * H).toISOString(), status: null, error_code: null, delivered_at: null }],
    from: new Date(T - 7 * 24 * H),
    to: new Date(T),
    now: T,
    twilio: { "2026-11-25": { inbound: 2, outbound: 1 } },
  });

  it("separates new from returning people, and counts who came back on another day", () => {
    expect(report.adoption).toMatchObject({ people: 3, newPeople: 2, returningPeople: 1, repeatPeople: 1 });
    expect(report.adoption.peopleByAdvisor).toEqual({ alden: 1, martini: 1 });
    expect(report.adoption.weekly[0]).toMatchObject({ people: 3 });
    expect(report.recordsSince).toBe(new Date(T - 21 * 24 * H).toISOString());
  });

  it("counts what went wrong and whether the person got an answer soon after", () => {
    expect(report.recovery).toEqual({ problems: 2, recovered: 1, byKind: { "answer failed": 1, "took too long": 1 } });
  });

  it("checks each day against Twilio, so a lost record shows as a gap", () => {
    expect(report.measurement.days).toEqual([{ day: "2026-11-25", twilioIn: 2, recordedIn: 1, twilioOut: 1, recordedOut: 1 }]);
    const html = renderOpsPage(report, { days: 7, recorded: true });
    expect(html).toContain("Records missing:");
  });

  it("opens with a plain-language summary", () => {
    const lines = summaryLines(report);
    expect(lines[0]).toBe("3 people used Cinq: 2 new and 1 returning. 1 came back on more than one day.");
    expect(lines.join(" ")).toContain("No request ended in silence.");
    expect(lines.join(" ")).toContain("2 requests went wrong; in 1 of them the person had an answer within 30 minutes.");
  });
});

describe("the migrations", () => {
  const metrics = readFileSync("supabase/migrations/20261126000001_sms_metrics.sql", "utf8");
  const lockdown = readFileSync("supabase/migrations/20261126000002_sms_lockdown.sql", "utf8");

  it("are safe to run again and only add", () => {
    expect(metrics).not.toMatch(/create table public|create index sms_/);
    expect(metrics).not.toMatch(/\b(drop|delete|truncate|alter table public\.sms_sessions|alter table public\.sms_processed_messages)\b/i);
    expect(lockdown).not.toMatch(/\b(drop|delete|truncate|update|insert)\b/i);
  });

  it("keep every SMS table away from the public key", () => {
    for (const t of ["sms_requests", "sms_outbound"]) expect(metrics).toContain(`alter table public.${t} enable row level security`);
    for (const t of ["sms_sessions", "sms_processed_messages"]) expect(lockdown).toContain(`alter table public.${t} enable row level security`);
    expect(metrics).toContain("from anon, authenticated");
    expect(lockdown).toContain("from anon, authenticated");
  });

  it("can each be undone", () => {
    expect(existsSync("supabase/rollback/20261126000001_sms_metrics.down.sql")).toBe(true);
    expect(existsSync("supabase/rollback/20261126000002_sms_lockdown.down.sql")).toBe(true);
  });
});
