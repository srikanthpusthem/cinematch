// Repository-backed search against real Postgres (npm run test:db). Search
// reads the whole catalog, so these run only on a database with no other
// titles (always true in CI); they seed and remove a test id range.
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "../../db/database-url";
import * as schema from "../../db/schema";
import { runSearchBenchmark } from "../search-benchmark/run";
import type { CreateSearch } from "../search-benchmark/types";
import {
  loadEligibleTitleIds,
  loadQuizSeeds,
  loadSearchDocuments,
} from "./repository";
import { createSearchService } from "./service";

const root = path.resolve(__dirname, "../../..");
const BASE = 9_400_000;
const NOW = new Date("2026-10-01T00:00:00Z");

let sql: postgres.Sql;
let db: ReturnType<typeof drizzle<typeof schema>>;
let connected = false;
let foreignTitles = 0;

const cleanup = () => sql`delete from titles where tmdb_id >= ${BASE}`;

async function insert(t: {
  n: number;
  kind?: "movie" | "series";
  title: string;
  originalTitle?: string | null;
  year?: number | null;
  poster?: string | null;
  votes?: number | null;
  checkedHoursAgo?: number | null;
  lifecycle?: "active" | "unavailable" | "tombstoned";
}) {
  const [row] = await sql`
    insert into titles (kind, tmdb_id, title, original_title, release_date, poster_path, vote_count, tmdb_fetched_at)
    values (${t.kind ?? "movie"}, ${BASE + t.n}, ${t.title}, ${t.originalTitle ?? null},
      ${t.year ? `${t.year}-06-01` : null}, ${t.poster === undefined ? "/p.jpg" : t.poster},
      ${t.votes ?? null}, now())
    returning id`;
  const id = Number(row!.id);
  if (t.checkedHoursAgo !== undefined && t.checkedHoursAgo !== null) {
    const at = new Date(
      NOW.getTime() - t.checkedHoursAgo * 3_600_000,
    ).toISOString();
    await sql`insert into title_availability (title_id, fetched_at) values (${id}, ${at})`;
  }
  if (t.lifecycle) {
    const missing = t.lifecycle !== "active";
    const tombstoned = t.lifecycle === "tombstoned";
    const at = NOW.toISOString();
    await sql`insert into title_lifecycle (title_id, status, first_seen_at, last_seen_at,
      last_observed_at, last_observation_run_id, missing_since, consecutive_missing,
      tombstoned_at, tombstone_reason)
      values (${id}, ${t.lifecycle}, ${at}, ${at}, ${at}, 'search-test',
        ${missing ? at : null}, ${missing ? 3 : 0},
        ${tombstoned ? at : null}, ${tombstoned ? "source_deleted" : null})`;
  }
  return id;
}

beforeAll(async () => {
  sql = postgres(resolveDatabaseUrl({ cwd: root }), {
    max: 3,
    onnotice: () => {},
  });
  connected = true;
  await migrate(drizzle(sql), { migrationsFolder: path.join(root, "drizzle") });
  db = drizzle(sql, { schema });
  await cleanup();
  const [row] = await sql`select count(*)::int as n from titles`;
  foreignTitles = row!.n;
});

beforeEach(async (ctx) => {
  if (foreignTitles > 0) ctx.skip(); // search is catalog-wide
  await cleanup();
});

afterAll(async () => {
  if (!connected) return;
  await cleanup();
  await sql.end();
});

/**
 * Seeds the corpus into Postgres and searches through the real repository and
 * service. Adult titles are never ingested. Ineligible corpus titles are
 * seeded as unavailable to exercise the real lifecycle exclusion. The schema
 * has no alternate titles, so those aren't stored.
 */
const repositorySearch: CreateSearch = async (titles) => {
  await cleanup();
  const ids = titles.map((t) => t.id).sort();
  const numberOf = new Map(ids.map((id, i) => [id, i + 1]));
  const idOfTmdb = new Map(ids.map((id, i) => [BASE + i + 1, id]));
  for (const t of titles) {
    if (t.adult) continue;
    await insert({
      n: numberOf.get(t.id)!,
      kind: t.kind,
      title: t.title,
      originalTitle: t.originalTitle,
      year: t.year,
      poster: t.posterPath,
      lifecycle: t.eligible ? undefined : "unavailable",
    });
  }
  const service = createSearchService({
    loadDocuments: () => loadSearchDocuments(db),
    loadEligibleTitleIds: (ids) => loadEligibleTitleIds(db, ids),
    loadQuizSeeds: (o) => loadQuizSeeds(db, o),
    now: () => NOW,
  });
  return async ({ query, kind, limit, cursor }) => {
    const r = await service.search({ q: query, kind, limit, cursor });
    return r.ok
      ? {
          ok: true,
          results: r.results.map((x) => ({ id: idOfTmdb.get(x.tmdbId)! })),
          nextCursor: r.nextCursor,
        }
      : { ok: false, error: "invalid_query" };
  };
};

