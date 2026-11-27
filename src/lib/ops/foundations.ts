import { callCost } from "./rates";
import type { RequestRecord } from "./report";

// The /ops view of each advisor's architecture (docs/foundations.md): which
// architecture and versions it uses, how often it fell back or was
// unavailable, leak-guard hits, and answer time and cost by architecture.
// Labels, version numbers and counts only: never any foundation text.

export interface ActiveConfig {
  advisor_id: string;
  architecture: string;
  identity_version: number | null;
  foundation_version: number | null;
  layer2_version: number | null;
  updated_by: string;
  updated_at: string;
  last_loaded_at: string | null;
}

export interface AdvisorEvent {
  advisor_id: string;
  at: string;
  kind: "fallback" | "unavailable" | "leak_guard";
  reason: string | null;
}

export interface ArchitectureRow {
  advisor: string;
  architecture: string;
  versions: string;
  updated: string;
  lastLoaded: string | null;
  fallbacks24h: number;
  unavailable24h: number;
  leakGuard24h: number;
  reasons: Record<string, number>;
}

export interface ArchitectureCost {
  architecture: string;
  answers: number;
  medianMs: number | null;
  costPerAnswer: number | null;
}

export interface FoundationsView {
  /** False when the tables aren't there yet (the migration hasn't been run on this project). */
  available: boolean;
  advisors: ArchitectureRow[];
  costs: ArchitectureCost[];
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function buildFoundationsView(input: { active: ActiveConfig[] | null; events: AdvisorEvent[] | null; requests: RequestRecord[]; now: Date }): FoundationsView {
  const dayAgo = input.now.getTime() - 24 * 60 * 60 * 1000;
  const recent = (input.events ?? []).filter((e) => Date.parse(e.at) >= dayAgo);
  const advisors = (input.active ?? []).map((a): ArchitectureRow => {
    const mine = recent.filter((e) => e.advisor_id === a.advisor_id);
    const reasons: Record<string, number> = {};
    for (const e of mine) if (e.kind !== "leak_guard" && e.reason) reasons[e.reason] = (reasons[e.reason] ?? 0) + 1;
    return {
      advisor: a.advisor_id,
      architecture: a.architecture,
      versions: a.architecture === "c2" ? `identity v${a.identity_version}, foundation v${a.foundation_version}${a.layer2_version ? `, layer 2 v${a.layer2_version}` : ", layer 2 off"}` : "",
      updated: `${a.updated_at.slice(0, 16).replace("T", " ")} by ${a.updated_by}`,
      lastLoaded: a.last_loaded_at ? a.last_loaded_at.slice(0, 16).replace("T", " ") : null,
      fallbacks24h: mine.filter((e) => e.kind === "fallback").length,
      unavailable24h: mine.filter((e) => e.kind === "unavailable").length,
      leakGuard24h: mine.filter((e) => e.kind === "leak_guard").length,
      reasons,
    };
  });
  // Answer time and cost by architecture, from Cinq by text's records (an answer without a label ran before the label existed: the current architecture).
  const byArch = new Map<string, { ms: number[]; cost: number; priced: number; n: number }>();
  for (const r of input.requests) {
    for (const c of r.model_calls ?? []) {
      if (c.purpose !== "answer" || c.failed) continue;
      const arch = (c as { architecture?: string }).architecture ?? "legacy";
      const slot = byArch.get(arch) ?? { ms: [], cost: 0, priced: 0, n: 0 };
      slot.n++;
      slot.ms.push(c.ms);
      const usd = callCost(c);
      if (usd !== null) {
        slot.cost += usd;
        slot.priced++;
      }
      byArch.set(arch, slot);
    }
  }
  const costs = [...byArch.entries()].map(([architecture, s]) => ({ architecture, answers: s.n, medianMs: median(s.ms), costPerAnswer: s.priced ? s.cost / s.priced : null }));
  return { available: input.active !== null, advisors, costs };
}
