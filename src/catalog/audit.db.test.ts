// Catalog audit against real Postgres (npm run test:db). The audit is
// catalog-wide, so these tests run only on a database holding no titles of
// its own (always true in CI); they seed and remove a test id range.
import path from "node:path";
import { sql as dsql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "../db/database-url";
import * as schema from "../db/schema";
import { runCatalogAudit, withReadOnly } from "./audit";

const root = path.resolve(__dirname, "../..");
const BASE = 9_300_000;
const AS_OF = new Date("2026-10-01T00:00:00Z");
const hoursAgo = (h: number) =>
  new Date(AS_OF.getTime() - h * 3_600_000).toISOString();

let sql: postgres.Sql;
let db: ReturnType<typeof drizzle<typeof schema>>;
let connected = false;
let foreignTitles = 0;

async function cleanup() {
  await sql`delete from titles where tmdb_id >= ${BASE}`;
  await sql`delete from genres where id >= ${BASE}`;
  await sql`delete from keywords where id >= ${BASE}`;
  await sql`delete from watch_providers where id >= ${BASE}`;
}

interface SeedTitle {
  kind?: "movie" | "series";
  n: number;
  overview?: string | null;
  releaseDate?: string | null;
  poster?: string | null;
  genres?: boolean;
  keywords?: boolean;
  /** Movies: runtime; null = missing. */
  runtime?: number | null;
  imdb?: string | null;
  /** Series: season numbers to store, and the season_count to write. */
  seasons?: number[];
  seasonCount?: number | null;
  episodeRuntime?: number | null;
  /** Skip the movie/series row (broken relationship). */
  noSubtype?: boolean;
  /** Hours since availability was checked; null = never checked. */
  availabilityAgeHours?: number | null;
  lifecycle?: "active" | "tombstoned";
}

async function seed(t: SeedTitle): Promise<number> {
  const kind = t.kind ?? "movie";
  const [row] = await sql`
    insert into titles (kind, tmdb_id, title, overview, release_date, poster_path, tmdb_fetched_at)
    values (${kind}, ${BASE + t.n}, ${`Title ${t.n}`},
      ${t.overview === undefined ? "An overview." : t.overview},
      ${t.releaseDate === undefined ? "2020-01-01" : t.releaseDate},
      ${t.poster === undefined ? "/p.jpg" : t.poster}, now())
    returning id`;
  const id = Number(row!.id);
  if (!t.noSubtype) {
    if (kind === "movie") {
      await sql`insert into movies (title_id, runtime_minutes, imdb_id)
        values (${id}, ${t.runtime === undefined ? 100 : t.runtime}, ${t.imdb ?? null})`;
    } else {
      const seasons = t.seasons ?? [1, 2];
      await sql`insert into series (title_id, season_count, episode_runtime_minutes)
        values (${id}, ${t.seasonCount === undefined ? seasons.filter((s) => s > 0).length : t.seasonCount},
          ${t.episodeRuntime === undefined ? 30 : t.episodeRuntime})`;
      for (const s of seasons) {
        await sql`insert into seasons (series_id, season_number) values (${id}, ${s})`;
      }
    }
  }
  if (t.genres !== false) {
    await sql`insert into genres (id, name) values (${BASE + 1}, 'Test Drama') on conflict do nothing`;
    await sql`insert into title_genres values (${id}, ${BASE + 1})`;
  }
  if (t.keywords !== false) {
    await sql`insert into keywords (id, name) values (${BASE + 1}, 'test-kw') on conflict do nothing`;
    await sql`insert into title_keywords values (${id}, ${BASE + 1})`;
  }
  const age = t.availabilityAgeHours === undefined ? 1 : t.availabilityAgeHours;
  if (age !== null) {
    await sql`insert into title_availability (title_id, fetched_at) values (${id}, ${hoursAgo(age)})`;
  }
  if (t.lifecycle) {
    const tomb = t.lifecycle === "tombstoned";
    await sql`insert into title_lifecycle (title_id, status, first_seen_at, last_seen_at,
        last_observed_at, last_observation_run_id, missing_since, consecutive_missing,
        tombstoned_at, tombstone_reason)
      values (${id}, ${t.lifecycle}, now(), now(), now(), 'r',
        ${tomb ? hoursAgo(300) : null}, ${tomb ? 3 : 0},
        ${tomb ? hoursAgo(10) : null}, ${tomb ? "source_deleted" : null})`;
  }
  return id;
}

const audit = (sampleSize = 10) =>
  runCatalogAudit(db, { asOf: AS_OF, sampleSize });
const finding = async (check: string, sampleSize = 10) =>
  (await audit(sampleSize)).findings.find((f) => f.check === check);

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
  if (foreignTitles > 0) ctx.skip(); // catalog-wide counts need a test-only database
  await cleanup();
});

afterAll(async () => {
  if (!connected) return;
  await cleanup();
  await sql.end();
});

