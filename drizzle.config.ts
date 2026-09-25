import { defineConfig } from "drizzle-kit";
import { resolveDatabaseUrl } from "./src/db/database-url";

const databaseUrl = resolveDatabaseUrl();

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
