import { z } from "zod";
import { signInRequired } from "@/lib/auth/access";
import { currentCompanion } from "@/lib/companions";
import { createUsageLimiter, spokenCharsPerHour, visitorKey } from "@/lib/ask/rate-limit";
import { createClient, getUserId } from "@/lib/supabase/server";
import { errorClass } from "@/lib/diagnostics";
import { DEFAULT_ELEVENLABS_MODEL, MAX_SPOKEN_CONTEXT, MAX_SPOKEN_PIECE, speak } from "@/lib/voice/elevenlabs";

// One piece of an answer is a minute or two of audio at most.
export const maxDuration = 60;

const bodySchema = z.object({
  text: z.string().trim().min(1).max(MAX_SPOKEN_PIECE),
  previous: z.string().max(MAX_SPOKEN_CONTEXT).optional(),
  next: z.string().max(MAX_SPOKEN_CONTEXT).optional(),
});

const budget = createUsageLimiter({ limit: spokenCharsPerHour() });

/** Only this app's own pages may use the voice, so the endpoint can't be borrowed by other sites. */
function fromThisSite(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/**
 * Reads one piece of an answer aloud in the advisor's natural voice, as MP3.
 * Plain errors only; the page falls back to the device's own voice on any of them.
 */
export async function POST(request: Request) {
  const started = Date.now();
  if (process.env.COMPANION?.trim().toLowerCase() === "hub") return Response.json({ error: "Not found." }, { status: 404 });
  const advisor = currentCompanion();
  if (advisor.retired) return Response.json({ error: "No longer available." }, { status: 410 });
  if (!fromThisSite(request)) return Response.json({ error: "Not allowed." }, { status: 403 });

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return Response.json({ error: "Natural voice isn't set up." }, { status: 503 });

  if (signInRequired()) {
    const supabase = await createClient();
    if (!(await getUserId(supabase))) return Response.json({ error: "You've been signed out." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That didn't go through." }, { status: 400 });
  const { text, previous, next } = parsed.data;

  const allowed = budget(visitorKey(request.headers), text.length);
  if (!allowed.ok) {
    return Response.json(
      { error: "That's a lot of listening in a short time." },
      { status: 429, headers: { "Retry-After": String(allowed.retryAfterSeconds) } },
    );
  }

  const log = { companion: advisor.id, chars: text.length };
  let upstream: Response;
  try {
    upstream = await speak({
      apiKey,
      model: process.env.ELEVENLABS_MODEL?.trim() || DEFAULT_ELEVENLABS_MODEL,
      voice: advisor.voice,
      text,
      previousText: previous,
      nextText: next,
      signal: request.signal,
    });
  } catch (err) {
    // Never the text: only what happened.
    console.error("Speech failed", JSON.stringify({ ...log, error: errorClass(err), ms: Date.now() - started }));
    return Response.json({ error: "The voice isn't available right now." }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    console.error("Speech failed", JSON.stringify({ ...log, status: upstream.status, ms: Date.now() - started }));
    return Response.json({ error: "The voice isn't available right now." }, { status: 502 });
  }
  console.info("Speech started", JSON.stringify({ ...log, ms: Date.now() - started }));
  return new Response(upstream.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}
