"use server";

import { redirect } from "next/navigation";
import { inviteCode, joinWithInvite, JOIN_UNAVAILABLE } from "@/lib/auth/invite";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function join(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const admin = createAdminClient();
  if (!admin) {
    console.error("Invitations need SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) on this deployment.");
    return { error: JOIN_UNAVAILABLE };
  }
  const supabase = await createClient();
  const result = await joinWithInvite(
    { code: String(formData.get("code") ?? ""), email: String(formData.get("email") ?? "") },
    {
      expectedCode: inviteCode(),
      mintToken: async (email) => {
        const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
        return { tokenHash: data?.properties?.hashed_token, error };
      },
      redeemToken: async (tokenHash) => {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
        return { error };
      },
    },
  );
  if (!result.ok) return { error: result.error };
  redirect("/");
}
