import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LIMITS,
  NormalizationFatalError,
  canonicalLine,
  canonicalParagraphs,
  normalizeBatch,
  normalizeMovie,
  normalizeSeason,
  normalizeSeries,
  type NormalizedMovie,
  type NormalizedSeries,
} from "./normalize";

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      path.join(__dirname, "__fixtures__/normalize", `${name}.json`),
      "utf8",
    ),
  );

function movie(name: string): NormalizedMovie {
  const result = normalizeMovie(fixture(name));
  if (!result.ok)
    throw new Error(`expected ${name} to normalize, got ${result.reason}`);
  return result.record;
}

function series(name: string): NormalizedSeries {
  const result = normalizeSeries(fixture(name));
  if (!result.ok)
    throw new Error(`expected ${name} to normalize, got ${result.reason}`);
  return result.record;
}

describe("normalizeMovie", () => {
  it("normalizes a complete record with no lossy notes", () => {
    expect(movie("movie-full")).toEqual({
      kind: "movie",
      tmdbId: 550,
      title: "Fight Club",
      originalTitle: "Fight Club",
      displayLanguage: "en",
      originalLanguage: "en",
      overview:
        "A ticking-time-bomb insomniac and a slippery soap salesman channel primal male aggression into a shocking new form of therapy.",
      releaseDate: "1999-10-15",
      releaseYear: 1999,
      genres: [
        { id: 18, name: "Drama" },
        { id: 53, name: "Thriller" },
      ],
      keywords: [
        { id: 825, name: "support group" },
        { id: 4565, name: "dual identity" },
      ],
      popularity: 61.416,
      voteAverage: 8.4,
      voteCount: 30000,
      posterPath: "/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
      backdropPath: "/hZkgoQYus5vegHoetLkCJzb17zJ.jpg",
      status: "released",
      runtimeMinutes: 139,
      imdbId: "tt0137523",
      provenance: { source: "tmdb", sourceStatus: "Released" },
      notes: [],
    });
  });

  it("fills a blank title from the original title and treats empty values as unknown", () => {
    const m = movie("movie-missing");
    expect(m).toMatchObject({
      title: "La Haine",
      originalTitle: "La Haine",
      overview: null,
      releaseDate: null,
      releaseYear: null,
      runtimeMinutes: null, // TMDB uses 0 for "unknown"
      genres: [],
      status: "unknown",
    });
    expect(m.notes).toEqual(["status_missing", "title_from_original"]);
  });

  it("nulls malformed and unsafe values, noting each loss", () => {
    const m = movie("movie-malformed");
    expect(m).toMatchObject({
      originalLanguage: null,
      releaseDate: null,
      runtimeMinutes: null,
      voteAverage: null,
      voteCount: null,
      popularity: null,
      imdbId: null,
      posterPath: null, // full URL on a foreign host
      backdropPath: null, // path traversal
      genres: [{ id: 18, name: "Drama" }],
      keywords: [],
      status: "unknown",
      provenance: { source: "tmdb", sourceStatus: "Released Soon" },
    });
    expect(m.notes).toEqual([
      "backdrop_path_invalid",
      "genre_dropped",
      "imdb_id_invalid",
      "keywords_invalid",
      "original_language_invalid",
      "popularity_invalid",
      "poster_path_invalid",
      "release_date_invalid",
      "runtime_invalid",
      "status_unknown",
      "vote_average_invalid",
      "vote_count_invalid",
    ]);
  });

  it("canonicalizes Unicode and whitespace without changing meaning", () => {
    const m = movie("movie-unicode");
    expect(m.title).toBe("Amélie Poulain"); // NFC, NBSP -> space, ZWSP removed
    expect(m.title.normalize("NFC")).toBe(m.title);
    expect(m.originalTitle).toBe("Le Fabuleux Destin d’Amélie Poulain");
    expect(m.originalLanguage).toBe("fr");
    expect(m.overview).toBe("Line one.\n\nLine two has tabs. Third line.");
    expect(m.runtimeMinutes).toBe(122);
    expect(m.genres).toEqual([
      { id: 35, name: "Comédie" },
      { id: 10749, name: "Romance" },
    ]);
    // Emoji ZWJ sequences and non-Latin scripts survive unchanged.
    expect(m.keywords).toEqual([
      { id: 1, name: "family 👨\u200D👩\u200D👧" },
      { id: 2, name: "नमस्ते" },
    ]);
    expect(m.notes).toEqual(["runtime_rounded"]);
  });

  it("degrades gracefully when source fields change type or shape", () => {
    const m = movie("movie-changed");
    expect(m).toMatchObject({
      title: "Schema Drift",
      originalTitle: null,
      overview: null,
      releaseDate: null,
      runtimeMinutes: null,
      voteAverage: null,
      genres: [],
      keywords: [],
      status: "unknown",
    });
    expect(m.notes).toEqual([
      "genres_invalid",
      "original_title_invalid",
      "overview_invalid",
      "release_date_invalid",
      "runtime_invalid",
      "status_missing",
      "vote_average_invalid",
    ]);
  });

  it.each([
    ["adult", fixture("movie-adult"), "adult", 1004],
    [
      "no title at all",
      { id: 5, title: "", original_title: "  " },
      "missing_title",
      5,
    ],
    ["invalid id", { id: -1, title: "X" }, "invalid_id", null],
    ["string id", { id: "550", title: "X" }, "invalid_id", null],
    ["non-object", "Fight Club", "not_an_object", null],
    [
      "overlong title",
      { id: 6, title: "x".repeat(LIMITS.titleLength + 1) },
      "title_too_long",
      6,
    ],
  ])("skips records that can't be used (%s)", (_name, raw, reason, tmdbId) => {
    expect(normalizeMovie(raw)).toEqual({
      ok: false,
      severity: "skip",
      reason,
      tmdbId,
    });
  });

  it("validates calendar dates without timezone math", () => {
    const date = (release_date: string) =>
      normalizeMovie({ id: 1, title: "X", release_date }).ok &&
      (
        normalizeMovie({ id: 1, title: "X", release_date }) as {
          record: NormalizedMovie;
        }
      ).record.releaseDate;
    expect(date("2024-02-29")).toBe("2024-02-29"); // leap year
    expect(date("2023-02-29")).toBeNull();
    expect(date("1900-02-29")).toBeNull(); // century, not leap
    expect(date("2000-02-29")).toBe("2000-02-29");
    expect(date("2020-13-01")).toBeNull();
    expect(date("1850-01-01")).toBeNull(); // before LIMITS.minYear
    expect(date("2020-1-01")).toBeNull();
  });

  it("drops overviews beyond the length bound instead of truncating meaning", () => {
    const m = normalizeMovie({
      id: 1,
      title: "X",
      overview: "a".repeat(LIMITS.overviewLength + 1),
    });
    expect(m.ok && m.record.overview).toBeNull();
    expect(m.ok && m.record.notes).toEqual([
      "overview_too_long",
      "status_missing",
    ]);
  });
});

