import { describe, expect, it } from "vitest";
import { renderContextBlock } from "@/lib/ai/render";
import type { ChatContentPart } from "@/lib/ai/types";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/gio/default-system-prompt";
import {
  BLOCK_ORDER,
  assemblePrompt,
  historyToTurns,
  memoriesBlock,
  projectContextBlock,
  referencesBlock,
  type PromptInput,
} from "@/lib/gio/prompt";

function textOf(parts: ChatContentPart[]): string {
  return parts
    .filter((p): p is Extract<ChatContentPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

const base: PromptInput = {
  systemPrompt: "You are Gio.",
  project: { name: "Marfa House", location: "Marfa, Texas", brief: "Adobe walls, big sky.", isDefault: false },
  room: { name: "Living room", notes: "West light, 18x22 ft." },
  otherRooms: ["Living room", "Kitchen", "Terrace"],
  memories: [],
  references: [],
  history: [],
  current: { speaker: "Amar", text: "Should we buy this chair?" },
};

describe("assemblePrompt", () => {
  it("orders the context: system prompt, capabilities, project, memories, references", () => {
    const { system } = assemblePrompt(base);
    expect(system.map((b) => b.label)).toEqual([...BLOCK_ORDER]);
    expect(system[0].body).toBe("You are Gio.");
  });

  it("keeps Gio's system prompt verbatim and marks it cacheable", () => {
    const { system } = assemblePrompt({ ...base, systemPrompt: DEFAULT_SYSTEM_PROMPT });
    expect(system[0].body).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(system[0].cacheable).toBe(true);
    // Per-turn blocks must not be cached, or stale memories would stick.
    expect(system.slice(2).every((b) => !b.cacheable)).toBe(true);
  });

  it("labels every context block with matching open and close tags", () => {
    const { system } = assemblePrompt(base);
    for (const block of system.slice(1)) {
      const rendered = renderContextBlock(block);
      expect(rendered.startsWith(`<${block.label}>\n${block.title}\n`)).toBe(true);
      expect(rendered.endsWith(`</${block.label}>`)).toBe(true);
    }
  });

  it("puts the conversation after the context and ends on the current user turn", () => {
    const { messages } = assemblePrompt({
      ...base,
      history: [
        { role: "user", speaker: "Courtney", content: "We moved the sofa." },
        { role: "assistant", speaker: "Gio", content: "Good. Now the lamp." },
      ],
    });
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(textOf(messages[2].content)).toContain("Should we buy this chair?");
  });

  it("enables web search by default and says so in the capabilities block", () => {
    const request = assemblePrompt(base);
    expect(request.webSearch).toBe(true);
    expect(request.system[1].body).toMatch(/web_search/);
    const off = assemblePrompt({ ...base, webSearch: false });
    expect(off.webSearch).toBe(false);
    expect(off.system[1].body).toMatch(/estimate/);
  });

  it("drops the oldest history beyond the limit", () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      speaker: (i % 2 === 0 ? "Both" : "Gio") as "Both" | "Gio",
      content: `m${i}`,
    }));
    const { messages } = assemblePrompt({ ...base, history, maxHistoryMessages: 4 });
    const all = messages.map((m) => textOf(m.content)).join("\n");
    expect(all).not.toContain("m5");
    expect(all).toContain("m6");
    expect(all).toContain("m9");
    expect(messages[0].role).toBe("user");
  });

  it("folds an unanswered previous user message into the current turn", () => {
    const { messages } = assemblePrompt({
      ...base,
      history: [{ role: "user", speaker: "Courtney", content: "First try" }],
    });
    expect(messages).toHaveLength(1);
    const text = textOf(messages[0].content);
    expect(text).toContain("Speaker: Courtney\n\nFirst try");
    expect(text).toContain("Speaker: Amar\n\nShould we buy this chair?");
  });

  it("attaches current-turn images before the text", () => {
    const { messages } = assemblePrompt({
      ...base,
      current: { speaker: "Both", text: "Analyze this living room photo.", images: [{ mediaType: "image/jpeg", data: "abc" }] },
    });
    const parts = messages[0].content;
    expect(parts[0]).toEqual({ type: "image", mediaType: "image/jpeg", data: "abc" });
    expect(parts[1].type).toBe("text");
  });

  it("includes visual reference images labeled by reference number", () => {
    const { messages } = assemblePrompt({
      ...base,
      references: [
        { fileName: "ponti.pdf", content: "Text", sourceType: "text" },
        {
          fileName: "saint-cecilia.jpg",
          content: "Low lamplit lounge",
          sourceType: "visual_description",
          image: { mediaType: "image/png", data: "xyz" },
        },
      ],
    });
    const parts = messages[0].content;
    expect(parts[0]).toEqual({ type: "text", text: "Reference image [2] from saint-cecilia.jpg:" });
    expect(parts[1]).toMatchObject({ type: "image", data: "xyz" });
  });
});

