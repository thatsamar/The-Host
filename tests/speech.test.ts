import { describe, expect, it } from "vitest";
import { FIRST_NATURAL_PIECE, MAX_SPOKEN_CHUNK, NATURAL_PIECE, chooseVoice, naturalPieces, speakableText, spokenChunks } from "../src/lib/speech";
import { ACTIVE_LINEUP, COMPANIONS } from "../src/lib/companions";

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

describe("each advisor's own voice", () => {
  // Typical lists: an iPhone, Chrome on a Mac, Edge on Windows, an Android phone.
  const IPHONE = [
    ["Samantha", "en-US"], ["Aaron", "en-US"], ["Fred", "en-US"], ["Nicky", "en-US"], ["Daniel", "en-GB"], ["Arthur", "en-GB"],
    ["Martha", "en-GB"], ["Karen", "en-AU"], ["Gordon", "en-AU"], ["Catherine", "en-AU"], ["Moira", "en-IE"], ["Rishi", "en-IN"],
    ["Tessa", "en-ZA"], ["Thomas", "fr-FR"], ["Amélie", "fr-CA"], ["Bad News", "en-US"],
  ].map(([name, lang]) => ({ name, lang }));
  const CHROME_MAC = [
    ["Google US English", "en-US"], ["Google UK English Female", "en-GB"], ["Google UK English Male", "en-GB"],
    ["Samantha", "en-US"], ["Daniel (English (United Kingdom))", "en-GB"], ["Karen", "en-AU"],
  ].map(([name, lang]) => ({ name, lang }));
  const EDGE = [
    "Microsoft Andrew Online (Natural) - English (United States)", "Microsoft Aria Online (Natural) - English (United States)",
    "Microsoft Guy Online (Natural) - English (United States)", "Microsoft Jenny Online (Natural) - English (United States)",
    "Microsoft Ryan Online (Natural) - English (United Kingdom)", "Microsoft Sonia Online (Natural) - English (United Kingdom)",
    "Microsoft William Online (Natural) - English (Australia)", "Microsoft Natasha Online (Natural) - English (Australia)",
  ].map((name) => ({ name, lang: name.includes("United States") ? "en-US" : name.includes("Kingdom") ? "en-GB" : "en-AU" }));

  const pick = (voices: { name: string; lang: string }[], id: (typeof ACTIVE_LINEUP)[number]) => chooseVoice(voices, COMPANIONS[id].voice)?.name;

  it("gives every advisor a voice of its own on an iPhone and in Edge", () => {
    for (const voices of [IPHONE, EDGE]) {
      const chosen = ACTIVE_LINEUP.map((id) => pick(voices, id));
      expect(new Set(chosen).size).toBe(ACTIVE_LINEUP.length);
    }
    expect(Object.fromEntries(ACTIVE_LINEUP.map((id) => [id, pick(IPHONE, id)]))).toEqual({
      tony: "Aaron",
      martini: "Martha",
      gio: "Arthur",
      alden: "Gordon",
      goldie: "Samantha",
    });
  });

  it("keeps each advisor's gender and never picks a novelty or non-English voice", () => {
    const female = new Set(["Google US English", "Google UK English Female", "Samantha", "Karen"]);
    for (const id of ACTIVE_LINEUP) {
      const name = pick(CHROME_MAC, id)!;
      expect(female.has(name)).toBe(COMPANIONS[id].voice.gender === "female");
      expect(pick(IPHONE, id)).not.toMatch(/Fred|Bad News|Thomas|Amélie/);
    }
  });

  it("prefers the better-quality copy of the same voice, and matches whole names only", () => {
    const voices = [{ name: "Daniel", lang: "en-GB" }, { name: "Daniel (Enhanced)", lang: "en-GB" }, { name: "Danielle", lang: "en-US" }];
    expect(chooseVoice(voices, { preferred: ["Daniel"], lang: "en-GB", gender: "male" })?.name).toBe("Daniel (Enhanced)");
  });

  it("leaves the browser's default when the device has no English voice", () => {
    expect(chooseVoice([{ name: "Thomas", lang: "fr-FR" }], COMPANIONS.gio.voice)).toBeNull();
    expect(chooseVoice([], COMPANIONS.gio.voice)).toBeNull();
  });

  it("gives every active advisor a calm, natural pace", () => {
    for (const id of ACTIVE_LINEUP) {
      const { rate, pitch } = COMPANIONS[id].voice;
      expect(rate).toBeGreaterThanOrEqual(0.85);
      expect(rate).toBeLessThanOrEqual(1.1);
      expect(pitch).toBeGreaterThanOrEqual(0.85);
      expect(pitch).toBeLessThanOrEqual(1.1);
    }
  });
});

describe("pieces for a natural voice", () => {
  it("starts with a short piece so the voice begins quickly, then longer ones, losing nothing", () => {
    const text = "This sentence is a reasonable length for one breath. ".repeat(60).trim();
    const pieces = naturalPieces(text);
    expect(pieces[0].length).toBeLessThanOrEqual(FIRST_NATURAL_PIECE);
    for (const p of pieces.slice(1)) expect(p.length).toBeLessThanOrEqual(NATURAL_PIECE);
    expect(pieces[1].length).toBeGreaterThan(FIRST_NATURAL_PIECE);
    expect(pieces.join(" ")).toBe(text);
    expect(naturalPieces("")).toEqual([]);
  });
});
