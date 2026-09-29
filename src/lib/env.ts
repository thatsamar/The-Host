import "server-only";
import { z } from "zod";

// Server-side configuration. Read lazily so `next build` works without secrets.
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  GIO_CHAT_MODEL: z.string().min(1).default("claude-opus-5-5"),
  GIO_CHAT_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
  GIO_WEB_SEARCH_MAX_USES: z.coerce.number().int().min(0).max(20).default(5),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse({
    ...process.env,
    // The Vercel Supabase integration may provide the legacy anon key instead.
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Gio is missing settings in Vercel: ${missing}. Add them under Settings → Environment Variables, then redeploy.`);
  }
  cached = parsed.data;
  return cached;
}
