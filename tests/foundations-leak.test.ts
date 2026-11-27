import { describe, expect, it } from "vitest";
import { checkLeak, RUN_WORDS, sentencesOf } from "@/lib/foundations/leak-guard";

// Stand-in text only: real foundations never enter the repository.
const FOUNDATION =
  'Stand-in principle. "A lantern is better judged at dusk than at noon, because the light it gives depends on the dark around it." Another stand-in line about kettles, harbours and the patience of slow bread on a cold morning in a small kitchen.';

describe("the leak guard", () => {
  it("passes an answer that says something in its own words", () => {
    const r = checkLeak("Go in the evening: lamps look best once it gets dark, and the street is calmer then.", FOUNDATION);
    expect(r.leaked).toBe(false);
  });

  it("catches a long run of the foundation's words, whatever the case and punctuation", () => {
    const r = checkLeak("As they say, a LANTERN is better judged at dusk than at noon; because the light it gives depends on the dark.", FOUNDATION);
    expect(r.leaked).toBe(true);
    expect(r.longestRun).toBeGreaterThanOrEqual(RUN_WORDS);
  });

  it("catches several shorter phrases lifted from it", () => {
    const answer = "Think of kettles, harbours and the patience of slow bread. The light it gives depends on the dark around it, mostly. On a cold morning in a small kitchen, everything is clearer.";
    const r = checkLeak(answer, FOUNDATION);
    expect(r.phrases).toBeGreaterThanOrEqual(3);
    expect(r.leaked).toBe(true);
  });

  it("splits a reply into sentences for the fallback trim", () => {
    expect(sentencesOf("One. Two? Three!” Four")).toEqual(["One.", "Two?", "Three!”", "Four"]);
  });
});
