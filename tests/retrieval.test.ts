import { describe, expect, it } from "vitest";
import { indexChatPhotos } from "@/lib/library/chat-photos";
import { buildRetrievalQuery, retrieveReferences, type MatchedChunk, type RetrievalStore } from "@/lib/library/retrieval";
import { FakeDescriber, FakeEmbedder } from "./helpers/library-fakes";

function match(overrides: Partial<MatchedChunk>): MatchedChunk {
  return {
    id: "c",
    file_id: "f",
    image_asset_id: null,
    project_id: "p",
    source_type: "text",
    content: "text",
    page: null,
    similarity: 0.5,
    file_name: "file.pdf",
    project_name: "General Design Brain",
    image_storage_path: null,
    ...overrides,
  };
}

function store(matches: MatchedChunk[], failImages = new Set<string>()) {
  const calls: Parameters<RetrievalStore["matchChunks"]>[0][] = [];
  const loaded: string[] = [];
  const s: RetrievalStore = {
    async matchChunks(params) {
      calls.push(params);
      return matches;
    },
    async loadImage(path) {
      if (failImages.has(path)) throw new Error("gone");
      loaded.push(path);
      return { mediaType: "image/jpeg", data: `b64:${path}` };
    },
  };
  return { s, calls, loaded };
}

const options = { topK: 8, minSimilarity: 0.25, maxImages: 2 };

describe("retrieveReferences", () => {
  it("embeds the query as a query and searches the current project plus the General Design Brain", async () => {
    const embedder = new FakeEmbedder();
    const { s, calls } = store([]);
    await retrieveReferences({ embedder, store: s }, "walnut dining table", { projectIds: ["p1", "gdb", "p1"], roomId: "r1" }, options);
    expect(embedder.calls[0]).toMatchObject({ texts: ["walnut dining table"], inputType: "query" });
    expect(calls[0]).toMatchObject({ projectIds: ["p1", "gdb"], count: 8, minSimilarity: 0.25, preferRoomId: "r1" });
  });

  it("maps matches to prompt references with file names, pages and projects", async () => {
    const { s } = store([match({ id: "a", file_name: "Ponti.pdf", page: 12, content: "Lightness.", similarity: 0.71 })]);
    const refs = await retrieveReferences({ embedder: new FakeEmbedder(), store: s }, "chairs by Ponti", { projectIds: ["p"], roomId: null }, options);
    expect(refs).toEqual([
      {
        chunkId: "a",
        fileId: "f",
        similarity: 0.71,
        fileName: "Ponti.pdf",
        content: "Lightness.",
        page: 12,
        sourceType: "text",
        projectName: "General Design Brain",
      },
    ]);
  });

  it("attaches original images for the best visual matches, within the image budget", async () => {
    const { s, loaded } = store(
      [
        match({ id: "1", source_type: "visual_description", image_storage_path: "img/1.jpg" }),
        match({ id: "2", source_type: "text" }),
        match({ id: "3", source_type: "visual_description", image_storage_path: "img/3.jpg" }),
        match({ id: "4", source_type: "visual_description", image_storage_path: "img/4.jpg" }),
      ],
      new Set(["img/3.jpg"]),
    );
    const refs = await retrieveReferences({ embedder: new FakeEmbedder(), store: s }, "lamplit lounge", { projectIds: ["p"], roomId: null }, options);
    expect(refs.map((r) => Boolean(r.image))).toEqual([true, false, false, true]);
    expect(loaded).toEqual(["img/1.jpg", "img/4.jpg"]);
  });

  it("skips the search for trivial queries or a zero budget", async () => {
    const embedder = new FakeEmbedder();
    const { s, calls } = store([match({})]);
    expect(await retrieveReferences({ embedder, store: s }, "ok", { projectIds: ["p"], roomId: null }, options)).toEqual([]);
    expect(await retrieveReferences({ embedder, store: s }, "long enough", { projectIds: ["p"], roomId: null }, { ...options, topK: 0 })).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(embedder.calls).toHaveLength(0);
  });
});

describe("buildRetrievalQuery", () => {
  it("borrows the previous message for short follow-ups only", () => {
    expect(buildRetrievalQuery("What about the other one?", "Compare the Wegner and Juhl lounge chairs")).toBe(
      "Compare the Wegner and Juhl lounge chairs\n\nWhat about the other one?",
    );
    const long = "Find us a vintage lounge chair under $2,000 for the reading corner, ideally in leather or wool.";
    expect(buildRetrievalQuery(long, "earlier")).toBe(long);
    expect(buildRetrievalQuery("Why?", null)).toBe("Why?");
  });
});

describe("indexChatPhotos", () => {
  it("describes, embeds and stores each chat photo, linked to its image asset", async () => {
    const saved: { id: string; description: string }[] = [];
    const chunks: unknown[] = [];
    const result = await indexChatPhotos(
      {
        store: {
          loadImage: async (p) => ({ mediaType: "image/jpeg", data: p }),
          setImageDescription: async (id, description) => {
            saved.push({ id, description });
          },
          insertChunks: async (rows) => {
            chunks.push(...rows);
          },
        },
        background: new FakeDescriber(),
        embedder: new FakeEmbedder(),
      },
      [
        { imageAssetId: "a1", storagePath: "u/chat/1.jpg", userId: "u", projectId: "p", roomId: "r" },
        { imageAssetId: "a2", storagePath: "u/chat/2.jpg", userId: "u", projectId: "p", roomId: "r" },
      ],
      'Photo shared in "Living room lighting"',
    );
    expect(result).toEqual({ indexed: 2, errors: [] });
    expect(saved.map((s) => s.id)).toEqual(["a1", "a2"]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      file_id: null,
      image_asset_id: "a1",
      source_type: "visual_description",
      room_id: "r",
      metadata: { label: 'Photo shared in "Living room lighting"', image_source: "chat" },
    });
  });

  it("reports per-photo errors and still indexes the rest", async () => {
    const describer = new FakeDescriber();
    describer.failOn.add(1);
    const chunks: unknown[] = [];
    const result = await indexChatPhotos(
      {
        store: {
          loadImage: async (p) => ({ mediaType: "image/jpeg", data: p }),
          setImageDescription: async () => {},
          insertChunks: async (rows) => {
            chunks.push(...rows);
          },
        },
        background: describer,
        embedder: new FakeEmbedder(),
      },
      [
        { imageAssetId: "a1", storagePath: "1", userId: "u", projectId: "p", roomId: null },
        { imageAssetId: "a2", storagePath: "2", userId: "u", projectId: "p", roomId: null },
      ],
      "Photo",
    );
    expect(result.indexed).toBe(1);
    expect(result.errors).toEqual(["describer unavailable"]);
  });
});
