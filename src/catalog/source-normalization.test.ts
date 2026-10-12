import { describe, expect, it, vi } from "vitest";
import { createTmdbClient, TmdbError } from "../tmdb/client";
import { createFakeSource, fakeMovie } from "./__fixtures__/fake-source";
import { ingestCatalog, type IngestOptions } from "./ingest";
import { SourceRecordSkippedError } from "./source-normalization";
import { movieRows, seriesRows, type CatalogStore } from "./store";

const AT = new Date("2026-10-01T00:00:00Z");
const movie = {
  id: 1,
  title: "Movie",
  status: "Released",
  release_date: "2020-01-01",
};
const series = {
  id: 2,
  name: "Series",
  status: "Ended",
  first_air_date: "2020-01-01",
};

function clientFor(raw: unknown) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(raw), {
        headers: { "content-type": "application/json" },
      }),
  );
  const client = createTmdbClient({
    apiKey: "fixture-key",
    fetch,
    minIntervalMs: 0,
  });
  return { client, fetch };
}

describe("raw TMDB detail to catalog rows", () => {
  it("uses canonical fallback text, null dates/images/runtime and retains internal provenance", async () => {
    const { client } = clientFor({
      ...movie,
      title: "  ",
      original_title: "  Cafe\u0301\u200B  Film  ",
      release_date: "2025-02-29",
      poster_path: "https://example.com/poster.jpg",
      backdrop_path: "/backdrop.jpg",
      runtime: 0,
      status: "New Status",
    });
    const detail = await client.getMovie(1);
    const rows = movieRows(detail, AT);
    expect(rows.title).toMatchObject({
      title: "Café Film",
      releaseDate: null,
      posterPath: null,
    });
    expect(rows.movie.runtimeMinutes).toBeNull();
    expect(detail.normalization).toMatchObject({
      status: "unknown",
      backdropPath: "/backdrop.jpg",
      provenance: { source: "tmdb", sourceStatus: "New Status" },
    });
    expect(detail.normalization?.notes).toEqual(
      expect.arrayContaining([
        "title_from_original",
        "release_date_invalid",
        "poster_path_invalid",
        "status_unknown",
      ]),
    );
  });

  it("stores the canonical runtime median and status rather than the first raw value", async () => {
    const { client } = clientFor({
      ...series,
      status: "Returning Series",
      episode_run_time: [0, 60, 20, 40],
      seasons: [
        { season_number: 0, episode_count: 2 },
        { season_number: 1, episode_count: null },
      ],
    });
    const detail = await client.getSeries(2);
    const rows = seriesRows(detail, AT);
    expect(rows.series).toMatchObject({
      status: "returning",
      episodeRuntimeMinutes: 40,
      seasonCount: 1,
    });
    expect(rows.seasons[1]?.episodeCount).toBeNull();
    expect(detail.normalization?.provenance.sourceStatus).toBe(
      "Returning Series",
    );
  });

  it.each([{ runtimes: [] }, { runtimes: [0] }])(
    "uses last-episode fallback with runtime list $runtimes",
    async ({ runtimes }) => {
      const { client } = clientFor({
        ...series,
        episode_run_time: runtimes,
        last_episode_to_air: { runtime: 44 },
      });
      const detail = await client.getSeries(2);
      expect(seriesRows(detail, AT).series.episodeRuntimeMinutes).toBe(44);
      expect(detail.normalization?.notes).toContain(
        "episode_runtime_from_last_episode",
      );
    },
  );

  it.each([undefined, null, "invalid"])(
    "preserves an unknown season count for %j",
    async (seasons) => {
      const { client } = clientFor({ ...series, seasons });
      const detail = await client.getSeries(2);
      expect(detail.normalization?.seasonCount).toBeNull();
      expect(seriesRows(detail, AT).series.seasonCount).toBeNull();
      expect(seriesRows(detail, AT).series.episodeRuntimeMinutes).toBeNull();
    },
  );

  it("keeps an explicitly empty season list as zero", async () => {
    const { client } = clientFor({ ...series, seasons: [] });
    expect(seriesRows(await client.getSeries(2), AT).series.seasonCount).toBe(
      0,
    );
  });

  it.each([
    "Rumored",
    "Planned",
    "In Production",
    "Post Production",
    "Canceled",
  ])("skips explicitly ineligible movie status %s", async (status) => {
    const { client, fetch } = clientFor({ ...movie, status });
    await expect(client.getMovie(1)).rejects.toMatchObject({
      reason: "ineligible_status",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["Planned", "In Production", "Pilot"])(
    "skips explicitly ineligible series status %s",
    async (status) => {
      const { client } = clientFor({ ...series, status });
      await expect(client.getSeries(2)).rejects.toMatchObject({
        reason: "ineligible_status",
      });
    },
  );

  it.each([
    ["Ended", "ended"],
    ["Returning Series", "returning"],
    ["Canceled", "canceled"],
    ["Novel Status", "unknown"],
  ])(
    "retains potentially watchable series %s with canonical %s",
    async (status, canonical) => {
      const { client } = clientFor({ ...series, status });
      const detail = await client.getSeries(2);
      expect(seriesRows(detail, AT).series.status).toBe(canonical);
      expect(detail.normalization?.provenance.sourceStatus).toBe(status);
    },
  );

  it.each(["movie", "series"] as const)(
    "rejects adult %s detail without retrying",
    async (kind) => {
      const { client, fetch } = clientFor({
        ...(kind === "movie" ? movie : series),
        adult: true,
      });
      const read = kind === "movie" ? client.getMovie(1) : client.getSeries(2);
      await expect(read).rejects.toBeInstanceOf(SourceRecordSkippedError);
      await expect(read).rejects.toMatchObject({ reason: "adult" });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps malformed envelopes distinct from record-level exclusions", async () => {
    const { client } = clientFor(null);
    await expect(client.getMovie(1)).rejects.toBeInstanceOf(TmdbError);
    await expect(client.getMovie(1)).rejects.toMatchObject({
      code: "malformed",
    });
  });

  it("reports exact skips and actual writes without exhausting the provider failure budget", async () => {
    const raw = new Map<number, Record<string, unknown>>([
      [1, { ...movie, id: 1, adult: true }],
      [2, { ...movie, id: 2, title: "", original_title: "" }],
      [3, { ...movie, id: 3, status: "Planned" }],
      [4, { ...movie, id: 4, title: "  Canonical\u200B  Movie ", runtime: 98 }],
    ]);
    const client = createTmdbClient({
      apiKey: "fixture-key",
      minIntervalMs: 0,
      fetch: vi.fn(
        async (url) =>
          new Response(
            JSON.stringify(
              raw.get(Number(new URL(String(url)).pathname.split("/").at(-1))),
            ),
          ),
      ),
    });
    const fake = createFakeSource({
      movies: [1, 2, 3, 4].map((id) => fakeMovie(id)),
    });
    const stored: ReturnType<typeof movieRows>[] = [];
    const saveMovie = vi.fn(
      async (detail: Awaited<ReturnType<typeof client.getMovie>>, at: Date) => {
        stored.push(movieRows(detail, at));
        return "inserted" as const;
      },
    );
    const saveSeries = vi.fn(async () => "inserted" as const);
    const store: CatalogStore = {
      recentlyFetched: async () => new Set(),
      saveMovie,
      saveSeries,
      stats: async () => ({
        movies: stored.length,
        series: 0,
        seasons: 0,
        genres: 0,
        keywords: 0,
        oldestFetchedAt: null,
        newestFetchedAt: null,
      }),
    };
    const options: IngestOptions = {
      movies: 4,
      series: 0,
      maxAgeDays: 1,
      concurrency: 2,
      minVotes: { movie: 0, series: 0 },
      fromYear: 2020,
      toYear: 2020,
      maxFailureRate: 0,
      minAttemptsBeforeAbort: 1,
      now: () => AT,
    };
    const report = await ingestCatalog(
      { ...fake.source, getMovie: client.getMovie },
      store,
      options,
    );
    expect(report).toMatchObject({
      status: "completed",
      movies: {
        target: 4,
        attempted: 4,
        inserted: 1,
        updated: 0,
        skipped: { adult: 1, missing_title: 1, ineligible_status: 1 },
        skippedSamples: [
          { tmdbId: 1, reason: "adult" },
          { tmdbId: 2, reason: "missing_title" },
          { tmdbId: 3, reason: "ineligible_status" },
        ],
        failed: {},
      },
      catalog: { movies: 1 },
    });
    expect(saveMovie).toHaveBeenCalledTimes(1);
    expect(saveSeries).not.toHaveBeenCalled();
    expect(stored[0]).toMatchObject({
      title: { tmdbId: 4, title: "Canonical Movie" },
      movie: { runtimeMinutes: 98 },
    });
  });
});
