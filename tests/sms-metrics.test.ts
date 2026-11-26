import { describe, expect, it } from "vitest";
import { ACK_TEXTS, FALLBACK_TEXT, STALLED_TEXT, STILL_THINKING_TEXT, WELCOME_TEXT } from "../src/lib/sms/handler";
import { RequestMeasure, newerStatus, numberKey, outboundKind, outcomeOf, twilioErrorCode, usageCounts } from "../src/lib/sms/metrics";
import { buildReport, spread, type OutboundRecord, type RequestRecord } from "../src/lib/ops/report";
import { callCost, modelRate } from "../src/lib/ops/rates";
import { renderOpsPage } from "../src/lib/ops/page";

describe("the baseline record (metrics.ts)", () => {
  it("keeps a number only as a stable keyed hash that doesn't contain it", () => {
    const key = numberKey("+15551234567", "secret");
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(numberKey("+15551234567", "secret")).toBe(key);
    expect(numberKey("+15551234568", "secret")).not.toBe(key);
    expect(numberKey("+15551234567", "other")).not.toBe(key);
    expect(key).not.toContain("5551234567");
  });

  it("names each text Cinq sends by kind, from its words, so no words are kept", () => {
    for (const ack of ACK_TEXTS) expect(outboundKind(ack)).toBe("ack");
    expect(outboundKind(STILL_THINKING_TEXT)).toBe("still_thinking");
    expect(outboundKind(FALLBACK_TEXT)).toBe("fallback");
    expect(outboundKind(STALLED_TEXT)).toBe("stalled");
    expect(outboundKind("Gio: A low linen sofa.")).toBe("answer");
    expect(outboundKind(WELCOME_TEXT)).toBe("system");
  });

  it("reads how a request ended from what it sent", () => {
    expect(outcomeOf(["ack", "answer"], false)).toBe("answered");
    expect(outcomeOf(["ack", "still_thinking", "stalled"], false)).toBe("stalled");
    expect(outcomeOf(["ack", "fallback"], false)).toBe("fallback");
    expect(outcomeOf(["system"], false)).toBe("system");
    expect(outcomeOf([], false)).toBe("opted_out");
    expect(outcomeOf([], true)).toBe("duplicate");
  });

  it("times the ack, the update and the answer from when the webhook got the text", () => {
    let clock = 1_000_000;
    const m = new RequestMeasure({ messageSid: "SM1", numberKey: "k", receivedAt: clock, hasText: true, photoCount: 0 }, () => clock);
    clock += 900;
    expect(m.sent(ACK_TEXTS[0], "SMout1", 1)).toMatchObject({ sid: "SMout1", request_sid: "SM1", kind: "ack", segments: 1 });
    clock += 24_000;
    m.sent(STILL_THINKING_TEXT, "SMout2", 1);
    clock += 10_000;
    m.sent("Gio: Lower the lamp.", "SMout3", 2);
    m.model({ purpose: "answer", model: "claude-opus-5-5", ms: 33_000, input: 1000, output: 100 });
    const row = m.finish();
    expect(row).toMatchObject({ ack_ms: 900, still_thinking_ms: 24_900, answer_ms: 34_900, texts_sent: 3, segments_sent: 4, outcome: "answered" });
    expect(row.finished_at).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain("Lower the lamp");
  });

  it("records a request that failed before any reply as an error, by class", () => {
    const m = new RequestMeasure({ messageSid: "SM2", numberKey: "k", receivedAt: Date.now(), hasText: true, photoCount: 0 });
    expect(m.finish("SmsStoreTimeoutError")).toMatchObject({ outcome: "error", error_class: "SmsStoreTimeoutError" });
  });

  it("reads token counts from usage, and only numbers", () => {
    expect(
      usageCounts({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2, server_tool_use: { web_search_requests: 1 } }),
    ).toEqual({ input: 10, output: 5, cache_read: 3, cache_write: 2, searches: 1 });
    expect(usageCounts({ input_tokens: "x" })).toEqual({ input: undefined, output: undefined, cache_read: undefined, cache_write: undefined, searches: undefined });
  });

  it("never lets a late delivery report move a text's status backwards", () => {
    expect(newerStatus(null, "queued")).toBe(true);
    expect(newerStatus("sent", "delivered")).toBe(true);
    expect(newerStatus("delivered", "sent")).toBe(false);
    expect(newerStatus("failed", "queued")).toBe(false);
  });

  it("keeps only digit error codes", () => {
    expect(twilioErrorCode("30007")).toBe("30007");
    expect(twilioErrorCode("bad code")).toBeNull();
    expect(twilioErrorCode(undefined)).toBeNull();
  });
});

const BASE = Date.UTC(2026, 10, 26, 12);
const iso = (ms: number) => new Date(BASE + ms).toISOString();

function req(over: Partial<RequestRecord> & { at: number }): RequestRecord {
  const { at, ...rest } = over;
  return {
    message_sid: `SM${at}`,
    number_key: "a",
    received_at: iso(at),
    finished_at: iso(at + 5_000),
    has_text: true,
    photo_count: 0,
    outcome: "answered",
    advisor_id: "gio",
    ack_ms: 800,
    still_thinking_ms: null,
    answer_ms: 5_000,
    texts_sent: 2,
    segments_sent: 3,
    send_failures: 0,
    save_failures: 0,
    model_calls: [{ purpose: "answer", model: "claude-opus-5-5", ms: 4_000, input: 1_000_000, output: 100_000 }],
    error_class: null,
    ...rest,
  };
}

