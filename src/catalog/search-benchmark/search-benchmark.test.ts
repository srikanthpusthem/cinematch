import { describe, expect, it } from "vitest";
import { SEARCH_BENCHMARK_CORPUS } from "./corpus";
import { runSearchBenchmark } from "./run";
import {
  QUERY_RULES,
  type BenchmarkCase,
  type BenchmarkCorpus,
  type BenchmarkTitle,
  type CaseCategory,
  type CreateSearch,
} from "./types";
import { BenchmarkCorpusError, validateBenchmarkCorpus } from "./validate";

// --- Throwaway reference implementations (not product search; #15 owns that)

const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const stripArticle = (s: string) => s.replace(/^(the|a|an) /, "");

/** Sound baseline: exact > article-stripped exact > prefix > token prefixes > joined. */
const referenceSearch: CreateSearch = (titles) => {
  const eligible = titles.filter((t) => !t.adult && t.eligible);
  return ({ query, kind, limit, cursor }) => {
    const q = fold(query.replace(CONTROL, ""));
    const raw = query.replace(CONTROL, "").trim();
    if (
      raw.length < QUERY_RULES.minLength ||
      raw.length > QUERY_RULES.maxLength ||
      !q
    ) {
      return { ok: false, error: "invalid_query" };
    }
    const qTokens = q.split(" ");
    const qJoined = q.replace(/ /g, "");
    const score = (name: string) => {
      const n = fold(name);
      const bare = stripArticle(n);
      if (n === q) return 100;
      if (bare === q) return 95;
      if (n.startsWith(q) || bare.startsWith(q)) return 80;
      const tokens = n.split(" ");
      if (qTokens.every((qt) => tokens.some((tk) => tk.startsWith(qt))))
        return 60;
      if (qJoined.length >= 3 && n.replace(/ /g, "").startsWith(qJoined))
        return 50;
      return 0;
    };
    const hits = eligible
      .filter((t) => !kind || t.kind === kind)
      .map((t) => ({
        t,
        s: Math.max(
          score(t.title),
          ...[t.originalTitle, ...t.alternateTitles]
            .filter((x): x is string => !!x)
            .map(score),
        ),
      }))
      .filter((h) => h.s > 0)
      .sort(
        (a, b) =>
          b.s - a.s ||
          a.t.title.length - b.t.title.length ||
          (a.t.year ?? 0) - (b.t.year ?? 0) ||
          (a.t.id < b.t.id ? -1 : 1),
      );
    const size = Math.min(limit, QUERY_RULES.maxLimit);
    const offset = cursor ? Number(cursor) : 0;
    const page = hits.slice(offset, offset + size);
    const next = offset + size < hits.length ? String(offset + size) : null;
    return {
      ok: true,
      results: page.map((h) => ({ id: h.t.id })),
      nextCursor: next,
    };
  };
};

/** Naive baseline: substring on display title, insertion order, no policy. */
const naiveSearch: CreateSearch =
  (titles) =>
  ({ query, limit }) => ({
    ok: true,
    results: titles
      .filter((t) => t.title.toLowerCase().includes(query.toLowerCase()))
      .slice(0, limit)
      .map((t) => ({ id: t.id })),
    nextCursor: null,
  });

// --- Corpus

