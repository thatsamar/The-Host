import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Supabase with the secret (service role) key, for signing invited people in.
 * Server only. The Vercel Supabase integration sets SUPABASE_SERVICE_ROLE_KEY;
 * newer projects may use SUPABASE_SECRET_KEY. Returns null when neither is set.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