describe("the operations report (ops/report.ts)", () => {
  const requests: RequestRecord[] = [
    // A photo with no words, then its question 2 s later, while the photo was still being answered.
    req({ at: 0, has_text: false, photo_count: 2, answer_ms: 9_000, finished_at: iso(9_000) }),
    req({ at: 2_000, ack_ms: 1_200 }),
    // Two texts 1 s apart from another number.
    req({ at: 60_000, number_key: "b", advisor_id: "martini" }),
    req({ at: 61_000, number_key: "b", advisor_id: "martini", outcome: "stalled", still_thinking_ms: 25_000, answer_ms: 150_000 }),
    // Failed before any reply, and one that never finished.
    req({ at: 120_000, number_key: "c", outcome: "error", error_class: "SmsStoreTimeoutError", ack_ms: null, model_calls: [] }),
    req({ at: 180_000, number_key: "c", outcome: null, finished_at: null, ack_ms: null }),
    // Ignored ones.
    req({ at: 200_000, number_key: "d", outcome: "duplicate", model_calls: [] }),
    req({ at: 210_000, number_key: "e", outcome: "opted_out", model_calls: [] }),
  ];
  const outbound: OutboundRecord[] = [
    { sid: "o1", request_sid: "SM0", kind: "ack", segments: 1, submitted_at: iso(800), status: "delivered", error_code: null, delivered_at: iso(3_800) },
    { sid: "o2", request_sid: "SM0", kind: "answer", segments: 3, submitted_at: iso(9_000), status: "undelivered", error_code: "30007", delivered_at: null },
    { sid: "o3", request_sid: "SM2000", kind: "answer", segments: 3, submitted_at: iso(5_000), status: "sent", error_code: null, delivered_at: null },
  ];
  const report = buildReport({ requests, outbound, from: new Date(BASE - 1), to: new Date(BASE + 3_600_000), now: BASE + 3_600_000 });

  it("counts silence as failed-before-reply plus never-finished, and never counts ignored texts as requests", () => {
    expect(report.usage.requests).toBe(6);
    expect(report.reliability.silent).toBe(2);
    expect(report.reliability.silentErrors).toBe(1);
    expect(report.reliability.unfinished).toBe(1);
    expect(report.reliability.errorClasses).toEqual({ SmsStoreTimeoutError: 1 });
    expect(report.usage.duplicatesIgnored).toBe(1);
    expect(report.usage.optedOutIgnored).toBe(1);
    expect(report.reliability.outcomes.stalled).toBe(1);
  });

  it("measures acknowledgment and answer latency", () => {
    expect(report.reliability.questions).toBe(5);
    expect(report.reliability.acked).toBe(4);
    expect(report.latency.ack).toEqual({ count: 4, p50: 800, p95: 1_200, max: 1_200 });
    expect(report.latency.answer.max).toBe(9_000);
    expect(report.latency.delivered).toEqual({ count: 1, p50: 3_000, p95: 3_000, max: 3_000 });
  });

  it("shows how often the grouping windows would apply, and overlapping texts", () => {
    expect(report.grouping.photoOnly).toBe(1);
    expect(report.grouping.photoThenMore).toBe(1);
    expect(report.grouping.textThenText).toBe(1);
    expect(report.grouping.overlaps).toBe(2);
    expect(report.grouping.gaps["under 1.5 s"]).toBe(1);
    expect(report.grouping.gaps["1.5–4 s"]).toBe(1);
  });

  it("reports delivery by kind with Twilio's error codes", () => {
    expect(report.delivery).toMatchObject({ submitted: 3, delivered: 1, failed: 1, pending: 1, errorCodes: { "30007": 1 } });
    expect(report.delivery.byKind.answer).toEqual({ submitted: 2, delivered: 0, failed: 1 });
  });

  it("prices model use at list prices, and never guesses an unlisted model", () => {
    // 1M input at $4 + 100k output at $20 = $6 per answer call, five of them.
    expect(report.cost.modelUsd).toBeCloseTo(30);
    expect(report.cost.modelCalls.answer).toBe(5);
    expect(callCost({ model: "some-other-model", input: 1000 })).toBeNull();
    expect(modelRate("claude-opus-5-5")?.input).toBe(4);
    expect(modelRate("claude-opus-5")?.input).toBe(5);
    expect(modelRate("claude-sonnet-5-5-fast")?.output).toBe(10);
  });

  it("renders the page with aggregates only: no number keys or message ids", () => {
    const html = renderOpsPage(report, { days: 1, recorded: true });
    expect(html).toContain("Cinq Operations");
    expect(html).toContain("Ended in silence");
    for (const r of requests) {
      expect(html).not.toContain(r.message_sid);
    }
    expect(html).not.toMatch(/number_key|"a"|"b"/);
  });

  it("takes percentiles from the sorted values", () => {
    expect(spread([5, 1, 3])).toEqual({ count: 3, p50: 3, p95: 5, max: 5 });
    expect(spread([])).toEqual({ count: 0, p50: null, p95: null, max: null });
  });
});
