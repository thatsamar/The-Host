import { describe, expect, it, vi } from "vitest";
import { COMPANIONS } from "@/lib/companions";

vi.mock("@/lib/env", () => ({ serverEnv: () => ({ ANTHROPIC_API_KEY: "test", CHAT_MODEL: "m", CHAT_EFFORT: "high" }) }));

const { getChatProvider } = await import("@/lib/ai");
const searchesOf = (provider: unknown) => (provider as { options: { webSearchMaxUses: number } }).options.webSearchMaxUses;

describe("web searches per answer", () => {
  it("gives Alden up to five, unless WEB_SEARCH_MAX_USES says otherwise", () => {
    expect(searchesOf(getChatProvider(COMPANIONS.alden))).toBe(5);
    expect(searchesOf(getChatProvider(COMPANIONS.tony))).toBe(8);
  });
});
