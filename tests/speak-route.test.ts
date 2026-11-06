import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANIONS } from "@/lib/companions";

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}), getUserId: async () => "u1" }));

let upstream: { url: string; init: RequestInit }[];
let reply: () => Response;

beforeEach(() => {
  vi.resetModules();
  upstream = [];
  reply = () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      upstream.push({ url, init });
      return reply();
    }),
  );
  vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
  vi.stubEnv("COMPANION", "tony");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function post(body: unknown, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) {
  const { POST } = await import("@/app/api/speak/route");
  return POST(
    new Request("https://tony.example/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/speak", () => {
  it("reads the piece in this advisor's natural voice and streams the MP3 back", async () => {
    const res = await post({ text: "Stay in Roma Norte.", previous: "The call.", next: "Book early." });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    expect(upstream).toHaveLength(1);
    const { url, init } = upstream[0];
    expect(url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${COMPANIONS.tony.voice.natural.voiceId}/stream?output_format=mp3_44100_128`);
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("test-key");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      text: "Stay in Roma Norte.",
      model_id: "eleven_multilingual_v2",
      previous_text: "The call.",
      next_text: "Book early.",
      voice_settings: { stability: COMPANIONS.tony.voice.natural.stability, speed: COMPANIONS.tony.voice.rate },
    });
  });

  it("gives every active advisor a different natural voice", () => {
    const ids = ["tony", "martini", "gio", "alden", "goldie"].map((id) => COMPANIONS[id as "gio"].voice.natural.voiceId);
    expect(new Set(ids).size).toBe(5);
  });

  it("uses ELEVENLABS_MODEL when set", async () => {
    vi.stubEnv("ELEVENLABS_MODEL", "eleven_v4");
    await post({ text: "Hello." });
    expect(JSON.parse(upstream[0].init.body as string).model_id).toBe("eleven_v4");
  });

  it("says plainly when no natural voice is set up, so the page uses the device voice", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const res = await post({ text: "Hello." });
    expect(res.status).toBe(503);
    expect(upstream).toHaveLength(0);
  });

  it("serves only this site's own pages, and not the hub or a retired advisor", async () => {
    expect((await post({ text: "Hello." }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post({ text: "Hello." }, { origin: "https://elsewhere.example" })).status).toBe(403);
    expect((await post({ text: "Hello." }, { origin: "https://tony.example" })).status).toBe(200);
    vi.stubEnv("COMPANION", "hub");
    expect((await post({ text: "Hello." })).status).toBe(404);
    vi.stubEnv("COMPANION", "jack");
    expect((await post({ text: "Hello." })).status).toBe(410);
  });

  it("refuses empty or oversized pieces", async () => {
    expect((await post({ text: "  " })).status).toBe(400);
    expect((await post({ text: "a".repeat(2_501) })).status).toBe(400);
    expect(upstream).toHaveLength(0);
  });

  it("caps how much one visitor can have read aloud per hour", async () => {
    vi.stubEnv("SPOKEN_CHARS_PER_HOUR", "3000");
    expect((await post({ text: "a".repeat(2_000) })).status).toBe(200);
    const res = await post({ text: "a".repeat(1_500) });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(upstream).toHaveLength(1);
  });

  it("reports a failed voice plainly and logs no words", async () => {
    reply = () => new Response("quota_exceeded: Stay in Roma Norte.", { status: 401 });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ text: "Stay in Roma Norte." });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "The voice isn't available right now." });
    const logged = errors.mock.calls.flat().join(" ");
    expect(logged).toContain('"status":401');
    expect(logged).not.toMatch(/Roma/);
  });
});
