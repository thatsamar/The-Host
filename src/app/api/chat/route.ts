import { z } from "zod";
import { getBackgroundModel, getChatProvider } from "@/lib/ai";
import { ChatInputError, runChatTurn, type ChatServerEvent } from "@/lib/chat/service";
import { SupabaseChatRepository } from "@/lib/db/supabase-repository";
import { HUMAN_SPEAKERS } from "@/lib/gio/speakers";
import { createClient, getUserId } from "@/lib/supabase/server";

// Long design answers with web search can take a while.
export const maxDuration = 300;

const bodySchema = z.object({
  chatId: z.string().uuid().nullish(),
  projectId: z.string().uuid(),
  roomId: z.string().uuid().nullish(),
  speaker: z.enum(HUMAN_SPEAKERS),
  text: z.string().min(1).max(20000),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const events = runChatTurn(
    {
      repo: new SupabaseChatRepository(supabase, userId),
      provider: getChatProvider(),
      background: getBackgroundModel(),
      signal: request.signal,
    },
    parsed.data,
  );

  // Pull the first event before committing to a 200 so validation errors
  // (bad chat, room or project) come back as proper HTTP errors.
  let first: IteratorResult<ChatServerEvent>;
  try {
    first = await events.next();
  } catch (err) {
    const status = err instanceof ChatInputError ? 400 : 500;
    return Response.json({ error: err instanceof Error ? err.message : "Failed" }, { status });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatServerEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        if (!first.done) send(first.value);
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
