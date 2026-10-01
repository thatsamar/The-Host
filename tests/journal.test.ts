import { describe, expect, it } from "vitest";
import {
  editPattern,
  emptyJournal,
  isSaved,
  keepPattern,
  memoryFor,
  parseJournal,
  removeFrom,
  saveDraft,
  saveLine,
  setMemory,
} from "@/lib/journal/store";

describe("journal", () => {
  it("saves lines newest first, once each", () => {
    let j = saveLine(emptyJournal(), "one_sentence", "Stop negotiating.", "hard-truth");
    j = saveLine(j, "one_sentence", " stop negotiating. ");
    j = saveLine(j, "next_move", "Update the résumé tonight.");
    expect(j.matchbook.map((e) => e.content)).toEqual(["Update the résumé tonight.", "Stop negotiating."]);
    expect(j.matchbook[1].mode).toBe("hard-truth");
    expect(isSaved(j, "one_sentence", "Stop negotiating.")).toBe(true);
    expect(isSaved(j, "next_move", "Stop negotiating.")).toBe(false);
    j = removeFrom(j, "matchbook", j.matchbook[0].id);
    expect(j.matchbook).toHaveLength(1);
  });

  it("keeps, edits and forgets patterns, and sends them only while memory is on", () => {
    let j = keepPattern(emptyJournal(), "You confuse exhaustion with virtue.");
    j = keepPattern(j, "you confuse exhaustion with virtue.");
    expect(j.patterns).toHaveLength(1);
    const id = j.patterns[0].id;
    j = editPattern(j, id, "You confuse exhaustion with virtue, and call it loyalty.");
    expect(memoryFor(j)).toEqual(["You confuse exhaustion with virtue, and call it loyalty."]);
    expect(memoryFor(setMemory(j, false))).toEqual([]);
    expect(editPattern(j, id, "   ").patterns).toEqual([]);
  });

  it("saves drafts with what they were for", () => {
    const j = saveDraft(emptyJournal(), { original_context: "Quit my job", draft_content: "I'm resigning.", tone: "Shorter" });
    expect(j.drafts[0]).toMatchObject({ original_context: "Quit my job", draft_content: "I'm resigning.", tone: "Shorter" });
    expect(saveDraft(j, { original_context: "", draft_content: "I'm resigning.", tone: "Original" }).drafts).toHaveLength(1);
  });

  it("reads back what it wrote, and survives junk in storage", () => {
    const j = keepPattern(saveLine(setMemory(emptyJournal(), false), "one_sentence", "Line."), "Pattern.");
    expect(parseJournal(JSON.stringify(j))).toEqual(j);
    expect(parseJournal(null)).toEqual(emptyJournal());
    expect(parseJournal("{oops")).toEqual(emptyJournal());
    expect(parseJournal('{"matchbook": [{"id": 1}, null, {"id": "a", "content": "ok", "type": "one_sentence"}]}').matchbook).toHaveLength(1);
  });
});
