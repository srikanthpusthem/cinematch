import { describe, expect, it } from "vitest";
import { DEFAULT_LIFECYCLE_POLICY } from "@/catalog/lifecycle";
import type { RecommendationRequest } from "@/lib/live-recommendation/contract";
import {
  recommendFromCatalog,
  UnknownPreferenceTitlesError,
  type CatalogCandidate,
  type CatalogCandidateSnapshot,
} from "./baseline";

const NOW = new Date("2026-10-12T00:00:00.000Z");
const COMEDY = { id: 35, name: "Comedy" };
const DRAMA = { id: 18, name: "Drama" };
const SPACE = { id: 100, name: "space travel" };
const request = (
  overrides: Partial<RecommendationRequest> = {},
): RecommendationRequest => ({
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
  ...overrides,
});
function title(
  id: string,
  overrides: Partial<CatalogCandidate> = {},
): CatalogCandidate {
  return {
    id,
    title: `Title ${id}`,
    format: "movie",
    year: 2020,
    posterUrl: null,
    genres: [DRAMA],
    keywords: [],
    runtimeMinutes: 95,
    episodeRuntimeMinutes: null,
    seasonCount: null,
    lifecycle: "active",
    availability: {
      region: "US",
      checkedAt: NOW,
      offers: [
        {
          providerId: 8,
          providerName: "Sample service",
          access: "subscription",
        },
      ],
      infoUrl: "https://example.com/provider-information",
    },
    ...overrides,
  };
}
const snapshot = (
  candidates: CatalogCandidate[],
  preferenceTitles: CatalogCandidate[] = [],
): CatalogCandidateSnapshot => ({ candidates, preferenceTitles });
const ids = (result: ReturnType<typeof recommendFromCatalog>) =>
  result.picks.map((pick) => pick.id);

