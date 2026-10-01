import { z } from "zod";
import { getChatProvider } from "@/lib/ai";
import { unavailable } from "@/lib/ai/anthropic";
import { signInRequired } from "@/lib/auth/access";
import { createRateLimiter, questionsPerHour, visitorKey } from "@/lib/ask/rate-limit";
import { serverEnv } from "@/lib/env";
import { ask, type AskEvent } from "@/lib/ask/ask";
import { currentCompanion, modeOf } from "@/lib/companions";
import { MAX_PATTERNS, MAX_PATTERN_LENGTH, MAX_PHOTOS_PER_TURN } from "@/lib/ask/prompt";
import { createClient, getUserId } from "@/lib/supabase/server";

// Long answers with web search can take a while.
export const maxDuration = 300;

const imageSchema = z.object({
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  data: z.string().min(1).max(6_000_000).regex(/^[A-Za-z0-9+/=]+$/),
});

const bodySchema = z.object({
  turns: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(40_000),
        images: z.array(imageSchema).max(MAX_PHOTOS_PER_TURN).optional(),
      }),
    )
    .min(1)
    .max(100),
  /** One of the companion's modes; anything else is ignored. */
  mode: z.string().max(40).optional(),
  /** Patterns the visitor kept, for companions with a journal. */
  memory: z.array(z.string().max(MAX_PATTERN_LENGTH)).max(MAX_PATTERNS).optional(),
  /** A careful moment (an earlier answer touched on safety): plain error copy. */
  careful: z.boolean().optional(),
});

const limiter = createRateLimiter({ limit: questionsPerHour() });

export async function POST(request: Request) {
  if (signInRequired()) {
    const supabase = await createClient();
    if (!(await getUserId(supabase))) {
      return Response.json({ error: "You've been signed out. Reload the page to sign in again." }, { status: 401 });
    }
  }

  const allowed = limiter(visitorKey(request.headers));
  if (!allowed.ok) {
    return Response.json(
      { error: "That's a lot of questions in a short time. Try again in a little while." },
      { status: 429, headers: { "Retry-After": String(allowed.retryAfterSeconds) } },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That didn't go through. Try again." }, { status: 400 });

  const companion = currentCompanion();
  const mode = modeOf(companion, parsed.data.mode);
  const plain = Boolean(parsed.data.careful || mode?.plain);
  let provider;
  try {
    serverEnv();
    provider = getChatProvider(companion, { plain });
  } catch (err) {
    // Names the missing settings (never their values) in the server log.
    console.error(`${companion.name} is misconfigured:`, err instanceof Error ? err.message : err);
    const message = (!plain && companion.errors?.unavailable) || unavailable(companion.name);
    return Response.json({ error: message }, { status: 503 });
  }

  const events = ask(
    { provider, companion, mode, memory: parsed.data.memory, signal: request.signal },
    parsed.data.turns,
  );
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AskEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of events) send(event);
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Something went wrong" });
      } finally {
        controller.close();
      }
    },
    async cancel() {
      await events.return(undefined);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
