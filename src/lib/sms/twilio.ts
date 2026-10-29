import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio request validation and sending, with no Twilio SDK dependency.
 * Signature: HMAC-SHA1 over the webhook URL plus the POST parameters sorted
 * by name, base64-encoded. The URL must match the webhook URL configured in
 * the Twilio console exactly.
 */
export function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("");
  return createHmac("sha1", authToken).update(data).digest("base64");
}

export function validTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  if (!authToken || !signature) return false;
  const expected = twilioSignature(authToken, url, params);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface TwilioSender {
  send(to: string, body: string): Promise<void>;
}

function basicAuth(accountSid: string, authToken: string): string {
  return "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
}

export function createTwilioSender(opts: {
  accountSid: string;
  authToken: string;
  from: string;
}): TwilioSender {
  return {
    async send(to: string, body: string): Promise<void> {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${opts.accountSid}/Messages.json`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: basicAuth(opts.accountSid, opts.authToken),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ From: opts.from, To: to, Body: body }),
      });
      if (!res.ok) throw new Error(`twilio_send_${res.status}`);
    },
  };
}

/** Download a Twilio media URL with account credentials. Null when it fails. */
export async function downloadTwilioMedia(opts: {
  accountSid: string;
  authToken: string;
  url: string;
}): Promise<{ data: string; mediaType: string } | null> {
  const res = await fetch(opts.url, {
    headers: { Authorization: basicAuth(opts.accountSid, opts.authToken) },
  });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const mediaType = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
  return { data: buf.toString("base64"), mediaType };
}
