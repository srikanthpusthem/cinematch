# Catalog search benchmark

An offline, deterministic benchmark for title search and quiz-seed discovery
(issue #71), written before the search endpoint (#15) is tuned.
Code: `src/catalog/search-benchmark/`. No network, database or credentials.

## Contract for #15

A search implementation provides a factory:

```ts
type CreateSearch = (
  titles: readonly BenchmarkTitle[],
) => SearchFn | Promise<SearchFn>;
type SearchFn = (req: {
  query: string;
  kind?: "movie" | "series";
  limit: number;
  cursor?: string | null;
}) => SearchResponse | Promise<SearchResponse>;
type SearchResponse =
  | { ok: true; results: { id: string }[]; nextCursor: string | null }
  | { ok: false; error: "invalid_query" };
```

A database-backed implementation seeds its store from `titles` in the factory.
The benchmark calls the factory **three times** with the same titles in different
orders, and requires identical responses: ranking must not depend on insertion order.

**Query rules** (`QUERY_RULES`):

- After stripping control characters and trimming, a query must be 2–100
  characters. Otherwise the response is `{ ok: false, error: "invalid_query" }`.
- A requested `limit` above 50 is **clamped**, not rejected.
- SQL-looking or odd text is ordinary text: no error, just (probably) no results.

**Policy:** titles with `adult: true` or `eligible: false` must never be returned.
Any leak fails the benchmark.

Run it:

```ts
import { runSearchBenchmark } from "@/catalog/search-benchmark/run";
const report = await runSearchBenchmark(createSearch, {
  implementation: "pg-trgm-v1",
});
```

## Corpus v1.0.0

41 titles: well-known public films and series (titles and years are public
facts) plus synthetic adult and ineligible records. There are 47 cases (42 required, 5 stretch) across 16
categories:

- exact titles
- prefixes
- original and alternate titles (French, Japanese, Korean, Spanish, romanized)
- punctuation (Spider-Man, WALL·E, M\*A\*S\*H)
- Unicode (diacritics, an NFD query)
- misspellings
- `kind` filters
- the same name across years
- missing posters
- exclusion
- zero results
- short, long and malformed queries
- pagination

**Expectations are ordered groups.** Every title in group _k_ must rank above every
title in group _k+1_. Order _within_ a group is free, because ties such as Dune
(1984) vs Dune (2021) are both reasonable. Results that weren't expected may appear
only after the last expected title. This checks what matters without overfitting
one exact order.

Cases are **required** (they gate the benchmark) or **stretch** (reported only).
Misspellings and joined words ("spiderman", "walle") are stretch: they need fuzzy
or compound matching, which #15 may or may not take on.

## Report

`runSearchBenchmark` returns JSON with no timestamps, so reports diff cleanly
between runs and implementations. The numbers below are the actual output for the
simple reference search used in the tests:

```jsonc
{
  "benchmarkVersion": "1.0.0",
  "corpusVersion": "1.0.0",
  "implementation": "reference",
  "summary": {
    "passed": true, // required all pass, no leaks, deterministic, pagination + limits OK
    "required": { "total": 42, "passed": 42 },
    "stretch": { "total": 5, "passed": 2 },
    "meanReciprocalRank": 0.9189, // all scored cases
    "requiredMeanReciprocalRank": 1, // gate on this
    "meanRecallAt10": 0.9189,
    "excludedLeaks": 0,
    "determinism": { "passed": true, "mismatchedCases": [] },
    "pagination": { "passed": true, "failures": [] },
    "limitClamp": { "passed": true, "requested": 1000, "returned": 6 },
  },
  "byCategory": { "exact": { "total": 6, "passed": 6 } },
  "cases": [
    {
      "id": "typo-interstelar",
      "category": "misspelling",
      "severity": "stretch",
      "passed": false,
      "failures": ["missing m-interstellar"],
      "metrics": {
        "firstRelevantRank": null,
        "reciprocalRank": 0,
        "recallAt10": 0,
      },
    },
  ],
}
```

Per-case failures are short strings: `missing <id>`,
`group 2 ranked above group 1`, `unexpected <id> ranked above expected results`,
`excluded title <id> returned`, `expected invalid_query`, and so on.

**Pagination:** for cases with `pageSize`, pages are walked through `nextCursor`
(at most 100). Each page must be within size, there must be no duplicates across
pages, and the pages must concatenate to exactly the order of a single request at
the maximum limit.

## Changing the corpus

`validateBenchmarkCorpus` rejects:

- duplicate case or title IDs
- unknown title IDs
- a title in two groups, or both expected and forbidden
- an expected title that the exclusion policy forbids
- a `kind` filter contradicting an expected title
- outcomes inconsistent with the expectations

Any change to titles or expectations **bumps the corpus version**. Don't edit
expectations after seeing an implementation's results; add a new case or version
instead, as with the recommendation corpus in `docs/evaluation.md`.
