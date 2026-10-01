import { describe, expect, it } from "vitest";
import { isCareful, parseNotes, splitNotes } from "@/lib/ask/notes";

const notes = {
  thing_under_the_thing: "You're not trapped. You're scared of finding out what freedom costs.",
  one_sentence: "Stop negotiating with a life you already know is too small.",
  next_move: "Update the résumé tonight.",
  safety_flag: "none",
  suggested_memory_pattern: null,
  draft_message: null,
};
const answer = `You don't need more clarity. You need more courage.\n\nTonight, update the résumé.\n<notes>\n${JSON.stringify(notes)}\n</notes>`;

describe("splitNotes", () => {
  it("shows the prose and reads the notes", () => {
    const { prose, notes: read } = splitNotes(answer);
    expect(prose).toBe("You don't need more clarity. You need more courage.\n\nTonight, update the résumé.");
    expect(read).toEqual(notes);
  });

  it("hides a notes block, or the start of its tag, while it streams in", () => {
    expect(splitNotes("Tonight.\n<no").prose).toBe("Tonight.");
    expect(splitNotes("Tonight.\n<notes>\n{\"thing_under").prose).toBe("Tonight.");
    expect(splitNotes("Tonight.\n<notes>\n{\"thing_under").notes).toBeNull();
    // A "<" that isn't the tag stays.
    expect(splitNotes("Love is < fear.").prose).toBe("Love is < fear.");
    expect(splitNotes("3 <4").prose).toBe("3 <4");
  });

  it("falls back to plain prose when there are no notes or they're broken", () => {
    expect(splitNotes("Just prose.")).toEqual({ prose: "Just prose.", notes: null });
    expect(splitNotes("Prose.\n<notes>{not json}</notes>")).toEqual({ prose: "Prose.", notes: null });
  });
});

describe("parseNotes", () => {
  it("is lenient: code fences, missing fields, blanks and unknown flags all read sensibly", () => {
    const read = parseNotes('```json\n{"one_sentence": "  Keep it.  ", "next_move": "", "safety_flag": "severe", "draft_message": 4}\n```');
    expect(read).toEqual({
      thing_under_the_thing: null,
      one_sentence: "Keep it.",
      next_move: null,
      safety_flag: "none",
      suggested_memory_pattern: null,
      draft_message: null,
    });
  });
});

describe("isCareful", () => {
  it("is true once any answer flagged medium or high", () => {
    const flagged = (flag: string) => `Prose.\n<notes>{"safety_flag": "${flag}"}</notes>`;
    expect(isCareful([answer, flagged("low")])).toBe(false);
    expect(isCareful([answer, flagged("medium")])).toBe(true);
    expect(isCareful([flagged("high"), "Plain text"])).toBe(true);
  });
});
