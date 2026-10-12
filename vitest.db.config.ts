import path from "node:path";
import { defineConfig } from "vitest/config";

// Database integration tests: require a disposable LOCAL pgvector Postgres
// configured via DATABASE_URL or .env.local. Run with `npm run test:db`.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./src/db/test-database-setup.ts"],
    include: ["src/**/*.db.test.ts"],
    testTimeout: 120_000,
    fileParallelism: false,
  },
});
