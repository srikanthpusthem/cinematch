// Raw client -> existing store -> Postgres, with fixture HTTP only.
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "../db/database-url";
import * as schema from "../db/schema";
import { createTmdbClient } from "../tmdb/client";
import { createCatalogStore, type CatalogStore } from "./store";

const BASE = 9_600_000;
const AT = new Date("2026-10-01T00:00:00Z");
const root = path.resolve(__dirname, "../..");
let sql: postgres.Sql | undefined;
let store: CatalogStore;

beforeAll(async () => {
  const client = postgres(resolveDatabaseUrl({ cwd: root }), {
    max: 3,
    onnotice: () => {},
  });
  await migrate(drizzle(client), {
    migrationsFolder: path.join(root, "drizzle"),
  });
  sql = client;
  store = createCatalogStore(drizzle(client, { schema }));
  await sql`delete from titles where tmdb_id >= ${BASE}`;
});

afterAll(async () => {
  if (!sql) return;
  try {
    await sql`delete from titles where tmdb_id >= ${BASE}`;
  } finally {
    await sql.end();
  }
});

describe("normalization persistence boundary (Postgres)", () => {
  it("stores canonical rows and honest nulls while rejecting adult details before writes", async () => {
    const source = createTmdbClient({
      apiKey: "fixture-key",
      minIntervalMs: 0,
      fetch: async (url) => {
        const id = Number(new URL(String(url)).pathname.split("/").at(-1));
        const raw =
          id === BASE + 1
            ? {
                id,
                title: "",
                original_title: " Canonical\u200B Movie ",
                runtime: 0,
                release_date: "2025-02-29",
                poster_path: "https://example.com/p.jpg",
                status: "Released",
              }
            : id === BASE + 2
              ? {
                  id,
                  name: "Series",
                  status: "Canceled",
                  episode_run_time: [0],
                  last_episode_to_air: { runtime: 44 },
                  seasons: null,
                }
              : { id, title: "Adult", adult: true };
        return new Response(JSON.stringify(raw));
      },
    });
    await store.saveMovie(await source.getMovie(BASE + 1), AT);
    await store.saveSeries(await source.getSeries(BASE + 2), AT);
    await expect(source.getMovie(BASE + 3)).rejects.toMatchObject({
      reason: "adult",
    });
    const movie =
      await sql!`select title, release_date, poster_path, runtime_minutes from titles join movies on movies.title_id = titles.id where tmdb_id = ${BASE + 1}`;
    expect(movie[0]).toEqual({
      title: "Canonical Movie",
      release_date: null,
      poster_path: null,
      runtime_minutes: null,
    });
    const series =
      await sql!`select status, season_count, episode_runtime_minutes from series join titles on titles.id = series.title_id where tmdb_id = ${BASE + 2}`;
    expect(series[0]).toEqual({
      status: "canceled",
      season_count: null,
      episode_runtime_minutes: 44,
    });
    const [count] =
      await sql!`select count(*)::int as n from titles where tmdb_id >= ${BASE}`;
    expect(count!.n).toBe(2);
  });
});
