// Applies the messaging channel's tables to the database in
// MESSAGES_DATABASE_URL. Run only when launching, against the database chosen
// for it; it is never run automatically. Pass --schedule to also add the
// retention job (needs pg_cron).
//   MESSAGES_DATABASE_URL=... npm run messages:migrate [-- --schedule]

import { readFileSync } from "node:fs";
import { createPostgresClient } from "../src/lib/channel/postgres-client";
import { splitSql } from "../src/lib/channel/postgres-store";

const url = process.env.MESSAGES_DATABASE_URL;
if (!url) {
  console.error("Set MESSAGES_DATABASE_URL to the messaging database's connection string.");
  process.exit(1);
}
const client = createPostgresClient(url, { max: 1 });
const files = ["0001_channel.sql", ...(process.argv.includes("--schedule") ? ["0002_retention_schedule.sql"] : [])];
try {
  for (const file of files) {
    const sql = readFileSync(new URL(`../db/messages/${file}`, import.meta.url), "utf8");
    await client.transaction(async (tx) => {
      for (const statement of splitSql(sql)) await tx.query(statement);
    });
    console.log(`Applied ${file}`);
  }
} finally {
  await client.end();
}
