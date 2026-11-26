/**
 * The operations report behind /ops: aggregates over the baseline records
 * (sms_requests, sms_outbound). Pure, so it is tested without a database.
 * Counts, rates, percentiles and dollars only; it never sees words or numbers.
 */

import type { ModelCall, OutboundKind, Outcome } from "@/lib/sms/metrics";
import { callCost } from "./rates";
import type { DayCount } from "./twilio-counts";

export interface RequestRecord {
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
  model_calls: ModelCall[] | null;
  error_class: string | null;
}

export interface OutboundRecord {
  sid: string;
  request_sid: string | null;
  kind: OutboundKind | null;
  segments: number | null;
  submitted_at: string | null;
  status: string | null;
  error_code: string | null;
  delivered_at: string | null;
}

/** A request still open this long after it arrived ended in silence: its worker died. */
export const SILENT_AFTER_MS = 10 * 60 * 1000;
/** The approved starting grouping windows, measured against real traffic. */
export const PHOTO_WINDOW_MS = 4_000;
export const TEXT_WINDOW_MS = 1_500;

export interface Spread {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export function spread(values: number[]): Spread {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const at = (q: number) => (v.length ? v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)] : null);
  return { count: v.length, p50: at(0.5), p95: at(0.95), max: v.length ? v[v.length - 1] : null };
}

export interface DayRow {
  day: string;
  requests: number;
  answered: number;
  silent: number;
  ackP95: number | null;
  answerP95: number | null;
  modelCost: number;
}

export interface WeekRow {
  week: string;
  people: number;
  newPeople: number;
  returningPeople: number;
  requests: number;
}

export interface MeasurementDay {
  day: string;
  twilioIn: number | null;
  recordedIn: number;
  twilioOut: number | null;
  recordedOut: number;
}

/** The acknowledgment goal: submitted to Twilio within 2 s of the text reaching us. */
export const ACK_TARGET_MS = 2_000;

/** After something went wrong, the same person got an answer within this long. */
export const RECOVERY_WINDOW_MS = 30 * 60 * 1000;

export interface Report {
  from: string;
  to: string;
  /** The earliest record kept: before it, nothing is known (records began, or expired). */
  recordsSince: string | null;
  adoption: {
    people: number;
    newPeople: number;
    returningPeople: number;
    repeatPeople: number;
    medianRequestsPerPerson: number | null;
    peopleByAdvisor: Record<string, number>;
    weekly: WeekRow[];
  };
  recovery: { problems: number; recovered: number; byKind: Record<string, number> };
  measurement: { days: MeasurementDay[]; twilioReachable: boolean; openRecords: number; deliveryReportsMissing: number };
  usage: {
    requests: number;
    activeNumbers: number;
    answered: number;
    byAdvisor: Record<string, number>;
    photos: number;
    duplicatesIgnored: number;
    optedOutIgnored: number;
  };
  latency: { ack: Spread; stillThinking: Spread; answer: Spread; delivered: Spread };
  reliability: {
    questions: number;
    acked: number;
    /** Acks submitted within ACK_TARGET_MS of the text reaching us. */
    ackedWithinTarget: number;
    stillThinkingSent: number;
    outcomes: Record<string, number>;
    silent: number;
    silentErrors: number;
    unfinished: number;
    errorClasses: Record<string, number>;
    saveFailures: number;
    sendFailures: number;
  };
  delivery: { submitted: number; delivered: number; failed: number; pending: number; byKind: Record<string, { submitted: number; delivered: number; failed: number }>; errorCodes: Record<string, number> };
  grouping: {
    photoThenMore: number;
    photoOnly: number;
    textThenText: number;
    textRequests: number;
    overlaps: number;
    gaps: Record<string, number>;
  };
  cost: {
    modelCalls: Record<string, number>;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
    searches: number;
    modelUsd: number;
    unpricedCalls: number;
    segments: Record<string, number>;
    smsUsd: number | null;
    perAnsweredUsd: number | null;
  };
  days: DayRow[];
}

const inc = (map: Record<string, number>, key: string, by = 1) => {
  map[key] = (map[key] ?? 0) + by;
};

