import { expect, it } from "vitest";
import { COMPANIONS } from "@/lib/companions";
import { CONFIGS, FORCED_BRIEFS, FORCED_PHOTOS, FORCED_SHARED } from "./configs";
import type { AdvisorId } from "./cases";

const ids: AdvisorId[] = ["tony", "martini", "gio", "alden", "goldie"];
const text = (cfg: string, id: AdvisorId) => CONFIGS.find((c) => c.id === cfg)!.system(id, new Date()).map((b) => b.body).join("\n");
it("every forced-behaviour swap lands somewhere, and nothing old survives", () => {
  for (const [cfg, swaps, base] of [["WF", FORCED_SHARED.filter((s) => !s[0].includes("clear call") && !s[0].includes("bullet lists")), "W"], ["AC", FORCED_SHARED, "A"], ["WFB", FORCED_BRIEFS, "W"], ["ACB", FORCED_BRIEFS, "A"]] as const) {
    for (const [from, to] of swaps) {
      const landed = ids.filter((id) => text(base, id).includes(from));
      // A search-only line (Amar's "what you checked") isn't in the controlled, no-search configurations.
      expect(landed.length + ids.filter((id) => text("W", id).includes(from) || text("A", id).includes(from)).length, `${cfg}: ${from.slice(0, 40)}`).toBeGreaterThan(0);
      for (const id of landed) {
        expect(text(cfg, id).includes(to), `${cfg} ${id}: ${to.slice(0, 40)}`).toBe(true);
      }
    }
  }
  for (const [from] of FORCED_PHOTOS) expect(ids.some((id) => COMPANIONS[id].photosOnly(1).includes(from))).toBe(true);
  for (const id of ids) {
    const wf = CONFIGS.find((c) => c.id === "WF")!;
    for (const [from] of FORCED_PHOTOS) expect(wf.photosOnly!(id)!(1).includes(from)).toBe(false);
  }
});
