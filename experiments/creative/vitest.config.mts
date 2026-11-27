import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The creative experiment runs only on purpose (README.md), never in `npm test`.
export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
      "server-only": fileURLToPath(new URL("../../tests/stubs/empty.ts", import.meta.url)),
    },
  },
  test: { environment: "node", include: ["experiments/creative/**/*.exp.ts"], testTimeout: 6 * 60 * 60 * 1000, hookTimeout: 60_000 },
});
