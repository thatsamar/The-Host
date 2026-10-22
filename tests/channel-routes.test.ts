import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The messaging routes exist in every Cinq deployment, so they must do
// nothing anywhere the channel isn't deliberately enabled.

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/lib/ai", () => ({ getChatProvider: () => ({}) }));

const { POST: webhook } = await import("@/app/api/messages/webhook/route");
const { GET: runDue } = await import("@/app/api/messages/run-due/route");

let logged: string[] = [];
const saved = { ...process.env };
beforeEach(() => {
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" ")));
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

const post = () => webhook(new Request("https://cinq.example/api/messages/webhook", { method: "POST", body: "{}" }));
const cron = (auth?: string) => runDue(new Request("https://cinq.example/api/messages/run-due", { headers: auth ? { authorization: auth } : {} }));

describe("messaging routes", () => {
  it("are not found unless MESSAGES_CHANNEL_ENABLED is exactly true", async () => {
    for (const value of [undefined, "", "1", "yes", "TRUE "]) {
      if (value === undefined) delete process.env.MESSAGES_CHANNEL_ENABLED;
      else process.env.MESSAGES_CHANNEL_ENABLED = value;
      expect((await post()).status).toBe(404);
      expect((await cron(`Bearer ${"x".repeat(32)}`)).status).toBe(404);
    }
  });

  it("refuses the retry job without the scheduler's secret", async () => {
    process.env.MESSAGES_CHANNEL_ENABLED = "true";
    process.env.CRON_SECRET = "s".repeat(32);
    expect((await cron()).status).toBe(401);
    expect((await cron("Bearer wrong")).status).toBe(401);
  });

  it("answers 503 when enabled but not configured, naming settings in the log and never their values", async () => {
    process.env.MESSAGES_CHANNEL_ENABLED = "true";
    process.env.MESSAGES_PROVIDER = "blooio";
    process.env.BLOOIO_API_KEY = "bl_live_secret_value";
    process.env.CRON_SECRET = "s".repeat(32);
    expect((await post()).status).toBe(503);
    expect((await cron(`Bearer ${"s".repeat(32)}`)).status).toBe(503);
    const all = logged.join("\n");
    expect(all).toMatch(/BLOOIO_WEBHOOK_SECRET/);
    expect(all).toMatch(/MESSAGES_DATABASE_URL/);
    expect(all).not.toContain("bl_live_secret_value");
  });
});