describe("catalog search (Postgres)", () => {
  it("runs the frozen #71 benchmark through the repository", async () => {
    const report = await runSearchBenchmark(repositorySearch, {
      implementation: "catalog-search-postgres",
    });
    const failedRequired = report.cases.filter(
      (c) => c.severity === "required" && !c.passed,
    );
    // Known data gap: TMDB alternative titles aren't ingested, so the two
    // alternate-title cases can't match. Everything else must pass.
    expect(failedRequired.map((c) => [c.id, c.failures])).toEqual([
      ["alternate-romanized", ["missing m-spirited-away"]],
      ["alternate-seven", ["missing m-se7en"]],
    ]);
    expect(report.summary).toMatchObject({
      excludedLeaks: 0,
      determinism: { passed: true },
      pagination: { passed: true },
      limitClamp: { passed: true },
    });
  });

  it("returns availability freshness and missing posters from the catalog", async () => {
    await insert({ n: 1, title: "Dune", year: 1984, checkedHoursAgo: 10 });
    await insert({
      n: 2,
      title: "Dune",
      year: 2021,
      poster: null,
      checkedHoursAgo: 100,
    });
    await insert({
      n: 3,
      title: "Dune: Part Two",
      year: 2024,
      checkedHoursAgo: null,
    });
    const service = createSearchService({
      loadDocuments: () => loadSearchDocuments(db),
      loadEligibleTitleIds: (ids) => loadEligibleTitleIds(db, ids),
      loadQuizSeeds: (o) => loadQuizSeeds(db, o),
      now: () => NOW,
    });
    const r = await service.search({ q: "dune", limit: 10 });
    expect(
      r.ok &&
        r.results.map((x) => [
          x.tmdbId - BASE,
          x.year,
          x.posterPath,
          x.availability.state,
        ]),
    ).toEqual([
      [1, 1984, "/p.jpg", "current"],
      [2, 2021, null, "stale"],
      [3, 2024, "/p.jpg", "unknown"],
    ]);
  });

  it("excludes missing and removed titles before quiz limits, and rechecks cached search results", async () => {
    const active = await insert({
      n: 1,
      title: "Star 1",
      lifecycle: "active",
      votes: 10,
    });
    const unobserved = await insert({ n: 2, title: "Star 2", votes: 20 });
    await insert({
      n: 3,
      title: "Star 3",
      lifecycle: "unavailable",
      votes: 900,
    });
    await insert({
      n: 4,
      title: "Star 4",
      lifecycle: "tombstoned",
      votes: 1000,
    });
    expect(
      (await loadSearchDocuments(db))
        .map((d) => d.titleId)
        .sort((a, b) => a - b),
    ).toEqual([active, unobserved]);
    expect(
      (await loadQuizSeeds(db, { limit: 1 })).map((d) => d.titleId),
    ).toEqual([unobserved]);
    const service = createSearchService({
      loadDocuments: () => loadSearchDocuments(db),
      loadEligibleTitleIds: (ids) => loadEligibleTitleIds(db, ids),
      loadQuizSeeds: (o) => loadQuizSeeds(db, o),
      now: () => NOW,
    });
    const before = await service.search({ q: "star", limit: 10 });
    expect(before.ok && before.results.map((r) => r.id)).toEqual([
      String(active),
      String(unobserved),
    ]);
    await sql`update title_lifecycle set status = 'unavailable', missing_since = ${NOW.toISOString()}, consecutive_missing = 1 where title_id = ${active}`;
    await sql`delete from titles where id = ${unobserved}`;
    expect(await service.search({ q: "star", limit: 10 })).toEqual({
      ok: true,
      results: [],
      nextCursor: null,
    });
    expect(await loadQuizSeeds(db, { limit: 10 })).toEqual([]);
  });

  it("serves deterministic quiz seeds: most-voted titles with posters", async () => {
    await insert({ n: 1, title: "A", votes: 500 });
    await insert({ n: 2, title: "B", votes: 900 });
    await insert({ n: 3, title: "C", votes: 900 }); // tie: tmdb id order
    await insert({ n: 4, title: "D", votes: 5000, poster: null }); // no poster: excluded
    await insert({ n: 5, title: "E", votes: 700, kind: "series" });
    await insert({ n: 6, title: "F", votes: null });
    const seeds = async (kind?: "movie" | "series", limit = 10) =>
      (await loadQuizSeeds(db, { kind, limit })).map((d) => d.tmdbId - BASE);

    expect(await seeds()).toEqual([2, 3, 5, 1, 6]);
    expect(await seeds("movie", 2)).toEqual([2, 3]);
    expect(await seeds("series")).toEqual([5]);
    expect(await seeds()).toEqual(await seeds()); // deterministic
  });
});