describe("benchmark corpus", () => {
  it("is valid and covers every category from the brief", () => {
    expect(() =>
      validateBenchmarkCorpus(SEARCH_BENCHMARK_CORPUS),
    ).not.toThrow();
    const categories = new Set(
      SEARCH_BENCHMARK_CORPUS.cases.map((c) => c.category),
    );
    const all: CaseCategory[] = [
      "exact",
      "prefix",
      "original_title",
      "alternate_title",
      "punctuation",
      "unicode",
      "misspelling",
      "kind_filter",
      "same_name",
      "missing_poster",
      "exclusion",
      "zero_result",
      "short_query",
      "long_query",
      "malformed",
      "pagination",
    ];
    expect([...categories].sort()).toEqual([...all].sort());
    expect(SEARCH_BENCHMARK_CORPUS.cases.length).toBeGreaterThanOrEqual(40);
  });

  it("includes titles with missing posters and excluded records", () => {
    const titles = SEARCH_BENCHMARK_CORPUS.titles;
    expect(titles.some((t) => t.posterPath === null)).toBe(true);
    expect(titles.some((t) => t.adult)).toBe(true);
    expect(titles.some((t) => !t.eligible)).toBe(true);
  });

  it("keeps an NFD query distinct from the NFC title it must match", () => {
    const c = SEARCH_BENCHMARK_CORPUS.cases.find(
      (x) => x.id === "unicode-decomposed-query",
    )!;
    expect(c.query).not.toBe(c.query.normalize("NFC"));
  });
});

describe("validateBenchmarkCorpus", () => {
  const title = (
    id: string,
    extra: Partial<BenchmarkTitle> = {},
  ): BenchmarkTitle => ({
    id,
    kind: "movie",
    title: id,
    originalTitle: null,
    alternateTitles: [],
    year: 2000,
    posterPath: null,
    adult: false,
    eligible: true,
    ...extra,
  });
  const kase = (
    id: string,
    groups: string[][],
    extra: Partial<BenchmarkCase> = {},
  ): BenchmarkCase => ({
    id,
    category: "exact",
    severity: "required",
    query: "q",
    outcome: groups.length ? "results" : "empty",
    groups,
    note: "",
    ...extra,
  });
  const corpus = (
    cases: BenchmarkCase[],
    titles = [title("a"), title("b")],
  ): BenchmarkCorpus => ({
    version: "1.0.0",
    titles,
    cases,
  });
  const problems = (c: BenchmarkCorpus) => {
    try {
      validateBenchmarkCorpus(c);
      return [];
    } catch (e) {
      expect(e).toBeInstanceOf(BenchmarkCorpusError);
      return (e as BenchmarkCorpusError).problems;
    }
  };

  it.each([
    [
      "duplicate case ids",
      corpus([kase("x", [["a"]]), kase("x", [["b"]])]),
      "duplicate case id: x",
    ],
    [
      "duplicate title ids",
      corpus([], [title("a"), title("a")]),
      "duplicate title id: a",
    ],
    [
      "unknown title ids",
      corpus([kase("x", [["zzz"]])]),
      "unknown title id zzz",
    ],
    [
      "an id in two groups",
      corpus([kase("x", [["a"], ["a"]])]),
      "appears in more than one group",
    ],
    [
      "expected and forbidden",
      corpus([kase("x", [["a"]], { forbidden: ["a"] })]),
      "both expected and forbidden",
    ],
    [
      "expecting an excluded title",
      corpus([kase("x", [["a"]])], [title("a", { adult: true })]),
      "exclusion policy forbids",
    ],
    [
      "a kind filter contradicting an expectation",
      corpus([kase("x", [["a"]], { kind: "series" })]),
      "expects series results but a is a movie",
    ],
    [
      "an invalid outcome with expectations",
      corpus([kase("x", [["a"]], { outcome: "invalid" })]),
      'outcome "invalid" contradicts',
    ],
  ])("rejects %s", (_name, c, message) => {
    expect(problems(c).join("\n")).toContain(message);
  });

  it("reports every problem at once", () => {
    expect(
      problems(corpus([kase("x", [["zzz"]]), kase("x", [["a"], ["a"]])]))
        .length,
    ).toBe(3);
  });
});

// --- Harness

