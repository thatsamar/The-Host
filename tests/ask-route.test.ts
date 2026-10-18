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
      expect(provider.requests[0].system[0].body).toMatch(/^IDENTITY\n\nYou are Amar, Cinq’s travel advisor/);
    } finally {
      delete process.env.COMPANION;
    }
  });

  it("answers as Alden on his deployment, with the photos passed through", async () => {
    process.env.COMPANION = "alden";
    try {
      const provider = state.provider as ScriptedProvider;
      const photo = { mediaType: "image/jpeg", data: "d2luZWxpc3Q=" };
      const res = await post({ turns: [{ role: "user", text: "Roast chicken, about $80. Which bottle?", images: [photo, photo] }] });
      expect(res.status).toBe(200);
      await collect(readNdjson(res.body!));
      const request = provider.requests[0];
      expect(request.system[0].body).toMatch(/^You are Alden, Cinq’s advisor on wine, cocktails, and spirits/);
      expect(request.system[1].body).toMatch(/up to five searches per answer/);
      expect(request.webSearch).toBe(true);
      expect(request.messages.at(-1)!.content.filter((p) => p.type === "image")).toHaveLength(2);
    } finally {
      delete process.env.COMPANION;
    }
  });

  it("takes no new questions at Jack's retired address, and says so", async () => {
    process.env.COMPANION = "jack";
    try {
      const provider = state.provider as ScriptedProvider;
      const res = await post({ turns: [{ role: "user", text: "Should I quit?" }] });
      expect(res.status).toBe(410);
      expect(await res.json()).toEqual({ error: "Jack is no longer one of Cinq’s advisors. Visit Cinq to meet the current advisors." });
      expect(provider.requests).toHaveLength(0);
    } finally {
      delete process.env.COMPANION;
    }
  });

  it("is open by default, and asks for sign-in only where it's switched on", async () => {
    state.userId = null;
    expect((await post({ turns: [{ role: "user", text: "Hi" }] })).status).toBe(200);
    process.env.REQUIRE_SIGN_IN = "true";
    try {
      expect((await post({ turns: [{ role: "user", text: "Hi" }] })).status).toBe(401);
    } finally {
      delete process.env.REQUIRE_SIGN_IN;
    }
  });

  it("rejects more than 10 photos, or photos that aren't images", async () => {
    const photo = { mediaType: "image/jpeg", data: "aW1n" };
    expect((await post({ turns: [{ role: "user", text: "", images: Array(11).fill(photo) }] })).status).toBe(400);
    expect((await post({ turns: [{ role: "user", text: "", images: [{ mediaType: "text/html", data: "aW1n" }] }] })).status).toBe(400);
    expect((await post({ turns: [{ role: "user", text: "", images: Array(10).fill(photo) }] })).status).toBe(200);
  });
});
