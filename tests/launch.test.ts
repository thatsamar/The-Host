import { describe, expect, it } from "vitest";
import { launchProblems } from "@/lib/launch";

describe("production launch guard", () => {
  it("stops a production hub build that would show Alden as coming soon", () => {
    expect(launchProblems({ COMPANION: "hub", VERCEL_ENV: "production" })).toEqual([expect.stringMatching(/^NEXT_PUBLIC_ALDEN_URL is not set/)]);
    expect(launchProblems({ COMPANION: " Hub ", VERCEL_ENV: "production", NEXT_PUBLIC_ALDEN_URL: " " })).toHaveLength(1);
  });

  it("lets the hub go live once Alden's address is set", () => {
    expect(launchProblems({ COMPANION: "hub", VERCEL_ENV: "production", NEXT_PUBLIC_ALDEN_URL: "https://alden.example" })).toEqual([]);
  });

  it("leaves previews, local builds and advisor deployments alone", () => {
    expect(launchProblems({ COMPANION: "hub", VERCEL_ENV: "preview" })).toEqual([]);
    expect(launchProblems({ COMPANION: "hub" })).toEqual([]);
    for (const companion of ["alden", "jack", "tony", undefined]) {
      expect(launchProblems({ COMPANION: companion, VERCEL_ENV: "production" })).toEqual([]);
    }
  });
});
