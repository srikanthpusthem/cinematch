// Run only against the loopback disposable pgvector database used by CI.
// Fixtures are transaction-scoped and always rolled back; never reset live data.
import path from "node:path";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql as query } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveTestDatabaseUrl } from "../../db/test-database-safety";
import * as schema from "../../db/schema";
import {
  parseRecommendationResponse,
  type RecommendationRequest,
  type RecommendationResult,
} from "../../lib/live-recommendation/contract";
import { createPostgresCatalogCandidateRepository } from "./catalog-repository";
import { createRecommendationHandler } from "./recommend-handler";

const ROOT = path.resolve(__dirname, "../../..");
const BASE = 9_700_000;
const NOW = new Date("2026-10-12T12:00:00.000Z");
const STALE = new Date(NOW.getTime() - 48 * 3_600_000 - 1);
const GENRES = { comedy: BASE + 1, drama: BASE + 2 };
const PROVIDERS = { included: BASE + 1, store: BASE + 2 };
let client: postgres.Sql | undefined;
let db: PostgresJsDatabase<typeof schema>;

beforeAll(async () => {
  const connection = resolveTestDatabaseUrl({ cwd: ROOT });
  client = postgres(connection, { max: 1, onnotice: () => {} });
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(ROOT, "drizzle") });
  const [existing] = await db
    .select({ count: query<number>`count(*)::int` })
    .from(schema.titles);
  if (existing!.count !== 0)
    throw new Error(
      "Recommendation DB tests require an empty disposable catalog; existing titles will not be removed.",
    );
});

afterAll(async () => {
  await client?.end();
});

