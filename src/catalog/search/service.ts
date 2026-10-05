// Search service: caches the prepared search index for a short TTL so each
// request ranks in memory instead of scanning the catalog (issue #15).
import {
  buildIndex,
  search,
  toResultItem,
  type SearchDocument,
  type SearchIndex,
  type SearchRequest,
  type SearchResponse,
  type SearchResultItem,
  type TitleKind,
} from "./engine";

export interface SearchServiceDeps {
  loadDocuments: () => Promise<SearchDocument[]>;
  loadQuizSeeds: (options: {
    kind?: TitleKind;
    limit: number;
  }) => Promise<SearchDocument[]>;
  /** How long a loaded index is reused. The catalog changes nightly. */
  ttlMs?: number;
  now?: () => Date;
}

export interface SearchService {
  search(req: SearchRequest): Promise<SearchResponse>;
  quizSeeds(options: {
    kind?: TitleKind;
    limit: number;
  }): Promise<SearchResultItem[]>;
}

export function createSearchService(deps: SearchServiceDeps): SearchService {
  const ttlMs = deps.ttlMs ?? 5 * 60_000;
  const now = deps.now ?? (() => new Date());
  let cached: { index: SearchIndex; loadedAt: number } | null = null;
  let loading: Promise<SearchIndex> | null = null;

  async function index(): Promise<SearchIndex> {
    const t = now().getTime();
    if (cached && t - cached.loadedAt < ttlMs) return cached.index;
    // Concurrent requests share one load.
    loading ??= deps
      .loadDocuments()
      .then((docs) => {
        const built = buildIndex(docs);
        cached = { index: built, loadedAt: now().getTime() };
        return built;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  return {
    async search(req) {
      return search(await index(), req, now());
    },
    async quizSeeds(options) {
      const at = now();
      return (await deps.loadQuizSeeds(options)).map((d) =>
        toResultItem(d, at),
      );
    },
  };
}
