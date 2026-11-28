import { afterEach, describe, expect, it } from "vitest";
import { isOwnerPhone, isOwnerRequest, normalizePhone } from "@/lib/foundations/owner";
import { newSession } from "@/lib/ops/session";

afterEach(() => {
  delete process.env.OWNER_PHONE;
});

describe("who the owner is", () => {
  it("normalizes numbers to E.164", () => {
    expect(normalizePhone("+1 (512) 555-0100")).toBe("+15125550100");
    expect(normalizePhone("512.555.0100")).toBe("+15125550100");
    expect(normalizePhone("15125550100")).toBe("+15125550100");
    expect(normalizePhone("0044 20 7946 0000")).toBe("+442079460000");
    expect(normalizePhone("5550100")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("by text: the sender whose number matches OWNER_PHONE, however it is written", () => {
    process.env.OWNER_PHONE = "(512) 555-0100";
    expect(isOwnerPhone("+15125550100")).toBe(true);
    expect(isOwnerPhone("+15125550101")).toBe(false);
    expect(isOwnerPhone("")).toBe(false);
    delete process.env.OWNER_PHONE;
    expect(isOwnerPhone("+15125550100")).toBe(false);
  });

  it("on the website: a request carrying this deployment's /ops sign-in", () => {
    const { value } = newSession("right-horse");
    const req = (cookie?: string) => new Request("https://cinq.example/api/ask", { headers: cookie ? { Cookie: cookie } : {} });
    expect(isOwnerRequest(req(`cinq_ops=${value}`), "right-horse")).toBe(true);
    expect(isOwnerRequest(req(`cinq_ops=${value}`), "other-password")).toBe(false);
    expect(isOwnerRequest(req("cinq_ops=9999999999.forged"), "right-horse")).toBe(false);
    expect(isOwnerRequest(req(), "right-horse")).toBe(false);
    expect(isOwnerRequest(req(`cinq_ops=${value}`), "")).toBe(false);
  });
});
