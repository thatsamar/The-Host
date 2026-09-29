export const SIGN_IN_UNAVAILABLE = "Sign-in isn't available right now. Please try again a little later.";

/**
 * Turns a Supabase sign-in failure into a message for the person signing in.
 * Setup problems all read the same to them; the caller logs the specifics.
 */
export function signInErrorMessage(error: { code?: string; status?: number; message?: string; name?: string } | null): string {
  if (!error) return "Sign-in failed. Try again.";
  if (error.code === "invalid_credentials") return "That email and password don't match.";
  if (error.code === "email_not_confirmed") return "This account isn't ready yet. Ask the person who invited you.";
  if (error.code === "user_banned") return "This account has been switched off.";
  if (error.code === "over_request_rate_limit" || error.status === 429) return "Too many attempts. Wait a few minutes and try again.";
  return SIGN_IN_UNAVAILABLE;
}

/** Names the Supabase settings that are missing from the environment. */
export function missingSupabaseConfig(env: Record<string, string | undefined> = supabaseEnv()): string[] {
  const missing: string[] = [];
  if (!env.NEXT_PUBLIC_SUPABASE_URL?.trim()) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() && !env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim())
    missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  return missing;
}

// Read each setting by its literal name, as the Supabase clients do, so the
// build inlines NEXT_PUBLIC_ values the same way for both.
function supabaseEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}