describe("normalizeSeries", () => {
  it("normalizes seasons, specials and the episode runtime median", () => {
    const s = series("series-full");
    expect(s).toMatchObject({
      kind: "series",
      tmdbId: 1396,
      title: "Breaking Bad",
      releaseDate: "2008-01-20",
      releaseYear: 2008,
      lastAirDate: "2013-09-29",
      status: "ended",
      episodeRuntimeMinutes: 50,
      seasonCount: 2,
      keywords: [
        { id: 1646, name: "drug dealer" },
        { id: 15484, name: "chemistry" },
      ],
      notes: [],
    });
    expect(
      s.seasons.map((x) => [
        x.seasonNumber,
        x.isSpecials,
        x.episodeCount,
        x.overview,
      ]),
    ).toEqual([
      [0, true, 9, null],
      [1, false, 7, "The pilot season."],
      [2, false, 13, null],
    ]);
  });

  it("dedupes taxonomy and seasons, falls back for runtime, and drops bad seasons", () => {
    const s = series("series-duplicates");
    expect(s.genres).toEqual([
      { id: 18, name: "Drama" },
      { id: 9648, name: "Mystery" },
    ]);
    expect(s.keywords).toEqual([{ id: 7, name: "twins" }]);
    expect(s.episodeRuntimeMinutes).toBe(42);
    expect(s.status).toBe("returning");
    expect(
      s.seasons.map((x) => [x.seasonNumber, x.name, x.episodeCount]),
    ).toEqual([
      [1, "Season 1", 8], // first occurrence wins
      [2, "Season 2", null], // non-numeric episode count
    ]);
    expect(s.seasonCount).toBe(2);
    expect(s.notes).toEqual([
      "duplicate_season",
      "duplicate_term",
      "episode_runtime_from_last_episode",
      "season_dropped",
      "season_field_invalid",
    ]);
  });

  it("takes the lower median for an even number of episode runtimes", () => {
    const r = normalizeSeries({
      id: 1,
      name: "X",
      episode_run_time: [60, 30, 45, 50],
    });
    expect(r.ok && r.record.episodeRuntimeMinutes).toBe(45);
  });
});