const input = (
  overrides: Partial<RecommendationRequest> = {},
): RecommendationRequest => ({
  schemaVersion: 1,
  selectedUsServiceIds: [PROVIDERS.included],
  excludedGenreIds: [],
  seedIds: [],
  watchedIds: [],
  likedIds: [],
  dislikedIds: [],
  excludedIds: [],
  mood: "laugh",
  format: "movie",
  length: null,
  limit: 5,
  ...overrides,
});
const request = (body: RecommendationRequest) =>
  new Request("http://localhost/api/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

type FixtureName =
  | "seedMovie"
  | "seedSeries"
  | "seedThird"
  | "liked"
  | "best"
  | "other"
  | "unavailable"
  | "tombstoned"
  | "stale"
  | "unknown"
  | "series"
  | "rentOnly"
  | "watched";
type FixtureIds = Record<FixtureName, number>;

async function seed(
  transaction: PostgresJsDatabase<typeof schema>,
): Promise<FixtureIds> {
  const names: FixtureName[] = [
    "seedMovie",
    "seedSeries",
    "seedThird",
    "liked",
    "best",
    "other",
    "unavailable",
    "tombstoned",
    "stale",
    "unknown",
    "series",
    "rentOnly",
    "watched",
  ];
  const rows = await transaction
    .insert(schema.titles)
    .values(
      names.map((name, index) => ({
        kind:
          name === "seedSeries" || name === "series"
            ? ("series" as const)
            : ("movie" as const),
        tmdbId: BASE + index + 1,
        title: `Integration ${name}`,
        tmdbFetchedAt: NOW,
        releaseDate: name === "unknown" ? null : "2020-02-20",
        posterPath: name === "unknown" ? null : "/fixture.jpg",
        popularity: 30,
        voteAverage: 8,
        voteCount: 1000,
      })),
    )
    .returning({ id: schema.titles.id, tmdbId: schema.titles.tmdbId });
  const ids = Object.fromEntries(
    rows.map((row) => [names[row.tmdbId - BASE - 1]!, row.id]),
  ) as FixtureIds;
  await transaction.insert(schema.movies).values(
    names
      .filter((name) => name !== "seedSeries" && name !== "series")
      .map((name) => ({
        titleId: ids[name],
        runtimeMinutes: name === "unknown" ? null : name === "other" ? 100 : 95,
      })),
  );
  await transaction.insert(schema.series).values([
    { titleId: ids.seedSeries, episodeRuntimeMinutes: 45, seasonCount: 4 },
    { titleId: ids.series, episodeRuntimeMinutes: 30, seasonCount: 1 },
  ]);
  await transaction.insert(schema.genres).values([
    { id: GENRES.comedy, name: "Comedy" },
    { id: GENRES.drama, name: "Drama" },
  ]);
  await transaction.insert(schema.keywords).values([
    { id: BASE + 1, name: "friendship" },
    { id: BASE + 2, name: "road trip" },
  ]);
  await transaction.insert(schema.titleGenres).values(
    names.flatMap((name) => {
      const genreIds =
        name === "best" || name === "seedMovie"
          ? [GENRES.comedy, GENRES.drama]
          : [
              name === "seedThird" || name === "other" || name === "seedSeries"
                ? GENRES.drama
                : GENRES.comedy,
            ];
      return genreIds.map((genreId) => ({ titleId: ids[name], genreId }));
    }),
  );
  await transaction.insert(schema.titleKeywords).values([
    { titleId: ids.seedMovie, keywordId: BASE + 1 },
    { titleId: ids.best, keywordId: BASE + 1 },
    { titleId: ids.best, keywordId: BASE + 2 },
  ]);
  await transaction.insert(schema.watchProviders).values([
    { id: PROVIDERS.included, name: "Included service" },
    { id: PROVIDERS.store, name: "Rental store" },
  ]);
  await transaction.insert(schema.titleAvailability).values(
    names
      .filter((name) => name !== "unknown")
      .map((name) => ({
        titleId: ids[name],
        region: "US",
        fetchedAt: name === "stale" ? STALE : NOW,
        link: "https://www.themoviedb.org/movie/123/watch?locale=US",
      })),
  );
  await transaction.insert(schema.titleOffers).values(
    names
      .filter((name) => name !== "unknown")
      .map((name) => ({
        titleId: ids[name],
        providerId: PROVIDERS.included,
        monetization:
          name === "rentOnly" ? ("rent" as const) : ("flatrate" as const),
      })),
  );
  await transaction.insert(schema.titleOffers).values([
    { titleId: ids.best, providerId: PROVIDERS.included, monetization: "ads" },
    { titleId: ids.best, providerId: PROVIDERS.store, monetization: "rent" },
    { titleId: ids.best, providerId: PROVIDERS.store, monetization: "buy" },
  ]);
  await transaction.insert(schema.titleLifecycle).values([
    {
      titleId: ids.best,
      status: "active",
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      lastObservedAt: NOW,
      lastObservationRunId: "recommendation-fixture",
    },
    {
      titleId: ids.unavailable,
      status: "unavailable",
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      lastObservedAt: NOW,
      lastObservationRunId: "recommendation-fixture",
      missingSince: NOW,
      consecutiveMissing: 1,
    },
    {
      titleId: ids.tombstoned,
      status: "tombstoned",
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      lastObservedAt: NOW,
      lastObservationRunId: "recommendation-fixture",
      missingSince: NOW,
      consecutiveMissing: 3,
      tombstonedAt: NOW,
      tombstoneReason: "source_deleted",
    },
  ]);
  return ids;
}

async function withCatalog(
  run: (
    transaction: PostgresJsDatabase<typeof schema>,
    ids: FixtureIds,
  ) => Promise<void>,
) {
  const rollback = new Error("Rollback recommendation fixtures.");
  try {
    await db.transaction(async (transaction) => {
      const ids = await seed(transaction);
      await run(transaction, ids);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  const [remaining] = await db
    .select({ count: query<number>`count(*)::int` })
    .from(schema.titles);
  expect(remaining!.count).toBe(0);
}

const seedIds = (ids: FixtureIds) =>
  [ids.seedMovie, ids.seedSeries, ids.seedThird].map(String);
async function successfulResponse(
  handler: ReturnType<typeof createRecommendationHandler>,
  body: RecommendationRequest,
): Promise<RecommendationResult> {
  const response = await handler(request(body));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const result = parseRecommendationResponse(await response.json());
  if (result.status === "error")
    throw new Error("Expected recommendations, received a typed failure.");
  return result;
}

describe("recommendation repository and handler (Postgres)", () => {
  it("decodes multi-tag and multi-offer rows once per title, with seed metadata independent of tonight's format", async () => {
    await withCatalog(async (transaction, ids) => {
      const repository = createPostgresCatalogCandidateRepository(transaction);
      const data = await repository.load(
        input({ seedIds: seedIds(ids), likedIds: [String(ids.liked)] }),
      );
      expect(new Set(data.candidates.map((title) => title.id)).size).toBe(11);
      expect(data.candidates).toHaveLength(11);
      expect(data.preferenceTitles.map((title) => title.id).sort()).toEqual(
        [...seedIds(ids), String(ids.liked)].sort(),
      );
      const best = data.candidates.find(
        (title) => title.id === String(ids.best),
      )!;
      expect(best.genres).toEqual([
        { id: GENRES.comedy, name: "Comedy" },
        { id: GENRES.drama, name: "Drama" },
      ]);
      expect(best.keywords.map((tag) => tag.name)).toEqual([
        "friendship",
        "road trip",
      ]);
      expect(best.availability.checkedAt).toBeInstanceOf(Date);
      expect(best.availability.checkedAt!.toISOString()).toBe(
        NOW.toISOString(),
      );
      expect(best.availability.offers).toHaveLength(4);
      expect(
        best.availability.offers.map((offer) => offer.access).sort(),
      ).toEqual(["ads", "buy", "rent", "subscription"]);
      expect(best).toMatchObject({
        year: 2020,
        runtimeMinutes: 95,
        popularity: 30,
        voteAverage: 8,
        voteCount: 1000,
        posterUrl: "https://image.tmdb.org/t/p/w500/fixture.jpg",
      });
      expect(
        data.preferenceTitles.find(
          (title) => title.id === String(ids.seedSeries),
        )!.format,
      ).toBe("series");
      expect(
        data.candidates.some((title) =>
          [String(ids.unavailable), String(ids.tombstoned)].includes(title.id),
        ),
      ).toBe(false);
    });
  });

  it("returns deterministic seeded results through real Drizzle reads and the HTTP handler", async () => {
    await withCatalog(async (transaction, ids) => {
      const handler = createRecommendationHandler(
        createPostgresCatalogCandidateRepository(transaction),
        { now: () => NOW },
      );
      const body = input({
        seedIds: seedIds(ids),
        likedIds: [String(ids.liked)],
        watchedIds: [String(ids.watched)],
        limit: 2,
      });
      const first = await successfulResponse(handler, body);
      expect(first).toEqual(await successfulResponse(handler, body));
      expect(first.status).toBe("ok");
      expect(first.confidence).toBe("seeded");
      expect(first.picks.map((title) => title.id)).toEqual([
        String(ids.best),
        String(ids.liked),
      ]);
      expect(first.picks[0]!.reasons).toContain(
        "Shares the catalog keyword “friendship” with your favorites.",
      );
      expect(first.picks[0]!.availability).toMatchObject({
        region: "US",
        state: "current",
        checkedAt: NOW.toISOString(),
      });
      expect(
        first.picks[0]!.availability.offers.map((offer) => offer.access),
      ).toEqual(["subscription", "ads", "rent", "buy"]);
      expect(first.exhaustion.eligibleCount).toBe(3);
    });
  });

  it("withholds stale offers and preserves missing dates, posters, runtimes and availability in JSON", async () => {
    await withCatalog(async (transaction, ids) => {
      const handler = createRecommendationHandler(
        createPostgresCatalogCandidateRepository(transaction),
        { now: () => NOW },
      );
      const excludedIds = Object.values(ids)
        .filter((id) => id !== ids.stale && id !== ids.unknown)
        .map(String);
      const result = await successfulResponse(
        handler,
        input({ selectedUsServiceIds: [], excludedIds }),
      );
      expect(result.status).toBe("shortage");
      expect(result.picks).toHaveLength(2);
      const stale = result.picks.find(
        (title) => title.id === String(ids.stale),
      )!;
      expect(stale.availability).toMatchObject({
        state: "stale",
        checkedAt: STALE.toISOString(),
        offers: [],
      });
      const unknown = result.picks.find(
        (title) => title.id === String(ids.unknown),
      )!;
      expect(unknown).toMatchObject({
        year: null,
        posterUrl: null,
        runtimeMinutes: null,
        episodeRuntimeMinutes: null,
        seasonCount: null,
      });
      expect(unknown.availability).toEqual({
        region: "US",
        state: "unknown",
        checkedAt: null,
        offers: [],
        infoUrl: null,
      });
      expect(
        (await successfulResponse(handler, input({ excludedIds }))).status,
      ).toBe("empty");
    });
  });

  it("treats an availability timestamp exactly 48 hours old as current", async () => {
    await withCatalog(async (transaction, ids) => {
      const handler = createRecommendationHandler(
        createPostgresCatalogCandidateRepository(transaction),
        { now: () => NOW },
      );
      const body = input({
        excludedIds: Object.values(ids)
          .filter((id) => id !== ids.stale)
          .map(String),
      });
      expect((await successfulResponse(handler, body)).status).toBe("empty");
      const boundary = new Date(NOW.getTime() - 48 * 3_600_000);
      await transaction
        .update(schema.titleAvailability)
        .set({ fetchedAt: boundary })
        .where(eq(schema.titleAvailability.titleId, ids.stale));
      const atBoundary = await successfulResponse(handler, body);
      expect(atBoundary.picks.map((title) => title.id)).toEqual([
        String(ids.stale),
      ]);
      expect(atBoundary.picks[0]!.availability).toMatchObject({
        state: "current",
        checkedAt: boundary.toISOString(),
      });
      expect(atBoundary.picks[0]!.availability.offers).toHaveLength(1);
    });
  });

  it("enforces canonical movie and series lengths on mapped subtype metadata", async () => {
    await withCatalog(async (transaction, ids) => {
      const handler = createRecommendationHandler(
        createPostgresCatalogCandidateRepository(transaction),
        { now: () => NOW },
      );
      const movies = await successfulResponse(
        handler,
        input({
          seedIds: seedIds(ids),
          watchedIds: [String(ids.watched)],
          length: { format: "movie", category: "under-100" },
        }),
      );
      expect(movies.picks.map((title) => title.id).sort()).toEqual(
        [String(ids.best), String(ids.liked)].sort(),
      );
      expect(movies.exhaustion.relaxationOptions).toContainEqual({
        constraint: "length",
        additionalEligibleCount: 1,
      });
      const series = await successfulResponse(
        handler,
        input({
          format: "series",
          length: { format: "series", category: "short-episodes" },
        }),
      );
      expect(series.picks.map((title) => title.id)).toEqual([
        String(ids.series),
      ]);
      expect(series.picks[0]).toMatchObject({
        runtimeMinutes: null,
        episodeRuntimeMinutes: 30,
        seasonCount: 1,
      });
    });
  });

  it("re-reads lifecycle on each request and never silently downgrades a missing seed", async () => {
    await withCatalog(async (transaction, ids) => {
      const handler = createRecommendationHandler(
        createPostgresCatalogCandidateRepository(transaction),
        { now: () => NOW },
      );
      const body = input({
        seedIds: seedIds(ids),
        watchedIds: [String(ids.watched)],
        limit: 1,
      });
      expect((await successfulResponse(handler, body)).picks[0]!.id).toBe(
        String(ids.best),
      );
      await transaction
        .update(schema.titleLifecycle)
        .set({
          status: "unavailable",
          missingSince: NOW,
          consecutiveMissing: 1,
        })
        .where(eq(schema.titleLifecycle.titleId, ids.best));
      expect(
        (await successfulResponse(handler, body)).picks.some(
          (title) => title.id === String(ids.best),
        ),
      ).toBe(false);
      const missing = await handler(
        request(
          input({
            seedIds: [
              String(ids.seedMovie),
              String(ids.seedThird),
              String(ids.tombstoned),
            ],
          }),
        ),
      );
      expect(missing.status).toBe(422);
      expect(parseRecommendationResponse(await missing.json())).toMatchObject({
        status: "error",
        code: "UNKNOWN_TITLES",
      });
    });
  });
});
