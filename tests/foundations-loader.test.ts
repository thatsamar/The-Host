import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { seal, type SealedLayer } from "@/lib/foundations/crypto";
import { CACHE_TTL_MS, FAILURE_TTL_MS, FoundationLoader } from "@/lib/foundations/loader";
import type { ActiveRow, AdvisorEventKind, FoundationStore } from "@/lib/foundations/store";

// Stand-in text only: real foundations never enter the repository.
const IDENTITY = "STAND-IN IDENTITY for tests.";
const FOUNDATION = "STAND-IN FOUNDATION for tests.";
const LAYER2 = "STAND-IN SECOND LAYER for tests.";
const raw = randomBytes(32);
const key = { id: "k1", key: raw };
const env = (over: Record<string, unknown> = {}) => () =>
  ({ FOUNDATIONS_ENABLED: true, FOUNDATION_KEY: raw.toString("base64"), FOUNDATION_KEY_ID: "k1", FOUNDATION_FALLBACK_MAX_MINUTES: 60, PHOTO_NOTE_ENABLED: false, ...over }) as never;

class FakeStore implements FoundationStore {
  row: ActiveRow | null = { advisor_id: "tony", architecture: "c2", identity_version: 1, foundation_version: 2, layer2_version: null, last_loaded_at: null };
  layers = new Map<string, SealedLayer>();
  calls = 0;
  failNext = 0;
  down = false;
  events: [string, AdvisorEventKind, string | undefined][] = [];
  loaded: Date[] = [];
  constructor() {
    this.put("identity", 1, IDENTITY);
    this.put("foundation", 2, FOUNDATION);
    this.put("foundation_l2", 1, LAYER2);
  }
  put(layer: string, version: number, text: string) {
    this.layers.set(`${layer}|${version}`, seal(text, key, { advisorId: "tony", layer, version }));
  }
  async active() {
    this.calls++;
    if (this.down) throw new Error("down");
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("blip");
    }
    return this.row;
  }
  async layer(_a: string, layer: string, version: number) {
    if (this.down) throw new Error("down");
    return this.layers.get(`${layer}|${version}`) ?? null;
  }
  async markLoaded(_a: string, at: Date) {
    this.loaded.push(at);
  }
  async event(advisorId: string, kind: AdvisorEventKind, reason?: string) {
    this.events.push([advisorId, kind, reason]);
  }
}

function setup(over: Record<string, unknown> = {}) {
  const store = new FakeStore();
  const logs: [string, Record<string, unknown>][] = [];
  let t = Date.parse("2026-11-27T12:00:00Z");
  const loader = new FoundationLoader({ store: () => store, env: env(over), now: () => t, log: (m, d) => logs.push([m, d]) });
  return { store, logs, loader, advance: (ms: number) => (t += ms) };
}

describe("the foundation loader", () => {
  it("reads nothing while foundations are off", async () => {
    const { store, loader } = setup({ FOUNDATIONS_ENABLED: false });
    expect(loader.quick()).toEqual({ kind: "legacy", loadMs: 0 });
    expect(await loader.resolve("tony")).toMatchObject({ kind: "legacy" });
    expect(store.calls).toBe(0);
  });

  it("loads C2, caches it for five minutes, then refreshes", async () => {
    const { store, loader, advance } = setup();
    expect(loader.quick()).toBeNull();
    expect(await loader.resolve("tony")).toMatchObject({ kind: "c2", identity: IDENTITY, foundation: FOUNDATION, versions: { identity: 1, foundation: 2, layer2: null } });
    expect(store.loaded).toHaveLength(1);
    await loader.resolve("tony");
    expect(store.calls).toBe(1);
    advance(CACHE_TTL_MS + 1);
    await loader.resolve("tony");
    expect(store.calls).toBe(2);
  });

  it("appends the second layer only when it is active", async () => {
    const { store, loader } = setup();
    store.row!.layer2_version = 1;
    const r = await loader.resolve("tony");
    expect(r.kind === "c2" && r.foundation).toBe(`${FOUNDATION}\n\n${LAYER2}`);
  });

  it("stays on the current architecture for an advisor configured so", async () => {
    const { store, loader, logs } = setup();
    store.row!.architecture = "legacy";
    expect(await loader.resolve("tony")).toMatchObject({ kind: "legacy" });
    expect(logs).toEqual([]);
  });

  it("retries a failed load once", async () => {
    const { store, loader } = setup();
    store.failNext = 1;
    expect(await loader.resolve("tony")).toMatchObject({ kind: "c2" });
    expect(store.calls).toBe(2);
  });

  it("keeps the last copy it loaded when a refresh fails", async () => {
    const { store, loader, advance, logs } = setup();
    await loader.resolve("tony");
    store.down = true;
    advance(CACHE_TTL_MS + 1);
    expect(await loader.resolve("tony")).toMatchObject({ kind: "c2", foundation: FOUNDATION });
    expect(logs.map(([, d]) => d.code)).toEqual(["FOUNDATION_LAST_KNOWN_GOOD"]);
  });

  it("falls back to the current architecture, logs and counts every fallback, and never logs text", async () => {
    const { store, loader, logs, advance } = setup();
    store.layers.delete("foundation|2");
    expect(await loader.resolve("tony")).toMatchObject({ kind: "legacy", fallback: "layer_missing" });
    advance(1_000);
    expect(await loader.resolve("tony")).toMatchObject({ kind: "legacy", fallback: "layer_missing" });
    expect(logs.map(([, d]) => d.code)).toEqual(["FOUNDATION_FALLBACK", "FOUNDATION_FALLBACK"]);
    expect(store.events.map(([, k, r]) => `${k}:${r}`)).toEqual(["fallback:layer_missing", "fallback:layer_missing"]);
    const everything = JSON.stringify(logs);
    for (const text of [IDENTITY, FOUNDATION, "STAND-IN"]) expect(everything).not.toContain(text);
  });

  it("names a tampered or unreadable foundation as such", async () => {
    const { store, loader } = setup();
    const good = store.layers.get("foundation|2")!;
    store.layers.set("foundation|2", { ...good, sha256: "0".repeat(64) });
    expect(await loader.resolve("tony")).toMatchObject({ kind: "legacy", fallback: "checksum_mismatch" });
    const other = setup({ FOUNDATION_KEY: randomBytes(32).toString("base64") });
    expect(await other.loader.resolve("tony")).toMatchObject({ kind: "legacy", fallback: "decrypt_failed" });
  });

  it("treats the advisor as unavailable once the fallback has lasted past the threshold", async () => {
    const { store, loader, advance } = setup({ FOUNDATION_FALLBACK_MAX_MINUTES: 60 });
    store.layers.delete("identity|1");
    expect(await loader.resolve("tony")).toMatchObject({ kind: "legacy" });
    advance(59 * 60_000);
    expect(await loader.resolve("tony")).toMatchObject({ kind: "legacy" });
    advance(2 * 60_000 + FAILURE_TTL_MS);
    expect(await loader.resolve("tony")).toMatchObject({ kind: "unavailable", fallback: "layer_missing" });
    expect(store.events.at(-1)?.[1]).toBe("unavailable");
    // Back as soon as it loads again.
    store.put("identity", 1, IDENTITY);
    advance(FAILURE_TTL_MS + 1);
    expect(await loader.resolve("tony")).toMatchObject({ kind: "c2" });
  });

  it("counts the threshold from when C2 last loaded anywhere, not just on this server", async () => {
    const { store, loader } = setup();
    store.row!.last_loaded_at = "2026-11-27T10:00:00Z"; // two hours ago
    store.layers.delete("identity|1");
    expect(await loader.resolve("tony")).toMatchObject({ kind: "unavailable" });
  });
});

