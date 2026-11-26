import { after } from "next/server";
import { getChatProvider, getRouterProvider } from "@/lib/ai";
import { ask } from "@/lib/ask/ask";
import type { CompanionId } from "@/lib/companions/types";
import { COMPANIONS } from "@/lib/companions";
import { createAdminClient } from "@/lib/supabase/admin";
import { processSms, type SmsInbound } from "@/lib/sms/handler";
import { textChannelNotes } from "@/lib/sms/handoff";
import { ROUTE_TIMEOUT_MS, ROUTER_PROMPT } from "@/lib/sms/router";
import { condensePrompt } from "@/lib/sms/short";
import { smsEncoding, smsSegments } from "@/lib/sms/segments";
import { SupabaseSmsStore } from "@/lib/sms/supabase-store";
import {
  createTwilioSender,
  downloadTwilioMedia,
  validTwilioSignature,
} from "@/lib/sms/twilio";
import type { SmsTurn } from "@/lib/sms/store";
import { errorClass, safeToken } from "@/lib/diagnostics";
import { numberKey, PRUNE_ONE_IN, RequestMeasure, usageCounts, type ModelCall, type ModelPurpose } from "@/lib/sms/metrics";
import { SupabaseMetricsSink } from "@/lib/sms/supabase-metrics";

// Answers can take a while; the webhook itself answers immediately (below)
// and the replies go out through the REST API after the handler finishes.
export const maxDuration = 300;

function emptyTwiml(): Response {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    headers: { "Content-Type": "text/xml" },
  });
}

/**
 * Twilio SMS webhook. Twilio retries deliveries it does not see answered
 * within ~15 seconds, so this route validates, claims the MessageSid, and
 * answers immediately; the conversation work runs in after() and replies go
 * out via the REST API. The Sid claim makes a retried delivery a no-op.
 * Logs carry error classes only, never message content or phone numbers.
 */