describe("speaker attribution", () => {
  it("labels every user turn with its speaker", () => {
    const turns = historyToTurns([
      { role: "user", speaker: "Amar", content: "I want the green velvet." },
      { role: "assistant", speaker: "Gio", content: "Noted." },
      { role: "user", speaker: "Courtney", content: "I want the linen." },
      { role: "assistant", speaker: "Gio", content: "Let's look." },
      { role: "user", speaker: "Both", content: "Where do we land?" },
    ]);
    expect(textOf(turns[0].content)).toBe("Speaker: Amar\n\nI want the green velvet.");
    expect(textOf(turns[2].content)).toBe("Speaker: Courtney\n\nI want the linen.");
    expect(textOf(turns[4].content)).toBe("Speaker: Both (Courtney and Amar together)\n\nWhere do we land?");
  });

  it("never lets an assistant turn carry a speaker label", () => {
    const turns = historyToTurns([
      { role: "user", speaker: "Amar", content: "Hi" },
      { role: "assistant", speaker: "Gio", content: "Hello." },
    ]);
    expect(textOf(turns[1].content)).toBe("Hello.");
  });

  it("labels the current turn with the toggle's speaker", () => {
    const { messages } = assemblePrompt({ ...base, current: { speaker: "Courtney", text: "Linen." } });
    expect(textOf(messages[messages.length - 1].content)).toBe("Speaker: Courtney\n\nLinen.");
  });
});

describe("historyToTurns", () => {
  it("skips empty assistant turns and merges consecutive same-role turns", () => {
    const turns = historyToTurns([
      { role: "user", speaker: "Amar", content: "One" },
      { role: "assistant", speaker: "Gio", content: "" },
      { role: "user", speaker: "Amar", content: "Two" },
    ]);
    expect(turns).toHaveLength(1);
    expect(textOf(turns[0].content)).toContain("One");
    expect(textOf(turns[0].content)).toContain("Two");
  });

  it("drops leading assistant turns so the conversation opens with the user", () => {
    const turns = historyToTurns([
      { role: "assistant", speaker: "Gio", content: "Imported greeting" },
      { role: "user", speaker: "Both", content: "Hello" },
    ]);
    expect(turns[0].role).toBe("user");
    expect(turns).toHaveLength(1);
  });
});

describe("context blocks", () => {
  it("project context names the project, place, room and other rooms", () => {
    const block = projectContextBlock(base.project, base.room, base.otherRooms);
    expect(block.body).toContain("Project: Marfa House");
    expect(block.body).toContain("Location: Marfa, Texas");
    expect(block.body).toContain("Current room: Living room");
    expect(block.body).toContain("Room notes: West light, 18x22 ft.");
    expect(block.body).toContain("Other rooms in this project: Kitchen, Terrace");
    expect(block.body).toContain("Adobe walls, big sky.");
  });

  it("project context handles no room and no brief", () => {
    const block = projectContextBlock({ name: "General Design Brain", location: null, brief: null, isDefault: true });
    expect(block.body).toContain("household-wide");
    expect(block.body).toContain("none selected");
    expect(block.body).toContain("(No brief written yet.)");
  });

  it("memories are grouped by type with attribution and scope", () => {
    const block = memoriesBlock([
      { type: "amar_preference", content: "Loves green velvet", attributedTo: "Amar", scope: "project" },
      { type: "courtney_preference", content: "Prefers washed linen", attributedTo: "Courtney", scope: "household" },
      { type: "decision", content: "Dining table: walnut", scope: "project", status: "keep_looking" },
    ]);
    expect(block.body).toContain("Amar's preferences:\n- Loves green velvet [from Amar]");
    expect(block.body).toContain("Courtney's preferences:\n- Prefers washed linen [household-wide, from Courtney]");
    expect(block.body).toContain("Decision log:\n- Dining table: walnut [keep looking]");
  });

  it("empty memories and references say so explicitly", () => {
    expect(memoriesBlock([]).body).toBe("No approved memories yet.");
    expect(referencesBlock([]).body).toMatch(/No references/);
  });

  it("references carry file names, pages and source type", () => {
    const block = referencesBlock([
      { fileName: "Ponti.pdf", page: 12, content: "Thin legs, lifted volumes.", sourceType: "text", projectName: "General Design Brain" },
      { fileName: "ett-hem.jpg", content: "Soft daylight on a scrubbed pine table.", sourceType: "visual_description" },
    ]);
    expect(block.body).toContain("[1] file: Ponti.pdf · page 12 · project: General Design Brain · text excerpt");
    expect(block.body).toContain("[2] file: ett-hem.jpg · visual description of an image");
  });
});