describe("staged rollout", () => {
  it("gives C2 rolled out to the owner only to the owner; everyone else gets the current architecture, uncounted", async () => {
    const { store, loader, logs } = setup();
    store.row!.audience = "owner";
    expect(await loader.resolve("tony")).toEqual({ kind: "legacy", loadMs: expect.any(Number) });
    expect(await loader.resolve("tony", { owner: true })).toMatchObject({ kind: "c2", identity: IDENTITY });
    expect(store.events).toEqual([]);
    expect(logs.filter(([m]) => m === "Foundation fallback")).toEqual([]);
    // For everyone, the owner included.
    store.row!.audience = "everyone";
    loader.invalidate("tony");
    expect(await loader.resolve("tony")).toMatchObject({ kind: "c2" });
  });

  it("never falls back a non-owner to old C2 material, or counts them unavailable, while C2 is the owner's only", async () => {
    const { store, loader, advance } = setup();
    store.row!.audience = "owner";
    await loader.resolve("tony", { owner: true });
    store.down = true;
    advance(CACHE_TTL_MS + 1);
    expect(await loader.resolve("tony")).toEqual({ kind: "legacy", loadMs: expect.any(Number) });
    expect(store.events).toEqual([]);
    advance(3 * 60 * 60_000);
    expect((await loader.resolve("tony")).kind).toBe("legacy");
  });

  it("reads the configuration fresh for the owner, so a change shows at once, and keeps decrypted versions", async () => {
    const { store, loader } = setup();
    await loader.resolve("tony");
    store.row = { ...store.row!, architecture: "legacy", identity_version: null, foundation_version: null };
    // Everyone else: the cached configuration until it expires (or is invalidated on this instance).
    expect((await loader.resolve("tony")).kind).toBe("c2");
    expect((await loader.resolve("tony", { owner: true })).kind).toBe("legacy");
    // The owner's fresh read refreshed this instance for everyone.
    expect((await loader.resolve("tony")).kind).toBe("legacy");
  });

  it("makes the owner's loads fail on purpose during the fallback test, counted, then recovers by itself", async () => {
    const { store, loader, logs, advance } = setup();
    store.row!.fallback_test_until = new Date(Date.parse("2026-11-27T12:10:00Z")).toISOString();
    expect(await loader.resolve("tony", { owner: true })).toMatchObject({ kind: "legacy", fallback: "fallback_test" });
    expect(store.events.at(-1)).toEqual(["tony", "fallback", "fallback_test"]);
    expect(logs.at(-1)).toEqual(["Foundation fallback", expect.objectContaining({ code: "FOUNDATION_FALLBACK", reason: "fallback_test" })]);
    // Nobody else is affected.
    expect((await loader.resolve("tony")).kind).toBe("c2");
    advance(11 * 60_000);
    expect((await loader.resolve("tony", { owner: true })).kind).toBe("c2");
  });
});
