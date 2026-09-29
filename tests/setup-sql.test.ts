import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSetupSql } from "../scripts/build-setup-sql.mjs";

describe("supabase/setup.sql", () => {
  it("matches the migrations (run npm run build:setup-sql after changing them)", () => {
    const root = join(__dirname, "..");
    expect(readFileSync(join(root, "supabase/setup.sql"), "utf8")).toBe(buildSetupSql(root));
  });
});
