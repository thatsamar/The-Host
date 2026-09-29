import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_OFF, INVITE_EXPIRED, JOIN_UNAVAILABLE, inviteCode, isValidInvite, joinWithInvite, normalizeEmail } from "@/lib/auth/invite";

describe("invite code", () => {
  it("is off unless INVITE_CODE is set and long enough", () => {
    expect(inviteCode(undefined)).toBeNull();
    expect(inviteCode("short")).toBeNull();
    expect(inviteCode("  late-light-ferry  ")).toBe("late-light-ferry");
  });

  it("matches exactly", () => {
    expect(isValidInvite("late-light-ferry", "late-light-ferry")).toBe(true);
    expect(isValidInvite(" late-light-ferry ", "late-light-ferry")).toBe(true);
    expect(isValidInvite("late-light-ferrY", "late-light-ferry")).toBe(false);
    expect(isValidInvite("anything", null)).toBe(false);
  });

  it("normalizes emails", () => {
    expect(normalizeEmail(" Ana@Example.com ")).toBe("ana@example.com");
    expect(normalizeEmail("nope")).toBeNull();
  });
});

describe("joinWithInvite", () => {
  const deps = (over: Partial<Parameters<typeof joinWithInvite>[1]> = {}) => ({
    expectedCode: "late-light-ferry",
    mintToken: vi.fn(async () => ({ tokenHash: "hash" })),
    redeemToken: vi.fn(async () => ({})),
    log: vi.fn(),
    ...over,
  });

  it("signs someone in with a valid link and an email, no password", async () => {
    const d = deps();
    expect(await joinWithInvite({ code: "late-light-ferry", email: "Ana@Example.com" }, d)).toEqual({ ok: true });
    expect(d.mintToken).toHaveBeenCalledWith("ana@example.com");
    expect(d.redeemToken).toHaveBeenCalledWith("hash");
  });

  it("turns away a retired link without touching accounts", async () => {
    const d = deps();
    expect(await joinWithInvite({ code: "old-code-123", email: "ana@example.com" }, d)).toEqual({ ok: false, error: INVITE_EXPIRED });
    expect(d.mintToken).not.toHaveBeenCalled();
  });

  it("asks for a real email", async () => {
    expect(await joinWithInvite({ code: "late-light-ferry", email: "ana" }, deps())).toMatchObject({ ok: false });
  });

  it("keeps switched-off accounts out, and setup problems out of view", async () => {
    const banned = deps({ redeemToken: async () => ({ error: { message: "User is banned", code: "user_banned" } }) });
    expect(await joinWithInvite({ code: "late-light-ferry", email: "ana@example.com" }, banned)).toEqual({ ok: false, error: ACCOUNT_OFF });
    const broken = deps({ mintToken: async () => ({ error: { message: "Invalid API key" } }) });
    expect(await joinWithInvite({ code: "late-light-ferry", email: "ana@example.com" }, broken)).toEqual({ ok: false, error: JOIN_UNAVAILABLE });
    expect(broken.log).toHaveBeenCalled();
  });
});
