import { z } from "zod";
import { getChatProvider } from "@/lib/ai";
import { serverEnv } from "@/lib/env";
import { askGio, type AskEvent } from "@/lib/gio/ask";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/gio/default-system-prompt";
import { MAX_PHOTOS_PER_TURN } from "@/lib/gio/prompt";
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
});

export async function POST(request: Request) {
  const supabase = await createClient();
  if (!(await getUserId(supabase))) return Response.json({ error: "Not signed in" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  let provider;
  try {
    serverEnv();
    provider = getChatProvider();
  } catch (err) {
    // Names the missing settings (never their values) so the page can show what to fix.
    return Response.json({ error: err instanceof Error ? err.message : "Server settings are incomplete" }, { status: 500 });
  }

  const events = askGio(
    { provider, systemPrompt: DEFAULT_SYSTEM_PROMPT, signal: request.signal },
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
