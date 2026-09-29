import { describe, expect, it } from "vitest";
import { missingSupabaseConfig, signInErrorMessage } from "@/lib/auth/sign-in-error";

describe("signInErrorMessage", () => {
  it("explains each failure", () => {
    expect(signInErrorMessage({ code: "email_not_confirmed", status: 400 })).toMatch(/Auto Confirm/);
    expect(signInErrorMessage({ code: "invalid_credentials", status: 400 })).toMatch(/don't match/);
    expect(signInErrorMessage({ status: 401, message: "Invalid API key" })).toMatch(/PUBLISHABLE_KEY/);
    expect(signInErrorMessage({ name: "AuthRetryableFetchError", status: 0, message: "fetch failed" })).toMatch(/SUPABASE_URL/);
    expect(signInErrorMessage({ status: 429 })).toMatch(/Too many/);
    expect(signInErrorMessage({ status: 500, message: "Database error" })).toBe("Sign-in failed: Database error.");
  });

  it("lists missing Supabase settings", () => {
    expect(missingSupabaseConfig({})).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
    expect(missingSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k" })).toEqual([]);
    expect(missingSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toEqual([]);
  });
});
