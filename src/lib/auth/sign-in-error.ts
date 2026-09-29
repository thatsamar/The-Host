/** Turns a Supabase sign-in failure into a message that says what to fix. */
export function signInErrorMessage(error: { code?: string; status?: number; message?: string; name?: string } | null): string {
  if (!error) return "Sign-in failed. Try again.";
  const message = error.message ?? "";
  if (error.code === "email_not_confirmed")
    return "This login hasn't been confirmed. In Supabase, open Authentication → Users, delete it, and add it again with “Auto Confirm User” ticked.";
  if (error.code === "invalid_credentials")
    return "That email and password don't match a login in Supabase. Check Authentication → Users, or use “Send password recovery” / set a new password there.";
  if (error.code === "over_request_rate_limit" || error.status === 429)
    return "Too many attempts. Wait a few minutes and try again.";
  if (/invalid api key|no api key|apikey/i.test(message) || error.status === 401)
    return "Gio can't reach its database: the Supabase key in Vercel is wrong. Check NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then redeploy.";
  if (error.name === "AuthRetryableFetchError" || error.status === 0 || /fetch failed|ENOTFOUND/i.test(message))
    return "Gio can't reach its database: check NEXT_PUBLIC_SUPABASE_URL in Vercel, then redeploy.";
  return `Sign-in failed: ${message || "unknown error"}.`;
}

/** Names the Supabase settings that are missing from the environment. */
export function missingSupabaseConfig(env: Record<string, string | undefined> = process.env): string[] {
  const missing: string[] = [];
  if (!env.NEXT_PUBLIC_SUPABASE_URL?.trim()) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() && !env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim())
    missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  return missing;
}