describe("recommendFromCatalog", () => {
  it("ranks the complete hard-filtered pool before taking a page", () => {
    const candidates = [
      ...Array.from({ length: 60 }, (_, i) =>
        title(`blocked-${i}`, { genres: [{ id: 27, name: "Horror" }] }),
      ),
      title("first-eligible"),
      title("best", { genres: [COMEDY] }),
    ];
    const result = recommendFromCatalog(
      snapshot(candidates),
      request({ excludedGenreIds: [27], limit: 1 }),
      NOW,
    );
    expect(ids(result)).toEqual(["best"]);
    expect(result.exhaustion).toMatchObject({
      eligibleCount: 2,
      returnedCount: 1,
      missingCount: 0,
      exhausted: false,
    });
    expect(result.picks[0]!.reasons).toEqual([
      "Comedy metadata is a rough match for your “laugh” mood.",
    ]);
  });

  it("uses stable ID ordering independent of repository order and repeated calls", () => {
    const candidates = [title("z"), title("b"), title("a")];
    const first = recommendFromCatalog(snapshot(candidates), request(), NOW);
    const repeated = recommendFromCatalog(
      snapshot([...candidates].reverse()),
      request(),
      NOW,
    );
    expect(ids(first)).toEqual(["a", "b", "z"]);
    expect(repeated).toEqual(first);
    expect(candidates.map((candidate) => candidate.id)).toEqual([
      "z",
      "b",
      "a",
    ]);
  });

  it("uses bounded rating and popularity to order equal-relevance cold-start picks", () => {
    const candidates = [
      title("a-one-vote", { voteAverage: 10, voteCount: 1 }),
      title("b-popular", { popularity: 1000 }),
      title("z-rated", { voteAverage: 8, voteCount: 1000 }),
    ];
    const result = recommendFromCatalog(
      snapshot(candidates),
      request({ mood: "think" }),
      NOW,
    );
    expect(ids(result)).toEqual(["z-rated", "b-popular", "a-one-vote"]);
    expect(result.confidence).toBe("cold-start");
    expect(result.picks[0]!.reasons[0]).toContain("lower-confidence");
  });

  it("caps popularity outliers and ignores invalid secondary signals", () => {
    const candidates = [
      title("b-outlier", { popularity: 1e12 }),
      title("a-capped", { popularity: 1000 }),
      title("c-invalid", {
        popularity: Number.NaN,
        voteAverage: Infinity,
        voteCount: -1,
      }),
    ];
    expect(
      ids(recommendFromCatalog(snapshot(candidates), request(), NOW)),
    ).toEqual(["a-capped", "b-outlier", "c-invalid"]);
  });

  it("adds genre variety among equally relevant alternatives deterministically", () => {
    const candidates = [
      title("a", { popularity: 900 }),
      title("b", { popularity: 800 }),
      title("c", { popularity: 700 }),
      title("d", { genres: [COMEDY], popularity: 100 }),
      title("e", { genres: [{ id: 12, name: "Adventure" }], popularity: 50 }),
    ];
    const input = request({ mood: "think", limit: 3 });
    expect(ids(recommendFromCatalog(snapshot(candidates), input, NOW))).toEqual(
      ["a", "d", "e"],
    );
    expect(
      recommendFromCatalog(snapshot([...candidates].reverse()), input, NOW),
    ).toEqual(recommendFromCatalog(snapshot(candidates), input, NOW));
  });

  it("never sacrifices higher explicit relevance for diversity or popularity", () => {
    const candidates = [
      title("a-popular", { popularity: 1e12 }),
      title("z-comedy", { genres: [COMEDY] }),
      title("y-comedy", { genres: [COMEDY] }),
    ];
    expect(
      ids(
        recommendFromCatalog(
          snapshot(candidates),
          request({ mood: "laugh", limit: 2 }),
          NOW,
        ),
      ),
    ).toEqual(["y-comedy", "z-comedy"]);
  });

  it("grounds seeded ranking in exact genre and keyword metadata, excluding seeds", () => {
    const seeds = [
      title("seed-a", { genres: [COMEDY], keywords: [SPACE] }),
      title("seed-b"),
      title("seed-c"),
    ];
    const candidates = [
      title("ordinary"),
      title("shared", { genres: [COMEDY], keywords: [SPACE] }),
      ...seeds,
    ];
    const result = recommendFromCatalog(
      snapshot(candidates, seeds),
      request({ seedIds: seeds.map((seed) => seed.id) }),
      NOW,
    );
    expect(ids(result)).toEqual(["shared", "ordinary"]);
    expect(result.confidence).toBe("seeded");
    expect(result.picks[0]!.reasons).toContain(
      "Shares Comedy genre metadata with your favorites.",
    );
    expect(result.picks[0]!.reasons).toContain(
      "Shares the catalog keyword “space travel” with your favorites.",
    );
    expect(result.picks.every((pick) => !pick.id.startsWith("seed-"))).toBe(
      true,
    );
  });

  it("uses likes as taste evidence, without automatically excluding liked titles", () => {
    const liked = title("liked", { genres: [COMEDY], keywords: [SPACE] });
    const result = recommendFromCatalog(
      snapshot([title("unrelated"), liked], [liked]),
      request({ likedIds: [liked.id] }),
      NOW,
    );
    expect(ids(result)).toEqual(["liked", "unrelated"]);
    expect(result.picks[0]!.reasons).toContain(
      "Has genre or keyword metadata in common with titles you liked.",
    );
  });

  it("does not turn watched history into positive taste", () => {
    const watched = title("watched", { genres: [COMEDY] });
    const candidates = [title("a"), title("b", { genres: [COMEDY] })];
    const input = request({ mood: "think" });
    const withoutWatched = recommendFromCatalog(
      snapshot(candidates),
      input,
      NOW,
    );
    const withWatched = recommendFromCatalog(
      snapshot([...candidates, watched], [watched]),
      { ...input, watchedIds: [watched.id] },
      NOW,
    );
    expect(withWatched).toEqual(withoutWatched);
  });

  it("keeps watched, dislikes and show-more exclusions hard and reversible", () => {
    const candidates = [
      title("watched"),
      title("disliked"),
      title("shown"),
      title("available"),
    ];
    const result = recommendFromCatalog(
      snapshot(candidates),
      request({
        watchedIds: ["watched"],
        dislikedIds: ["disliked"],
        excludedIds: ["shown"],
      }),
      NOW,
    );
    expect(ids(result)).toEqual(["available"]);
    expect(
      ids(recommendFromCatalog(snapshot(candidates), request(), NOW)),
    ).toHaveLength(4);
  });

  it.each(["unavailable", "tombstoned"] as const)(
    "never recommends lifecycle %s records",
    (lifecycle) => {
      const result = recommendFromCatalog(
        snapshot([
          title("hidden", { lifecycle }),
          title("legacy", { lifecycle: null }),
        ]),
        request(),
        NOW,
      );
      expect(ids(result)).toEqual(["legacy"]);
    },
  );

  it("reports unknown or inactive seeds instead of claiming personalization", () => {
    const input = request({ seedIds: ["a", "b", "c"] });
    expect(() =>
      recommendFromCatalog(
        snapshot([title("pick")], [title("a"), title("b")]),
        input,
        NOW,
      ),
    ).toThrow(UnknownPreferenceTitlesError);
    expect(() =>
      recommendFromCatalog(
        snapshot(
          [],
          [title("a"), title("b"), title("c", { lifecycle: "tombstoned" })],
        ),
        input,
        NOW,
      ),
    ).toThrow(UnknownPreferenceTitlesError);
  });

  it("fails closed on duplicate candidate or preference IDs", () => {
    expect(() =>
      recommendFromCatalog(snapshot([title("a"), title("a")]), request(), NOW),
    ).toThrow("Duplicate catalog title ID");
    expect(() =>
      recommendFromCatalog(
        snapshot([], [title("a"), title("a")]),
        request(),
        NOW,
      ),
    ).toThrow("Duplicate catalog title ID");
  });

  it("preserves precise canonical runtime constraints without silent widening", () => {
    const candidates = [
      title("short", { runtimeMinutes: 99 }),
      title("long", { runtimeMinutes: 100 }),
      title("show", {
        format: "series",
        episodeRuntimeMinutes: 30,
        seasonCount: 1,
      }),
      title("unknown", { runtimeMinutes: null }),
    ];
    const result = recommendFromCatalog(
      snapshot(candidates),
      request({ length: { format: "movie", category: "under-100" } }),
      NOW,
    );
    expect(ids(result)).toEqual(["short"]);
    expect(result.status).toBe("shortage");
    expect(result.exhaustion.relaxationOptions).toEqual([
      { constraint: "format", additionalEligibleCount: 3 },
      { constraint: "length", additionalEligibleCount: 2 },
    ]);
  });

  it("returns a structured empty result with no invented replacements", () => {
    const result = recommendFromCatalog(
      snapshot([title("wrong", { genres: [DRAMA] })]),
      request({ excludedGenreIds: [DRAMA.id] }),
      NOW,
    );
    expect(result.status).toBe("empty");
    expect(result.picks).toEqual([]);
    expect(result.message).toContain("no constraints were widened");
    expect(result.exhaustion.relaxationOptions).toEqual([
      { constraint: "genres", additionalEligibleCount: 1 },
      { constraint: "format", additionalEligibleCount: 0 },
    ]);
  });

  it.each(["subscription", "free", "ads"] as const)(
    "accepts current US %s access for a selected service",
    (access) => {
      const candidate = title("a");
      candidate.availability.offers = [
        { providerId: 8, providerName: "Sample", access },
      ];
      const result = recommendFromCatalog(
        snapshot([candidate]),
        request({ selectedUsServiceIds: [8] }),
        NOW,
      );
      expect(ids(result)).toEqual(["a"]);
      expect(result.picks[0]!.availability.offers[0]!.access).toBe(access);
    },
  );

  it.each(["rent", "buy"] as const)(
    "does not treat %s as included streaming access",
    (access) => {
      const candidate = title("a");
      candidate.availability.offers = [
        { providerId: 8, providerName: "Sample", access },
      ];
      expect(
        ids(
          recommendFromCatalog(
            snapshot([candidate]),
            request({ selectedUsServiceIds: [8] }),
            NOW,
          ),
        ),
      ).toEqual([]);
      expect(
        recommendFromCatalog(snapshot([candidate]), request(), NOW).picks[0]!
          .availability.offers[0]!.access,
      ).toBe(access);
    },
  );

  it("uses the shared freshness cutoff inclusively and withholds stale offers", () => {
    const cutoff = new Date(
      NOW.getTime() -
        DEFAULT_LIFECYCLE_POLICY.availabilityMaxAgeHours * 3_600_000,
    );
    const current = title("current");
    current.availability.checkedAt = cutoff;
    const stale = title("stale");
    stale.availability.checkedAt = new Date(cutoff.getTime() - 1);
    expect(
      ids(
        recommendFromCatalog(
          snapshot([current, stale]),
          request({ selectedUsServiceIds: [8] }),
          NOW,
        ),
      ),
    ).toEqual(["current"]);
    const stalePick = recommendFromCatalog(snapshot([stale]), request(), NOW)
      .picks[0]!;
    expect(stalePick.availability).toMatchObject({
      state: "stale",
      checkedAt: stale.availability.checkedAt.toISOString(),
      offers: [],
    });
  });

  it.each([null, new Date("invalid"), new Date(NOW.getTime() + 1)])(
    "treats absent/invalid/future checkedAt %s as unknown",
    (checkedAt) => {
      const candidate = title("a");
      candidate.availability.checkedAt = checkedAt;
      const result = recommendFromCatalog(
        snapshot([candidate]),
        request(),
        NOW,
      );
      expect(result.picks[0]!.availability).toEqual({
        region: "US",
        state: "unknown",
        checkedAt: null,
        offers: [],
        infoUrl: null,
      });
    },
  );

  it("does not offer non-US availability", () => {
    const candidate = title("a");
    candidate.availability.region = "CA";
    expect(
      recommendFromCatalog(snapshot([candidate]), request(), NOW).picks[0]!
        .availability.state,
    ).toBe("unknown");
    expect(
      ids(
        recommendFromCatalog(
          snapshot([candidate]),
          request({ selectedUsServiceIds: [8] }),
          NOW,
        ),
      ),
    ).toEqual([]);
  });

  it("separates and deterministically deduplicates access types", () => {
    const candidate = title("a");
    candidate.availability.offers = [
      { providerId: 9, providerName: "Store", access: "buy" },
      { providerId: 8, providerName: "Sample", access: "rent" },
      { providerId: 8, providerName: "Sample", access: "subscription" },
      { providerId: 8, providerName: "Sample", access: "subscription" },
    ];
    const pick = recommendFromCatalog(snapshot([candidate]), request(), NOW)
      .picks[0]!;
    expect(pick.availability.offers.map((offer) => offer.access)).toEqual([
      "subscription",
      "rent",
      "buy",
    ]);
    expect(pick.availability.infoUrl).toBe(
      "https://example.com/provider-information",
    );
    expect(pick).not.toHaveProperty("playbackUrl");
  });

  it("withholds unsafe URLs and preserves unknown display metadata", () => {
    const candidate = title("a", {
      year: null,
      runtimeMinutes: null,
      posterUrl: "javascript:alert(1)",
    });
    candidate.availability.infoUrl = "https://user:password@example.com/";
    const pick = recommendFromCatalog(snapshot([candidate]), request(), NOW)
      .picks[0]!;
    expect(pick).toMatchObject({
      year: null,
      runtimeMinutes: null,
      posterUrl: null,
    });
    expect(pick.availability.infoUrl).toBeNull();
  });

  it("rejects malformed output rather than inventing missing title metadata", () => {
    expect(() =>
      recommendFromCatalog(
        snapshot([title("a", { title: "" })]),
        request(),
        NOW,
      ),
    ).toThrow("Invalid recommendation response");
  });
});
