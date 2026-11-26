import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildReport, type OutboundRecord, type RequestRecord } from "@/lib/ops/report";
import { renderOpsPage } from "@/lib/ops/page";

export const dynamic = "force-dynamic";

const MAX_ROWS = 20_000;

function authorized(request: Request, password: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const given = Buffer.from(decoded.slice(decoded.indexOf(":") + 1));
  const want = Buffer.from(password);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * Cinq's internal operations dashboard: usage, latency, reliability,
 * delivery, grouping and cost over the baseline records. Off unless
 * OPS_PASSWORD is set on the deployment (any username, that password).
 * It shows aggregates only and never reads a conversation.
 */
export async function GET(request: Request): Promise<Response> {
  const password = process.env.OPS_PASSWORD ?? "";
  if (!password) return new Response("Not found", { status: 404 });
  if (!authorized(request, password)) {
    return new Response("Sign in to see Cinq's operations.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Cinq operations", charset="UTF-8"', "Cache-Control": "no-store" },
    });
  }
  const admin = createAdminClient();
  if (!admin) return new Response("Supabase isn't configured on this deployment.", { status: 503 });

  const daysParam = Number(new URL(request.url).searchParams.get("days"));
  const days = [1, 7, 30].includes(daysParam) ? daysParam : 7;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  const [requests, outbound] = await Promise.all([
    admin.from("sms_requests").select("*").gte("received_at", from.toISOString()).order("received_at", { ascending: true }).limit(MAX_ROWS),
    admin.from("sms_outbound").select("sid, request_sid, kind, segments, submitted_at, status, error_code, delivered_at").gte("submitted_at", from.toISOString()).limit(MAX_ROWS * 3),
  ]);
  const recorded = !requests.error && (requests.data?.length ?? 0) > 0;
  const segmentUsd = Number(process.env.OPS_SMS_SEGMENT_USD);
  const report = buildReport({
    requests: (requests.error ? [] : requests.data ?? []) as RequestRecord[],
    outbound: (outbound.error ? [] : outbound.data ?? []) as OutboundRecord[],
    from,
    to,
    smsSegmentUsd: Number.isFinite(segmentUsd) && segmentUsd > 0 ? segmentUsd : null,
  });
  return new Response(renderOpsPage(report, { days, recorded }), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
