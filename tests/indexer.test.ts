import { describe, expect, it } from "vitest";
import { embedText, runIndexStep, type IndexerDeps, type LibraryParsers } from "@/lib/library/indexer";
import { serverParsers } from "@/lib/library/parsers";
import { makeDocx, makePdf, makePhoto, makeTextPdf } from "./helpers/fixtures";
import { FakeDescriber, FakeEmbedder, MemoryLibraryStore } from "./helpers/library-fakes";

function deps(store: MemoryLibraryStore, overrides: Partial<IndexerDeps> = {}): IndexerDeps & {
  embedder: FakeEmbedder;
  background: FakeDescriber;
} {
  return {
    store,
    embedder: new FakeEmbedder(),
    background: new FakeDescriber(),
    parsers: serverParsers,
    ...overrides,
  } as IndexerDeps & { embedder: FakeEmbedder; background: FakeDescriber };
}

const BIG_BUDGET = { budgetMs: 120_000 };

describe("text and markdown files", () => {
  it("chunks, embeds and stores text, then marks the file indexed", async () => {
    const store = new MemoryLibraryStore();
    const long = "Terracotta floors hold the cool of the night. ".repeat(200);
    const file = store.addFile({ name: "Notes on Marfa.md", mime_type: "text/markdown", room_id: "room-1" }, Buffer.from(`﻿# Marfa\n\n${long}`));
    const d = deps(store);

    const result = await runIndexStep(d, file.id, BIG_BUDGET);

    expect(result).toMatchObject({ status: "indexed", more: false });
    expect(store.chunks.length).toBeGreaterThan(1);
    for (const c of store.chunks) {
      expect(c).toMatchObject({ source_type: "text", file_id: file.id, project_id: "project-1", room_id: "room-1", page: null });
      expect(c.embedding).toHaveLength(16);
      expect(c.metadata).toMatchObject({ file_name: "Notes on Marfa.md", kind: "markdown" });
    }
    expect(store.chunks[0].content.startsWith("# Marfa")).toBe(true); // BOM stripped
    expect(d.embedder.calls[0].inputType).toBe("document");
    expect(d.embedder.calls[0].texts[0].startsWith("From Notes on Marfa.md.")).toBe(true);
    expect(store.files.get(file.id)).toMatchObject({ status: "indexed", chunk_count: store.chunks.length, lease_until: null });
  });

  it("fails an empty file with a clear message", async () => {
    const store = new MemoryLibraryStore();
    const file = store.addFile({ name: "empty.txt", mime_type: "text/plain" }, Buffer.from("   \n  "));
    const result = await runIndexStep(deps(store), file.id, BIG_BUDGET);
    expect(result).toMatchObject({ status: "failed", error: "No text or images found in this file." });
  });
});

