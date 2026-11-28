import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { open, seal, type SealedLayer } from "@/lib/foundations/crypto";
import type { PanelActive, PanelHistory, PanelLayer, PanelStore } from "@/lib/foundations/panel";
import { newSession } from "@/lib/ops/session";

// The /ops foundations panel, end to end through its route, with an in-memory
// store that behaves like the tables (the history trigger included).
// Stand-in text only: real foundations never enter the repository.
const SECRET = "STAND-IN FOUNDATION TEXT: a private principle about lanterns at dusk.";
const raw = randomBytes(32);
const key = { id: "k1", key: raw };

const state = vi.hoisted(() => ({ invalidated: [] as string[] }));
vi.mock("@/lib/foundations/loader", () => ({ foundationLoader: () => ({ invalidate: (id: string) => void state.invalidated.push(id) }) }));

class MemoryStore implements PanelStore {
  rows = new Map<string, PanelActive>();
  stored: (PanelLayer & SealedLayer & { ciphertext: string })[] = [];
  log: PanelHistory[] = [];
  private id = 0;
  async active() {
    return [...this.rows.values()];
  }
  async layers() {
    return this.stored.map((l) => ({
      advisor_id: l.advisor_id, layer: l.layer, version: l.version, status: l.status, key_id: l.key_id, sha256: l.sha256, provenance: l.provenance,
      approved_by: l.approved_by, approved_at: l.approved_at, approval_note: l.approval_note, bytes: Buffer.from(l.ciphertext, "base64").length,
    }));
  }
  async history() {
    return [...this.log].reverse();
  }
  async historyRow(id: number) {
    return this.log.find((h) => h.id === id) ?? null;
  }
  async sealed(advisorId: string, layer: string, version: number) {
    const l = this.stored.find((x) => x.advisor_id === advisorId && x.layer === layer && x.version === version);
    return l ? { ciphertext: l.ciphertext, iv: l.iv, tag: l.tag, key_id: l.key_id, sha256: l.sha256, status: l.status } : null;
  }
  async latestVersion(advisorId: string, layer: string) {
    return Math.max(0, ...this.stored.filter((x) => x.advisor_id === advisorId && x.layer === layer).map((x) => x.version));
  }
  async insertLayer(row: Record<string, unknown>) {
    this.stored.push({ status: "approved", provenance: {}, approval_note: null, ...row } as never);
  }
  async upsertActive(row: Record<string, unknown>) {
    const next = { audience: "everyone", fallback_test_until: null, last_action: null, note: null, last_loaded_at: null, ...this.rows.get(row.advisor_id as string), ...row } as PanelActive;
    this.rows.set(next.advisor_id, next);
    // The history trigger.
    await this.insertHistory({ ...next, action: next.last_action });
  }
  async insertHistory(row: Record<string, unknown>) {
    const { advisor_id, architecture, identity_version, foundation_version, layer2_version, audience, fallback_test_until, action, note, updated_by } = row as unknown as PanelHistory;
    this.log.push({ id: ++this.id, advisor_id, architecture, identity_version, foundation_version, layer2_version, audience: audience ?? null, fallback_test_until: fallback_test_until ?? null, action: action ?? null, note: note ?? null, updated_by, changed_at: new Date().toISOString() });
  }
  /** A version sealed with some other key, as if uploaded elsewhere. */
  foreign(layer: string, version: number) {
    const other = { id: "k1", key: randomBytes(32) };
    this.stored.push({ advisor_id: "tony", layer, version, status: "approved", provenance: {}, approved_by: "owner", approved_at: new Date().toISOString(), approval_note: null, bytes: 0, ...seal("x", other, { advisorId: "tony", layer, version }) } as never);
  }
}

const { panelStore } = await import("@/lib/foundations/panel");
const { GET, POST } = await import("@/app/ops/foundations/route");

let store: MemoryStore;
let logged: string[];
const cookie = () => `cinq_ops=${newSession("right-horse").value}`;
const ORIGIN = "https://cinq.example";

