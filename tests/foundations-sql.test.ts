import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFoundationsView } from "@/lib/ops/foundations";

// The foundations tables are locked to the server (scripts/check-migrations.sh
// also proves it against a real Postgres: the public roles read nothing and
// write nothing, versions can't be changed, configuration changes are kept).
const migration = readFileSync("supabase/migrations/20261127000001_advisor_foundations.sql", "utf8");
const TABLES = ["advisor_layers", "advisor_active", "advisor_active_history", "advisor_events"];

describe("the foundations migration", () => {
  it("turns on row level security for every table, with no policies and no grants to the public roles", () => {
    for (const t of TABLES) expect(migration).toContain(`alter table public.${t} enable row level security`);
    expect(migration).not.toMatch(/create policy/i);
    expect(migration).toMatch(/revoke all on table public\.advisor_layers, public\.advisor_active, public\.advisor_active_history, public\.advisor_events from anon, authenticated/);
    expect(migration).not.toMatch(/\bgrant\b/i);
  });

  it("stores only ciphertext, keeps every version, and records every configuration change", () => {
    expect(migration).toMatch(/ciphertext text not null/);
    expect(migration).not.toMatch(/\b(plaintext|body|content) text\b/);
    expect(migration).toContain("advisor_layers versions are immutable");
    expect(migration).toContain("create trigger advisor_active_record");
  });

  it("can be run again, and has an undo file", () => {
    expect(migration).not.toMatch(/create table (?!if not exists)/i);
    expect(existsSync("supabase/rollback/20261127000001_advisor_foundations.down.sql")).toBe(true);
  });
});

describe("the /ops view", () => {
  it("shows architectures, versions and counts, and tells answer time and cost apart by architecture", () => {
    const now = new Date("2026-11-27T12:00:00Z");
    const view = buildFoundationsView({
      now,
      active: [{ advisor_id: "tony", architecture: "c2", identity_version: 1, foundation_version: 2, layer2_version: null, updated_by: "owner", updated_at: "2026-11-27T09:00:00Z", last_loaded_at: "2026-11-27T11:55:00Z" }],
      events: [
        { advisor_id: "tony", at: "2026-11-27T11:00:00Z", kind: "fallback", reason: "store_unavailable" },
        { advisor_id: "tony", at: "2026-11-25T11:00:00Z", kind: "fallback", reason: "old" },
        { advisor_id: "tony", at: "2026-11-27T11:30:00Z", kind: "leak_guard", reason: "text" },
      ],
      requests: [
        { model_calls: [{ purpose: "answer", ms: 4000, architecture: "c2" }] },
        { model_calls: [{ purpose: "answer", ms: 6000 }, { purpose: "condense", ms: 500 }] },
      ] as never,
    });
    expect(view.available).toBe(true);
    expect(view.advisors[0]).toMatchObject({ architecture: "c2", versions: "identity v1, foundation v2, layer 2 off", fallbacks24h: 1, leakGuard24h: 1, reasons: { store_unavailable: 1 } });
    expect(view.costs).toEqual(expect.arrayContaining([expect.objectContaining({ architecture: "c2", answers: 1, medianMs: 4000 }), expect.objectContaining({ architecture: "legacy", answers: 1, medianMs: 6000 })]));
    expect(buildFoundationsView({ now, active: null, events: null, requests: [] }).available).toBe(false);
  });
});
