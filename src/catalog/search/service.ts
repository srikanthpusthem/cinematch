// Search service: caches the prepared search index for a short TTL so each
// request ranks in memory instead of scanning the catalog (issue #15).
import { createHash } from "node:crypto";
import {
  buildIndex,
  canonicalQuery,
  decodeCursor,
  encodeCursor,
  rank,
  SEARCH_LIMITS,
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
  /** Live eligibility check for at most 100 cached candidates per call. */
  loadEligibleTitleIds?: (
    ids: readonly number[],
  ) => Promise<ReadonlySet<number>>;
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
      const query = canonicalQuery(req.q);
      if (!query.ok) return { ok: false, error: "invalid_query" };
      const offset = decodeCursor(req.cursor, query.folded, req.kind);
      if (offset === null) return { ok: false, error: "invalid_cursor" };
      const prepared = await index();
      if (!deps.loadEligibleTitleIds) return search(prepared, req, now());

      const ranked = rank(prepared, query.folded, req.kind);
      // Bind offsets to the actual ordered snapshot, not this process or TTL.
      // Equivalent snapshots work across instances; a rebuild that inserts,
      // removes or reorders titles explicitly rejects the old cursor. The
      // bounded digest reveals neither the full catalog nor process state.
      const snapshot = createHash("sha256")
        .update(JSON.stringify(ranked.map((doc) => doc.titleId)))
        .digest("base64url");
      if (decodeCursor(req.cursor, query.folded, req.kind, snapshot) === null)
        return { ok: false, error: "invalid_cursor" };
      const limit = Math.min(
        Math.max(1, Math.floor(req.limit)),
        SEARCH_LIMITS.maxLimit,
      );
      const results: SearchResultItem[] = [];
      const at = now();
      // The cursor tracks the unfiltered cached ranking. A lifecycle change on
      // an earlier page cannot shift offsets and make us skip a later title.
      // Fetch one extra eligible candidate to distinguish a next page from a
      // tail containing only removed titles. No false has-more cursor.
      for (let start = offset; start < ranked.length; start += 100) {
        const batch = ranked.slice(start, start + 100);
        const eligible = await deps.loadEligibleTitleIds(
          batch.map((d) => d.titleId),
        );
        for (const [i, doc] of batch.entries()) {
          if (!eligible.has(doc.titleId)) continue;
          if (results.length === limit) {
            return {
              ok: true,
              results,
              nextCursor: encodeCursor(
                start + i,
                query.folded,
                req.kind,
                snapshot,
              ),
            };
          }
          results.push(toResultItem(doc, at));
        }
      }
      return { ok: true, results, nextCursor: null };
    },
    async quizSeeds(options) {
      const at = now();
      return (await deps.loadQuizSeeds(options))
        .filter((d) => d.eligible)
        .map((d) => toResultItem(d, at));
    },
  };
}
