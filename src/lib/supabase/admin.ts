import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client for scripts only (bootstrap, migrations of data).
 * Never import this from app code: it bypasses row-level security.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
