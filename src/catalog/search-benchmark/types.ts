// Contract between the offline search benchmark (issue #71) and a catalog
// search implementation (issue #15). See docs/search-benchmark.md.

export const SEARCH_BENCHMARK_VERSION = "1.0.0";

/** Query rules a conforming search must apply. */
export const QUERY_RULES = {
  /** Shorter queries (after trimming/canonicalizing) are invalid_query. */
  minLength: 2,
  /** Longer queries are invalid_query. */
  maxLength: 100,
  defaultLimit: 20,
  /** Larger requested limits are clamped to this, not rejected. */
  maxLimit: 50,
} as const;

export type TitleKind = "movie" | "series";

export interface BenchmarkTitle {
  id: string;
  kind: TitleKind;
  title: string;
  originalTitle: string | null;
  alternateTitles: string[];
  year: number | null;
  posterPath: string | null;
  /** Adult titles must never be returned. */
  adult: boolean;
  /** Ineligible titles (e.g. tombstoned, no US availability) must not be returned. */
  eligible: boolean;
}

export interface SearchRequest {
  query: string;
  kind?: TitleKind;
  limit: number;
  cursor?: string | null;
}

export type SearchResponse =
  | { ok: true; results: { id: string }[]; nextCursor: string | null }
  | { ok: false; error: "invalid_query" };

export type SearchFn = (
  request: SearchRequest,
) => SearchResponse | Promise<SearchResponse>;

/**
 * Builds a search over the given titles. A database-backed implementation
 * seeds its store here. The benchmark calls it more than once, with the
 * corpus in different orders, to check deterministic ranking.
 */
export type CreateSearch = (
  titles: readonly BenchmarkTitle[],
) => SearchFn | Promise<SearchFn>;

export type CaseCategory =
  | "exact"
  | "prefix"
  | "original_title"
  | "alternate_title"
  | "punctuation"
  | "unicode"
  | "misspelling"
  | "kind_filter"
  | "same_name"
  | "missing_poster"
  | "exclusion"
  | "zero_result"
  | "short_query"
  | "long_query"
  | "malformed"
  | "pagination";

export interface BenchmarkCase {
  id: string;
  category: CaseCategory;
  /** Required cases gate the benchmark; stretch cases are reported only. */
  severity: "required" | "stretch";
  query: string;
  kind?: TitleKind;
  outcome: "results" | "empty" | "invalid";
  /**
   * Ordered relevance groups. Every id in group k must rank above every id in
   * group k+1; order within a group is free (reasonable ties). Other results
   * may appear only after the last expected id.
   */
  groups: string[][];
  /** Ids that must not appear (beyond the corpus-wide exclusion policy). */
  forbidden?: string[];
  /** Walk pages of this size and check them against a single full request. */
  pageSize?: number;
  note: string;
}

export interface BenchmarkCorpus {
  version: string;
  titles: BenchmarkTitle[];
  cases: BenchmarkCase[];
}
