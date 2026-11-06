import { describe, expect, it } from "vitest";
import { MAX_SPOKEN_CHUNK, speakableText, spokenChunks } from "../src/lib/speech";

describe("reading an answer aloud", () => {
  it("reads the words, not the Markdown or the addresses", () => {
    const answer = [
      "## The call",
      "",
      "**Book the Rosewood.** It is *quiet*, and the [bar](https://example.com/bar) is good.",
      "",
      "- Ask for a high floor",
      "1. Arrive before six",
      "",
      "---",
      "",
      "| Hotel | Price |",
      "| --- | --- |",
      "| Rosewood | $$$ |",
      "",
      "See https://example.com for more. Keep snake_case_words.",
    ].join("\n");
    const spoken = speakableText(answer);
    expect(spoken).toBe(
      "The call. Book the Rosewood. It is quiet, and the bar is good. Ask for a high floor. Arrive before six. Hotel, Price. Rosewood, $$$. See for more. Keep snake_case_words.",
    );
    expect(spoken).not.toMatch(/[#*|[\]]|https?:/);
  });

  it("splits a long answer into short pieces at sentence ends, losing nothing", () => {
    const sentence = "This sentence is a reasonable length for one breath. ";
    const text = sentence.repeat(20).trim();
    const chunks = spokenChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(MAX_SPOKEN_CHUNK);
      expect(c.endsWith(".")).toBe(true);
    }
    expect(chunks.join(" ")).toBe(text);
  });

  it("breaks a single overlong sentence at spaces", () => {
    const text = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
    const chunks = spokenChunks(text);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(MAX_SPOKEN_CHUNK);
    expect(chunks.join(" ")).toBe(text);
  });

  it("has nothing to read in an empty answer", () => {
    expect(spokenChunks(speakableText("   \n\n"))).toEqual([]);
  });
});
