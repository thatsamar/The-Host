// Table access for export and import. Runs in the browser with the signed-in
// user's Supabase client, so row-level security applies to every read and
// write, and big exports never pass through a size-limited server function.

import type { SupabaseClient } from "@supabase/supabase-js";

export const PORTABLE_TABLES = [
  "projects",
  "rooms",
  "chats",
  "messages",
  "memories",
  "decisions",
  "products",
  "files",
  "settings",
  "system_prompt_versions",
] as const;
export type PortableTable = (typeof PORTABLE_TABLES)[number];

export type Row = Record<string, unknown>;

export interface DataStore {
  /** Every row of a table visible to this user (paged under the hood). */
  selectAll(table: PortableTable, columns: string): Promise<Row[]>;
  /** Inserts rows in chunks. */
  insert(table: PortableTable, rows: Row[]): Promise<void>;
}

const PAGE = 1000;
const INSERT_CHUNK = 500;

export function supabaseDataStore(client: SupabaseClient): DataStore {
  return {
    async selectAll(table, columns) {
      const out: Row[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await client
          .from(table)
          .select(columns)
          .order(table === "settings" ? "key" : "created_at", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`Reading ${table}: ${error.message}`);
        out.push(...((data ?? []) as unknown as Row[]));
        if (!data || data.length < PAGE) return out;
      }
    },
    async insert(table, rows) {
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        const { error } = await client.from(table).insert(rows.slice(i, i + INSERT_CHUNK));
        if (error) throw new Error(`Saving ${table}: ${error.message}`);
      }
    },
  };
}
