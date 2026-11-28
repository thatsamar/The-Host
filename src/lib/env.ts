import "server-only";
import { z } from "zod";

// Server-side configuration. Read lazily so `next build` works without secrets.
const schema = z.object({
  // Only needed where sign-in is on (REQUIRE_SIGN_IN); the proxy checks them there.
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
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
  // Cinq by text's router (which advisor a first question goes to). Unset uses CHAT_MODEL.
  ROUTER_MODEL: z.string().min(1).optional(),
  // Unset means the companion's own default (Gio 5, Amar 8).
  WEB_SEARCH_MAX_USES: z.coerce.number().int().min(0).max(20).optional(),
});

/**
 * The private intellectual foundations (docs/foundations.md). Server only:
 * none of these is ever NEXT_PUBLIC_. Off unless FOUNDATIONS_ENABLED is set;
 * until then nothing is read from the store at all. Parsed apart from the
 * settings above, so a mistyped foundation key can only send C2 advisors to
 * their fallback, never take the whole app down.
 */
function foundationsShape() {
  const flag = z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1");
  // A 32-byte key, base64: what `openssl rand -base64 32` prints.
  const key = z
    .string()
    .trim()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 random bytes, base64 (openssl rand -base64 32)")
    .optional();
  return {
    FOUNDATIONS_ENABLED: flag,
    FOUNDATION_KEY: key,
    FOUNDATION_KEY_ID: z.string().trim().min(1).max(40).optional(),
    // The key before the last rotation, so versions encrypted with it still load.
    FOUNDATION_KEY_PREVIOUS: key,
    FOUNDATION_KEY_PREVIOUS_ID: z.string().trim().min(1).max(40).optional(),
    // How long a C2 advisor may run on its fallback before it counts as unavailable.
    FOUNDATION_FALLBACK_MAX_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(60),
    // The photo note (off until approved).
    PHOTO_NOTE_ENABLED: flag,
    // The owner's number, for C2 rolled out to the owner only (by text). Never logged.
    OWNER_PHONE: z.string().trim().max(32).optional(),
  };
}

/** The foundations settings alone, so they can be read where the model's settings aren't needed (and in tests). */
export function foundationsEnv(): z.infer<z.ZodObject<ReturnType<typeof foundationsShape>>> {
  const parsed = z.object(foundationsShape()).safeParse(process.env);
  if (!parsed.success) {
    const settings = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))];
    throw Object.assign(new Error(`Invalid foundation settings in Vercel: ${settings.join(", ")}.`), { settings });
  }
  return parsed.data;
}

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
    ROUTER_MODEL: process.env.ROUTER_MODEL || undefined,
  });
  if (!parsed.success) {
    // Names each setting and what's wrong with it, never its value.
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")} (${i.message})`).join(", ");
    // The settings' names alone, for the server log; the message is for whoever reads the error.
    const settings = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))];
    throw Object.assign(
      new Error(`Missing or invalid settings in Vercel: ${problems}. Fix them under Settings → Environment Variables, then redeploy.`),
      { settings },
    );
  }
  cached = parsed.data;
  return cached;
}
