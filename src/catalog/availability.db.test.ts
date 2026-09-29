// US availability against real Postgres (npm run test:db). Uses its own id
// range for titles and providers and cleans up only that range. The
// end-to-end refresh touches every due title, so it only runs on a database
// that holds no other titles (always true in CI).
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "../db/database-url";
import * as schema from "../db/schema";
import type { RegionProviders, WatchProviders } from "../tmdb/schema";
import {
  createFakeSource,
  fakeMovie,
  fakeSeries,
} from "./__fixtures__/fake-source";
import {
  createAvailabilityStore,
  refreshAvailability,
  usAvailability,
  type AvailabilityStore,
} from "./availability";
import { createCatalogStore, type CatalogStore } from "./store";

const root = path.resolve(__dirname, "../..");
const BASE = 9_100_000;
const DAY = 86_400_000;
const T0 = new Date("2026-09-29T00:00:00Z");

let sql: postgres.Sql;
let connected = false;
let catalog: CatalogStore;
let store: AvailabilityStore;

const p = (n: number, name = `Test Provider ${n}`) => ({
  providerId: BASE + n,
  providerName: name,
  logoPath: null,
  displayPriority: 1,
});
const us = (r: Partial<RegionProviders>): WatchProviders => ({
  US: {
    link: "https://www.themoviedb.org/movie/1/watch?locale=US",
    flatrate: [],
    free: [],
    ads: [],
    rent: [],
    buy: [],
    ...r,
  },
});

async function cleanup() {
  await sql`delete from titles where tmdb_id >= ${BASE}`;
  await sql`delete from watch_providers where id >= ${BASE}`;
  await sql`delete from genres where id >= ${BASE}`;
  await sql`delete from keywords where id >= ${BASE}`;
}

/** Saves a test movie/series via the catalog store and returns its title id. */
async function addTitle(kind: "movie" | "series", n: number): Promise<number> {
  const terms = { genres: [], keywords: [] };
  if (kind === "movie") await catalog.saveMovie(fakeMovie(BASE + n, terms), T0);
  else await catalog.saveSeries(fakeSeries(BASE + n, terms), T0);
  const [row] = await sql`
    select id from titles where kind = ${kind} and tmdb_id = ${BASE + n}`;
  return Number(row!.id);
}

async function offersOf(titleId: number) {
  const rows = await sql<{ provider_id: number; monetization: string }[]>`
    select provider_id, monetization::text from title_offers
    where title_id = ${titleId} order by provider_id, monetization`;
  return rows.map((r) => `${r.provider_id - BASE}:${r.monetization}`);
}

async function checkedAt(titleId: number): Promise<Date | null> {
  const [row] = await sql<{ fetched_at: string }[]>`
    select fetched_at from title_availability where title_id = ${titleId}`;
  // Drizzle sets this shared client to return timestamps as strings.
  return row ? new Date(row.fetched_at) : null;
}

beforeAll(async () => {
  sql = postgres(resolveDatabaseUrl({ cwd: root }), {
    max: 10,
    onnotice: () => {},
  });
  connected = true;
  await migrate(drizzle(sql), { migrationsFolder: path.join(root, "drizzle") });
  const db = drizzle(sql, { schema });
  catalog = createCatalogStore(db);
  store = createAvailabilityStore(db);
});

beforeEach(cleanup);

afterAll(async () => {
  if (!connected) return;
  await cleanup();
  await sql.end();
});

