import { after } from "next/server";
import { z } from "zod";
import { getChatProvider } from "@/lib/ai";
import { unavailable } from "@/lib/ai/anthropic";
import { signInRequired } from "@/lib/auth/access";
import { createRateLimiter, questionsPerHour, visitorKey } from "@/lib/ask/rate-limit";
import { serverEnv } from "@/lib/env";
import { ask, timeLimitMessage, type AnswerInfo, type AskEvent, type StreamEvent } from "@/lib/ask/ask";
import { AnswerRelay, isAnswerId } from "@/lib/ask/relay";
import { currentCompanion } from "@/lib/companions";
import { MAX_PHOTOS_PER_TURN } from "@/lib/ask/prompt";
import { createClient, getUserId } from "@/lib/supabase/server";
import { errorClass, safeToken } from "@/lib/diagnostics";
import type { FailureInfo } from "@/lib/ai/types";

// Long answers with web search can take a while.
export const maxDuration = 300;

// Vercel ends the function at maxDuration without warning, which would leave
// the answer unfinished with nothing to say so. Stop a little before that
// instead, so the page always gets an ending and keeps what was written.
const ANSWER_TIME_LIMIT_MS = (maxDuration - 20) * 1000;
// Enough phase changes to see where a long answer spent its time.
const MAX_LOGGED_PHASES = 60;
// Something goes down the line at least this often, so a dead connection shows.
const HEARTBEAT_MS = 10_000;

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
  try {
    return await answer(request);
  } catch (err) {
    // Anything unexpected still gets a plain message; the log gets the error's class, never its text.
    console.error("Ask route failed", JSON.stringify({ error: errorClass(err) }));
    return Response.json({ error: "Something went wrong on our side. Try again." }, { status: 500 });
  }
}

async function answer(request: Request): Promise<Response> {
  const receivedAt = Date.now();
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
  let env;
  try {
    env = serverEnv();
    provider = getChatProvider(companion);
  } catch (err) {
    // Names the missing or invalid settings, never their values, in the server log.
    const settings = (err as { settings?: unknown }).settings;
    console.error(`${companion.name} is misconfigured`, JSON.stringify({ error: errorClass(err), settings }));
    return Response.json({ error: unavailable(companion.name) }, { status: 503 });
  }

  const { id, turns } = parsed.data;
  const encoder = new TextEncoder();
  const encode = (event: StreamEvent) => encoder.encode(`${JSON.stringify(event)}\n`);

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
  const live: { send?: (event: StreamEvent) => void } = {};
  // Timings and counts only, for the server log; never the conversation itself.
  const latest = turns.at(-1)!;
  const log: Record<string, unknown> = {
    companion: companion.id,
    turns: turns.length,
    photos: latest.images?.length ?? 0,
    photoChars: (latest.images ?? []).reduce((n, i) => n + i.data.length, 0),
    textChars: latest.text.length,
    // This environment's model settings (never the key), to compare deployments.
    model: safeToken(env.CHAT_MODEL),
    effort: env.CHAT_EFFORT,
    webSearchMaxUses: env.WEB_SEARCH_MAX_USES ?? companion.webSearchMaxUses,
  };
  // Where the time went, even when the answer never finishes: each phase and when it began.
  const phases: [string, number][] = [];
  let answerChars = 0;
  let searchesRun = 0;
  let timedOut = false;
  const timeLimit = setTimeout(() => {
    timedOut = true;
    stop.abort();
  }, Math.max(0, ANSWER_TIME_LIMIT_MS - (Date.now() - receivedAt)));
  const heartbeat = setInterval(() => {
    relay.keepAlive();
    live.send?.({ type: "alive" });
  }, HEARTBEAT_MS);
  const onFinish = (info: AnswerInfo) => Object.assign(log, info);
  const onFailure = (failure: FailureInfo) => {
    log.failure = { ...failure, atMs: Date.now() - receivedAt };
  };

  const generation = (async () => {
    let outcome = "answered";
    try {
      for await (let event of ask({ provider, companion, signal: stop.signal, onFinish, onFailure }, turns)) {
        if (event.type === "error") {
          outcome = timedOut ? "time-limit" : event.message === "Stopped." ? "stopped" : "error";
          if (timedOut) event = { type: "error", message: timeLimitMessage(companion.name) };
        } else if (event.type === "phase") {
          const atMs = Date.now() - receivedAt;
          log.firstPhaseMs ??= atMs;
          if (phases.at(-1)?.[0] !== event.phase && phases.length < MAX_LOGGED_PHASES) phases.push([event.phase, atMs]);
        } else if (event.type === "text") {
          log.firstTextMs ??= Date.now() - receivedAt;
          answerChars += event.text.length;
        } else if (event.type === "searching") searchesRun++;
        relay.push(event);
        live.send?.(event);
      }
    } catch (err) {
      outcome = "error";
      const event: AskEvent = { type: "error", message: err instanceof Error ? err.message : "Something went wrong" };
      relay.push(event);
      live.send?.(event);
    } finally {
      clearTimeout(timeLimit);
      clearInterval(heartbeat);
      await relay.finish();
      console.info(
        "Answer finished",
        JSON.stringify({ outcome, ms: Date.now() - receivedAt, connected: !!live.send, ...log, answerChars, searchesRun, phases }),
      );
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
