import { createAdminClient } from "@/lib/supabase/admin";
import { twilioErrorCode } from "@/lib/sms/metrics";
import { SupabaseMetricsSink } from "@/lib/sms/supabase-metrics";
import { validTwilioSignature } from "@/lib/sms/twilio";

const STATUS = /^[a-z_]{1,20}$/;

/**
 * Twilio's delivery reports for the texts Cinq sends (each send names this
 * URL as its StatusCallback). Records the status and, for a failure,
 * Twilio's numeric error code, against the text's SID. Nothing else is kept:
 * no number, no words. Always answers 204 to a signed request, so Twilio
 * never retries a report on our account.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const params: Record<string, string> = {};
    form.forEach((value, key) => {
      if (typeof value === "string") params[key] = value;
    });
    const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
    if (!validTwilioSignature(authToken, request.url, params, request.headers.get("x-twilio-signature") ?? "")) {
      return new Response("forbidden", { status: 403 });
    }
    const sid = params.MessageSid ?? "";
    const status = (params.MessageStatus ?? "").toLowerCase();
    const admin = createAdminClient();
    if (admin && /^[A-Za-z0-9]{10,64}$/.test(sid) && STATUS.test(status)) {
      const sink = new SupabaseMetricsSink(admin, (where) => console.error("SMS delivery report not recorded", JSON.stringify({ where })));
      await sink.delivery({ sid, status, errorCode: twilioErrorCode(params.ErrorCode), at: new Date().toISOString() });
      if (status === "failed" || status === "undelivered") {
        console.info("SMS delivery failed", JSON.stringify({ sid, status, errorCode: twilioErrorCode(params.ErrorCode) }));
      }
    }
    return new Response(null, { status: 204 });
  } catch {
    console.error("sms status webhook failed");
    return new Response(null, { status: 204 });
  }
}
