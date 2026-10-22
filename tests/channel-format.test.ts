import { describe, expect, it } from "vitest";
import { splitMessages, toPlainText } from "@/lib/channel/format";

describe("plain text for a messaging app", () => {
  it("takes Markdown marks off and keeps every word and link", () => {
    const md = "### The call\n\nGo to **Jay Fai** for the *crab omelette*.\n\n- Book [ahead](https://example.com/jay)\n- Arrive early\n\n```\ncode\n```";
    expect(toPlainText(md)).toBe("The call\n\nGo to Jay Fai for the crab omelette.\n\n• Book ahead (https://example.com/jay)\n• Arrive early\n\ncode");
  });

  it("leaves underscores and asterisks inside words alone", () => {
    expect(toPlainText("snake_case and 5*3*2")).toBe("snake_case and 5*3*2");
  });
});

describe("splitting a long answer", () => {
  const para = (n: number, len = 300) => `${"word ".repeat(len / 5 - 1)}end${n}.`;

  it("keeps a short answer in one message", () => {
    expect(splitMessages("Yes. Go early.", 900, 2000)).toEqual(["Yes. Go early."]);
  });

  it("groups whole paragraphs up to the preferred size and never past the limit", () => {
    const text = [1, 2, 3, 4, 5, 6].map((n) => para(n)).join("\n\n");
    const parts = splitMessages(text, 700, 1000);
    expect(parts.length).toBe(3);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(1000);
    expect(parts.join("\n\n")).toBe(text);
  });

  it("keeps a heading with the paragraph after it", () => {
    const text = `${para(1, 600)}\n\nThe call\n\n${para(2, 200)}`;
    const parts = splitMessages(text, 650, 2000);
    expect(parts[1].startsWith("The call\n\n")).toBe(true);
  });

  it("breaks an oversized paragraph at sentences, then words", () => {
    const long = Array.from({ length: 30 }, (_, i) => `Sentence ${i} is here.`).join(" ");
    const parts = splitMessages(long, 100, 120);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(120);
    expect(parts.join(" ")).toBe(long);
    const word = "x".repeat(250);
    expect(splitMessages(word, 100, 100)).toEqual(["x".repeat(100), "x".repeat(100), "x".repeat(50)]);
  });
});
