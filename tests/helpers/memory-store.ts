import type { DataStore, PortableTable, Row } from "@/lib/portability/store";

/** An in-memory stand-in for the Supabase tables, scoped to one user like RLS. */
export class MemoryDataStore implements DataStore {
  tables: Record<string, Row[]> = {};
  constructor(
    readonly userId = "user-1",
    seed: Partial<Record<PortableTable, Row[]>> = {},
  ) {
    for (const [t, rows] of Object.entries(seed)) this.tables[t] = rows.map((r) => ({ user_id: userId, ...r }));
  }
  rows(table: PortableTable): Row[] {
    return (this.tables[table] ??= []);
  }
  async selectAll(table: PortableTable, columns: string) {
    const cols = columns.split(",").map((c) => c.trim());
    return this.rows(table)
      .filter((r) => r.user_id === this.userId)
      .map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, structuredClone(r[c])])));
  }
  async insert(table: PortableTable, rows: Row[]) {
    const existing = this.rows(table);
    for (const r of rows) {
      if (r.user_id !== this.userId) throw new Error(`RLS: ${table} row for another user`);
      if (r.id && existing.some((e) => e.id === r.id)) throw new Error(`duplicate key ${table}.${r.id}`);
      existing.push({ id: r.id ?? `gen-${existing.length + 1}`, ...structuredClone(r) });
    }
  }
}
