// Ingestion against real Postgres (npm run test:db). Uses its own id range
// (>= 9,000,000) for titles, genres and keywords and cleans up only that range,
// so it never touches other rows in a developer's database.
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "../db/database-url";
import * as schema from "../db/schema";
import type { MovieDetails, SeriesDetails } from "../tmdb/schema";
import {
  createFakeSource,
  fakeMovie,
  fakeSeries,
} from "./__fixtures__/fake-source";
import { ingestCatalog, type IngestOptions } from "./ingest";
import { createCatalogStore, type CatalogStore } from "./store";

const root = path.resolve(__dirname, "../..");
const BASE = 9_000_000;
const T0 = new Date("2026-09-29T00:00:00Z");

let sql: postgres.Sql;
let connected = false;
let store: CatalogStore;

// Test-range ids for titles, genres and keywords.
const movie = (n: number, o: Partial<MovieDetails> = {}) =>
  fakeMovie(BASE + n, {
    genres: [{ id: BASE + 1, name: "Test Drama" }],
    keywords: [{ id: BASE + 100 + (n % 3), name: `test-kw-${n % 3}` }],
    voteCount: 1000 - n,
    ...o,
  });
const show = (n: number, o: Partial<SeriesDetails> = {}) =>
  fakeSeries(BASE + n, {
    genres: [{ id: BASE + 2, name: "Test Crime" }],
    keywords: [{ id: BASE + 200, name: "test-family" }],
    voteCount: 500 - n,
    ...o,
  });

async function cleanup() {
  await sql`delete from titles where tmdb_id >= ${BASE}`;
  await sql`delete from genres where id >= ${BASE}`;
  await sql`delete from keywords where id >= ${BASE}`;
}

async function titleRow(kind: "movie" | "series", tmdbId: number) {
  const [row] = await sql<{ id: string; title: string }[]>`
    select id, title from titles where kind = ${kind} and tmdb_id = ${tmdbId}`;
  return row ? { id: Number(row.id), title: row.title } : undefined;
}

async function testRangeCounts() {
  const [row] = await sql<Record<string, number>[]>`
    select
      (select count(*)::int from titles where tmdb_id >= ${BASE}) as titles,
      (select count(*)::int from seasons s join titles t on t.id = s.series_id
         where t.tmdb_id >= ${BASE}) as seasons,
      (select count(*)::int from title_genres where genre_id >= ${BASE}) as genre_links,
      (select count(*)::int from title_keywords where keyword_id >= ${BASE}) as keyword_links,
      (select count(*)::int from genres where id >= ${BASE}) as genres,
      (select count(*)::int from keywords where id >= ${BASE}) as keywords`;
  return row!;
}

beforeAll(async () => {
  sql = postgres(resolveDatabaseUrl({ cwd: root }), {
    max: 10,
    onnotice: () => {},
  });
  await migrate(drizzle(sql), { migrationsFolder: path.join(root, "drizzle") });
  connected = true;
  store = createCatalogStore(drizzle(sql, { schema }));
});

beforeEach(cleanup);

afterAll(async () => {
  if (!connected) return;
  await cleanup();
  await sql.end();
});

