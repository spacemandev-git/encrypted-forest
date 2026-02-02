import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/**/*.test.ts",
      "sdk/core/src/**/*.test.ts",
    ],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: "threads",
    maxWorkers: 1,
    maxConcurrency: 1,
  },
});
