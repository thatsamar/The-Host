import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Runs only on purpose (README.md), never in `npm test`.
export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
      "server-only": fileURLToPath(new URL("../../tests/stubs/empty.ts", import.meta.url)),
    },
  },
  test: { environment: "node", include: ["experiments/goldie-safety/**/*.exp.ts"], testTimeout: 60 * 60 * 1000 },
});