describe("catalog audit (Postgres)", () => {
  it("reports a clean catalog as healthy, with real counts and unmet M1 targets", async () => {
    await seed({ n: 1 });
    await seed({ n: 2 });
    await seed({ n: 3, kind: "series" });
    const r = await audit();
    expect(r.findings).toEqual([]);
    expect(r.healthy).toBe(true);
    expect(r.counts).toMatchObject({
      movies: 2,
      series: 1,
      seasons: 2,
      availabilityRows: 3,
    });
    expect(r.targets).toEqual({
      movies: { target: 20_000, actual: 2, met: false },
      series: { target: 5_000, actual: 1, met: false },
    });
    expect(r.availability).toMatchObject({
      neverChecked: 0,
      fresh: 3,
      stale: 0,
    });
    expect(r.lifecycle).toMatchObject({ unobserved: 3, tombstoned: 0 });
  });

  it("flags incomplete metadata and broken relationships with guidance", async () => {
    await seed({
      n: 1,
      overview: null,
      poster: null,
      genres: false,
      runtime: null,
    });
    await seed({ n: 2, noSubtype: true });
    await seed({
      n: 3,
      kind: "series",
      seasons: [0, 1, 2, 3],
      seasonCount: 1,
      episodeRuntime: null,
    });
    await seed({ n: 4, kind: "series", seasons: [], keywords: false });
    const r = await audit();
    const byCheck = Object.fromEntries(r.findings.map((f) => [f.check, f]));

    expect(r.healthy).toBe(false);
    expect(byCheck.movie_subtype_missing).toMatchObject({
      severity: "error",
      count: 1,
      sample: [`movie:${BASE + 2}`],
    });
    expect(byCheck.season_count_mismatch).toMatchObject({
      severity: "error",
      count: 1,
      sample: [`series:${BASE + 3}`],
    });
    expect(byCheck.series_without_seasons).toMatchObject({
      count: 1,
      sample: [`series:${BASE + 4}`],
    });
    expect(byCheck.overview_missing?.sample).toEqual([`movie:${BASE + 1}`]);
    expect(byCheck.poster_missing?.count).toBe(1);
    expect(byCheck.genres_missing?.count).toBe(1);
    expect(byCheck.keywords_missing?.sample).toEqual([`series:${BASE + 4}`]);
    expect(byCheck.movie_runtime_missing?.count).toBe(1);
    expect(byCheck.series_episode_runtime_missing?.count).toBe(1);
    for (const f of r.findings) expect(f.guidance.length).toBeGreaterThan(20);
  });

  it("flags duplicate IMDb ids across TMDB movies", async () => {
    await seed({ n: 1, imdb: "tt0000001" });
    await seed({ n: 2, imdb: "tt0000001" });
    await seed({ n: 3, imdb: "tt0000002" });
    expect(await finding("duplicate_imdb_id")).toEqual(
      expect.objectContaining({
        count: 1,
        sample: [`tt0000001=movie:${BASE + 1}+movie:${BASE + 2}`],
      }),
    );
    expect(await finding("duplicate_source_id")).toBeUndefined(); // constraint holds
  });

  it("reports stale and never-checked availability, oldest first", async () => {
    await seed({ n: 1, availabilityAgeHours: 2 });
    await seed({ n: 2, availabilityAgeHours: 30 });
    await seed({ n: 3, availabilityAgeHours: 100 });
    await seed({ n: 4, availabilityAgeHours: 400 });
    await seed({ n: 5, availabilityAgeHours: null });
    const r = await audit();
    expect(r.availability).toMatchObject({
      neverChecked: 1,
      fresh: 2,
      stale: 2,
      ageBuckets: { upTo24h: 1, upTo48h: 1, upTo7d: 1, over7d: 1 },
      oldestFetchedAt: hoursAgo(400),
      newestFetchedAt: hoursAgo(2),
    });
    const stale = r.findings.find((f) => f.check === "availability_stale");
    expect(stale?.sample).toEqual([`movie:${BASE + 4}`, `movie:${BASE + 3}`]);
    expect(
      r.findings.find((f) => f.check === "availability_never_checked")?.sample,
    ).toEqual([`movie:${BASE + 5}`]);
  });

  it("breaks down lifecycle status and tombstone reasons", async () => {
    await seed({ n: 1, lifecycle: "active" });
    await seed({ n: 2, lifecycle: "tombstoned" });
    await seed({ n: 3 });
    expect((await audit()).lifecycle).toEqual({
      unobserved: 1,
      active: 1,
      unavailable: 0,
      tombstoned: 1,
      tombstonedByReason: { source_deleted: 1, source_id_collision: 0 },
    });
  });

  it("bounds samples while reporting full counts", async () => {
    for (let n = 1; n <= 15; n++) await seed({ n, overview: null });
    const f = await finding("overview_missing", 5);
    expect(f?.count).toBe(15);
    expect(f?.sample).toEqual([1, 2, 3, 4, 5].map((n) => `movie:${BASE + n}`));
  });

  it("is deterministic and never writes", async () => {
    await seed({ n: 1, overview: null });
    await seed({ n: 2, availabilityAgeHours: null });
    const first = JSON.stringify(await audit());
    expect(JSON.stringify(await audit())).toBe(first);

    const error: unknown = await withReadOnly(db, (tx) =>
      tx.execute(dsql`delete from titles where tmdb_id >= ${BASE}`),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    // Drizzle wraps the Postgres error; the SQLSTATE is on its cause.
    const pg = (error as { cause?: { code?: string } } | null)?.cause ?? error;
    expect((pg as { code?: string } | null)?.code).toBe("25006"); // read_only_sql_transaction
    const [row] =
      await sql`select count(*)::int as n from titles where tmdb_id >= ${BASE}`;
    expect(row!.n).toBe(2);
  });
});
