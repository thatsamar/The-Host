import { describe, expect, it } from "vitest";
import { COMPANIONS, copyOf, currentCompanion } from "@/lib/companions";

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
