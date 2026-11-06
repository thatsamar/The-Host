import { timingSafeEqual } from "node:crypto";
import { channelOrUnavailable, messagesEnabled } from "@/lib/channel/runtime";

// For a scheduler: retries replies that are due, finishes events a worker
// left behind, and runs the retention sweep. Not found unless the channel is
// enabled here; otherwise it needs `Authorization: Bearer <CRON_SECRET>`.
export const maxDuration = 300;

function authorized(header: string | null, secret = process.env.CRON_SECRET): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const given = Buffer.from(header, "utf8");
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!messagesEnabled()) return new Response(null, { status: 404 });
  if (!authorized(request.headers.get("authorization"))) return new Response(null, { status: 401 });
  const built = channelOrUnavailable();
  if ("response" in built) return built.response;
  await built.channel.runDue();
  return new Response(null, { status: 204 });
}
