import { after } from "next/server";
import { getChatProvider, getRouterProvider } from "@/lib/ai";
import { ask } from "@/lib/ask/ask";
import type { CompanionId } from "@/lib/companions/types";
import { COMPANIONS } from "@/lib/companions";
import { createAdminClient } from "@/lib/supabase/admin";
import { processSms, type SmsInbound } from "@/lib/sms/handler";
import { ROUTE_TIMEOUT_MS, ROUTER_PROMPT } from "@/lib/sms/router";
import { smsEncoding, smsSegments } from "@/lib/sms/segments";
import { SupabaseSmsStore } from "@/lib/sms/supabase-store";
import {
  createTwilioSender,
  downloadTwilioMedia,
  validTwilioSignature,
} from "@/lib/sms/twilio";
import type { SmsTurn } from "@/lib/sms/store";

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

    after(async () => {
      try {
        const accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
        const sender = createTwilioSender({
          accountSid,
          authToken,
          from: process.env.TWILIO_PHONE_NUMBER ?? "",
        });
        const replies = await processSms(inbound, {
          store,
          ask: async (advisorId, turns) => {
            const companion = COMPANIONS[advisorId as CompanionId];
            const provider = getChatProvider(companion);
            let text = "";
            for await (const event of ask(
              { provider, companion },
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
          },
          // Which advisor a question goes to when none is picked: one short, low-effort call.
          route: async (question) => {
            let reply = "";
            for await (const event of getRouterProvider().streamChat({
              system: [{ label: "router", title: "ROUTER", body: ROUTER_PROMPT, cacheable: true }],
              messages: [{ role: "user", content: [{ type: "text", text: question }] }],
              webSearch: false,
              signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
            })) {
              if (event.type === "text") reply += event.text;
            }
            return reply;
          },
          downloadMedia: async (url: string) =>
            downloadTwilioMedia({ accountSid, authToken, url }),
          // "Give me a second…" goes out while the answer is still being written.
          acknowledge: async (text) => {
            const sent = await sender.send(from, text);
            console.info("SMS ack sent", JSON.stringify({ sid: sent.sid ?? null }));
          },
        });
        // One line per reply batch, to match a garbled text against Twilio's log:
        // lengths, encodings, segments and SIDs only, never the words or the number.
        const parts: Record<string, unknown>[] = [];
        try {
          for (const reply of replies) {
            const sent = await sender.send(from, reply);
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
      } catch {
        console.error("sms processing failed");
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