export async function POST(request: Request): Promise<Response> {
  // Every timing in the baseline is measured from here: the moment the webhook reached us.
  const receivedAt = Date.now();
  try {
    const form = await request.formData();
    const params: Record<string, string> = {};
    form.forEach((value, key) => {
      if (typeof value === "string") params[key] = value;
    });

    const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
    const signature = request.headers.get("x-twilio-signature") ?? "";
    if (!validTwilioSignature(authToken, request.url, params, signature)) {
      return new Response("forbidden", { status: 403 });
    }

    const admin = createAdminClient();
    if (!admin) {
      console.error("sms webhook misconfigured");
      return emptyTwiml();
    }

    const sid = params.MessageSid ?? "";
    const from = params.From ?? "";
    if (!sid || !from) return emptyTwiml();

    const store = new SupabaseSmsStore(admin);
    const media: { url: string; contentType: string }[] = [];
    const mediaCount = Number.parseInt(params.NumMedia ?? "0", 10) || 0;
    for (let i = 0; i < mediaCount; i++) {
      const url = params[`MediaUrl${i}`];
      if (url) media.push({ url, contentType: params[`MediaContentType${i}`] ?? "" });
    }
    const inbound: SmsInbound = {
      from,
      body: params.Body ?? "",
      media,
      messageSid: sid,
    };

    // The baseline record (metrics.ts): timings, counts and kinds only. Recording
    // runs alongside the work and never delays or changes a reply.
    const measure = new RequestMeasure({
      messageSid: sid,
      numberKey: numberKey(from, process.env.SMS_METRICS_KEY || authToken),
      receivedAt,
      hasText: !!inbound.body.trim(),
      photoCount: media.length,
    });
    let metricsFailed = false;
    const sink = new SupabaseMetricsSink(admin, () => (metricsFailed = true));
    // Twilio reports each text's delivery here.
    const statusCallback = new URL("/api/sms/status", request.url).toString();

    after(async () => {
      const recordStart = sink.started(measure.row);
      const recordings: Promise<void>[] = [];
      let failure: string | undefined;
      try {
        const accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
        const twilio = createTwilioSender({
          accountSid,
          authToken,
          from: process.env.TWILIO_PHONE_NUMBER ?? "",
          statusCallback,
        });
        // Every text sent is recorded by kind (never its words) once Twilio accepts it.
        const send = async (text: string) => {
          try {
            const sent = await twilio.send(from, text);
            const out = measure.sent(text, sent.sid, sent.segments);
            if (out) recordings.push(recordStart.then(() => sink.outbound(out)));
            return sent;
          } catch (err) {
            measure.sendFailed(text);
            throw err;
          }
        };
        // A model call, timed, with its token counts.
        const timed = async <T>(purpose: ModelPurpose, run: (onUsage: (usage: Record<string, unknown>, model?: string) => void) => Promise<T>) => {
          const began = Date.now();
          const call: ModelCall = { purpose, ms: 0 };
          try {
            return await run((usage, model) => Object.assign(call, usageCounts(usage), model ? { model: safeToken(model) } : {}));
          } catch (err) {
            call.failed = true;
            throw err;
          } finally {
            call.ms = Date.now() - began;
            measure.model(call);
          }
        };
        const claimingStore = {
          getSession: store.getSession.bind(store),
          saveSession: store.saveSession.bind(store),
          claimMessageSid: async (messageSid: string, phone: string) => {
            const claimed = await store.claimMessageSid(messageSid, phone);
            if (!claimed) measure.duplicate = true;
            return claimed;
          },
        };
        const replies = await processSms(inbound, {
          store: claimingStore,
          // On text, each advisor also gets the text-only notes: how to suggest
          // another advisor, and the previous advisor's answer on a handoff.
          ask: (advisorId, turns, context) =>
            timed("answer", async (onUsage) => {
              measure.row.advisor_id = advisorId;
              const companion = COMPANIONS[advisorId as CompanionId];
              const provider = getChatProvider(companion);
              let text = "";
              for await (const event of ask(
                {
                  provider,
                  companion,
                  channel: textChannelNotes(advisorId, context?.handoff, context?.met, context?.budget),
                  signal: context?.signal,
                  onUsage,
                },
                turns.map(
                  (turn: SmsTurn) => ({
                    role: turn.role,
                    text: turn.text,
                    images: turn.images,
                  }),
                ),
              )) {
                if (event.type === "text") text += event.text;
                else if (event.type === "error") throw new Error("ask_error");
              }
              if (!text.trim()) throw new Error("ask_empty");
              return text;
            }),
          // Which advisor a question goes to when none is picked: one short, low-effort call.
          route: (question) =>
            timed("router", async (onUsage) => {
              let reply = "";
              for await (const event of getRouterProvider().streamChat({
                system: [{ label: "router", title: "ROUTER", body: ROUTER_PROMPT, cacheable: true }],
                messages: [{ role: "user", content: [{ type: "text", text: question }] }],
                webSearch: false,
                signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
              })) {
                if (event.type === "text") reply += event.text;
                else if (event.type === "done") onUsage(event.usage, event.model);
              }
              return reply;
            }),
          // An answer longer than one text is rewritten to fit as one complete text: one quick, low-effort call.
          condense: (advisorId, answer, room) =>
            timed("condense", async (onUsage) => {
              let reply = "";
              const name = COMPANIONS[advisorId as CompanionId].name;
              for await (const event of getRouterProvider().streamChat({
                system: [{ label: "condense", title: "CONDENSE", body: condensePrompt(name, room) }],
                messages: [{ role: "user", content: [{ type: "text", text: answer }] }],
                webSearch: false,
                signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
              })) {
                if (event.type === "text") reply += event.text;
                else if (event.type === "done") onUsage(event.usage, event.model);
              }
              return reply;
            }),
          downloadMedia: async (url: string) =>
            downloadTwilioMedia({ accountSid, authToken, url }),
          // A failed save never holds back a reply; the log names its class only.
          onSaveError: (err) => {
            measure.row.save_failures += 1;
            console.error("SMS session save failed", JSON.stringify({ error: errorClass(err) }));
          },
          // "Give me a second…" goes out while the answer is still being written.
          acknowledge: async (text) => {
            const sent = await send(text);
            console.info("SMS ack sent", JSON.stringify({ sid: sent.sid ?? null }));
          },
        });
        // One line per reply batch, to match a garbled text against Twilio's log:
        // lengths, encodings, segments and SIDs only, never the words or the number.
        const parts: Record<string, unknown>[] = [];
        try {
          for (const reply of replies) {
            const sent = await send(reply);
            parts.push({
              chars: reply.length,
              encoding: smsEncoding(reply),
              segments: smsSegments(reply),
              twilioSegments: sent.segments ?? null,
              sid: sent.sid ?? null,
            });
          }
        } finally {
          if (replies.length) {
            const chars = replies.reduce((n, r) => n + r.length, 0);
            console.info("SMS replies sent", JSON.stringify({ texts: replies.length, chars, sent: parts.length, parts }));
          }
        }
      } catch (err) {
        failure = errorClass(err);
        console.error("sms processing failed");
      } finally {
        const row = measure.finish(failure);
        // A redelivered MessageSid is the same request: its first record stands.
        if (!measure.duplicate) recordings.push(recordStart.then(() => sink.finished(row)));
        // Retention: now and then, expired records go (RETENTION_DAYS).
        if (Math.random() < 1 / PRUNE_ONE_IN) recordings.push(Promise.resolve().then(() => sink.prune()).catch(() => {}));
        await Promise.all(recordings);
        if (metricsFailed) console.error("SMS metrics write failed");
        // The log line carries neither the number's key nor the message id.
        const summary: Partial<typeof row> = { ...row };
        delete summary.number_key;
        delete summary.message_sid;
        console.info("SMS request finished", JSON.stringify({ ...summary, recorded: !metricsFailed }));
      }
    });

    return emptyTwiml();
  } catch {
    // Never let an unexpected error turn into a Twilio retry storm; the
    // Sid claim already protects redelivery for validated requests.
    console.error("sms webhook failed");
    return emptyTwiml();
  }
}
