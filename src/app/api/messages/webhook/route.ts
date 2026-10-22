import { after } from "next/server";
import { channelOrUnavailable, messagesEnabled } from "@/lib/channel/runtime";

// The messaging provider's webhook. Not found unless this deployment is the
// one carrying the channel (MESSAGES_CHANNEL_ENABLED=true); the provider's
// signature is checked before anything is read. It acknowledges at once and
// answers in the background.
export const maxDuration = 300;

/** Larger than any text event; photos arrive as references, not bytes. */
const MAX_BODY_BYTES = 1_000_000;

export async function POST(request: Request) {
  if (!messagesEnabled()) return new Response(null, { status: 404 });
  const built = channelOrUnavailable();
  if ("response" in built) return built.response;
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_BODY_BYTES) return new Response(null, { status: 413 });
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });
  const result = await built.channel.handleWebhook({ headers: request.headers, rawBody });
  after(() => result.background);
  return new Response(null, { status: result.status });
}
