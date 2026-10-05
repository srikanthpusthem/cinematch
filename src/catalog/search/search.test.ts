import { describe, expect, it, vi } from "vitest";
import { runSearchBenchmark } from "../search-benchmark/run";
import type { CreateSearch } from "../search-benchmark/types";
import { documentsFor } from "./__fixtures__/benchmark-documents";
import {
  SEARCH_LIMITS,
  availabilityOf,
  buildIndex,
  canonicalQuery,
  decodeCursor,
  encodeCursor,
  parseKind,
  parseLimit,
  search,
  type SearchDocument,
} from "./engine";
import { createQuizSeedsHandler, createSearchHandler } from "./http";
import { createSearchService, type SearchService } from "./service";

const NOW = new Date("2026-10-01T00:00:00Z");

const engineSearch: CreateSearch = (titles) => {
  const { docs, idOf } = documentsFor(titles);
  const index = buildIndex(docs);
  return ({ query, kind, limit, cursor }) => {
    const r = search(index, { q: query, kind, limit, cursor }, NOW);
    return r.ok
      ? {
          ok: true,
          results: r.results.map((x) => ({ id: idOf.get(x.id)! })),
          nextCursor: r.nextCursor,
        }
      : { ok: false, error: "invalid_query" };
  };
};

describe("frozen search benchmark (#71)", () => {
  it("passes every required case with no leaks, deterministic ranking, pagination and clamping", async () => {
    const report = await runSearchBenchmark(engineSearch, {
      implementation: "catalog-search-engine",
    });
    expect(
      report.cases.filter((c) => c.severity === "required" && !c.passed),
    ).toEqual([]);
    expect(report.summary).toMatchObject({
      passed: true,
      excludedLeaks: 0,
      requiredMeanReciprocalRank: 1,
      determinism: { passed: true },
      pagination: { passed: true },
      limitClamp: { passed: true },
    });
  });
});

describe("query and parameter validation", () => {
  it.each([
    ["dune", true],
    ["  Dune  ", true],
    ["a", false],
    ["   ", false],
    ["", false],
    ["\u0000\u0007", false],
    ["x".repeat(SEARCH_LIMITS.maxQueryLength + 1), false],
    ["!!", false], // nothing searchable after folding
    [42, false],
  ])("canonicalQuery(%j) ok=%s", (raw, ok) => {
    expect(canonicalQuery(raw).ok).toBe(ok);
  });

  it("parses, defaults and clamps limits", () => {
    expect(parseLimit(null)).toBe(20);
    expect(parseLimit("5")).toBe(5);
    expect(parseLimit("1000")).toBe(SEARCH_LIMITS.maxLimit);
    expect(parseLimit("0")).toBeNull();
    expect(parseLimit("-1")).toBeNull();
    expect(parseLimit("2.5")).toBeNull();
    expect(parseLimit("ten")).toBeNull();
  });

  it("accepts only known kinds", () => {
    expect(parseKind(null)).toBeUndefined();
    expect(parseKind("series")).toBe("series");
    expect(parseKind("episode")).toBeNull();
  });
});

describe("cursors", () => {
  it("round-trips and is bound to the query and filters", () => {
    const c = encodeCursor(20, "dune", "movie");
    expect(decodeCursor(c, "dune", "movie")).toBe(20);
    expect(decodeCursor(c, "dune")).toBeNull(); // different filter
    expect(decodeCursor(c, "heat", "movie")).toBeNull(); // different query
    expect(decodeCursor(null, "dune")).toBe(0);
  });

  it.each([
    "not base64!",
    "e30",
    Buffer.from('{"o":-1,"f":"x"}').toString("base64url"),
    "A".repeat(300),
  ])("rejects tampered cursor %j", (cursor) => {
    expect(decodeCursor(cursor, "dune")).toBeNull();
  });
});