describe("catalog store (Postgres)", () => {
  it("upserts a movie and replaces its genre and keyword links", async () => {
    expect(await store.saveMovie(movie(1, { runtime: 0 }), T0)).toBe(
      "inserted",
    );
    const first = await titleRow("movie", BASE + 1);
    const [m] =
      await sql`select runtime_minutes from movies where title_id = ${first!.id}`;
    expect(m!.runtime_minutes).toBeNull(); // TMDB's 0 runtime stored as unknown

    const changed = movie(1, {
      title: "Renamed",
      genres: [{ id: BASE + 3, name: "Test Comedy" }],
      keywords: [],
    });
    expect(await store.saveMovie(changed, T0)).toBe("updated");

    const second = await titleRow("movie", BASE + 1);
    expect(second).toEqual({ id: first!.id, title: "Renamed" }); // same row
    const links = await sql`
      select genre_id from title_genres where title_id = ${first!.id}`;
    expect(links.map((l) => Number(l.genre_id))).toEqual([BASE + 3]);
    const kws =
      await sql`select 1 from title_keywords where title_id = ${first!.id}`;
    expect(kws).toHaveLength(0);
  });

  it("upserts seasons, removes ones TMDB dropped, and keeps season_count", async () => {
    await store.saveSeries(show(1), T0);
    const { id } = (await titleRow("series", BASE + 1))!;
    const before = await sql`
      select season_number from seasons where series_id = ${id} order by 1`;
    expect(before.map((s) => s.season_number)).toEqual([0, 1, 2]);

    const base = show(1);
    await store.saveSeries(
      { ...base, seasons: base.seasons.filter((s) => s.seasonNumber !== 2) },
      T0,
    );
    const after = await sql`
      select season_number from seasons where series_id = ${id} order by 1`;
    expect(after.map((s) => s.season_number)).toEqual([0, 1]);
    const [s] =
      await sql`select season_count from series where title_id = ${id}`;
    expect(s!.season_count).toBe(1);
  });

  it("reports recently fetched ids per kind", async () => {
    await store.saveMovie(movie(1), T0);
    await store.saveMovie(movie(2), new Date(T0.getTime() - 10 * 86_400_000));
    await store.saveSeries(show(1), T0);
    const fresh = await store.recentlyFetched(
      "movie",
      new Date(T0.getTime() - 86_400_000),
    );
    expect([...fresh].filter((id) => id >= BASE)).toEqual([BASE + 1]);
  });
});

describe("ingestCatalog (Postgres)", () => {
  const options = (
    now: Date,
    o: Partial<IngestOptions> = {},
  ): IngestOptions => ({
    movies: 30,
    series: 5,
    maxAgeDays: 7,
    concurrency: 8,
    minVotes: { movie: 0, series: 0 },
    fromYear: 2019,
    toYear: 2020,
    maxFailureRate: 0.05,
    minAttemptsBeforeAbort: 10,
    now: () => now,
    ...o,
  });

  it("is idempotent and resumable across runs, with concurrent writers", async () => {
    // Shared genres/keywords across 30 concurrent saves exercise lock ordering.
    const { source, calls } = createFakeSource({
      movies: Array.from({ length: 30 }, (_, i) =>
        movie(i + 1, {
          genres: [
            { id: BASE + 1, name: "Test Drama" },
            { id: BASE + 3, name: "Test Comedy" },
          ].slice(i % 2),
          keywords: [
            { id: BASE + 101, name: "test-kw-1" },
            { id: BASE + 100, name: "test-kw-0" },
          ],
        }),
      ),
      series: Array.from({ length: 5 }, (_, i) => show(i + 1)),
      pageSize: 7,
    });

    const first = await ingestCatalog(source, store, options(T0));
    expect(first.status).toBe("completed");
    expect(first.movies).toMatchObject({
      candidates: 30,
      inserted: 30,
      failed: {},
    });
    expect(first.series).toMatchObject({
      candidates: 5,
      inserted: 5,
      failed: {},
    });
    const countsAfterFirst = await testRangeCounts();
    expect(countsAfterFirst).toMatchObject({
      titles: 35,
      seasons: 15,
      genres: 3,
      keywords: 3,
    });

    // Resume: everything is fresh, so no detail requests and no writes.
    calls.details.length = 0;
    const second = await ingestCatalog(source, store, options(T0));
    expect(second.movies).toMatchObject({ skippedFresh: 30, attempted: 0 });
    expect(calls.details).toEqual([]);

    // Refresh after maxAgeDays: every title is re-fetched and updated in place.
    const later = new Date(T0.getTime() + 8 * 86_400_000);
    const third = await ingestCatalog(source, store, options(later));
    expect(third.movies).toMatchObject({ updated: 30, inserted: 0 });
    expect(third.series).toMatchObject({ updated: 5, inserted: 0 });
    expect(await testRangeCounts()).toEqual(countsAfterFirst);
    expect(third.catalog.newestFetchedAt?.toISOString()).toBe(
      later.toISOString(),
    );
  });
});
