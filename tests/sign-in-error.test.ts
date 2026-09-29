import { describe, expect, it } from "vitest";
import { SIGN_IN_UNAVAILABLE, missingSupabaseConfig, signInErrorMessage } from "@/lib/auth/sign-in-error";

describe("signInErrorMessage", () => {
  it("explains what the person can act on, and keeps setup problems out of their view", () => {
    expect(signInErrorMessage({ code: "invalid_credentials", status: 400 })).toBe("That email and password don't match.");
    expect(signInErrorMessage({ code: "email_not_confirmed", status: 400 })).toMatch(/Ask the person who invited you/);
    expect(signInErrorMessage({ status: 429 })).toMatch(/Too many/);
    for (const setup of [
      { status: 401, message: "Invalid API key" },
      { name: "AuthRetryableFetchError", status: 0, message: "fetch failed" },
      { status: 500, message: "Database error" },
    ]) {
      const message = signInErrorMessage(setup);
      expect(message).toBe(SIGN_IN_UNAVAILABLE);
      expect(message).not.toMatch(/Supabase|Vercel|KEY|URL/);
    }
  });

  it("lists missing Supabase settings", () => {
    expect(missingSupabaseConfig({})).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
    expect(missingSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k" })).toEqual([]);
    expect(missingSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toEqual([]);
  });
});
