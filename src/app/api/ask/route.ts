import { after } from "next/server";
import { z } from "zod";
import { getChatProvider } from "@/lib/ai";
import { unavailable } from "@/lib/ai/anthropic";
import { signInRequired } from "@/lib/auth/access";
import { createRateLimiter, questionsPerHour, visitorKey } from "@/lib/ask/rate-limit";
import { serverEnv } from "@/lib/env";
import { ask, type AskEvent } from "@/lib/ask/ask";
import { AnswerRelay, isAnswerId } from "@/lib/ask/relay";
import { currentCompanion } from "@/lib/companions";
import { MAX_PHOTOS_PER_TURN } from "@/lib/ask/prompt";
import { createClient, getUserId } from "@/lib/supabase/server";

// Long answers with web search can take a while.
export const maxDuration = 300;

const imageSchema = z.object({
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  data: z.string().min(1).max(6_000_000).regex(/^[A-Za-z0-9+/=]+$/),
});

const bodySchema = z.object({
  /** The page's random id for this answer, so it can be collected after a disconnect. */
  id: z.string().refine(isAnswerId).optional(),
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
  let provider;
  try {
    serverEnv();
    provider = getChatProvider(companion);
  } catch (err) {
    // Names the missing settings (never their values) in the server log.
    console.error(`${companion.name} is misconfigured:`, err instanceof Error ? err.message : err);
    return Response.json({ error: unavailable(companion.name) }, { status: 503 });
  }

  const { id, turns } = parsed.data;
  const encoder = new TextEncoder();
  const encode = (event: AskEvent) => encoder.encode(`${JSON.stringify(event)}\n`);

  if (!id) {
    // Without an answer id there's nothing to resume, so stop when the visitor goes.
    const events = ask({ provider, companion, signal: request.signal }, turns);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of events) controller.enqueue(encode(event));
        } catch (err) {
          controller.enqueue(encode({ type: "error", message: err instanceof Error ? err.message : "Something went wrong" }));
        } finally {
          controller.close();
        }
      },
      async cancel() {
        await events.return(undefined);
      },
    });
    return new Response(stream, { headers: STREAM_HEADERS });
  }

  // A phone suspends the page when its owner switches apps, which drops this
  // connection. The answer keeps going regardless and is mirrored to the cache,
  // so the page can collect it on return; only an explicit Stop ends it early.
  const stop = new AbortController();
  const relay = new AnswerRelay(id, () => stop.abort());
  relay.begin();
  // Set while the visitor is still connected.
  const live: { send?: (event: AskEvent) => void } = {};
  const generation = (async () => {
    try {
      for await (const event of ask({ provider, companion, signal: stop.signal }, turns)) {
        relay.push(event);
        live.send?.(event);
      }
    } catch (err) {
      const event: AskEvent = { type: "error", message: err instanceof Error ? err.message : "Something went wrong" };
      relay.push(event);
      live.send?.(event);
    } finally {
      await relay.finish();
    }
  })();
  after(() => generation);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      live.send = (event) => {
        try {
          controller.enqueue(encode(event));
        } catch {
          live.send = undefined;
        }
      };
      await generation;
      live.send = undefined;
      try {
        controller.close();
      } catch {}
    },
    cancel() {
      live.send = undefined;
    },
  });

  return new Response(stream, { headers: STREAM_HEADERS });
}

const STREAM_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Accel-Buffering": "no",
};
