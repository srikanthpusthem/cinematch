// Process-wide search service backed by the catalog database. Created lazily
// on first request; reused across requests (and hot reloads in development).
import { getCatalogDb } from "../database";
import {
  loadEligibleTitleIds,
  loadQuizSeeds,
  loadSearchDocuments,
} from "./repository";
import { createSearchService, type SearchService } from "./service";

const globalForSearch = globalThis as unknown as {
  catalogSearch?: SearchService;
};

export function getSearchService(): SearchService {
  if (!globalForSearch.catalogSearch) {
    const db = getCatalogDb();
    globalForSearch.catalogSearch = createSearchService({
      loadDocuments: () => loadSearchDocuments(db),
      loadEligibleTitleIds: (ids) => loadEligibleTitleIds(db, ids),
      loadQuizSeeds: (options) => loadQuizSeeds(db, options),
    });
  }
  return globalForSearch.catalogSearch;
}