describe("search", () => {
  const doc = (
    n: number,
    extra: Partial<SearchDocument> = {},
  ): SearchDocument => ({
    titleId: 100 + n,
    kind: "movie",
    tmdbId: n,
    title: `Star ${n}`,
    originalTitle: null,
    alternateTitles: [],
    year: 2000 + n,
    posterPath: n % 2 ? `/p${n}.jpg` : null,
    availabilityCheckedAt: new Date(NOW.getTime() - n * 24 * 3_600_000),
    eligible: true,
    ...extra,
  });

  it("returns only the public fields, including missing posters and freshness", () => {
    const index = buildIndex([
      doc(1),
      doc(2),
      doc(3, { availabilityCheckedAt: null }),
    ]);
    const r = search(index, { q: "star", limit: 10 }, NOW);
    expect(r.ok && r.results.map((x) => Object.keys(x).sort())).toEqual(
      Array(3).fill([
        "availability",
        "id",
        "kind",
        "posterPath",
        "title",
        "tmdbId",
        "year",
      ]),
    );
    expect(
      r.ok && r.results.map((x) => [x.id, x.posterPath, x.availability.state]),
    ).toEqual([
      [101, "/p1.jpg", "current"],
      [102, null, "current"],
      [103, "/p3.jpg", "unknown"],
    ]);
  });

  it("pages stably with opaque cursors and stops at the end", () => {
    const index = buildIndex([1, 2, 3, 4, 5].map((n) => doc(n)));
    const page1 = search(index, { q: "star", limit: 2 }, NOW);
    expect(page1.ok && page1.results.map((x) => x.tmdbId)).toEqual([1, 2]);
    const page2 = page1.ok
      ? search(index, { q: "star", limit: 2, cursor: page1.nextCursor }, NOW)
      : null;
    const page3 = page2?.ok
      ? search(index, { q: "star", limit: 2, cursor: page2.nextCursor }, NOW)
      : null;
    expect(page2?.ok && page2.results.map((x) => x.tmdbId)).toEqual([3, 4]);
    expect(page3?.ok && page3.results.map((x) => x.tmdbId)).toEqual([5]);
    expect(page3?.ok && page3.nextCursor).toBeNull();
  });

  it("never returns ineligible titles and rejects a cursor from another query", () => {
    const index = buildIndex([doc(1), doc(2, { eligible: false })]);
    const r = search(index, { q: "star", limit: 10 }, NOW);
    expect(r.ok && r.results.map((x) => x.tmdbId)).toEqual([1]);
    expect(
      search(
        index,
        { q: "star", limit: 10, cursor: encodeCursor(1, "heat") },
        NOW,
      ),
    ).toEqual({
      ok: false,
      error: "invalid_cursor",
    });
  });

  it("classifies availability freshness at the 48 hour boundary", () => {
    const at = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
    expect(availabilityOf(at(48), NOW).state).toBe("current");
    expect(availabilityOf(at(49), NOW).state).toBe("stale");
    expect(availabilityOf(null, NOW)).toEqual({
      state: "unknown",
      checkedAt: null,
    });
  });
});

describe("search service", () => {
  it("reuses the loaded index within the TTL and shares concurrent loads", async () => {
    let t = NOW.getTime();
    const loadDocuments = vi.fn(async () => [
      {
        titleId: 1,
        kind: "movie" as const,
        tmdbId: 1,
        title: "Dune",
        originalTitle: null,
        alternateTitles: [],
        year: 2021,
        posterPath: null,
        availabilityCheckedAt: null,
        eligible: true,
      },
    ]);
    const service = createSearchService({
      loadDocuments,
      loadQuizSeeds: async () => [],
      ttlMs: 60_000,
      now: () => new Date(t),
    });
    await Promise.all([
      service.search({ q: "dune", limit: 5 }),
      service.search({ q: "dune", limit: 5 }),
    ]);
    expect(loadDocuments).toHaveBeenCalledTimes(1);
    t += 61_000;
    await service.search({ q: "dune", limit: 5 });
    expect(loadDocuments).toHaveBeenCalledTimes(2);
  });
});

describe("HTTP handlers", () => {
  const fakeService = (
    overrides: Partial<SearchService> = {},
  ): SearchService => ({
    search: async () => ({ ok: true, results: [], nextCursor: null }),
    quizSeeds: async () => [],
    ...overrides,
  });
  const get = (handler: (r: Request) => Promise<Response>, query: string) =>
    handler(new Request(`http://localhost/api/catalog/x?${query}`));

  it.each([
    ["q=a", "invalid_query"],
    ["q=dune&kind=episode", "invalid_kind"],
    ["q=dune&limit=0", "invalid_limit"],
    ["q=dune&limit=abc", "invalid_limit"],
  ])("search rejects %s with %s", async (query, error) => {
    const service = createSearchService({
      loadDocuments: async () => [],
      loadQuizSeeds: async () => [],
    });
    const res = await get(
      createSearchHandler(() => service),
      query,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("clamps the limit and passes validated parameters to the service", async () => {
    const searchFn = vi.fn(async () => ({
      ok: true as const,
      results: [],
      nextCursor: null,
    }));
    const res = await get(
      createSearchHandler(() => fakeService({ search: searchFn })),
      "q=dune&kind=series&limit=999",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [],
      nextCursor: null,
      limit: 50,
    });
    expect(searchFn).toHaveBeenCalledWith({
      q: "dune",
      kind: "series",
      limit: 50,
      cursor: null,
    });
  });

  it("hides internal errors behind a generic 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get(
      createSearchHandler(() =>
        fakeService({
          search: async () => {
            throw new Error(
              "connect ECONNREFUSED postgresql://user:secret@db/cinematch",
            );
          },
        }),
      ),
      "q=dune",
    );
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toBe('{"error":"internal_error"}');
    expect(body).not.toContain("secret");
    spy.mockRestore();
  });

  it("serves quiz seeds with bounded limits", async () => {
    const quizSeeds = vi.fn(async () => []);
    const handler = createQuizSeedsHandler(() => fakeService({ quizSeeds }));
    expect((await get(handler, "")).status).toBe(200);
    expect(quizSeeds).toHaveBeenLastCalledWith({ kind: undefined, limit: 12 });
    await get(handler, "kind=movie&limit=500");
    expect(quizSeeds).toHaveBeenLastCalledWith({ kind: "movie", limit: 50 });
    expect((await get(handler, "limit=-3")).status).toBe(400);
    expect((await get(handler, "kind=tv")).status).toBe(400);
  });
});
