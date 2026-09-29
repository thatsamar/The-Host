"use server";

import { redirect } from "next/navigation";
import { missingSupabaseConfig, signInErrorMessage } from "@/lib/auth/sign-in-error";
import { createClient } from "@/lib/supabase/server";

export async function signIn(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter the email and password." };

  const missing = missingSupabaseConfig();
  if (missing.length) return { error: `Gio isn't connected to Supabase yet. Add ${missing.join(" and ")} in Vercel, then redeploy.` };

  let failure: string | null = null;
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) failure = signInErrorMessage(error);
  } catch (err) {
    failure = signInErrorMessage({ message: err instanceof Error ? err.message : String(err), status: 0 });
  }
  if (failure) return { error: failure };
  redirect("/");
}
