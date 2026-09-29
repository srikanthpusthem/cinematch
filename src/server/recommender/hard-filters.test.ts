import { describe, expect, it } from "vitest";

import { applyHardFilters, type RecommendationCandidate } from "./hard-filters";

function movie(
  id: string,
  overrides: Partial<RecommendationCandidate> = {},
): RecommendationCandidate {
  return {
    id,
    format: "movie",
    genreIds: [],
    usStreamingServiceIds: [8],
    runtimeMinutes: 95,
    ...overrides,
  };
}

function series(
  id: string,
  overrides: Partial<RecommendationCandidate> = {},
): RecommendationCandidate {
  return {
    id,
    format: "series",
    genreIds: [],
    usStreamingServiceIds: [8],
    episodeRuntimeMinutes: 30,
    seasonCount: 1,
    ...overrides,
  };
}

describe("applyHardFilters", () => {
  it("applies every hard constraint and keeps deterministic caller order", () => {
    const result = applyHardFilters(
      [
        movie("wrong-service", { usStreamingServiceIds: [9] }),
        movie("excluded-genre", { genreIds: [27] }),
        series("wrong-format"),
        movie("too-long", { runtimeMinutes: 100 }),
        movie("watched"),
        movie("first"),
        movie("second", { usStreamingServiceIds: [8, 9] }),
      ],
      {
        selectedUsServiceIds: [8],
        excludedGenreIds: [27],
        format: "movie",
        length: { format: "movie", category: "under-100" },
        watchedIds: ["watched"],
        limit: 5,
      },
    );

    expect(result.candidates.map(({ id }) => id)).toEqual(["first", "second"]);
    expect(result.exhaustion).toMatchObject({
      requestedCount: 5,
      eligibleCount: 2,
      returnedCount: 2,
      missingCount: 3,
      exhausted: true,
      activeEditableConstraints: ["services", "genres", "format", "length"],
    });
  });

  it("filters the complete pool before applying the result limit", () => {
    const result = applyHardFilters(
      [
        movie("blocked-1", { genreIds: [27] }),
        movie("blocked-2", { genreIds: [27] }),
        movie("eligible-1"),
        movie("eligible-2"),
      ],
      { excludedGenreIds: [27], limit: 2 },
    );

    expect(result.candidates.map(({ id }) => id)).toEqual([
      "eligible-1",
      "eligible-2",
    ]);
    expect(result.exhaustion).toMatchObject({
      eligibleCount: 2,
      returnedCount: 2,
      missingCount: 0,
      exhausted: true,
    });
  });

  it("uses any selected US service and reports sparse-combination shortages", () => {
    const result = applyHardFilters(
      [
        movie("netflix-drama", { genreIds: [18], usStreamingServiceIds: [8] }),
        movie("hulu-comedy", { genreIds: [35], usStreamingServiceIds: [15] }),
        movie("netflix-comedy", { genreIds: [35], usStreamingServiceIds: [8] }),
      ],
      {
        selectedUsServiceIds: [8, 9],
        excludedGenreIds: [18],
        limit: 3,
      },
    );

    expect(result.candidates.map(({ id }) => id)).toEqual(["netflix-comedy"]);
    expect(result.exhaustion.relaxationOptions).toEqual([
      { constraint: "services", additionalEligibleCount: 1 },
      { constraint: "genres", additionalEligibleCount: 1 },
    ]);
  });

  it("returns structured zero-result exhaustion without relaxing constraints", () => {
    const result = applyHardFilters(
      [movie("watched"), movie("horror", { genreIds: [27] })],
      {
        excludedGenreIds: [27],
        watchedIds: ["watched"],
        limit: 5,
      },
    );

    expect(result.candidates).toEqual([]);
    expect(result.exhaustion).toEqual({
      requestedCount: 5,
      eligibleCount: 0,
      returnedCount: 0,
      missingCount: 5,
      exhausted: true,
      activeEditableConstraints: ["genres"],
      relaxationOptions: [{ constraint: "genres", additionalEligibleCount: 1 }],
    });
  });

  it("supports cold start with no optional constraints", () => {
    const result = applyHardFilters([movie("a"), series("b"), movie("c")], {
      limit: 2,
    });

    expect(result.candidates.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(result.exhaustion).toEqual({
      requestedCount: 2,
      eligibleCount: 3,
      returnedCount: 2,
      missingCount: 0,
      exhausted: false,
      activeEditableConstraints: [],
      relaxationOptions: [],
    });
  });

  it.each([
    [99, "under-100", true],
    [100, "under-100", false],
    [149, "epic", false],
    [150, "epic", true],
  ] as const)(
    "applies movie runtime boundary %i for %s",
    (runtimeMinutes, category, expected) => {
      const result = applyHardFilters([movie("boundary", { runtimeMinutes })], {
        format: "movie",
        length: { format: "movie", category },
        limit: 1,
      });
      expect(result.candidates).toHaveLength(expected ? 1 : 0);
    },
  );

  it.each([
    [series("30m", { episodeRuntimeMinutes: 30 }), "short-episodes", true],
    [series("31m", { episodeRuntimeMinutes: 31 }), "short-episodes", false],
    [series("one", { seasonCount: 1 }), "one-season", true],
    [series("two", { seasonCount: 2 }), "one-season", false],
    [series("three", { seasonCount: 3 }), "long-running", false],
    [series("four", { seasonCount: 4 }), "long-running", true],
  ] as const)(
    "applies series boundary for %s and %s",
    (candidate, category, expected) => {
      const result = applyHardFilters([candidate], {
        format: "series",
        length: { format: "series", category },
        limit: 1,
      });
      expect(result.candidates).toHaveLength(expected ? 1 : 0);
    },
  );

  it("fails closed when active length metadata is missing", () => {
    const result = applyHardFilters(
      [
        movie("unknown", { runtimeMinutes: null }),
        series("unknown-series", { seasonCount: null }),
      ],
      {
        format: "movie",
        length: { format: "movie", category: "under-100" },
        limit: 2,
      },
    );
    expect(result.candidates).toEqual([]);
  });

  it("rejects incompatible length and format inputs", () => {
    expect(() =>
      applyHardFilters([movie("a")], {
        format: "movie",
        length: { format: "series", category: "one-season" },
        limit: 1,
      }),
    ).toThrow("length must match the selected format");
  });
});