export function buildReport(input: {
  requests: RequestRecord[];
  outbound: OutboundRecord[];
  from: Date;
  to: Date;
  now?: number;
  smsSegmentUsd?: number | null;
  /** Twilio's own daily counts, to check the records are complete (twilio-counts.ts). */
  twilio?: Record<string, DayCount> | null;
}): Report {
  const now = input.now ?? Date.now();
  const all = input.requests.filter((r) => {
    const t = Date.parse(r.received_at);
    return t >= input.from.getTime() && t <= input.to.getTime();
  });
  // Duplicates and opted-out texts are counted, but aren't requests anyone waited on.
  const real = all.filter((r) => r.outcome !== "duplicate" && r.outcome !== "opted_out");
  const unfinished = (r: RequestRecord) => r.finished_at === null && now - Date.parse(r.received_at) > SILENT_AFTER_MS;
  const silent = (r: RequestRecord) => r.outcome === "error" || unfinished(r);

  const byAdvisor: Record<string, number> = {};
  const outcomes: Record<string, number> = {};
  const errorClasses: Record<string, number> = {};
  for (const r of all) {
    inc(outcomes, unfinished(r) ? "unfinished" : (r.outcome ?? "in_progress"));
    if (r.outcome === "error") inc(errorClasses, r.error_class ?? "unknown");
  }
  for (const r of real) if (r.outcome === "answered" && r.advisor_id) inc(byAdvisor, r.advisor_id);

  // Questions are the requests that went to an advisor: the ones that should get an ack.
  const questions = real.filter((r) => (r.model_calls ?? []).some((c) => c.purpose === "answer"));

  // Grouping: each number's texts in order, against the approved windows.
  const byNumber = new Map<string, RequestRecord[]>();
  for (const r of all.filter((x) => x.outcome !== "duplicate")) {
    const list = byNumber.get(r.number_key) ?? [];
    list.push(r);
    byNumber.set(r.number_key, list);
  }
  const gaps: Record<string, number> = { "under 1.5 s": 0, "1.5–4 s": 0, "4–10 s": 0, "10–30 s": 0 };
  let photoThenMore = 0;
  let textThenText = 0;
  let overlaps = 0;
  for (const list of byNumber.values()) {
    list.sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at));
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      const gap = Date.parse(cur.received_at) - Date.parse(prev.received_at);
      if (gap < 1_500) gaps["under 1.5 s"] += 1;
      else if (gap < 4_000) gaps["1.5–4 s"] += 1;
      else if (gap < 10_000) gaps["4–10 s"] += 1;
      else if (gap < 30_000) gaps["10–30 s"] += 1;
      if (!prev.has_text && prev.photo_count > 0 && gap <= PHOTO_WINDOW_MS) photoThenMore += 1;
      if (prev.has_text && cur.has_text && gap <= TEXT_WINDOW_MS) textThenText += 1;
      // Arrived while the previous text was still being worked on (or never finished).
      const prevEnd = prev.finished_at ? Date.parse(prev.finished_at) : Infinity;
      if (Date.parse(cur.received_at) < prevEnd) overlaps += 1;
    }
  }

  // Delivery, for texts sent in the window.
  const sids = new Set(all.map((r) => r.message_sid));
  const out = input.outbound.filter((o) => (o.request_sid ? sids.has(o.request_sid) : false));
  const byKind: Record<string, { submitted: number; delivered: number; failed: number }> = {};
  const errorCodes: Record<string, number> = {};
  const segments: Record<string, number> = {};
  let delivered = 0;
  let failed = 0;
  const deliveredMs: number[] = [];
  for (const o of out) {
    const kind = o.kind ?? "unknown";
    byKind[kind] ??= { submitted: 0, delivered: 0, failed: 0 };
    byKind[kind].submitted += 1;
    inc(segments, kind, o.segments ?? 0);
    if (o.status === "delivered" || o.status === "read" || o.delivered_at) {
      delivered += 1;
      byKind[kind].delivered += 1;
      if (o.delivered_at && o.submitted_at) deliveredMs.push(Date.parse(o.delivered_at) - Date.parse(o.submitted_at));
    } else if (o.status === "failed" || o.status === "undelivered") {
      failed += 1;
      byKind[kind].failed += 1;
      inc(errorCodes, o.error_code ?? "none");
    }
  }

  // Cost.
  const modelCalls: Record<string, number> = {};
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let searches = 0;
  let modelUsd = 0;
  let unpricedCalls = 0;
  const dayCost = new Map<string, number>();
  for (const r of all) {
    for (const c of r.model_calls ?? []) {
      inc(modelCalls, c.purpose);
      tokens.input += c.input ?? 0;
      tokens.output += c.output ?? 0;
      tokens.cacheRead += c.cache_read ?? 0;
      tokens.cacheWrite += c.cache_write ?? 0;
      searches += c.searches ?? 0;
      const usd = callCost(c);
      if (usd === null) {
        if ((c.input ?? 0) + (c.output ?? 0) > 0) unpricedCalls += 1;
      } else {
        modelUsd += usd;
        const day = r.received_at.slice(0, 10);
        dayCost.set(day, (dayCost.get(day) ?? 0) + usd);
      }
    }
  }
  const totalSegments = Object.values(segments).reduce((a, b) => a + b, 0);
  const smsUsd = input.smsSegmentUsd ? totalSegments * input.smsSegmentUsd : null;
  const answered = real.filter((r) => r.outcome === "answered").length;

  // Day by day (UTC).
  const days = new Map<string, RequestRecord[]>();
  for (const r of real) {
    const day = r.received_at.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), r]);
  }
  const dayRows: DayRow[] = [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, rows]) => ({
      day,
      requests: rows.length,
      answered: rows.filter((r) => r.outcome === "answered").length,
      silent: rows.filter(silent).length,
      ackP95: spread(rows.flatMap((r) => (r.ack_ms === null ? [] : [r.ack_ms]))).p95,
      answerP95: spread(rows.flatMap((r) => (r.outcome === "answered" && r.answer_ms !== null ? [r.answer_ms] : []))).p95,
      modelCost: dayCost.get(day) ?? 0,
    }));

  // Adoption: people are numbers (as keys); "before" means any earlier record kept.
  const history = input.requests.filter((r) => r.outcome !== "duplicate" && r.outcome !== "opted_out");
  const firstSeen = new Map<string, number>();
  for (const r of history) {
    const t = Date.parse(r.received_at);
    if (t < (firstSeen.get(r.number_key) ?? Infinity)) firstSeen.set(r.number_key, t);
  }
  const people = new Set(real.map((r) => r.number_key));
  const fromMs = input.from.getTime();
  let newPeople = 0;
  for (const p of people) if ((firstSeen.get(p) ?? Infinity) >= fromMs) newPeople += 1;
  const daysPerPerson = new Map<string, Set<string>>();
  const requestsPerPerson = new Map<string, number>();
  const peopleByAdvisorSets: Record<string, Set<string>> = {};
  for (const r of real) {
    const days = daysPerPerson.get(r.number_key) ?? new Set<string>();
    days.add(r.received_at.slice(0, 10));
    daysPerPerson.set(r.number_key, days);
    requestsPerPerson.set(r.number_key, (requestsPerPerson.get(r.number_key) ?? 0) + 1);
    if (r.outcome === "answered" && r.advisor_id) (peopleByAdvisorSets[r.advisor_id] ??= new Set()).add(r.number_key);
  }
  const peopleByAdvisor = Object.fromEntries(Object.entries(peopleByAdvisorSets).map(([k, v]) => [k, v.size]));

  // Weekly (weeks starting Monday, UTC), over every record kept, newest first.
  const weekOf = (ms: number) => {
    const d = new Date(ms);
    const day = (d.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
  };
  const weeks = new Map<string, RequestRecord[]>();
  for (const r of history) {
    const w = weekOf(Date.parse(r.received_at));
    weeks.set(w, [...(weeks.get(w) ?? []), r]);
  }
  const weekly: WeekRow[] = [...weeks.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, 12)
    .map(([week, rows]) => {
      const start = Date.parse(`${week}T00:00:00Z`);
      const ppl = new Set(rows.map((r) => r.number_key));
      let fresh = 0;
      for (const p of ppl) if ((firstSeen.get(p) ?? Infinity) >= start) fresh += 1;
      return { week, people: ppl.size, newPeople: fresh, returningPeople: ppl.size - fresh, requests: rows.length };
    });

  // Recovery: after a request that went wrong, did the same person get an answer soon after?
  const problemKind = (r: RequestRecord): string | null =>
    unfinished(r) ? "never finished" : r.outcome === "error" ? "failed before any reply" : r.outcome === "stalled" ? "took too long" : r.outcome === "fallback" ? "answer failed" : r.send_failures ? "a text Twilio refused" : null;
  const problemsByKind: Record<string, number> = {};
  let problems = 0;
  let recovered = 0;
  for (const r of real) {
    const kind = problemKind(r);
    if (!kind) continue;
    problems += 1;
    inc(problemsByKind, kind);
    const t = Date.parse(r.received_at);
    if (history.some((x) => x.number_key === r.number_key && x.outcome === "answered" && Date.parse(x.received_at) > t && Date.parse(x.received_at) - t <= RECOVERY_WINDOW_MS)) recovered += 1;
  }

  // Measurement health: our records against Twilio's own counts, day by day.
  const recordedIn = new Map<string, number>();
  for (const r of input.requests) recordedIn.set(r.received_at.slice(0, 10), (recordedIn.get(r.received_at.slice(0, 10)) ?? 0) + 1);
  const recordedOut = new Map<string, number>();
  for (const o of input.outbound) if (o.submitted_at) recordedOut.set(o.submitted_at.slice(0, 10), (recordedOut.get(o.submitted_at.slice(0, 10)) ?? 0) + 1);
  const measurementDays: MeasurementDay[] = Object.keys(input.twilio ?? {})
    .sort((a, b) => (a < b ? 1 : -1))
    .map((day) => ({
      day,
      twilioIn: input.twilio?.[day]?.inbound ?? null,
      recordedIn: recordedIn.get(day) ?? 0,
      twilioOut: input.twilio?.[day]?.outbound ?? null,
      recordedOut: recordedOut.get(day) ?? 0,
    }));
  const hourAgo = now - 60 * 60 * 1000;
  const recordsSince = input.requests.reduce<string | null>((min, r) => (min === null || r.received_at < min ? r.received_at : min), null);

  return {
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    recordsSince,
    adoption: {
      people: people.size,
      newPeople,
      returningPeople: people.size - newPeople,
      repeatPeople: [...daysPerPerson.values()].filter((d) => d.size >= 2).length,
      medianRequestsPerPerson: spread([...requestsPerPerson.values()]).p50,
      peopleByAdvisor,
      weekly,
    },
    recovery: { problems, recovered, byKind: problemsByKind },
    measurement: {
      days: measurementDays,
      twilioReachable: !!input.twilio,
      openRecords: real.filter(unfinished).length,
      deliveryReportsMissing: out.filter((o) => !o.status && o.submitted_at && Date.parse(o.submitted_at) < hourAgo).length,
    },
    usage: {
      requests: real.length,
      activeNumbers: new Set(real.map((r) => r.number_key)).size,
      answered,
      byAdvisor,
      photos: real.reduce((n, r) => n + r.photo_count, 0),
      duplicatesIgnored: all.filter((r) => r.outcome === "duplicate").length,
      optedOutIgnored: all.filter((r) => r.outcome === "opted_out").length,
    },
    latency: {
      ack: spread(real.flatMap((r) => (r.ack_ms === null ? [] : [r.ack_ms]))),
      stillThinking: spread(real.flatMap((r) => (r.still_thinking_ms === null ? [] : [r.still_thinking_ms]))),
      answer: spread(real.flatMap((r) => (r.outcome === "answered" && r.answer_ms !== null ? [r.answer_ms] : []))),
      delivered: spread(deliveredMs),
    },
    reliability: {
      questions: questions.length,
      acked: questions.filter((r) => r.ack_ms !== null).length,
      ackedWithinTarget: questions.filter((r) => r.ack_ms !== null && r.ack_ms <= ACK_TARGET_MS).length,
      stillThinkingSent: real.filter((r) => r.still_thinking_ms !== null).length,
      outcomes,
      silent: real.filter(silent).length,
      silentErrors: real.filter((r) => r.outcome === "error").length,
      unfinished: real.filter(unfinished).length,
      errorClasses,
      saveFailures: real.reduce((n, r) => n + r.save_failures, 0),
      sendFailures: real.reduce((n, r) => n + r.send_failures, 0),
    },
    delivery: { submitted: out.length, delivered, failed, pending: out.length - delivered - failed, byKind, errorCodes },
    grouping: {
      photoThenMore,
      photoOnly: real.filter((r) => !r.has_text && r.photo_count > 0).length,
      textThenText,
      textRequests: real.filter((r) => r.has_text).length,
      overlaps,
      gaps,
    },
    cost: {
      modelCalls,
      tokens,
      searches,
      modelUsd,
      unpricedCalls,
      segments,
      smsUsd,
      perAnsweredUsd: answered ? (modelUsd + (smsUsd ?? 0)) / answered : null,
    },
    days: dayRows,
  };
}
