import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeBackground, MemoryRepo, ScriptedProvider, replyWith } from "./helpers/fakes";

// Everything the route touches outside itself is mocked: Supabase, the model
// providers, env, and Next's `after`.
const state = vi.hoisted(() => ({
  userId: "user-1" as string | null,
  repo: null as unknown as MemoryRepo,
  provider: null as unknown as ScriptedProvider,
  background: null as unknown as FakeBackground,
  afterCallbacks: [] as (() => Promise<void>)[],
  loadedImages: [] as string[],
}));

vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => state.afterCallbacks.push(fn) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { title: "T" } }) }) }) }),
  }),
  getUserId: async () => state.userId,
}));
vi.mock("@/lib/ai", () => ({
  getChatProvider: () => state.provider,
  getBackgroundModel: () => state.background,
  getEmbeddingProvider: () => {
    throw new Error("Embeddings aren't configured");
  },
}));
vi.mock("@/lib/db/supabase-repository", () => ({
  SupabaseChatRepository: class {
    constructor() {
      return state.repo;
    }
  },
}));
vi.mock("@/lib/env", () => ({
  serverEnv: () => ({ RETRIEVAL_TOP_K: 8, RETRIEVAL_MIN_SIMILARITY: 0.25, RETRIEVAL_MAX_IMAGES: 3 }),
}));
vi.mock("@/lib/library/server", () => ({
  loadModelImage: async (_s: unknown, path: string) => {
    state.loadedImages.push(path);
    return { mediaType: "image/jpeg", data: "b64" };
  },
  retrievalProjectIds: async (_s: unknown, id: string) => [id],
  hasIndexedChunks: async () => false,
  supabaseRetrievalStore: () => ({}),
  supabaseChatPhotoStore: () => ({}),
}));

const { POST } = await import("@/app/api/chat/route");

function request(body: unknown) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function events(res: Response) {
  const text = await res.text();
  return text
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

let projectId: string;

beforeEach(() => {
  state.userId = "user-1";
  state.repo = new MemoryRepo();
  projectId = state.repo.addProject({ name: "Marfa House", is_default: false }).id;
  state.provider = new ScriptedProvider(replyWith("THE CALL — Subtract first."));
  state.background = new FakeBackground("Marfa Living Room");
  state.afterCallbacks = [];
  state.loadedImages = [];
});

describe("POST /api/chat", () => {
  it("rejects requests without a session", async () => {
    state.userId = null;
    const res = await POST(request({ projectId, speaker: "Amar", text: "Hi" }));
    expect(res.status).toBe(401);
  });

  it("rejects malformed bodies and unknown speakers", async () => {
    expect((await POST(request("not json"))).status).toBe(400);
    expect((await POST(request({ projectId: "nope", speaker: "Amar", text: "Hi" }))).status).toBe(400);
    const res = await POST(request({ projectId, speaker: "Gio", text: "Hi" }));
    expect(res.status).toBe(400);
  });

  it("rejects photo paths outside the user's chat folder", async () => {
    for (const storagePath of ["user-2/chat/x.jpg", "user-1/files/x.jpg", "user-1/chat/../../user-2/chat/x.jpg"]) {
      const res = await POST(request({ projectId, speaker: "Amar", text: "Look", attachments: [{ storagePath, mimeType: "image/jpeg" }] }));
      expect(res.status).toBe(400);
    }
    expect(state.repo.messages).toHaveLength(0);
  });

  it("returns 400 for a chat or room that doesn't exist", async () => {
    const res = await POST(request({ projectId, chatId: "00000000-0000-4000-8000-000000000999", speaker: "Amar", text: "Hi" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Chat not found" });
  });

  it("streams newline-delimited events and saves both messages with their speakers", async () => {
    const res = await POST(request({ projectId, speaker: "Courtney", text: "What is the highest-leverage move in this room?", mode: "analyze_photo", attachments: [{ storagePath: "user-1/chat/a.jpg", mimeType: "image/jpeg" }] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const evs = await events(res);
    expect(evs[0]).toMatchObject({ type: "meta", projectId, userMessage: { speaker: "Courtney", metadata: { mode: "analyze_photo" } } });
    expect(evs.filter((e) => e.type === "text").map((e) => e.text).join("")).toBe("THE CALL — Subtract first.");
    expect(evs.map((e) => e.type)).toEqual(expect.arrayContaining(["done", "title"]));
    expect(state.repo.messages.map((m) => [m.role, m.speaker])).toEqual([
      ["user", "Courtney"],
      ["assistant", "Gio"],
    ]);
    expect(state.loadedImages).toEqual(["user-1/chat/a.jpg"]);
    // The photo is indexed into the library after the response.
    expect(state.afterCallbacks).toHaveLength(1);
  });

  it("reports model failures inside the stream", async () => {
    state.provider = new ScriptedProvider(() => new Error("Anthropic returned an error (529)."));
    const res = await POST(request({ projectId, speaker: "Both", text: "Hello" }));
    const evs = await events(res);
    expect(evs.at(-1)).toEqual({ type: "error", message: "Anthropic returned an error (529)." });
  });
});