beforeEach(() => {
  store = new MemoryStore();
  panelStore.make = () => store;
  state.invalidated = [];
  logged = [];
  Object.assign(process.env, { OPS_PASSWORD: "right-horse", FOUNDATIONS_ENABLED: "true", FOUNDATION_KEY: raw.toString("base64"), FOUNDATION_KEY_ID: "k1", OWNER_PHONE: "+15125550100" });
  for (const level of ["error", "info", "warn", "log"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" ")));
});
afterEach(() => {
  for (const k of ["OPS_PASSWORD", "FOUNDATIONS_ENABLED", "FOUNDATION_KEY", "FOUNDATION_KEY_ID", "OWNER_PHONE"]) delete process.env[k];
  vi.restoreAllMocks();
});

async function act(fields: Record<string, string | File>, headers: Record<string, string> = { Origin: ORIGIN, Cookie: cookie() }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await POST(new Request(`${ORIGIN}/ops/foundations`, { method: "POST", body: form, headers }));
  return { status: res.status, location: res.headers.get("Location") ?? "" };
}
const page = async () => (await GET(new Request(`${ORIGIN}/ops/foundations`, { headers: { Cookie: cookie() } }))).text();
const upload = (layer: string, text = SECRET) => act({ advisor: "tony", action: "upload", layer, text, provenance: "interview", note: "approved for rehearsal" });