describe("runSearchBenchmark", () => {
  it("passes a sound implementation on every required case", async () => {
    const report = await runSearchBenchmark(referenceSearch, {
      implementation: "reference",
    });
    const failedRequired = report.cases.filter(
      (c) => c.severity === "required" && !c.passed,
    );
    expect(failedRequired).toEqual([]);
    expect(report.summary).toMatchObject({
      passed: true,
      excludedLeaks: 0,
      determinism: { passed: true, mismatchedCases: [] },
      pagination: { passed: true, failures: [] },
      limitClamp: { passed: true, requested: 1000 },
    });
    expect(report.summary.requiredMeanReciprocalRank).toBe(1);
    // Overall mean includes the stretch typo cases it can't answer.
    expect(report.summary.meanReciprocalRank).toBeLessThan(1);
    // No fuzzy matching: the typo cases are reported but don't gate the run.
    expect(report.summary.stretch.passed).toBeLessThan(
      report.summary.stretch.total,
    );
    expect(
      report.cases.find((c) => c.id === "typo-interstelar")?.failures,
    ).toContain("missing m-interstellar");
  });

  it("fails a naive implementation for leaks, invalid queries, limits and order dependence", async () => {
    const report = await runSearchBenchmark(naiveSearch, {
      implementation: "naive-substring",
    });
    const failures = (id: string) =>
      report.cases.find((c) => c.id === id)!.failures;

    expect(report.summary.passed).toBe(false);
    expect(report.summary.excludedLeaks).toBeGreaterThan(0);
    expect(failures("exclude-heat")).toContain(
      "excluded title m-heat-ineligible returned",
    );
    expect(failures("short-one-char")).toEqual(["expected invalid_query"]);
    expect(failures("unicode-no-accent")).toContain("missing m-amelie");
    // Substring matching finds "her" inside "The Godfather" and ranks it first.
    expect(failures("exact-short-her")).toContain(
      "unexpected m-godfather ranked above expected results",
    );
    expect(report.summary.determinism.passed).toBe(false);
    expect(report.summary.limitClamp.passed).toBe(true); // corpus < maxLimit matches
    expect(report.summary.meanReciprocalRank).toBeLessThan(1);
  });

  it("flags pagination that doesn't concatenate to the full order", async () => {
    const shuffledPages: CreateSearch = async (titles) => {
      const inner = await referenceSearch(titles);
      return async (req) => {
        const res = await inner(req);
        // Bug: pages reverse their items.
        return res.ok && req.limit === 2
          ? { ...res, results: [...res.results].reverse() }
          : res;
      };
    };
    const report = await runSearchBenchmark(shuffledPages, {
      implementation: "bad-pages",
    });
    expect(report.summary.pagination.failures).toEqual([
      "page-star: pages don't concatenate to the single-request order",
    ]);
  });

  it("flags unbounded limits", async () => {
    const unbounded: CreateSearch =
      (titles) =>
      ({ limit }) => ({
        ok: true,
        results: Array.from({ length: limit }, (_, i) => ({
          id: titles[i % titles.length]!.id,
        })),
        nextCursor: null,
      });
    const report = await runSearchBenchmark(unbounded, {
      implementation: "unbounded",
    });
    expect(report.summary.limitClamp).toEqual({
      passed: false,
      requested: 1000,
      returned: 1000,
    });
  });

  it("produces a stable, JSON-serializable report", async () => {
    const a = await runSearchBenchmark(referenceSearch, {
      implementation: "reference",
    });
    const b = await runSearchBenchmark(referenceSearch, {
      implementation: "reference",
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.parse(JSON.stringify(a))).toMatchObject({
      benchmarkVersion: "1.0.0",
      corpusVersion: "1.0.0",
      implementation: "reference",
    });
  });

  it("refuses to score against an invalid corpus", async () => {
    const broken: BenchmarkCorpus = {
      ...SEARCH_BENCHMARK_CORPUS,
      cases: [
        ...SEARCH_BENCHMARK_CORPUS.cases,
        SEARCH_BENCHMARK_CORPUS.cases[0]!,
      ],
    };
    await expect(
      runSearchBenchmark(referenceSearch, {
        implementation: "x",
        corpus: broken,
      }),
    ).rejects.toThrow(BenchmarkCorpusError);
  });
});
