import { createAdminClient } from "@/lib/supabase/admin";
import { buildReport, type OutboundRecord, type RequestRecord } from "@/lib/ops/report";
import { renderOpsPage } from "@/lib/ops/page";
import { buildFoundationsView, type ActiveConfig, type AdvisorEvent } from "@/lib/ops/foundations";
import { completeDays, twilioDailyCounts } from "@/lib/ops/twilio-counts";
import { RETENTION_DAYS } from "@/lib/sms/metrics";
import { SupabaseMetricsSink } from "@/lib/sms/supabase-metrics";
import { newSession, passwordMatches, sessionCookie, sessionHeader, signInPage, validSession } from "@/lib/ops/session";

export const dynamic = "force-dynamic";

const MAX_ROWS = 20_000;

function basicPassword(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  return decoded.slice(decoded.indexOf(":") + 1);
}

const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const html = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...noStore, ...extra } });

/** Signing in from the form: a wrong password waits a second, so guessing is slow. */
export async function POST(request: Request): Promise<Response> {
  const password = process.env.OPS_PASSWORD ?? "";
  if (!password) return new Response("Not found", { status: 404 });
  const form = await request.formData().catch(() => null);
  const given = form?.get("password");
  if (typeof given !== "string" || !passwordMatches(given, password)) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    return html(signInPage(true), 401);
  }
  const session = newSession(password);
  return new Response(null, { status: 303, headers: { Location: "/ops", "Set-Cookie": sessionHeader(session.value, session.maxAge), ...noStore } });
}

/**
 * Cinq's internal operations dashboard: usage, latency, reliability,
 * delivery, grouping and cost over the baseline records. Off unless
 * OPS_PASSWORD is set on the deployment; signing in once keeps a device
 * signed in for 30 days (session.ts).
 * It shows aggregates only and never reads a conversation.
 */
export async function GET(request: Request): Promise<Response> {
  const password = process.env.OPS_PASSWORD ?? "";
  if (!password) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  if (url.searchParams.has("signout")) {
    return new Response(null, { status: 303, headers: { Location: "/ops", "Set-Cookie": sessionHeader("", 0), ...noStore } });
  }
  // Signed in on this device, or a password sent the older way (Basic auth); otherwise the sign-in page.
  const basic = basicPassword(request);
  if (!validSession(sessionCookie(request), password) && !(basic !== null && passwordMatches(basic, password))) {
    return html(signInPage(), 401);
  }
  const admin = createAdminClient();
  if (!admin) return new Response("Supabase isn't configured on this deployment.", { status: 503 });

  const daysParam = Number(url.searchParams.get("days"));
  const days = [1, 7, 30].includes(daysParam) ? daysParam : 7;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  // Every record kept (up to RETENTION_DAYS), so "returning" and "new" look past this period.
  const since = new Date(to.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  // Twilio's own counts for the complete days in this period (at most a week), to check the records.
  const checkDays = completeDays(to.getTime(), Math.min(days, 7));
  const [requests, outbound, twilio, , active, events] = await Promise.all([
    admin.from("sms_requests").select("*").gte("received_at", since.toISOString()).order("received_at", { ascending: true }).limit(MAX_ROWS),
    admin.from("sms_outbound").select("sid, request_sid, kind, segments, submitted_at, status, error_code, delivered_at").gte("submitted_at", from.toISOString()).limit(MAX_ROWS * 3),
    twilioDailyCounts({
      accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
      authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
      number: process.env.TWILIO_PHONE_NUMBER ?? "",
      days: checkDays,
    }),
    // Retention: expired records go whenever the dashboard is opened, too.
    new SupabaseMetricsSink(admin).prune(),
    // Each advisor's architecture and its last day's fallbacks (docs/foundations.md): never any text.
    admin.from("advisor_active").select("advisor_id, architecture, identity_version, foundation_version, layer2_version, updated_by, updated_at, last_loaded_at"),
    admin.from("advisor_events").select("advisor_id, at, kind, reason").gte("at", new Date(to.getTime() - 24 * 60 * 60 * 1000).toISOString()).limit(MAX_ROWS),
  ]);
  const recorded = !requests.error && (requests.data ?? []).some((r) => (r as { received_at: string }).received_at >= from.toISOString());
  const segmentUsd = Number(process.env.OPS_SMS_SEGMENT_USD);
  const report = buildReport({
    requests: (requests.error ? [] : requests.data ?? []) as RequestRecord[],
    outbound: (outbound.error ? [] : outbound.data ?? []) as OutboundRecord[],
    from,
    to,
    smsSegmentUsd: Number.isFinite(segmentUsd) && segmentUsd > 0 ? segmentUsd : null,
    twilio,
  });
  const foundations = buildFoundationsView({
    active: active.error ? null : ((active.data ?? []) as ActiveConfig[]),
    events: events.error ? [] : ((events.data ?? []) as AdvisorEvent[]),
    requests: ((requests.error ? [] : requests.data ?? []) as RequestRecord[]).filter((r) => r.received_at >= from.toISOString()),
    now: to,
  });
  return html(renderOpsPage(report, { days, recorded, foundations }));
}