describe("availability store (Postgres)", () => {
  it("replaces offers on refresh, so removed offers disappear", async () => {
    const id = await addTitle("movie", 1);
    await store.saveAvailability(
      id,
      usAvailability(us({ flatrate: [p(1), p(2)], rent: [p(3)] })),
      T0,
    );
    expect(await offersOf(id)).toEqual(["1:flatrate", "2:flatrate", "3:rent"]);

    const later = new Date(T0.getTime() + DAY);
    await store.saveAvailability(
      id,
      usAvailability(us({ flatrate: [p(2)] })),
      later,
    );
    expect(await offersOf(id)).toEqual(["2:flatrate"]);
    expect(await checkedAt(id)).toEqual(later);

    // Saving the same data again changes nothing (idempotent).
    await store.saveAvailability(
      id,
      usAvailability(us({ flatrate: [p(2)] })),
      later,
    );
    expect(await offersOf(id)).toEqual(["2:flatrate"]);
  });

  it("records checked-with-no-US-offers and attribution metadata", async () => {
    const id = await addTitle("series", 1);
    await store.saveAvailability(id, usAvailability({}), T0);
    const [row] = await sql`
      select region, source, link, fetched_at from title_availability where title_id = ${id}`;
    expect(row).toMatchObject({
      region: "US",
      source: "tmdb-justwatch",
      link: null,
    });
    expect(await offersOf(id)).toEqual([]);
  });

  it("keeps provider names current and dedupes duplicate entries", async () => {
    const a = await addTitle("movie", 1);
    const b = await addTitle("movie", 2);
    await store.saveAvailability(
      a,
      usAvailability(us({ flatrate: [p(1, "Old Name"), p(1, "Old Name")] })),
      T0,
    );
    await store.saveAvailability(
      b,
      usAvailability(us({ free: [p(1, "New Name")] })),
      T0,
    );
    const [prov] =
      await sql`select name from watch_providers where id = ${BASE + 1}`;
    expect(prov!.name).toBe("New Name");
    expect(await offersOf(a)).toEqual(["1:flatrate"]);
  });

  it("orders due titles never-checked first, then oldest, and skips fresh ones", async () => {
    const never = await addTitle("movie", 1);
    const old = await addTitle("movie", 2);
    const older = await addTitle("movie", 3);
    const fresh = await addTitle("movie", 4);
    await store.saveAvailability(
      old,
      usAvailability({}),
      new Date(T0.getTime() - 3 * DAY),
    );
    await store.saveAvailability(
      older,
      usAvailability({}),
      new Date(T0.getTime() - 9 * DAY),
    );
    await store.saveAvailability(fresh, usAvailability({}), T0);

    const due = await store.dueForRefresh(new Date(T0.getTime() - DAY), 10_000);
    const ours = due
      .map((d) => d.titleId)
      .filter((id) => [never, old, older, fresh].includes(id));
    expect(ours).toEqual([never, older, old]);
  });
});

describe("refreshAvailability (Postgres)", () => {
  it("refreshes due titles and survives a partial outage without losing data", async (ctx) => {
    const [other] =
      await sql`select count(*)::int as n from titles where tmdb_id < ${BASE}`;
    if (other!.n > 0) ctx.skip(); // would touch real titles on a dev database

    const movie = await addTitle("movie", 1);
    const show = await addTitle("series", 2);
    const noUs = await addTitle("movie", 3);
    // Previous availability for the series, which will fail to refresh.
    const stale = new Date(T0.getTime() - 5 * DAY);
    await store.saveAvailability(
      show,
      usAvailability(us({ flatrate: [p(9)] })),
      stale,
    );

    const { source } = createFakeSource({
      providers: new Map([
        [`movie:${BASE + 1}`, us({ flatrate: [p(1)], rent: [p(2)] })],
        [`series:${BASE + 2}`, us({ flatrate: [p(1)] })],
        [`movie:${BASE + 3}`, { GB: us({ flatrate: [p(5)] }).US! }],
      ]),
      failures: new Map([[BASE + 2, "server" as const]]),
    });
    const report = await refreshAvailability(source, store, {
      maxAgeDays: 1,
      limit: 100,
      concurrency: 4,
      maxFailureRate: 0.5,
      minAttemptsBeforeAbort: 10,
      now: () => T0,
    });

    expect(report).toMatchObject({
      status: "completed",
      due: 3,
      saved: 2,
      withUsOffers: 1,
      withoutUsOffers: 1,
      failed: { server: 1 },
    });
    expect(await offersOf(movie)).toEqual(["1:flatrate", "2:rent"]);
    expect(await offersOf(noUs)).toEqual([]);
    expect(await checkedAt(noUs)).toEqual(T0);
    // Failed title: previous offers and timestamp untouched, so it's retried first.
    expect(await offersOf(show)).toEqual(["9:flatrate"]);
    expect(await checkedAt(show)).toEqual(stale);
    expect(report.availability).toMatchObject({
      titles: 3,
      checked: 3,
      neverChecked: 0,
      stale: 1,
    });
  });
});
