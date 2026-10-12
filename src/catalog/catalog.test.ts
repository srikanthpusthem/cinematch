import { describe, expect, it } from "vitest";
import { TmdbError } from "../tmdb/client";
import {
  createFakeSource,
  fakeMovie,
  fakeSeries,
} from "./__fixtures__/fake-source";
import { discoverCandidates, discoverPartitions } from "./discover";
import {
  IngestAbortedError,
  ingestCatalog,
  type IngestOptions,
} from "./ingest";
import {
  cleanTerms,
  movieRows,
  seriesRows,
  type CatalogStats,
  type CatalogStore,
  type TitleKind,
} from "./store";

const FETCHED_AT = new Date("2026-09-29T00:00:00Z");

describe("discoverPartitions", () => {
  it("queries one year at a time plus an 'older' bucket, newest first", () => {
    const parts = discoverPartitions({
      kind: "movie",
      minVotes: 50,
      fromYear: 2024,
      toYear: 2026,
    });
    expect(
      parts.map((p) => p.primary_release_year ?? p["primary_release_date.lte"]),
    ).toEqual([2026, 2025, 2024, "2023-12-31"]);
    expect(parts[0]).toMatchObject({
      sort_by: "vote_count.desc",
      include_adult: false,
      "vote_count.gte": 50,
    });
  });

  it("uses first-air-date parameters for series", () => {
    const parts = discoverPartitions({
      kind: "series",
      minVotes: 20,
      fromYear: 2026,
      toYear: 2026,
    });
    expect(parts).toEqual([
      expect.objectContaining({ first_air_date_year: 2026 }),
      expect.objectContaining({ "first_air_date.lte": "2025-12-31" }),
    ]);
  });
});

describe("discoverCandidates", () => {
  it("merges partitions, dedupes, ranks by votes and cuts to the target", async () => {
    const { source } = createFakeSource({
      movies: [
        fakeMovie(1, { releaseDate: "2026-01-01", voteCount: 300 }),
        fakeMovie(2, { releaseDate: "2025-05-01", voteCount: 900 }),
        fakeMovie(3, { releaseDate: "1990-01-01", voteCount: 600 }),
        fakeMovie(4, { releaseDate: "2025-02-01", voteCount: 10 }), // under minVotes
        fakeMovie(5, { releaseDate: "2024-01-01", voteCount: 600 }),
      ],
    });
    const candidates = await discoverCandidates(source, {
      kind: "movie",
      target: 3,
      minVotes: 50,
      fromYear: 2024,
      toYear: 2026,
    });
    // 3 and 5 tie on votes; lower tmdb id first.
    expect(candidates.map((c) => c.tmdbId)).toEqual([2, 3, 5]);
  });
});

describe("row mapping", () => {
  it("nulls values the schema would reject instead of failing the title", () => {
    const rows = movieRows(
      fakeMovie(1, {
        runtime: 0,
        imdbId: "",
        voteAverage: 11,
        popularity: -1,
        title: "  Heat  ",
      }),
      FETCHED_AT,
    );
    expect(rows.title).toMatchObject({
      title: "Heat",
      voteAverage: null,
      popularity: null,
    });
    expect(rows.movie).toEqual({ runtimeMinutes: null, imdbId: null });
  });

  it("counts regular seasons only and dedupes repeated season numbers", () => {
    const base = fakeSeries(1);
    const rows = seriesRows(
      {
        ...base,
        seasons: [...base.seasons, { ...base.seasons[1]!, name: "dupe" }],
        episodeRunTimes: [],
      },
      FETCHED_AT,
    );
    expect(rows.series.seasonCount).toBe(2);
    expect(rows.series.episodeRuntimeMinutes).toBeNull();
    expect(rows.seasons.map((s) => [s.seasonNumber, s.name])).toEqual([
      [0, "Specials"],
      [1, "Season 1"],
      [2, "Season 2"],
    ]);
  });

  it("cleans genre/keyword lists and sorts them for a stable lock order", () => {
    expect(
      cleanTerms([
        { id: 9, name: "b" },
        { id: 3, name: " a " },
        { id: 9, name: "dupe" },
        { id: 4, name: "  " },
        { id: 0, name: "zero" },
      ]),
    ).toEqual([
      { id: 3, name: "a" },
      { id: 9, name: "b" },
    ]);
  });
});

/** In-memory store with the same resume semantics as the database store. */
function memoryStore() {
  const saved = new Map<string, Date>();
  const key = (kind: TitleKind, id: number) => `${kind}:${id}`;
  const save = (kind: TitleKind, id: number, at: Date) => {
    const existed = saved.has(key(kind, id));
    saved.set(key(kind, id), at);
    return Promise.resolve(
      existed ? ("updated" as const) : ("inserted" as const),
    );
  };
  const store: CatalogStore = {
    recentlyFetched: (kind, since) =>
      Promise.resolve(
        new Set(
          [...saved]
            .filter(([k, at]) => k.startsWith(`${kind}:`) && at >= since)
            .map(([k]) => Number(k.split(":")[1])),
        ),
      ),
    saveMovie: (d, at) => save("movie", d.id, at),
    saveSeries: (d, at) => save("series", d.id, at),
    stats: (): Promise<CatalogStats> =>
      Promise.resolve({
        movies: [...saved.keys()].filter((k) => k.startsWith("movie:")).length,
        series: [...saved.keys()].filter((k) => k.startsWith("series:")).length,
        seasons: 0,
        genres: 0,
        keywords: 0,
        oldestFetchedAt: null,
        newestFetchedAt: null,
      }),
  };
  return { store, saved };
}

