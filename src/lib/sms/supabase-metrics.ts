import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { newerStatus, type MetricsSink, type OutboundRow, type RequestRow } from "./metrics";

/**
 * Records in sms_requests and sms_outbound (migration 20261126000001).
 * Until that migration is applied, every write fails quietly: the log says
 * so by class once per request, and texting works exactly as before.
 */
export class SupabaseMetricsSink implements MetricsSink {
  constructor(
    private client: SupabaseClient,
    private onError: (where: string) => void = () => {},
  ) {}

  private async run(where: string, op: () => PromiseLike<{ error: unknown }>): Promise<void> {
    try {
      const { error } = await op();
      if (error) this.onError(where);
    } catch {
      this.onError(where);
    }
  }

  started(row: RequestRow): Promise<void> {
    // A redelivered MessageSid keeps the first record.
    return this.run("start", () => this.client.from("sms_requests").upsert(row, { onConflict: "message_sid", ignoreDuplicates: true }));
  }

  finished(row: RequestRow): Promise<void> {
    const { message_sid, ...rest } = row;
    return this.run("finish", () => this.client.from("sms_requests").update(rest).eq("message_sid", message_sid));
  }

  outbound(row: OutboundRow): Promise<void> {
    // A delivery report may have arrived first: only this row's own columns are written.
    return this.run("outbound", () => this.client.from("sms_outbound").upsert(row, { onConflict: "sid" }));
  }

  async delivery(update: { sid: string; status: string; errorCode: string | null; at: string }): Promise<void> {
    try {
      const { data, error } = await this.client.from("sms_outbound").select("status").eq("sid", update.sid).maybeSingle();
      if (error) {
        this.onError("delivery");
        return;
      }
      const current = (data as { status?: string | null } | null)?.status;
      if (!newerStatus(current, update.status)) return;
      const fields = {
        sid: update.sid,
        status: update.status,
        error_code: update.errorCode,
        status_at: update.at,
        ...(update.status === "delivered" ? { delivered_at: update.at } : {}),
      };
      await this.run("delivery", () => this.client.from("sms_outbound").upsert(fields, { onConflict: "sid" }));
    } catch {
      this.onError("delivery");
    }
  }
}
