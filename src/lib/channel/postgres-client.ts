// The PostgresStore's database connection, over the `postgres` driver. One
// small pool per server instance. Built for a pooled connection string such
// as Supabase's transaction pooler: prepared statements are off because a
// transaction pooler can't keep them between requests.

import postgres from "postgres";
import type { SqlClient, SqlQuery } from "./postgres-store";

export interface PostgresClientOptions {
  /** Connections per server instance. Serverless functions want very few. */
  max?: number;
  /** Seconds before an idle connection closes. */
  idleTimeout?: number;
  /** Seconds to wait for a connection. */
  connectTimeout?: number;
}

const asQuery = (sql: postgres.Sql | postgres.TransactionSql): SqlQuery => ({
  async query<T>(text: string, params: unknown[] = []) {
    const rows = await sql.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
    return { rows: [...rows] as T[] };
  },
});

export function createPostgresClient(url: string, options: PostgresClientOptions = {}): SqlClient & { end(): Promise<void> } {
  const sql = postgres(url, {
    max: options.max ?? 2,
    idle_timeout: options.idleTimeout ?? 20,
    connect_timeout: options.connectTimeout ?? 10,
    prepare: false,
    // Server notices can quote statements; keep them out of the logs.
    onnotice: () => {},
  });
  return {
    ...asQuery(sql),
    transaction: <T>(fn: (tx: SqlQuery) => Promise<T>) => sql.begin((tx) => fn(asQuery(tx))) as Promise<T>,
    end: () => sql.end({ timeout: 5 }),
  };
}