describe("visual indexing", () => {
  it("describes an uploaded image, stores a model-sized copy and links the chunk to it", async () => {
    const store = new MemoryLibraryStore();
    const file = store.addFile({ name: "ett-hem-kitchen.jpg", mime_type: "image/jpeg" }, await makePhoto(3000, 2000));
    const d = deps(store);

    const result = await runIndexStep(d, file.id, BIG_BUDGET);

    expect(result.status).toBe("indexed");
    expect(store.assets).toHaveLength(1);
    const asset = store.assets[0];
    expect(asset).toMatchObject({ source: "upload", file_id: file.id, mime_type: "image/jpeg", width: 1568, unit: 0 });
    expect(asset.description).toContain("warm lounge");
    expect(store.objects.has(`images:${asset.storage_path}`)).toBe(true);
    expect(store.chunks).toHaveLength(1);
    expect(store.chunks[0]).toMatchObject({ source_type: "visual_description", image_asset_id: asset.id });
    expect(d.embedder.calls[0].texts[0].startsWith("Image from ett-hem-kitchen.jpg.")).toBe(true);
  });

  it("indexes PDF text pages as text, image pages as descriptions, skips blanks, and does both for mixed pages", async () => {
    const store = new MemoryLibraryStore();
    const file = store.addFile({ name: "references.pdf", mime_type: "application/pdf" }, await makePdf());
    const d = deps(store);

    const result = await runIndexStep(d, file.id, BIG_BUDGET);

    expect(result.status).toBe("indexed");
    const byPage = (p: number) => store.chunks.filter((c) => c.page === p).map((c) => c.source_type).sort();
    expect(byPage(1)).toEqual(["text"]);
    expect(byPage(2)).toEqual(["visual_description"]);
    expect(byPage(3)).toEqual([]);
    expect(byPage(4)).toEqual(["text", "visual_description"]);
    expect(store.assets.map((a) => [a.page, a.source])).toEqual(
      expect.arrayContaining([
        [2, "pdf_page"],
        [4, "pdf_page"],
      ]),
    );
    expect(store.assets).toHaveLength(2);
    // The caption on the image page is passed to the describer as context.
    const visual = store.chunks.find((c) => c.page === 2)!;
    expect(visual.content).toContain("references.pdf, page 2");
    expect(store.files.get(file.id)).toMatchObject({ page_count: 4, progress: { next_unit: 4, total_units: 4 } });
  }, 60_000);

  it("indexes .docx body text and embedded images", async () => {
    const store = new MemoryLibraryStore();
    const file = store.addFile(
      { name: "brief.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      await makeDocx(),
    );
    const result = await runIndexStep(deps(store), file.id, BIG_BUDGET);
    expect(result.status).toBe("indexed");
    expect(store.chunks.map((c) => c.source_type).sort()).toEqual(["text", "visual_description"]);
    expect(store.assets[0]).toMatchObject({ source: "docx_image", unit: 1 });
  });

  it("records a warning and keeps going when one PDF page can't be described", async () => {
    const store = new MemoryLibraryStore();
    const file = store.addFile({ name: "refs.pdf", mime_type: "application/pdf" }, await makePdf());
    const d = deps(store);
    d.background.failOn.add(1);
    const result = await runIndexStep(d, file.id, BIG_BUDGET);
    expect(result.status).toBe("indexed");
    expect(result.progress.warnings).toHaveLength(1);
    expect(result.progress.warnings![0]).toMatch(/^Page \d: describer unavailable/);
  }, 60_000);

  it("fails an image file whose description fails", async () => {
    const store = new MemoryLibraryStore();
    const file = store.addFile({ name: "a.png", mime_type: "image/png" }, await makePhoto(400, 300));
    const d = deps(store);
    d.background.failOn.add(1);
    const result = await runIndexStep(d, file.id, BIG_BUDGET);
    expect(result).toMatchObject({ status: "failed", error: "describer unavailable" });
    expect(store.files.get(file.id)!.status).toBe("failed");
  });
});

describe("resumable steps", () => {
  it("stops when the budget runs out and resumes where it left off", async () => {
    const store = new MemoryLibraryStore();
    const file = store.addFile({ name: "long.pdf", mime_type: "application/pdf" }, await makeTextPdf(14));
    // A fake clock that jumps 1s per reading, with a 1ms budget: each step
    // gets exactly one batch (6 pages).
    let t = 0;
    const d = deps(store, { now: () => (t += 1000) });

    const first = await runIndexStep(d, file.id, { budgetMs: 1 });
    expect(first).toMatchObject({ status: "processing", more: true, progress: { next_unit: 6, total_units: 14 } });
    const second = await runIndexStep(d, file.id, { budgetMs: 1 });
    expect(second.progress.next_unit).toBe(12);
    const third = await runIndexStep(d, file.id, { budgetMs: 1 });
    expect(third).toMatchObject({ status: "indexed", more: false });

    const pages = store.chunks.map((c) => c.page).sort((a, b) => a! - b!);
    expect(pages).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    expect(store.files.get(file.id)!.attempts).toBe(3);
  }, 60_000);

  it("cleans up partial work from an interrupted step before resuming", async () => {
    const store = new MemoryLibraryStore();
    const file = store.addFile({ name: "notes.txt", mime_type: "text/plain" }, Buffer.from("Walnut and linen. ".repeat(50)));
    // Simulate leftovers from a crashed step at unit 0.
    store.chunks.push({
      id: "stale",
      user_id: "user-1",
      file_id: file.id,
      image_asset_id: null,
      project_id: "project-1",
      room_id: null,
      source_type: "text",
      content: "stale",
      page: null,
      unit: 0,
      chunk_index: 0,
      token_count: 1,
      metadata: {},
      embedding: [],
    });
    await runIndexStep(deps(store), file.id, BIG_BUDGET);
    expect(store.chunks.find((c) => c.id === "stale")).toBeUndefined();
    expect(store.chunks.length).toBe(1);
  });

  it("reports busy when another step holds a live lease", async () => {
    const store = new MemoryLibraryStore();
    const file = store.addFile({ name: "notes.txt", mime_type: "text/plain" }, Buffer.from("hello there, oak"));
    Object.assign(store.files.get(file.id)!, {
      status: "processing",
      lease_until: new Date(Date.now() + 60_000).toISOString(),
    });
    const result = await runIndexStep(deps(store), file.id, BIG_BUDGET);
    expect(result).toMatchObject({ status: "processing", busy: true, more: true });
  });

  it("does nothing for a file that's already indexed", async () => {
    const store = new MemoryLibraryStore();
    const file = store.addFile({ name: "n.txt", mime_type: "text/plain", status: "indexed" }, Buffer.from("x"));
    const result = await runIndexStep(deps(store), file.id, BIG_BUDGET);
    expect(result).toMatchObject({ status: "indexed", more: false });
  });

  it("gives up after too many attempts", async () => {
    const store = new MemoryLibraryStore();
    const file = store.addFile({ name: "n.txt", mime_type: "text/plain", attempts: 30 }, Buffer.from("hello world again"));
    const result = await runIndexStep(deps(store), file.id, BIG_BUDGET);
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/gave up/);
  });

  it("marks the file failed when embedding fails, so it can be retried", async () => {
    const store = new MemoryLibraryStore();
    const file = store.addFile({ name: "n.txt", mime_type: "text/plain" }, Buffer.from("hello world again and again"));
    const embedder = new FakeEmbedder();
    embedder.embed = async () => {
      throw new Error("Voyage AI rejected the API key. Check VOYAGE_API_KEY.");
    };
    const result = await runIndexStep(deps(store, { embedder }), file.id, BIG_BUDGET);
    expect(result).toMatchObject({ status: "failed", error: "Voyage AI rejected the API key. Check VOYAGE_API_KEY." });
  });

  it("rejects unsupported files", async () => {
    const store = new MemoryLibraryStore();
    const file = store.addFile({ name: "sheet.xlsx", mime_type: "application/vnd.ms-excel" }, Buffer.from("x"));
    const parsers: LibraryParsers = { ...serverParsers };
    const result = await runIndexStep(deps(store, { parsers }), file.id, BIG_BUDGET);
    expect(result.error).toMatch(/Unsupported/);
  });
});

describe("embedText", () => {
  it("prefixes chunks with where they came from", () => {
    expect(embedText({ name: "a.pdf" }, { content: "x", page: 3, source_type: "text" })).toBe("From a.pdf, page 3.\n\nx");
    expect(embedText({ name: "b.jpg" }, { content: "y", page: null, source_type: "visual_description" })).toBe(
      "Image from b.jpg.\n\ny",
    );
  });
});
