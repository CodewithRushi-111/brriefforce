import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // Default to Node; files needing a DOM opt in with `// @vitest-environment jsdom`.
    environment: "node",
    // Loads ANTHROPIC_API_KEY from .env.local for the opt-in live tests (never printed).
    setupFiles: ["./test/loadEnv.ts"],
    // Live web-search tests can take a while.
    testTimeout: 15_000,
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
});