describe("the foundations panel", () => {
  it("needs the /ops sign-in, and every action must come from the page itself", async () => {
    expect((await GET(new Request(`${ORIGIN}/ops/foundations`))).headers.get("Location")).toBe("/ops");
    expect((await act({ advisor: "tony", action: "emergency_legacy" }, { Origin: ORIGIN })).location).toBe("/ops");
    const forged = await act({ advisor: "tony", action: "emergency_legacy" }, { Origin: "https://evil.example", Cookie: cookie() });
    expect(forged.location).toContain("error=bad_origin");
    expect((await act({ advisor: "tony", action: "emergency_legacy" }, { Cookie: cookie() })).location).toContain("error=bad_origin");
    expect(store.rows.size).toBe(0);
    delete process.env.OPS_PASSWORD;
    expect((await GET(new Request(`${ORIGIN}/ops/foundations`))).status).toBe(404);
  });

  it("encrypts an upload on the server and never shows, returns or logs its text", async () => {
    const res = await upload("foundation");
    expect(res.location).toBe("/ops/foundations?done=uploaded#tony");
    const [row] = store.stored;
    expect(row).toMatchObject({ advisor_id: "tony", layer: "foundation", version: 1, approved_by: "owner", approval_note: "approved for rehearsal", provenance: { source: "interview" } });
    expect(row.ciphertext).not.toContain("lantern");
    expect(open(row, [key], { advisorId: "tony", layer: "foundation", version: 1 })).toBe(SECRET);
    const html = await page();
    expect(html).toContain("v1");
    expect(html).toContain(row.sha256.slice(0, 12));
    for (const out of [html, res.location, logged.join("\n")]) {
      expect(out).not.toContain("lantern");
      expect(out).not.toContain(row.ciphertext);
    }
    expect(store.log.at(-1)).toMatchObject({ action: "upload", updated_by: "owner", note: "foundation v1 uploaded: approved for rehearsal" });
  });

  it("takes a .md file too, and numbers versions in turn", async () => {
    await upload("foundation");
    const file = new File([`${SECRET}\nSecond line.`], "amar.md", { type: "text/markdown" });
    expect((await act({ advisor: "tony", action: "upload", layer: "foundation", file })).location).toContain("done=uploaded");
    expect(store.stored.map((s) => s.version)).toEqual([1, 2]);
    expect(open(store.stored[1], [key], { advisorId: "tony", layer: "foundation", version: 2 })).toBe(`${SECRET}\nSecond line.`);
    expect((await act({ advisor: "tony", action: "upload", layer: "foundation", text: "x", file })).location).toContain("error=both");
    expect((await act({ advisor: "tony", action: "upload", layer: "foundation", text: "  " })).location).toContain("error=empty");
  });

  it("activates for the owner only after checking each version opens, then for everyone", async () => {
    await upload("identity");
    await upload("foundation");
    const res = await act({ advisor: "tony", action: "activate", identity: "1", foundation: "1", layer2: "none", audience: "owner", note: "rehearsal" });
    expect(res.location).toContain("done=activated");
    expect(store.rows.get("tony")).toMatchObject({ architecture: "c2", identity_version: 1, foundation_version: 1, layer2_version: null, audience: "owner", updated_by: "owner" });
    expect(state.invalidated).toEqual(["tony"]);
    expect(await page()).toContain("C2 for you only");
    await act({ advisor: "tony", action: "activate", identity: "1", foundation: "1", layer2: "none", audience: "everyone" });
    expect(store.rows.get("tony")?.audience).toBe("everyone");
    expect(store.log.filter((h) => h.action === "activate").map((h) => h.audience)).toEqual(["owner", "everyone"]);
  });

  it("changes nothing when a version doesn't open with this deployment's key", async () => {
    await upload("identity");
    store.foreign("foundation", 1);
    const res = await act({ advisor: "tony", action: "activate", identity: "1", foundation: "1", audience: "owner" });
    expect(res.location).toContain("error=version_unreadable");
    expect(store.rows.size).toBe(0);
    expect(logged.join("\n")).toContain("PANEL_VERSION_UNREADABLE");
  });

  it("rolls back to any earlier configuration in one action, and switches to legacy in an emergency", async () => {
    await upload("identity");
    await upload("foundation");
    await upload("foundation", `${SECRET} v2`);
    await act({ advisor: "tony", action: "activate", identity: "1", foundation: "1", audience: "everyone" });
    const first = store.log.at(-1)!.id;
    await act({ advisor: "tony", action: "activate", identity: "1", foundation: "2", audience: "everyone" });
    expect((await act({ advisor: "tony", action: "rollback", history: String(first) })).location).toContain("done=rolled_back");
    expect(store.rows.get("tony")).toMatchObject({ architecture: "c2", foundation_version: 1, last_action: "rollback" });
    // An upload isn't a configuration to go back to.
    const uploadRow = store.log.find((h) => h.action === "upload")!.id;
    expect((await act({ advisor: "tony", action: "rollback", history: String(uploadRow) })).location).toContain("error=no_such_configuration");
    expect((await act({ advisor: "tony", action: "emergency_legacy" })).location).toContain("done=emergency");
    expect(store.rows.get("tony")).toMatchObject({ architecture: "legacy", identity_version: null, audience: "everyone", last_action: "emergency_legacy", updated_by: "owner" });
    expect(state.invalidated.length).toBe(4);
  });

  it("runs the owner's fallback test, which ends by itself or on request", async () => {
    expect((await act({ advisor: "tony", action: "fallback_test_on" })).location).toContain("error=not_on_c2");
    await upload("identity");
    await upload("foundation");
    await act({ advisor: "tony", action: "activate", identity: "1", foundation: "1", audience: "owner" });
    const began = Date.now();
    expect((await act({ advisor: "tony", action: "fallback_test_on" })).location).toContain("done=test_on");
    const until = Date.parse(store.rows.get("tony")!.fallback_test_until!);
    expect(until - began).toBeGreaterThan(9 * 60_000);
    expect(until - began).toBeLessThanOrEqual(10 * 60_000 + 1000);
    expect(await page()).toContain("End the fallback test");
    await act({ advisor: "tony", action: "fallback_test_off" });
    expect(store.rows.get("tony")).toMatchObject({ fallback_test_until: null, architecture: "c2", audience: "owner" });
    expect(store.log.slice(-2).map((h) => h.action)).toEqual(["fallback_test_on", "fallback_test_off"]);
  });

  it("refuses an unknown advisor", async () => {
    expect((await act({ advisor: "jack", action: "emergency_legacy" })).location).toContain("error=bad_advisor");
  });
});
