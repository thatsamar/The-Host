import { describe, expect, it } from "vitest";
import { APP_JUDGMENT, BLOCK_ORDER, C2_BLOCK_ORDER, CHANNEL_BLOCK, DATE_BLOCK, PHOTO_NOTE_BLOCK, assemblePrompt } from "@/lib/ask/prompt";
import { CORRECTIONS, FOUNDATION_PROTECTION, PHOTO_NOTE, SAFETY, WEB_EXPRESSION } from "@/lib/ask/safeguards";
import { COMPANIONS } from "@/lib/companions";
import { GOLDIE_SAFETY } from "@/lib/companions/goldie";
import { tony } from "@/lib/companions/tony";
import { textChannelNotes } from "@/lib/sms/handoff";
import type { ResolvedArchitecture } from "@/lib/foundations/types";

// Stand-in text only: real foundations never enter the repository.
const c2: ResolvedArchitecture = { kind: "c2", identity: "STAND-IN IDENTITY.", foundation: "STAND-IN FOUNDATION.", versions: { identity: 1, foundation: 1, layer2: null } };
const now = new Date("2026-11-27T18:00:00Z");
const turns = [{ role: "user" as const, text: "Hi" }];
const photo = [{ role: "user" as const, text: "", images: [{ mediaType: "image/jpeg", data: "aW1n" }] }];

describe("the current architecture is unchanged", () => {
  it.each(Object.values(COMPANIONS))("gives $name exactly the same prompt with or without the new options", (companion) => {
    for (const channel of [undefined, textChannelNotes("gio")]) {
      for (const t of [turns, photo]) {
        const before = assemblePrompt({ companion, turns: t, channel, now });
        expect(assemblePrompt({ companion, turns: t, channel, now, architecture: { kind: "legacy" } })).toEqual(before);
        expect(assemblePrompt({ companion, turns: t, channel, now, architecture: { kind: "legacy", fallback: "layer_missing" }, searchLimit: 3 })).toEqual(before);
        expect(before.system.map((b) => b.label).slice(0, 2)).toEqual([...BLOCK_ORDER]);
      }
    }
  });
});

describe("C2", () => {
  it("puts identity, foundation, safeguards, channel notes and search status before the date", () => {
    const req = assemblePrompt({ companion: tony, turns, now, architecture: c2, searchLimit: 8 });
    expect(req.system.map((b) => b.label)).toEqual([...C2_BLOCK_ORDER, DATE_BLOCK]);
    expect(req.system[0].body).toBe("STAND-IN IDENTITY.");
    expect(req.system[1].body).toBe(`STAND-IN FOUNDATION.\n\n${FOUNDATION_PROTECTION}`);
    expect(req.system.at(-1)?.cacheable).toBe(false);
  });

  it("uses neither the companion's own prompt, its capabilities nor the shared standard of judgment", () => {
    const all = assemblePrompt({ companion: tony, turns, now, architecture: c2 }).system.map((b) => b.body).join("\n");
    expect(all).not.toContain(tony.systemPrompt.slice(0, 80));
    expect(all).not.toContain(APP_JUDGMENT.slice(0, 80));
    expect(all).not.toContain(tony.capabilities(true)[0]);
  });

  it("carries the owner's three corrections and the protection line, in their words", () => {
    const all = assemblePrompt({ companion: tony, turns, now, architecture: c2 }).system.map((b) => b.body).join("\n");
    for (const line of [CORRECTIONS.talk, CORRECTIONS.research, CORRECTIONS.photo, FOUNDATION_PROTECTION, SAFETY]) expect(all).toContain(line);
  });

  it("on the website, adds the prose preference and the conversation line", () => {
    const notes = assemblePrompt({ companion: tony, turns, now, architecture: c2 }).system.find((b) => b.label === CHANNEL_BLOCK)!;
    expect(notes.body).toBe(`${WEB_EXPRESSION}\n${CORRECTIONS.talk}`);
  });

  it("by text, keeps every text-channel note and adds the conversation line", () => {
    const channel = textChannelNotes("tony", undefined, ["gio"], 450);
    const notes = assemblePrompt({ companion: tony, turns, now, channel, architecture: c2 }).system.find((b) => b.label === CHANNEL_BLOCK)!;
    expect(notes.body).toBe(`${channel.body}\n${CORRECTIONS.talk}`);
    expect(notes.title).toBe(channel.title);
  });

  it("states the search status from the system's settings", () => {
    const status = (limit: number | undefined, webSearch = true) =>
      assemblePrompt({ companion: tony, turns, now, architecture: c2, searchLimit: limit, webSearch }).system.find((b) => b.label === "search_status")!.body;
    expect(status(8)).toContain("up to 8 searches");
    expect(status(8)).toContain("search is not broken");
    expect(status(8)).toContain("sources are listed");
    expect(status(undefined)).toContain(`up to ${tony.webSearchMaxUses} searches`);
    expect(status(0)).toContain("isn't available");
    expect(status(8, false)).toContain("isn't available");
  });

  it("keeps an advisor's own safety boundary (Goldie's) in place of the shared one", () => {
    const all = assemblePrompt({ companion: COMPANIONS.goldie, turns, now, architecture: c2 }).system.map((b) => b.body).join("\n");
    expect(all).toContain(GOLDIE_SAFETY);
    expect(all).not.toContain(SAFETY);
  });
});

describe("the photo note", () => {
  it("is added only when switched on and the latest message has photos", () => {
    const labels = (o: Parameters<typeof assemblePrompt>[0]) => assemblePrompt(o).system.map((b) => b.label);
    expect(labels({ companion: tony, turns: photo, now })).not.toContain(PHOTO_NOTE_BLOCK);
    expect(labels({ companion: tony, turns, now, photoNote: true })).not.toContain(PHOTO_NOTE_BLOCK);
    for (const architecture of [undefined, c2]) {
      const req = assemblePrompt({ companion: tony, turns: photo, now, photoNote: true, architecture });
      const at = req.system.findIndex((b) => b.label === PHOTO_NOTE_BLOCK);
      expect(req.system[at].body).toBe(PHOTO_NOTE);
      expect(req.system[at + 1].label).toBe(DATE_BLOCK);
    }
  });
});
