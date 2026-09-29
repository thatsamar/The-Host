// Version history for Gio's system prompt. The live prompt is
// settings.system_prompt; every change also records a version, so any earlier
// prompt can be restored. The first change snapshots the prompt as it was.

export type PromptVersionLabel = "original" | "edited" | "restored" | "reset" | "imported";

export interface PromptVersionRow {
  content: string;
  label: PromptVersionLabel;
  note: string | null;
}

/**
 * Versions to record when the live prompt changes from `live` to `next`.
 * Empty when nothing changed.
 */
export function promptChangePlan(input: {
  live: string;
  next: string;
  hasHistory: boolean;
  label: Exclude<PromptVersionLabel, "original" | "imported">;
  note?: string | null;
}): PromptVersionRow[] {
  if (input.next === input.live) return [];
  const rows: PromptVersionRow[] = [];
  if (!input.hasHistory) rows.push({ content: input.live, label: "original", note: "The prompt before the first change" });
  rows.push({ content: input.next, label: input.label, note: input.note?.trim() || null });
  return rows;
}

/** Line-level summary of what changed, for the history list. */
export function diffSummary(before: string, after: string): { added: number; removed: number } {
  const a = before.split("\n");
  const b = after.split("\n");
  const count = (lines: string[]) => lines.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map<string, number>());
  const ca = count(a);
  const cb = count(b);
  let added = 0;
  let removed = 0;
  for (const [line, n] of cb) added += Math.max(0, n - (ca.get(line) ?? 0));
  for (const [line, n] of ca) removed += Math.max(0, n - (cb.get(line) ?? 0));
  return { added, removed };
}
