// Process-wide search service backed by the catalog database. Created lazily
// on first request; reused across requests (and hot reloads in development).
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { resolveDatabaseUrl } from "../../db/database-url";
import * as schema from "../../db/schema";
import { loadQuizSeeds, loadSearchDocuments } from "./repository";
import { createSearchService, type SearchService } from "./service";

const globalForSearch = globalThis as unknown as {
  catalogSearch?: SearchService;
};

export function getSearchService(): SearchService {
  if (!globalForSearch.catalogSearch) {
    const db = drizzle(
      postgres(resolveDatabaseUrl(), { max: 3, onnotice: () => {} }),
      {
        schema,
      },
    );
    globalForSearch.catalogSearch = createSearchService({
      loadDocuments: () => loadSearchDocuments(db),
      loadQuizSeeds: (options) => loadQuizSeeds(db, options),
    });
  }
  return globalForSearch.catalogSearch;
}
