import type { Page } from "@playwright/test";
import type {
  RecommendationPick,
  RecommendationRequest,
} from "../src/lib/live-recommendation/contract";

/** Test-only HTTP fixtures. The shipped application never imports this module. */
const checkedAt = "2026-09-27T18:00:00.000Z";
export const quizTitles = [
  { id: "1", title: "The Grand Budapest Hotel", year: 2014, kind: "movie" },
  { id: "2", title: "Parks and Recreation", year: 2009, kind: "series" },
  { id: "3", title: "Booksmart", year: 2019, kind: "movie" },
  { id: "4", title: "Arrival", year: 2016, kind: "movie" },
].map((title) => ({
  ...title,
  tmdbId: Number(title.id),
  posterPath: null,
  availability: { state: "current", checkedAt },
}));

function pick(
  id: string,
  title: string,
  providerId: number,
  providerName: string,
): RecommendationPick {
  return {
    id,
    title,
    format: "movie",
    year: 2013,
    posterUrl: null,
    runtimeMinutes: 123,
    episodeRuntimeMinutes: null,
    seasonCount: null,
    reasons: ["Cold start, lower confidence without selected favorites."],
    availability: {
      region: "US",
      state: "current",
      checkedAt,
      offers: [{ providerId, providerName, access: "subscription" }],
      infoUrl: "https://example.com/provider-information",
    },
  };
}

export async function mockCatalog(page: Page) {
  await page.route("**/api/catalog/options", (route) =>
    route.fulfill({
      json: {
        providers: [
          ["8", "Netflix"],
          ["12", "Max"],
          ["11", "Hulu"],
          ["13", "Disney+"],
          ["9", "Prime Video"],
          ["10", "Apple TV+"],
          ["14", "Peacock"],
          ["15", "Paramount+"],
        ].map(([id, name]) => ({
          id,
          name,
          logoPath: null,
          monetizations: ["flatrate"],
        })),
        genres: [
          { id: "28", name: "Action", kinds: ["movie"] },
          { id: "27", name: "Horror", kinds: ["movie"] },
          { id: "10759", name: "Action & Adventure", kinds: ["series"] },
        ],
      },
    }),
  );
  await page.route("**/api/catalog/quiz-seeds?*", (route) =>
    route.fulfill({ json: { results: quizTitles, limit: 12 } }),
  );
  await page.route("**/api/catalog/search?*", (route) => {
    const query =
      new URL(route.request().url()).searchParams.get("q")?.toLowerCase() ?? "";
    return route.fulfill({
      json: {
        results: quizTitles.filter((title) =>
          title.title.toLowerCase().includes(query),
        ),
        limit: 12,
        nextCursor: null,
      },
    });
  });
  await page.route("**/api/recommend", async (route) => {
    const input = route.request().postDataJSON() as RecommendationRequest;
    const mode = new URL(page.url()).searchParams.get("mock");
    if (mode === "loading")
      await new Promise((resolve) => setTimeout(resolve, 800));
    if (mode === "error")
      return route.fulfill({
        status: 503,
        json: {
          schemaVersion: 1,
          status: "error",
          code: "CATALOG_UNAVAILABLE",
          message:
            "Catalog recommendations could not be loaded. Please try again.",
        },
      });
    let picks =
      input.mood === "think"
        ? [
            pick("201", "Blade Runner 2049", 10, "Apple TV+"),
            pick("202", "Ex Machina", 12, "Max"),
          ]
        : [
            pick("101", "About Time", 9, "Prime Video"),
            pick("102", "Hunt for the Wilderpeople", 9, "Prime Video"),
            pick("103", "Paddington 2", 8, "Netflix"),
            pick("104", "Safety Not Guaranteed", 8, "Netflix"),
            pick("105", "School of Rock", 15, "Paramount+"),
            pick("106", "The Farewell", 11, "Hulu"),
          ];
    if (input.mood === "think")
      picks[0]!.availability.offers.push({
        providerId: 9,
        providerName: "Prime Video",
        access: "rent",
      });
    const excluded = new Set([
      ...input.seedIds,
      ...input.watchedIds,
      ...input.dislikedIds,
      ...input.excludedIds,
    ]);
    picks = picks.filter(
      (item) =>
        !excluded.has(item.id) &&
        (input.selectedUsServiceIds.length === 0 ||
          item.availability.offers.some(
            (offer) =>
              offer.access === "subscription" &&
              input.selectedUsServiceIds.includes(offer.providerId),
          )),
    );
    if (mode === "empty") picks = [];
    if (mode === "shortage") picks = picks.slice(0, 2);
    if (input.seedIds.length)
      picks.forEach((item) => {
        item.reasons = ["Shares Comedy with a quiz seed."];
      });
    if (mode === "unavailable" || mode === "stale")
      picks.forEach((item) => {
        item.availability = {
          ...item.availability,
          state: mode === "stale" ? "stale" : "unknown",
          offers: [],
          checkedAt: mode === "stale" ? checkedAt : null,
        };
      });
    const eligibleCount = picks.length;
    const returned = picks.slice(0, input.limit);
    const missingCount = Math.max(0, input.limit - eligibleCount);
    const constraints = [
      ...(input.selectedUsServiceIds.length ? ["services"] : []),
      ...(input.excludedGenreIds.length ? ["genres"] : []),
      "format",
      ...(input.length ? ["length"] : []),
    ];
    return route.fulfill({
      json: {
        schemaVersion: 1,
        rankingVersion: "metadata-v1",
        status:
          returned.length === 0 ? "empty" : missingCount ? "shortage" : "ok",
        confidence: input.seedIds.length ? "seeded" : "cold-start",
        picks: returned,
        exhaustion: {
          requestedCount: input.limit,
          eligibleCount,
          returnedCount: returned.length,
          missingCount,
          exhausted: eligibleCount <= input.limit,
          activeEditableConstraints: constraints,
          relaxationOptions: missingCount
            ? constraints.map((constraint) => ({
                constraint,
                additionalEligibleCount: 0,
              }))
            : [],
        },
        message: missingCount
          ? returned.length === 0
            ? "Nothing in the catalog fits these constraints. Edit a step to try different choices."
            : `Only ${returned.length} matches fit these constraints. Nothing was added to fill the list.`
          : null,
      },
    });
  });
}
