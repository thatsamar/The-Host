import { beforeEach, describe, expect, it, vi } from "vitest";
import { readNdjson } from "@/lib/ask/ndjson";
import { ScriptedProvider, collect, replyWith } from "./helpers/fakes";

const state = vi.hoisted(() => ({ userId: "u1" as string | null, provider: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({}),
  getUserId: async () => state.userId,
}));
vi.mock("@/lib/ai", () => ({ getChatProvider: () => state.provider }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({}) }));

const { POST } = await import("@/app/api/ask/route");

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/ask", { method: "POST", body: JSON.stringify(body) }));

describe("POST /api/ask", () => {
  beforeEach(() => {
    state.userId = "u1";
    state.provider = new ScriptedProvider(replyWith("Lower the lamp."));
  });

  it("streams the answer as NDJSON", async () => {
    const res = await post({ turns: [{ role: "user", text: "What's wrong with this lamp?" }] });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/ndjson/);
    const events = await collect(readNdjson<{ type: string; text?: string }>(res.body!));
    expect(events.map((e) => e.text ?? "").join("")).toBe("Lower the lamp.");
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("answers as the deployment's companion", async () => {
    process.env.COMPANION = "tony";
    try {
      const provider = state.provider as ScriptedProvider;
      const res = await post({ turns: [{ role: "user", text: "First night in Mexico City?" }] });
      await collect(readNdjson(res.body!));
      expect(provider.requests[0].system[0].body).toMatch(/^You are Amar Lalvani’s private travel intelligence/);
    } finally {
      delete process.env.COMPANION;
    }
  });

  it("requires sign-in", async () => {
    state.userId = null;
    expect((await post({ turns: [{ role: "user", text: "Hi" }] })).status).toBe(401);
  });

  it("rejects more than 10 photos, or photos that aren't images", async () => {
    const photo = { mediaType: "image/jpeg", data: "aW1n" };
    expect((await post({ turns: [{ role: "user", text: "", images: Array(11).fill(photo) }] })).status).toBe(400);
    expect((await post({ turns: [{ role: "user", text: "", images: [{ mediaType: "text/html", data: "aW1n" }] }] })).status).toBe(400);
    expect((await post({ turns: [{ role: "user", text: "", images: Array(10).fill(photo) }] })).status).toBe(200);
  });
});
