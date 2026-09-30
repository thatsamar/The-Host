import "server-only";
import { z } from "zod";

// Server-side configuration. Read lazily so `next build` works without secrets.
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  // Printable ASCII only: catches the "●●●●" Vercel shows for a hidden value
  // being saved back as the key, which otherwise fails deep inside fetch.
  ANTHROPIC_API_KEY: z
    .string()
    .trim()
    .min(1)
    .regex(/^[\x21-\x7e]+$/, "must be the key itself, not the dots Vercel shows in place of a hidden value"),
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  CHAT_MODEL: z.string().min(1).default("claude-opus-5-5"),
  CHAT_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
  // Unset means the companion's own default (Gio 5, Tony 8).
  WEB_SEARCH_MAX_USES: z.coerce.number().int().min(0).max(20).optional(),
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
    // Earlier names, from when this app was only Gio.
    CHAT_MODEL: process.env.CHAT_MODEL || process.env.GIO_CHAT_MODEL || undefined,
    CHAT_EFFORT: process.env.CHAT_EFFORT || process.env.GIO_CHAT_EFFORT || undefined,
    WEB_SEARCH_MAX_USES: process.env.WEB_SEARCH_MAX_USES || process.env.GIO_WEB_SEARCH_MAX_USES || undefined,
  });
  if (!parsed.success) {
    // Names each setting and what's wrong with it, never its value.
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")} (${i.message})`).join(", ");
    throw new Error(`Missing or invalid settings in Vercel: ${problems}. Fix them under Settings → Environment Variables, then redeploy.`);
  }
  cached = parsed.data;
  return cached;
}
