import { defineConfig } from "vitest/config";

// Database integration tests: need a reachable pgvector Postgres configured via
// DATABASE_URL or .env.local. Run with `npm run test:db`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.db.test.ts"],
    testTimeout: 120_000,
    fileParallelism: false,
  },
});