const options = (overrides: Partial<IngestOptions> = {}): IngestOptions => ({
  movies: 4,
  series: 2,
  maxAgeDays: 7,
  concurrency: 3,
  minVotes: { movie: 0, series: 0 },
  fromYear: 2019,
  toYear: 2020,
  maxFailureRate: 0.5,
  minAttemptsBeforeAbort: 2,
  now: () => FETCHED_AT,
  ...overrides,
});

describe("ingestCatalog", () => {
  it("ingests up to the targets and reports counts", async () => {
    const { source } = createFakeSource({
      movies: [1, 2, 3, 4, 5].map((id) => fakeMovie(id)),
      series: [1, 2, 3].map((id) => fakeSeries(id)),
    });
    const { store } = memoryStore();
    const report = await ingestCatalog(source, store, options());

    expect(report.status).toBe("completed");
    expect(report.movies).toMatchObject({
      target: 4,
      candidates: 4,
      inserted: 4,
      updated: 0,
    });
    expect(report.series).toMatchObject({
      target: 2,
      candidates: 2,
      inserted: 2,
    });
    expect(report.catalog).toMatchObject({ movies: 4, series: 2 });
  });

  it("resumes: a re-run skips titles fetched within maxAgeDays", async () => {
    const { source, calls } = createFakeSource({
      movies: [1, 2, 3].map((id) => fakeMovie(id)),
    });
    const { store } = memoryStore();
    await ingestCatalog(source, store, options({ series: 0 }));
    calls.details.length = 0;

    const again = await ingestCatalog(source, store, options({ series: 0 }));
    expect(again.movies).toMatchObject({
      candidates: 3,
      skippedFresh: 3,
      attempted: 0,
    });
    expect(calls.details).toEqual([]);

    const later = new Date(FETCHED_AT.getTime() + 8 * 86_400_000);
    const refresh = await ingestCatalog(
      source,
      store,
      options({ series: 0, now: () => later }),
    );
    expect(refresh.movies).toMatchObject({ skippedFresh: 0, updated: 3 });
  });

  it("skips titles TMDB no longer serves and counts other failures", async () => {
    const { source } = createFakeSource({
      movies: [1, 2, 3, 4, 5, 6].map((id) => fakeMovie(id)),
      failures: new Map<number, TmdbError["code"]>([
        [2, "not_found"],
        [3, "malformed"],
      ]),
    });
    const { store } = memoryStore();
    const report = await ingestCatalog(
      source,
      store,
      options({ movies: 6, series: 0 }),
    );
    expect(report.movies).toMatchObject({
      inserted: 4,
      notFound: 1,
      failed: { malformed: 1 },
    });
  });

  it("aborts with a partial report when the failure rate is too high", async () => {
    const ids = [1, 2, 3, 4, 5, 6];
    const { source } = createFakeSource({
      movies: ids.map((id) => fakeMovie(id)),
      failures: new Map(ids.slice(0, 4).map((id) => [id, "server" as const])),
    });
    const { store } = memoryStore();
    const error = await ingestCatalog(
      source,
      store,
      options({
        movies: 6,
        series: 2,
        concurrency: 1,
        maxFailureRate: 0.5,
        minAttemptsBeforeAbort: 3,
      }),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IngestAbortedError);
    const { report } = error as IngestAbortedError;
    expect(report.status).toBe("aborted");
    expect(report.abortReason).toMatch(/movie failure rate 3\/3/);
    expect(report.series.attempted).toBe(0); // stopped before series
  });

  it("aborts immediately on an invalid API key", async () => {
    const { source } = createFakeSource({
      movies: [1, 2, 3].map((id) => fakeMovie(id)),
      failures: new Map([[1, "unauthorized" as const]]),
    });
    const { store } = memoryStore();
    const error = await ingestCatalog(
      source,
      store,
      options({ concurrency: 1, minAttemptsBeforeAbort: 100 }),
    ).catch((e: unknown) => e);
    expect((error as IngestAbortedError).report.abortReason).toMatch(
      /TMDB_API_KEY/,
    );
    expect((error as IngestAbortedError).report.movies.attempted).toBe(1);
  });

  it("never runs more detail requests at once than the concurrency limit", async () => {
    const { source } = createFakeSource({
      movies: [1, 2, 3, 4, 5, 6, 7, 8].map((id) => fakeMovie(id)),
    });
    let active = 0;
    let peak = 0;
    const slowSource = {
      ...source,
      getMovie: async (id: number) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return source.getMovie(id);
      },
    };
    const { store } = memoryStore();
    await ingestCatalog(
      slowSource,
      store,
      options({ movies: 8, series: 0, concurrency: 3 }),
    );
    expect(peak).toBe(3);
  });
});
