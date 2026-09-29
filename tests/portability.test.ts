import { describe, expect, it } from "vitest";
import { collectExport, parseBundle, toJson, type ExportBundle } from "@/lib/portability/bundle";
import { importBundle } from "@/lib/portability/import";
import { fromMarkdown, toMarkdown } from "@/lib/portability/markdown";
import { MemoryDataStore } from "./helpers/memory-store";

const GDB = "00000000-0000-4000-8000-0000000000a1";
const MARFA = "00000000-0000-4000-8000-0000000000a2";

function seededStore() {
  return new MemoryDataStore("user-1", {
    projects: [
      { id: GDB, name: "General Design Brain", location: null, brief: "Household thinking.", is_default: true, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" },
      { id: MARFA, name: "Marfa House", location: "Marfa, Texas", brief: "Adobe.\n\nA fenced ~~~~ block inside\n~~~~~\nstill fine\n", is_default: false, created_at: "2026-09-02T00:00:00Z", updated_at: "2026-09-02T00:00:00Z" },
    ],
    rooms: [{ id: "r1", project_id: MARFA, name: "Living room", notes: null, created_at: "2026-09-02T01:00:00Z" }],
    chats: [{ id: "c1", project_id: MARFA, room_id: "r1", title: "Velvet vs linen --> ok", source: "app", external_id: null, created_at: "2026-09-03T00:00:00Z", updated_at: "2026-09-03T00:00:00Z" }],
    messages: [
      { id: "m1", chat_id: "c1", role: "user", speaker: "Amar", content: "I want the green velvet.", attachments: [], metadata: {}, created_at: "2026-09-03T00:00:01Z" },
      { id: "m2", chat_id: "c1", role: "assistant", speaker: "Gio", content: "THE CALL — olive mohair.\n\n| a | b |\n|---|---|\n\n<!-- gio:memories {\"fake\":true} -->", attachments: [], metadata: { model: "x" }, created_at: "2026-09-03T00:00:02Z" },
    ],
    memories: [
      { id: "mem1", project_id: null, room_id: null, type: "amar_preference", content: "Amar loves green velvet.", attributed_to: "Amar", review_state: "approved", source: "extracted", evidence: "I want the green velvet", source_message_id: "m1", created_at: "2026-09-03T00:00:03Z", updated_at: "2026-09-03T00:00:03Z" },
      { id: "mem2", project_id: MARFA, room_id: "r1", type: "dimension", content: "Living room is 18 x 22.", attributed_to: "Both", review_state: "proposed", source: "extracted", evidence: null, source_message_id: null, created_at: "2026-09-03T00:00:04Z", updated_at: "2026-09-03T00:00:04Z" },
    ],
    products: [{ id: "p1", project_id: MARFA, room_id: "r1", name: "Danish lounge chair", designer: null, vendor: null, url: null, dimensions: "28W", material_color: "Teak", provenance: "vintage", price_amount: 1800, price_currency: "USD", price_basis: "sourced", price_source_url: null, placement: null, rationale: null, verdict: "invest", status: "considering", source_message_id: "m2", created_at: "2026-09-03T00:00:05Z", updated_at: "2026-09-03T00:00:05Z" }],
    decisions: [{ id: "d1", project_id: MARFA, room_id: "r1", title: "Sofa fabric", detail: "Olive mohair", status: "keep_looking", review_state: "approved", product_id: "p1", source_message_id: "m2", decided_by: "Both", source: "manual", evidence: null, created_at: "2026-09-03T00:00:06Z", updated_at: "2026-09-03T00:00:06Z" }],
    files: [{ id: "f1", project_id: MARFA, room_id: null, name: "Ponti.pdf", mime_type: "application/pdf", size_bytes: 10, status: "indexed", page_count: 4, chunk_count: 6, created_at: "2026-09-03T00:00:07Z" }],
    settings: [{ key: "system_prompt", value: "You are Gio." }],
    system_prompt_versions: [{ id: "v1", content: "You are Gio, v0.", label: "original", note: null, created_at: "2026-09-01T00:00:00Z" }],
  });
}

async function exported(): Promise<ExportBundle> {
  return collectExport(seededStore(), new Date("2026-10-01T12:00:00Z"));
}

describe("export", () => {
  it("collects every table without user ids, plus the live prompt", async () => {
    const bundle = await exported();
    expect(bundle).toMatchObject({ format: "gio-export", version: 1, exported_at: "2026-10-01T12:00:00.000Z", system_prompt: "You are Gio." });
    expect(bundle.projects).toHaveLength(2);
    expect(bundle.messages).toHaveLength(2);
    expect(bundle.files[0]).toMatchObject({ name: "Ponti.pdf" });
    for (const table of ["projects", "messages", "memories"] as const) {
      for (const row of bundle[table]) expect(row).not.toHaveProperty("user_id");
    }
  });

  it("JSON round-trips through parseBundle", async () => {
    const bundle = await exported();
    expect(parseBundle(JSON.parse(toJson(bundle)))).toEqual(bundle);
  });

  it("Markdown is readable and round-trips exactly, including awkward text", async () => {
    const bundle = await exported();
    const md = toMarkdown(bundle);
    expect(md).toContain("# Gio export");
    expect(md).toContain("## Project: Marfa House");
    expect(md).toContain("- **Amar's preference.** Amar loves green velvet.");
    expect(md).toContain("### Conversation: Velvet vs linen --> ok");
    expect(md).toContain("**Amar** · 2026-09-03 00:00");
    expect(md).toContain("I want the green velvet.");
    expect(md).toContain("Danish lounge chair** · 28W · Teak · vintage · $1,800 (sourced) · invest");
    expect(fromMarkdown(md)).toEqual(bundle);
  });

  it("rejects files that aren't Gio exports", () => {
    expect(() => parseBundle({ hello: "world" })).toThrow(/isn't a Gio export/);
    expect(() => fromMarkdown("# Some notes\n\nNothing here.")).toThrow(/isn't a Gio export/);
    expect(() => parseBundle({ ...JSON.parse(JSON.stringify({ format: "gio-export", version: 99, exported_at: "x", system_prompt: null, projects: [], rooms: [], chats: [], messages: [], memories: [], decisions: [], products: [], files: [], system_prompt_versions: [] })) })).toThrow(/newer version/);
  });
});

describe("import", () => {
  it("imports into a fresh account, merging into its General Design Brain", async () => {
    const bundle = await exported();
    const target = new MemoryDataStore("user-2", {
      projects: [{ id: "new-gdb", name: "General Design Brain", is_default: true, created_at: "2026-10-01T00:00:00Z" }],
      settings: [{ key: "system_prompt", value: "You are Gio (edited here)." }],
    });
    const report = await importBundle(target, bundle, "user-2");

    expect(report.added).toEqual({ projects: 1, rooms: 1, chats: 1, messages: 2, memories: 2, decisions: 1, products: 1, promptVersions: 2 });
    expect(report.filesNotIncluded).toBe(1);
    expect(report.memoryIdsToEmbed).toEqual(["mem1"]);
    expect(target.rows("projects").filter((p) => p.is_default)).toHaveLength(1);
    expect(target.rows("projects").every((p) => p.user_id === "user-2")).toBe(true);
    const decision = target.rows("decisions")[0];
    expect(decision).toMatchObject({ product_id: "p1", source_message_id: "m2", status: "keep_looking" });
    // The exported prompt differs, so it's kept as a restorable version, not applied.
    expect(target.rows("settings")[0].value).toBe("You are Gio (edited here).");
    expect(target.rows("system_prompt_versions").map((v) => v.label)).toEqual(["original", "imported"]);
  });

  it("maps content from the exported default project onto the existing one", async () => {
    const bundle = await exported();
    bundle.memories.push({ ...bundle.memories[1], id: "mem3", project_id: GDB, room_id: null });
    const target = new MemoryDataStore("user-2", { projects: [{ id: "new-gdb", name: "General Design Brain", is_default: true, created_at: "x" }] });
    await importBundle(target, bundle, "user-2");
    expect(target.rows("memories").find((m) => m.id === "mem3")!.project_id).toBe("new-gdb");
  });

  it("importing the same export twice adds nothing the second time", async () => {
    const bundle = await exported();
    const target = new MemoryDataStore("user-2", { projects: [{ id: "g", name: "General Design Brain", is_default: true, created_at: "x" }] });
    await importBundle(target, bundle, "user-2");
    const second = await importBundle(target, bundle, "user-2");
    expect(Object.values(second.added).every((n) => n === 0)).toBe(true);
    expect(second.skipped).toBeGreaterThan(0);
  });

  it("merges rooms by name and drops links to messages that aren't there", async () => {
    const bundle = await exported();
    bundle.messages = [];
    bundle.chats = [];
    const target = new MemoryDataStore("user-2", {
      projects: [
        { id: "g", name: "General Design Brain", is_default: true, created_at: "x" },
        { id: MARFA, name: "Marfa House", is_default: false, created_at: "x" },
      ],
      rooms: [{ id: "existing-room", project_id: MARFA, name: "  LIVING ROOM ", created_at: "x" }],
    });
    const report = await importBundle(target, bundle, "user-2");
    expect(report.added.rooms).toBe(0);
    expect(target.rows("memories").find((m) => m.id === "mem2")!.room_id).toBe("existing-room");
    expect(target.rows("decisions")[0].source_message_id).toBeNull();
    expect(target.rows("memories").find((m) => m.id === "mem1")!.source_message_id).toBeNull();
  });

  it("round-trips export → Markdown → import", async () => {
    const md = toMarkdown(await exported());
    const target = new MemoryDataStore("user-2", { projects: [{ id: "g", name: "General Design Brain", is_default: true, created_at: "x" }] });
    const report = await importBundle(target, fromMarkdown(md), "user-2");
    expect(report.added.messages).toBe(2);
    expect(target.rows("messages").find((m) => m.id === "m2")!.content).toContain('<!-- gio:memories {"fake":true} -->');
  });
});
