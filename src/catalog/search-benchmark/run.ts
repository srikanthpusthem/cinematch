// Runs the offline search benchmark against any CreateSearch implementation
// and produces a machine-readable report (docs/search-benchmark.md).
import { SEARCH_BENCHMARK_CORPUS } from "./corpus";
import {
  QUERY_RULES,
  SEARCH_BENCHMARK_VERSION,
  type BenchmarkCase,
  type BenchmarkCorpus,
  type BenchmarkTitle,
  type CaseCategory,
  type CreateSearch,
  type SearchFn,
  type SearchRequest,
  type SearchResponse,
} from "./types";
import { isExcluded, validateBenchmarkCorpus } from "./validate";

export interface CaseMetrics {
  /** 1-based rank of the best-ranked title from the first group. */
  firstRelevantRank: number | null;
  reciprocalRank: number;
  /** Share of expected titles found in the top 10 (denominator capped at 10). */
  recallAt10: number;
}

export interface CaseResult {
  id: string;
  category: CaseCategory;
  severity: BenchmarkCase["severity"];
  passed: boolean;
  failures: string[];
  metrics: CaseMetrics | null;
}

export interface BenchmarkReport {
  benchmarkVersion: string;
  corpusVersion: string;
  implementation: string;
  summary: {
    /** All required cases pass, no leaks, deterministic, pagination and limits correct. */
    passed: boolean;
    required: { total: number; passed: number };
    stretch: { total: number; passed: number };
    /** Over all scored cases, including stretch ones. */
    meanReciprocalRank: number;
    /** Over required scored cases only: the figure #15 should gate on. */
    requiredMeanReciprocalRank: number;
    meanRecallAt10: number;
    excludedLeaks: number;
    determinism: { passed: boolean; mismatchedCases: string[] };
    pagination: { passed: boolean; failures: string[] };
    limitClamp: { passed: boolean; requested: number; returned: number | null };
  };
  byCategory: Partial<Record<CaseCategory, { total: number; passed: number }>>;
  cases: CaseResult[];
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

function request(
  c: BenchmarkCase,
  limit: number,
  cursor?: string | null,
): SearchRequest {
  return {
    query: c.query,
    limit,
    ...(c.kind ? { kind: c.kind } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

function scoreCase(
  c: BenchmarkCase,
  response: SearchResponse,
  titles: ReadonlyMap<string, BenchmarkTitle>,
  limit: number,
  leaks: { count: number },
): CaseResult {
  const failures: string[] = [];
  const done = (metrics: CaseMetrics | null): CaseResult => ({
    id: c.id,
    category: c.category,
    severity: c.severity,
    passed: failures.length === 0,
    failures,
    metrics,
  });

  if (c.outcome === "invalid") {
    if (response.ok || response.error !== "invalid_query") {
      failures.push("expected invalid_query");
    }
    return done(null);
  }
  if (!response.ok) {
    failures.push("unexpected invalid_query");
    return done(null);
  }

  const ids = response.results.map((r) => r.id);
  if (ids.length > limit)
    failures.push(`returned ${ids.length} results for limit ${limit}`);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) failures.push(`duplicate result ${id}`);
    seen.add(id);
    const title = titles.get(id);
    if (!title) {
      failures.push(`unknown title id ${id}`);
      continue;
    }
    if (isExcluded(title)) {
      leaks.count++;
      failures.push(`excluded title ${id} returned`);
    }
    if (c.kind && title.kind !== c.kind)
      failures.push(`${id} is not a ${c.kind}`);
    if (c.forbidden?.includes(id))
      failures.push(`forbidden title ${id} returned`);
  }

  if (c.outcome === "empty") {
    if (ids.length) failures.push(`expected no results, got ${ids.length}`);
    return done(null);
  }

  const rank = new Map(ids.map((id, i) => [id, i + 1] as const));
  const expected = c.groups.flat();
  for (const id of expected) if (!rank.has(id)) failures.push(`missing ${id}`);

  for (let g = 0; g + 1 < c.groups.length; g++) {
    const worst = Math.max(
      ...c.groups[g]!.map((id) => rank.get(id) ?? Infinity),
    );
    const best = Math.min(
      ...c.groups[g + 1]!.map((id) => rank.get(id) ?? Infinity),
    );
    if (Number.isFinite(best) && worst > best) {
      failures.push(`group ${g + 2} ranked above group ${g + 1}`);
    }
  }

  const lastExpected = Math.max(0, ...expected.map((id) => rank.get(id) ?? 0));
  const expectedSet = new Set(expected);
  for (const id of ids.slice(0, lastExpected)) {
    if (!expectedSet.has(id))
      failures.push(`unexpected ${id} ranked above expected results`);
  }

  const firstRanks = c.groups[0]!.map((id) => rank.get(id)).filter(
    (r): r is number => r !== undefined,
  );
  const firstRelevantRank = firstRanks.length ? Math.min(...firstRanks) : null;
  const top10 = new Set(ids.slice(0, 10));
  return done({
    firstRelevantRank,
    reciprocalRank: firstRelevantRank ? round(1 / firstRelevantRank) : 0,
    recallAt10: round(
      expected.filter((id) => top10.has(id)).length /
        Math.min(expected.length, 10),
    ),
  });
}

async function checkPagination(
  search: SearchFn,
  c: BenchmarkCase,
  full: string[],
): Promise<string[]> {
  const failures: string[] = [];
  const pageSize = c.pageSize!;
  const collected: string[] = [];
  let cursor: string | null = null;
  for (let page = 1; ; page++) {
    if (page > 100) {
      failures.push(`${c.id}: pagination did not terminate`);
      break;
    }
    const response = await search(request(c, pageSize, cursor));
    if (!response.ok) {
      failures.push(`${c.id}: page ${page} returned invalid_query`);
      break;
    }
    if (response.results.length > pageSize) {
      failures.push(`${c.id}: page ${page} exceeded page size ${pageSize}`);
    }
    collected.push(...response.results.map((r) => r.id));
    cursor = response.nextCursor;
    if (!cursor) break;
  }
  if (new Set(collected).size !== collected.length)
    failures.push(`${c.id}: duplicates across pages`);
  if (collected.join("|") !== full.join("|")) {
    failures.push(
      `${c.id}: pages don't concatenate to the single-request order`,
    );
  }
  return failures;
}

/** Deterministic reorderings of the corpus, to catch insertion-order ranking. */
function reorderings(titles: readonly BenchmarkTitle[]): BenchmarkTitle[][] {
  const reversed = [...titles].reverse();
  const interleaved = [
    ...titles.filter((_, i) => i % 2 === 1),
    ...titles.filter((_, i) => i % 2 === 0),
  ];
  return [reversed, interleaved];
}

export async function runSearchBenchmark(
  createSearch: CreateSearch,
  options: { implementation: string; corpus?: BenchmarkCorpus },
): Promise<BenchmarkReport> {
  const corpus = options.corpus ?? SEARCH_BENCHMARK_CORPUS;
  validateBenchmarkCorpus(corpus);
  const titles = new Map(corpus.titles.map((t) => [t.id, t] as const));
  const limit = QUERY_RULES.defaultLimit;

  const search = await createSearch(corpus.titles);
  const leaks = { count: 0 };
  const cases: CaseResult[] = [];
  const baseline = new Map<string, string>();
  for (const c of corpus.cases) {
    const response = await search(request(c, limit));
    cases.push(scoreCase(c, response, titles, limit, leaks));
    baseline.set(c.id, JSON.stringify(response));
  }

  const mismatchedCases = new Set<string>();
  for (const order of reorderings(corpus.titles)) {
    const other = await createSearch(order);
    for (const c of corpus.cases) {
      if (
        JSON.stringify(await other(request(c, limit))) !== baseline.get(c.id)
      ) {
        mismatchedCases.add(c.id);
      }
    }
  }

  const paginationFailures: string[] = [];
  for (const c of corpus.cases.filter((x) => x.pageSize)) {
    const full = await search(request(c, QUERY_RULES.maxLimit));
    const fullIds = full.ok ? full.results.map((r) => r.id) : [];
    paginationFailures.push(...(await checkPagination(search, c, fullIds)));
  }

  const requested = 1000;
  const broad = await search({ query: "star", limit: requested });
  const returned = broad.ok ? broad.results.length : null;

  const byCategory: BenchmarkReport["byCategory"] = {};
  for (const r of cases) {
    const entry = (byCategory[r.category] ??= { total: 0, passed: 0 });
    entry.total++;
    if (r.passed) entry.passed++;
  }
  const count = (severity: CaseResult["severity"]) => ({
    total: cases.filter((r) => r.severity === severity).length,
    passed: cases.filter((r) => r.severity === severity && r.passed).length,
  });
  const mean = (
    f: (m: CaseMetrics) => number,
    include: (r: CaseResult) => boolean = () => true,
  ) => {
    const scored = cases.filter((r) => r.metrics && include(r));
    return scored.length
      ? round(scored.reduce((sum, r) => sum + f(r.metrics!), 0) / scored.length)
      : 0;
  };

  const required = count("required");
  const limitClamp = {
    passed: returned !== null && returned <= QUERY_RULES.maxLimit,
    requested,
    returned,
  };
  const determinism = {
    passed: mismatchedCases.size === 0,
    mismatchedCases: [...mismatchedCases].sort(),
  };
  const pagination = {
    passed: paginationFailures.length === 0,
    failures: paginationFailures,
  };

  return {
    benchmarkVersion: SEARCH_BENCHMARK_VERSION,
    corpusVersion: corpus.version,
    implementation: options.implementation,
    summary: {
      passed:
        required.passed === required.total &&
        leaks.count === 0 &&
        determinism.passed &&
        pagination.passed &&
        limitClamp.passed,
      required,
      stretch: count("stretch"),
      meanReciprocalRank: mean((m) => m.reciprocalRank),
      requiredMeanReciprocalRank: mean(
        (m) => m.reciprocalRank,
        (r) => r.severity === "required",
      ),
      meanRecallAt10: mean((m) => m.recallAt10),
      excludedLeaks: leaks.count,
      determinism,
      pagination,
      limitClamp,
    },
    byCategory,
    cases,
  };
}
