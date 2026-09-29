import { describe, expect, it } from "vitest";
import type { DecisionRow, MemoryRow } from "@/lib/db/types";
import { filterDecisions, filterMemories, matchesQuery } from "@/lib/memory/search";

const mem = (m: Partial<MemoryRow>): MemoryRow => ({
  id: "m",
  project_id: "p1",
  room_id: null,
  type: "material",
  content: "Limewash walls",
  attributed_to: null,
  review_state: "approved",
  source_message_id: null,
  created_at: "",
  ...m,
});

describe("settings search", () => {
  it("matches every word, ignoring case and accents", () => {
    expect(matchesQuery("hotel COSTES", "Hôtel Costes lobby")).toBe(true);
    expect(matchesQuery("costes velvet", "Hôtel Costes lobby")).toBe(false);
    expect(matchesQuery("  ", "anything")).toBe(true);
  });

  it("filters memories by text, state, type and project (including household-wide)", () => {
    const memories = [
      mem({ id: "a", content: "Amar loves green velvet", type: "amar_preference", project_id: null, attributed_to: "Amar" }),
      mem({ id: "b", content: "Oak floors", review_state: "proposed" }),
      mem({ id: "c", content: "Velvet sofa rejected", type: "rejected_idea", project_id: "p2", review_state: "dismissed" }),
    ];
    const base = { query: "", state: "all" as const, type: "", project: "" };
    expect(filterMemories(memories, { ...base, query: "velvet" }).map((m) => m.id)).toEqual(["a", "c"]);
    expect(filterMemories(memories, { ...base, query: "amar" }).map((m) => m.id)).toEqual(["a"]);
    expect(filterMemories(memories, { ...base, state: "proposed" }).map((m) => m.id)).toEqual(["b"]);
    expect(filterMemories(memories, { ...base, project: "household" }).map((m) => m.id)).toEqual(["a"]);
    expect(filterMemories(memories, { ...base, type: "rejected_idea" }).map((m) => m.id)).toEqual(["c"]);
  });

  it("filters decisions and never shows dismissed ones", () => {
    const d = (x: Partial<DecisionRow>): DecisionRow => ({
      id: "d",
      project_id: "p1",
      room_id: null,
      title: "Walnut table",
      detail: null,
      status: "approved",
      review_state: "approved",
      source_message_id: null,
      created_at: "",
      ...x,
    });
    const decisions = [d({ id: "1" }), d({ id: "2", status: "keep_looking", review_state: "proposed" }), d({ id: "3", review_state: "dismissed" })];
    const base = { query: "walnut", status: "", project: "", includeProposed: true };
    expect(filterDecisions(decisions, base).map((x) => x.id)).toEqual(["1", "2"]);
    expect(filterDecisions(decisions, { ...base, includeProposed: false }).map((x) => x.id)).toEqual(["1"]);
    expect(filterDecisions(decisions, { ...base, status: "keep_looking" }).map((x) => x.id)).toEqual(["2"]);
  });
});
