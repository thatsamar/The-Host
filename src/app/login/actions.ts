"use server";

import { redirect } from "next/navigation";
import { SIGN_IN_UNAVAILABLE, missingSupabaseConfig, signInErrorMessage } from "@/lib/auth/sign-in-error";
import { createClient } from "@/lib/supabase/server";

export async function signIn(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter the email and password." };

  const missing = missingSupabaseConfig();
  if (missing.length) {
    console.error(`Sign-in is misconfigured: set ${missing.join(" and ")} in Vercel, then redeploy.`);
    return { error: SIGN_IN_UNAVAILABLE };
  }

  let failure: string | null = null;
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      failure = signInErrorMessage(error);
      if (failure === SIGN_IN_UNAVAILABLE) console.error("Sign-in failed:", error.status, error.code, error.message);
    }
  } catch (err) {
    console.error("Sign-in failed:", err instanceof Error ? err.message : err);
    failure = SIGN_IN_UNAVAILABLE;
  }
  if (failure) return { error: failure };
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
