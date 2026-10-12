import { describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import type { RecommendationRequest } from "@/lib/live-recommendation/contract";
import { recommendFromCatalog } from "./baseline";
import {
  catalogRecommendationQuery,
  createCatalogCandidateRepository,
  mapCatalogRecommendationRow,
  type CatalogRecommendationRow,
} from "./catalog-repository";

const NOW = new Date("2026-10-12T00:00:00.000Z");
const input: RecommendationRequest = {
  schemaVersion: 1,
  selectedUsServiceIds: [],
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
};
function row(
  id: number,
  overrides: Partial<CatalogRecommendationRow> = {},
): CatalogRecommendationRow {
  return {
    id,
    kind: "movie",
    title: `Title ${id}`,
    releaseDate: "2020-01-02",
    posterPath: "/poster.jpg",
    popularity: 12,
    voteAverage: 8,
    voteCount: 1000,
    runtimeMinutes: 95,
    episodeRuntimeMinutes: null,
    seasonCount: null,
    lifecycle: null,
    availabilityRegion: "US",
    availabilityCheckedAt: NOW,
    availabilityLink: "https://www.themoviedb.org/movie/123/watch?locale=US",
    genres: [{ id: 35, name: "Comedy" }],
    keywords: [{ id: 1, name: "friendship" }],
    offers: [
      { providerId: 8, providerName: "Sample", monetization: "flatrate" },
    ],
    ...overrides,
  };
}

describe("catalog recommendation query", () => {
  it("reads one complete, lifecycle-eligible snapshot with only US offers", () => {
    const query = catalogRecommendationQuery(drizzle.mock({ schema })).toSQL();
    expect(query.sql).toContain('"title_lifecycle"."title_id" is null');
    expect(query.sql).toContain('"title_lifecycle"."status" =');
    expect(query.params).toEqual(["US", "active"]);
    expect(query.sql).toContain('"title_offers"."region" = \'US\'');
    expect(query.sql).toContain('"movies"."runtime_minutes"');
    expect(query.sql).toContain('"series"."season_count"');
    expect(query.sql).toContain('"title_genres"."title_id" = "titles"."id"');
    expect(query.sql).toContain('"title_keywords"."title_id" = "titles"."id"');
    expect(query.sql.match(/jsonb_agg/g)).toHaveLength(3);
    expect(query.sql.toLowerCase()).not.toMatch(/\blimit\b/);
    expect(query.sql).not.toMatch(/"titles"\."kind"\s*=/);
  });
});

describe("catalog row mapping", () => {
  it("preserves stable string IDs, metrics, runtimes and source timestamps", () => {
    const mapped = mapCatalogRecommendationRow(row(42));
    expect(mapped).toMatchObject({
      id: "42",
      format: "movie",
      year: 2020,
      posterUrl: "https://image.tmdb.org/t/p/w500/poster.jpg",
      popularity: 12,
      voteAverage: 8,
      voteCount: 1000,
      runtimeMinutes: 95,
      episodeRuntimeMinutes: null,
      seasonCount: null,
      lifecycle: null,
    });
    expect(mapped.availability.checkedAt).toBe(NOW);
    expect(mapped.availability.offers).toEqual([
      { providerId: 8, providerName: "Sample", access: "subscription" },
    ]);
  });
  it.each(["flatrate", "free", "ads", "rent", "buy"] as const)(
    "maps %s without conflating access types",
    (monetization) => {
      const mapped = mapCatalogRecommendationRow(
        row(1, {
          offers: [{ providerId: 8, providerName: "Sample", monetization }],
        }),
      );
      expect(mapped.availability.offers[0]!.access).toBe(
        monetization === "flatrate" ? "subscription" : monetization,
      );
    },
  );
  it("preserves unknown metadata and withholds non-US offers", () => {
    const mapped = mapCatalogRecommendationRow(
      row(1, {
        releaseDate: null,
        posterPath: "https://attacker.test/poster.jpg",
        runtimeMinutes: null,
        availabilityRegion: "CA",
      }),
    );
    expect(mapped.year).toBeNull();
    expect(mapped.posterUrl).toBeNull();
    expect(mapped.runtimeMinutes).toBeNull();
    expect(mapped.availability.offers).toEqual([]);
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    "rejects invalid or lossy stable ID %s",
    (id) => {
      expect(() => mapCatalogRecommendationRow(row(id))).toThrow(
        "Invalid catalog title ID",
      );
    },
  );
  it("fails closed on malformed catalog tags and offers", () => {
    expect(() =>
      mapCatalogRecommendationRow(
        row(1, { genres: [{ id: 0, name: "Wrong" }] }),
      ),
    ).toThrow("Malformed catalog tags");
    expect(() =>
      mapCatalogRecommendationRow(row(1, { keywords: [{ id: 1, name: "" }] })),
    ).toThrow("Malformed catalog tags");
    expect(() =>
      mapCatalogRecommendationRow(
        row(1, {
          offers: [
            { providerId: 0, providerName: "Sample", monetization: "buy" },
          ],
        }),
      ),
    ).toThrow("Malformed catalog offer");
  });
});

describe("injected catalog repository", () => {
  it("resolves seeds and likes from the same complete snapshot with no prelimit", async () => {
    const load = vi.fn(async () => [
      row(1),
      row(2, {
        kind: "series",
        runtimeMinutes: null,
        episodeRuntimeMinutes: 30,
        seasonCount: 1,
      }),
      row(3),
      row(4),
      row(5),
    ]);
    const repository = createCatalogCandidateRepository(load);
    const controller = new AbortController();
    const data = await repository.load(
      { ...input, seedIds: ["1", "2", "3"], likedIds: ["4"], limit: 1 },
      controller.signal,
    );
    expect(data.candidates).toHaveLength(5);
    expect(data.preferenceTitles.map((title) => title.id)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(controller.signal);
  });
  it("does not fabricate an empty catalog or a repository outage", async () => {
    const repository = createCatalogCandidateRepository(async () => []);
    const result = recommendFromCatalog(
      await repository.load(input),
      input,
      NOW,
    );
    expect(result.status).toBe("empty");
    expect(result.picks).toEqual([]);
    const error = new Error("database unavailable");
    await expect(
      createCatalogCandidateRepository(async () => {
        throw error;
      }).load(input),
    ).rejects.toBe(error);
  });
  it("suppresses inactive rows defensively even if an injected loader returns them", async () => {
    const repository = createCatalogCandidateRepository(async () => [
      row(1, { lifecycle: "tombstoned" }),
      row(2, { lifecycle: "unavailable" }),
      row(3),
    ]);
    const result = recommendFromCatalog(
      await repository.load(input),
      input,
      NOW,
    );
    expect(result.picks.map((title) => title.id)).toEqual(["3"]);
  });
  it("does not query an already cancelled request", async () => {
    const load = vi.fn(async () => [row(1)]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      createCatalogCandidateRepository(load).load(input, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(load).not.toHaveBeenCalled();
  });
  it("rejects results returned after cancellation", async () => {
    const controller = new AbortController();
    const repository = createCatalogCandidateRepository(async () => {
      controller.abort();
      return [row(1)];
    });
    await expect(
      repository.load(input, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
