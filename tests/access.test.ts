import { describe, expect, it } from "vitest";
import { signInRequired } from "@/lib/auth/access";
import { createRateLimiter, questionsPerHour, visitorKey } from "@/lib/ask/rate-limit";

describe("signInRequired", () => {
  it("is off unless REQUIRE_SIGN_IN is switched on", () => {
    expect(signInRequired(undefined)).toBe(false);
    expect(signInRequired("")).toBe(false);
    expect(signInRequired("false")).toBe(false);
    for (const on of ["true", "TRUE", " yes ", "1", "on"]) expect(signInRequired(on)).toBe(true);
  });
});

describe("rate limit", () => {
  it("lets a visitor ask up to the limit per hour, then says when to come back", () => {
    let t = 0;
    const check = createRateLimiter({ limit: 3, now: () => t });
    expect([check("a"), check("a"), check("a")].every((r) => r.ok)).toBe(true);
    expect(check("b").ok).toBe(true);
    t = 10 * 60 * 1000;
    expect(check("a")).toEqual({ ok: false, retryAfterSeconds: 50 * 60 });
    t = 60 * 60 * 1000;
    expect(check("a").ok).toBe(true);
  });

  it("can be switched off, and reads the visitor's address", () => {
    const check = createRateLimiter({ limit: 0 });
    expect(Array.from({ length: 100 }, () => check("a").ok).every(Boolean)).toBe(true);
    expect(visitorKey(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(visitorKey(new Headers())).toBe("unknown");
    expect(questionsPerHour(undefined)).toBe(40);
    expect(questionsPerHour("0")).toBe(0);
    expect(questionsPerHour("abc")).toBe(40);
  });
});
