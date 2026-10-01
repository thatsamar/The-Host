import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readNdjson } from "@/lib/ask/ndjson";
import { ScriptedProvider, collect, replyWith } from "./helpers/fakes";

const state = vi.hoisted(() => ({ userId: "u1" as string | null, provider: null as unknown, plain: false }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({}),
  getUserId: async () => state.userId,
}));
vi.mock("@/lib/ai", () => ({
  getChatProvider: (_companion: unknown, options: { plain?: boolean } = {}) => {
    state.plain = Boolean(options.plain);
    return state.provider;
  },
}));
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

  describe("with a companion that has modes and a journal", () => {
    beforeEach(() => {
      process.env.COMPANION = "jack";
    });
    afterEach(() => {
      delete process.env.COMPANION;
    });

    it("adds the picked mode and the kept patterns to the prompt", async () => {
      const provider = state.provider as ScriptedProvider;
      const res = await post({
        turns: [{ role: "user", text: "I hate my job but I'm scared to quit." }],
        mode: "career",
        memory: ["You confuse exhaustion with virtue."],
      });
      await collect(readNdjson(res.body!));
      const labels = provider.requests[0].system.map((b) => b.label);
      expect(labels).toEqual(["system_prompt", "app_capabilities", "mode", "memory"]);
      expect(provider.requests[0].system[2].body).toMatch(/^Career Bloodletting:/);
      expect(state.plain).toBe(false);
    });

    it("ignores an unknown mode, and rejects oversized memory", async () => {
      const provider = state.provider as ScriptedProvider;
      const res = await post({ turns: [{ role: "user", text: "Hi" }], mode: "nonsense" });
      await collect(readNdjson(res.body!));
      expect(provider.requests[0].system.map((b) => b.label)).toEqual(["system_prompt", "app_capabilities"]);
      expect((await post({ turns: [{ role: "user", text: "Hi" }], memory: Array(21).fill("p") })).status).toBe(400);
      expect((await post({ turns: [{ role: "user", text: "Hi" }], memory: ["x".repeat(301)] })).status).toBe(400);
    });

    it("keeps errors plain on the ledge and in careful moments", async () => {
      await collect(readNdjson((await post({ turns: [{ role: "user", text: "Hi" }], mode: "ledge" })).body!));
      expect(state.plain).toBe(true);
      await collect(readNdjson((await post({ turns: [{ role: "user", text: "Hi" }], careful: true })).body!));
      expect(state.plain).toBe(true);
    });
  });
});
