import { afterEach, describe, expect, it, vi } from "vitest";

const base = {
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k",
};

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...base, ...env })) vi.stubEnv(k, v);
  return (await import("@/lib/env")).serverEnv;
}

describe("serverEnv", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts a real-looking key, trimming stray whitespace", async () => {
    const serverEnv = await load({ ANTHROPIC_API_KEY: "  sk-ant-api03-abc_DEF-123 \n" });
    expect(serverEnv().ANTHROPIC_API_KEY).toBe("sk-ant-api03-abc_DEF-123");
  });

  it("names a key saved as Vercel's hidden-value dots, without echoing it", async () => {
    const serverEnv = await load({ ANTHROPIC_API_KEY: "●●●●●●●●" });
    expect(serverEnv).toThrow(/ANTHROPIC_API_KEY \(must be the key itself, not the dots/);
    try {
      serverEnv();
    } catch (err) {
      expect(String(err)).not.toContain("●");
    }
  });
});
