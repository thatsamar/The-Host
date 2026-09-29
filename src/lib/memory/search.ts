import type { DecisionRow, MemoryRow } from "@/lib/db/types";

/** Every word of the query must appear (case- and accent-insensitive). */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = fold(fields.filter(Boolean).join(" "));
  return words.every((w) => haystack.includes(w));
}

export interface MemoryFilter {
  query: string;
  state: "approved" | "proposed" | "dismissed" | "all";
  type: string; // "" for any
  project: string; // "" any, "household", or a project id
}

export function filterMemories(memories: MemoryRow[], f: MemoryFilter): MemoryRow[] {
  return memories.filter(
    (m) =>
      (f.state === "all" || m.review_state === f.state) &&
      (!f.type || m.type === f.type) &&
      (!f.project || (f.project === "household" ? m.project_id === null : m.project_id === f.project)) &&
      matchesQuery(f.query, m.content, m.evidence, m.attributed_to),
  );
}

export interface DecisionFilter {
  query: string;
  status: string; // "" any
  project: string;
  includeProposed: boolean;
}

export function filterDecisions(decisions: DecisionRow[], f: DecisionFilter): DecisionRow[] {
  return decisions.filter(
    (d) =>
      d.review_state !== "dismissed" &&
      (f.includeProposed || d.review_state === "approved") &&
      (!f.status || d.status === f.status) &&
      (!f.project || d.project_id === f.project) &&
      matchesQuery(f.query, d.title, d.detail, d.decided_by),
  );
}
