// Lazy, shared catalog read pool. Importing routes never requires credentials.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { resolveDatabaseUrl } from "../db/database-url";
import * as schema from "../db/schema";
import type { CatalogDb } from "./store";

const globalForCatalog = globalThis as unknown as { catalogDb?: CatalogDb };

export function getCatalogDb(): CatalogDb {
  return (globalForCatalog.catalogDb ??= drizzle(
    postgres(resolveDatabaseUrl(), {
      max: 3,
      connect_timeout: 5,
      onnotice: () => {},
    }),
    { schema },
  ));
}
