import { describe, expect, it } from "vitest";
import { ACTIVE_LINEUP, COMPANIONS, copyOf, currentCompanion, isCompanionId } from "@/lib/companions";

describe("currentCompanion", () => {
  it("picks the deployment's companion from COMPANION, defaulting to Gio", () => {
    expect(currentCompanion("tony").name).toBe("Tony");
    expect(currentCompanion(" Tony ").name).toBe("Tony");
    expect(currentCompanion("martini").name).toBe("Martine");
    expect(currentCompanion("JACK").name).toBe("Jack");
    expect(currentCompanion("constructor").name).toBe("Gio");
    expect(currentCompanion("gio").name).toBe("Gio");
    expect(currentCompanion(undefined).name).toBe("Gio");
    expect(currentCompanion("nobody").name).toBe("Gio");
  });

  it("sends the browser the words only, never the prompt", () => {
    for (const companion of Object.values(COMPANIONS)) {
      const copy = copyOf(companion) as unknown as Record<string, unknown>;
      expect(copy.systemPrompt).toBeUndefined();
      expect(copy.capabilities).toBeUndefined();
      expect(copy.tagline).toBe(companion.tagline);
    }
  });
});

describe("Cinq's lineup", () => {
  it("is Tony, Martine, Gio, Alden and Goldie, in that order", () => {
    expect(ACTIVE_LINEUP.map((id) => COMPANIONS[id].name)).toEqual(["Tony", "Martine", "Gio", "Alden", "Goldie"]);
    for (const id of ACTIVE_LINEUP) expect(COMPANIONS[id].retired).toBeFalsy();
  });

  it("picks Alden from COMPANION=alden", () => {
    for (const value of ["alden", " Alden ", "ALDEN"]) {
      const alden = currentCompanion(value);
      expect(alden.id).toBe("alden");
      expect(alden.name).toBe("Alden");
      expect(alden.role).toBe("Wine, Cocktails & Spirits Advisor");
      expect(alden.tagline).toBe("Choose well. Enjoy it.");
      expect(alden.intro).toBe("Alden helps you choose what to drink, from a bottle on a wine list to a cocktail at the bar. Deep knowledge, no pretense.");
      expect(alden.placeholder).toBe("What are we drinking?");
    }
  });

  it("keeps Jack as Jack, retired and out of the lineup, never as Alden", () => {
    const jack = currentCompanion("jack");
    expect(jack.id).toBe("jack");
    expect(jack.name).toBe("Jack");
    expect(jack.retired).toBe(true);
    expect(jack.systemPrompt).toMatch(/^You are Jack:/);
    expect(ACTIVE_LINEUP).not.toContain("jack");
    expect(COMPANIONS.alden.systemPrompt).not.toMatch(/\bJack\b/);
    expect(COMPANIONS.alden.iconTile).not.toBe(jack.iconTile);
  });

  it("knows which COMPANION values are advisors, so the rest are the hub", () => {
    for (const value of ["alden", "tony", "martini", "gio", "goldie", "jack", " Alden "]) expect(isCompanionId(value)).toBe(true);
    for (const value of [undefined, "", "hub", "constructor", "untangled", "aldo"]) expect(isCompanionId(value)).toBe(false);
  });
});
