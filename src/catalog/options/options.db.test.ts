// Runs only against the explicitly configured disposable integration database.
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "../../db/database-url";
import * as schema from "../../db/schema";
import { loadCatalogOptions } from "./repository";

const BASE = 9_500_000;
const root = path.resolve(__dirname, "../../..");
let client: postgres.Sql | undefined;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function cleanup() {
  await client!`delete from titles where tmdb_id >= ${BASE}`;
  await client!`delete from watch_providers where id >= ${BASE}`;
  await client!`delete from genres where id >= ${BASE}`;
}

beforeAll(async () => {
  const sql = postgres(resolveDatabaseUrl({ cwd: root }), {
    max: 3,
    onnotice: () => {},
  });
  await migrate(drizzle(sql), { migrationsFolder: path.join(root, "drizzle") });
  client = sql;
  db = drizzle(sql, { schema });
  await cleanup();
});

afterAll(async () => {
  if (!client) return;
  try {
    await cleanup();
  } finally {
    await client.end();
  }
});

describe("catalog options (Postgres)", () => {
  it("uses actual relationships, keeps monetization types and different genre IDs, and excludes tombstones", async () => {
    const sql = client!;
    const now = new Date("2026-10-01T00:00:00Z");
    const [movie, series, removed] = await db
      .insert(schema.titles)
      .values([
        { kind: "movie", tmdbId: BASE + 1, title: "Movie", tmdbFetchedAt: now },
        {
          kind: "series",
          tmdbId: BASE + 2,
          title: "Series",
          tmdbFetchedAt: now,
        },
        {
          kind: "movie",
          tmdbId: BASE + 3,
          title: "Removed",
          tmdbFetchedAt: now,
        },
      ])
      .returning();
    await db.insert(schema.titleLifecycle).values({
      titleId: removed!.id,
      status: "tombstoned",
      firstSeenAt: now,
      lastSeenAt: now,
      lastObservedAt: now,
      lastObservationRunId: "options-test",
      tombstonedAt: now,
      tombstoneReason: "source_deleted",
    });
    await db.insert(schema.genres).values([
      { id: BASE + 1, name: "Action" },
      { id: BASE + 2, name: "Action" },
      { id: BASE + 3, name: "Removed genre" },
    ]);
    await db.insert(schema.titleGenres).values([
      { titleId: movie!.id, genreId: BASE + 1 },
      { titleId: series!.id, genreId: BASE + 2 },
      { titleId: removed!.id, genreId: BASE + 3 },
    ]);
    await db.insert(schema.watchProviders).values([
      { id: BASE + 1, name: "Example", logoPath: null },
      { id: BASE + 2, name: "Removed provider", logoPath: null },
    ]);
    await db.insert(schema.titleAvailability).values(
      [movie!, series!, removed!].map((t) => ({
        titleId: t.id,
        fetchedAt: now,
      })),
    );
    await db.insert(schema.titleOffers).values([
      { titleId: movie!.id, providerId: BASE + 1, monetization: "flatrate" },
      { titleId: movie!.id, providerId: BASE + 1, monetization: "rent" },
      { titleId: series!.id, providerId: BASE + 1, monetization: "buy" },
      { titleId: removed!.id, providerId: BASE + 2, monetization: "flatrate" },
    ]);
    const options = await loadCatalogOptions(db, now);
    expect(options.providers.filter((p) => Number(p.id) >= BASE)).toEqual([
      {
        id: String(BASE + 1),
        name: "Example",
        logoPath: null,
        monetizations: ["flatrate", "rent", "buy"],
      },
    ]);
    expect(options.genres.filter((g) => Number(g.id) >= BASE)).toEqual([
      { id: String(BASE + 1), name: "Action", kinds: ["movie"] },
      { id: String(BASE + 2), name: "Action", kinds: ["series"] },
    ]);
    // Only the series buy offer remains current after movie offers expire.
    const stale = new Date(now.getTime() - 49 * 3_600_000).toISOString();
    await sql`update title_availability set fetched_at = ${stale} where title_id = ${movie!.id}`;
    expect(
      (await loadCatalogOptions(db, now)).providers.filter(
        (p) => Number(p.id) >= BASE,
      ),
    ).toEqual([
      {
        id: String(BASE + 1),
        name: "Example",
        logoPath: null,
        monetizations: ["buy"],
      },
    ]);
    const boundary = new Date(now.getTime() - 48 * 3_600_000).toISOString();
    await sql`update title_availability set fetched_at = ${boundary} where title_id = ${movie!.id}`;
    expect(
      (await loadCatalogOptions(db, now)).providers.find(
        (p) => p.id === String(BASE + 1),
      )?.monetizations,
    ).toEqual(["flatrate", "rent", "buy"]);
    await sql`update title_availability set fetched_at = ${stale} where title_id in (${movie!.id}, ${series!.id})`;
    expect(
      (await loadCatalogOptions(db, now)).providers.some(
        (p) => p.id === String(BASE + 1),
      ),
    ).toBe(false);
    await sql`update title_lifecycle set status = 'active', tombstoned_at = null, tombstone_reason = null where title_id = ${removed!.id}`;
    expect(
      (await loadCatalogOptions(db, now)).providers.some(
        (p) => p.id === String(BASE + 2),
      ),
    ).toBe(true);
  });
});