describe("normalizeSeason", () => {
  it("normalizes a season detail payload, counting episodes", () => {
    expect(normalizeSeason(fixture("season-detail"))).toEqual({
      ok: true,
      notes: [],
      record: {
        seasonNumber: 1,
        isSpecials: false,
        name: "Season 1",
        overview: "Walter White begins.",
        airDate: "2008-01-20",
        episodeCount: 3,
        posterPath: "/1BP4xYv9ZG4ZVHkL7ocOziBbSYH.jpg",
      },
    });
    expect(normalizeSeason({ season_number: "1" })).toEqual({
      ok: false,
      severity: "skip",
      reason: "invalid_id",
    });
  });
});

describe("normalizeBatch", () => {
  it("skips bad records by index and returns records sorted by tmdbId", () => {
    const result = normalizeBatch(
      [
        fixture("movie-unicode"),
        fixture("movie-adult"),
        null,
        fixture("movie-full"),
      ],
      normalizeMovie,
    );
    expect(result.records.map((r) => r.tmdbId)).toEqual([550, 1003]);
    expect(result.skipped).toEqual([
      { index: 1, reason: "adult", tmdbId: 1004 },
      { index: 2, reason: "not_an_object", tmdbId: null },
    ]);
  });

  it("fails the whole batch only for batch-level structure problems", () => {
    expect(() => normalizeBatch({ results: [] }, normalizeMovie)).toThrow(
      NormalizationFatalError,
    );
    expect(() =>
      normalizeBatch(new Array(LIMITS.batchSize + 1).fill({}), normalizeMovie),
    ).toThrow(/batch_too_large/);
  });

  it("never echoes source values in skips or errors", () => {
    const secretish = "sk-live-VALUE-SHOULD-NOT-LEAK";
    const result = normalizeBatch(
      [
        { id: secretish, title: secretish },
        { id: 9, adult: true, title: secretish },
      ],
      normalizeMovie,
    );
    expect(JSON.stringify(result)).not.toContain(secretish);
    try {
      normalizeBatch(secretish, normalizeMovie);
    } catch (error) {
      expect(String(error)).not.toContain(secretish);
    }
  });
});

describe("determinism", () => {
  /** Deterministically reorders object keys at every level. */
  function shuffleKeys(value: unknown, seed = 1): unknown {
    if (Array.isArray(value)) return value.map((v) => shuffleKeys(v, seed));
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      entries.sort(
        (a, b) =>
          ((a[0].length * 31 + seed) % 7) - ((b[0].length * 31 + seed) % 7) ||
          (a[0] < b[0] ? 1 : -1),
      );
      return Object.fromEntries(
        entries.map(([k, v]) => [k, shuffleKeys(v, seed + 1)]),
      );
    }
    return value;
  }

  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it.each([
    "movie-full",
    "movie-malformed",
    "movie-unicode",
    "series-full",
    "series-duplicates",
  ])("%s: same output for reordered keys and any timezone", (name) => {
    const normalize = name.startsWith("series")
      ? normalizeSeries
      : normalizeMovie;
    const baseline = JSON.stringify(normalize(fixture(name)));

    expect(JSON.stringify(normalize(shuffleKeys(fixture(name))))).toBe(
      baseline,
    );
    for (const tz of ["Pacific/Kiritimati", "America/Adak", "Asia/Kathmandu"]) {
      process.env.TZ = tz;
      expect(JSON.stringify(normalize(fixture(name)))).toBe(baseline);
    }
  });

  it("reordered taxonomy and seasons produce identical records", () => {
    const raw = fixture("series-full");
    const reversed = {
      ...raw,
      genres: [...(raw.genres as unknown[])].reverse(),
      seasons: [...(raw.seasons as unknown[])].reverse(),
    };
    expect(normalizeSeries(reversed)).toEqual(normalizeSeries(raw));
  });
});

describe("text canonicalization", () => {
  it("keeps joiners that carry meaning and removes invisible filler", () => {
    expect(canonicalLine("a\u200Bb")).toBe("ab"); // zero-width space
    expect(canonicalLine("می\u200Cخواهم")).toBe("می\u200Cخواهم"); // ZWNJ (Persian)
    expect(canonicalLine("👩\u200D💻")).toBe("👩\u200D💻"); // ZWJ emoji
    expect(canonicalLine(" a  b ")).toBe("a b");
    expect(canonicalParagraphs("a\n\n\n\nb\n c ")).toBe("a\n\nb\nc");
  });
});
