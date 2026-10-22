import "server-only";
import { z } from "zod";
import { errorClass } from "@/lib/diagnostics";
import { BlooioAdapter } from "./blooio";
import { cinqEngine } from "./engine";
import { createPostgresClient } from "./postgres-client";
import { PostgresStore } from "./postgres-store";
import { retention } from "./retention";
import { createChannel, type Channel } from "./service";

// The messaging channel as a deployment runs it, from server settings. Off
// unless MESSAGES_CHANNEL_ENABLED is exactly "true": this codebase deploys to
// every Cinq project, and only one should ever carry the channel.

export const messagesEnabled = (value = process.env.MESSAGES_CHANNEL_ENABLED) => value?.trim() === "true";

const list = z
  .string()
  .transform((v) => v.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean))
  .pipe(z.array(z.string().regex(/^[a-z0-9.-]+$/)).min(1));

const schema = z.object({
  MESSAGES_PROVIDER: z.literal("blooio"),
  BLOOIO_API_KEY: z.string().trim().min(1),
  BLOOIO_WEBHOOK_SECRET: z.string().trim().min(1),
  MESSAGES_ATTACHMENT_HOSTS: list,
  MESSAGES_DATABASE_URL: z.string().trim().regex(/^postgres(ql)?:\/\//),
  MESSAGES_MAX_TEXT_CHARS: z.coerce.number().int().min(200).max(20_000).optional(),
});

let cached: Channel | undefined;

/** The channel for this deployment, built once per server instance. Throws, naming the settings (never their values), when misconfigured. */
export function channelFromEnv(): Channel {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const settings = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))];
    throw Object.assign(new Error("Messaging settings are missing or invalid"), { settings });
  }
  const env = parsed.data;
  const adapter = new BlooioAdapter({
    apiKey: env.BLOOIO_API_KEY,
    webhookSecret: env.BLOOIO_WEBHOOK_SECRET,
    attachmentHosts: env.MESSAGES_ATTACHMENT_HOSTS,
    maxTextChars: env.MESSAGES_MAX_TEXT_CHARS,
  });
  const store = new PostgresStore(createPostgresClient(env.MESSAGES_DATABASE_URL), retention());
  cached = createChannel({ adapter, store, engine: cinqEngine() });
  return cached;
}

/** For the routes: the channel, or the response to send when it can't be built. */
export function channelOrUnavailable(): { channel: Channel } | { response: Response } {
  try {
    return { channel: channelFromEnv() };
  } catch (err) {
    console.error("Messages: misconfigured", JSON.stringify({ error: errorClass(err), settings: (err as { settings?: unknown }).settings }));
    return { response: new Response(null, { status: 503 }) };
  }
}
