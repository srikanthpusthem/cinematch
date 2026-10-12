import {
  DEFAULT_LIFECYCLE_POLICY,
  presentableAvailability,
} from "@/catalog/lifecycle";
import {
  isSafeHttpsUrl,
  parseRecommendationRequest,
  parseRecommendationResponse,
  type CatalogTag,
  type RecommendationAvailability,
  type RecommendationMood,
  type RecommendationOffer,
  type RecommendationPick,
  type RecommendationRequest,
  type RecommendationResult,
} from "@/lib/live-recommendation/contract";
import { applyHardFilters, type MediaFormat } from "./hard-filters";

export interface CatalogCandidate {
  id: string;
  title: string;
  format: MediaFormat;
  year: number | null;
  posterUrl: string | null;
  popularity?: number | null;
  voteAverage?: number | null;
  voteCount?: number | null;
  genres: readonly CatalogTag[];
  keywords: readonly CatalogTag[];
  runtimeMinutes: number | null;
  episodeRuntimeMinutes: number | null;
  seasonCount: number | null;
  /** A missing lifecycle record is active, matching the existing catalog policy. */
  lifecycle: "active" | "unavailable" | "tombstoned" | null;
  availability: {
    region: string;
    checkedAt: Date | null;
    offers: readonly RecommendationOffer[];
    infoUrl: string | null;
  };
}

export interface CatalogCandidateSnapshot {
  /**
   * Complete catalog pool. Do not prefilter editable constraints or truncate it:
   * this baseline owns hard filtering and descriptive marginal relaxation counts.
   */
  candidates: readonly CatalogCandidate[];
  /** Resolve requested seeds and likes independently of tonight's filters. */
  preferenceTitles: readonly CatalogCandidate[];
}

export interface CatalogCandidateRepository {
  load(
    request: RecommendationRequest,
    signal?: AbortSignal,
  ): Promise<CatalogCandidateSnapshot>;
}

export class UnknownPreferenceTitlesError extends Error {
  constructor() {
    super(
      "Some selected favorites are no longer in the catalog. Edit your favorites and try again.",
    );
    this.name = "UnknownPreferenceTitlesError";
  }
}

/** Transparent genre heuristics, not a claim about a title's emotional effect. */
const MOOD_GENRES: Record<RecommendationMood, readonly string[]> = {
  laugh: ["comedy"],
  cry: ["drama", "romance"],
  thrill: ["thriller", "mystery", "action", "action & adventure", "horror"],
  think: ["documentary", "science fiction", "sci-fi & fantasy", "mystery"],
  comfort: ["comedy", "family", "animation"],
};

const ACCESS_ORDER = {
  subscription: 0,
  free: 1,
  ads: 2,
  rent: 3,
  buy: 4,
} as const;
const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const active = (title: CatalogCandidate) =>
  title.lifecycle === null || title.lifecycle === "active";

function uniqueIndex(
  titles: readonly CatalogCandidate[],
): Map<string, CatalogCandidate> {
  const index = new Map<string, CatalogCandidate>();
  for (const title of titles) {
    if (index.has(title.id)) throw new Error("Duplicate catalog title ID.");
    index.set(title.id, title);
  }
  return index;
}

function currentAvailability(
  title: CatalogCandidate,
  now: Date,
): RecommendationAvailability {
  const source = title.availability;
  const checkedAt = source.checkedAt;
  // Invalid/future dates cannot establish that an offer has actually been checked.
  if (
    source.region !== "US" ||
    !checkedAt ||
    !Number.isFinite(checkedAt.getTime()) ||
    checkedAt > now
  ) {
    return {
      region: "US",
      state: "unknown",
      checkedAt: null,
      offers: [],
      infoUrl: null,
    };
  }
  const availability = presentableAvailability(
    source.offers,
    checkedAt,
    now,
    DEFAULT_LIFECYCLE_POLICY,
  );
  const seen = new Set<string>();
  const offers = availability.offers
    .filter((offer) => {
      const key = `${offer.providerId}:${offer.access}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) =>
        ACCESS_ORDER[a.access] - ACCESS_ORDER[b.access] ||
        a.providerId - b.providerId,
    );
  return {
    region: "US",
    state: availability.state,
    checkedAt: checkedAt.toISOString(),
    offers,
    infoUrl: isSafeHttpsUrl(source.infoUrl) ? source.infoUrl : null,
  };
}

function tags(
  titles: readonly CatalogCandidate[],
  key: "genres" | "keywords",
): Set<number> {
  return new Set(titles.flatMap((title) => title[key].map((tag) => tag.id)));
}

function overlaps(
  values: readonly CatalogTag[],
  selected: ReadonlySet<number>,
): CatalogTag[] {
  const unique = new Map(
    values.filter((tag) => selected.has(tag.id)).map((tag) => [tag.id, tag]),
  );
  return [...unique.values()].sort((a, b) => a.id - b.id);
}

/** Secondary metadata signal, never personalization or a hard constraint. */
function metadataQuality(
  title: Pick<CatalogCandidate, "popularity" | "voteAverage" | "voteCount">,
): number {
  const bounded = (value: number | null | undefined, cap: number) =>
    value != null && Number.isFinite(value)
      ? Math.max(0, Math.min(value, cap)) / cap
      : 0;
  // Ratings with few votes carry less weight; extreme popularity cannot dominate.
  return (
    bounded(title.voteAverage, 10) * bounded(title.voteCount, 1000) * 2 +
    bounded(title.popularity, 1000)
  );
}

interface RankedTitle {
  title: Omit<CatalogCandidate, "availability"> & {
    availability: RecommendationAvailability;
  };
  score: number;
  quality: number;
  genreIds: readonly number[];
  reasons: string[];
}

/** Diversify only among equally relevant titles; never widen hard constraints. */
function diversePage(
  ranked: readonly RankedTitle[],
  limit: number,
): RankedTitle[] {
  const remaining = [...ranked];
  const page: RankedTitle[] = [];
  const genreCounts = new Map<number, number>();
  const diversity = ({ genreIds: genres }: RankedTitle) => {
    return {
      novelty: genres.some((id) => !genreCounts.has(id)) ? 1 : 0,
      exposure: genres.length
        ? genres.reduce((sum, id) => sum + (genreCounts.get(id) ?? 0), 0) /
          genres.length
        : Number.MAX_SAFE_INTEGER,
    };
  };
  while (remaining.length > 0 && page.length < limit) {
    // At most five linear selections, without repeatedly sorting the full catalog.
    let bestIndex = 0;
    let best = remaining[0]!;
    let bestDiversity = diversity(best);
    for (let index = 1; index < remaining.length; index++) {
      const candidate = remaining[index]!;
      const candidateDiversity = diversity(candidate);
      const comparison =
        best.score - candidate.score ||
        bestDiversity.novelty - candidateDiversity.novelty ||
        candidateDiversity.exposure - bestDiversity.exposure ||
        best.quality - candidate.quality ||
        compareIds(candidate.title.id, best.title.id);
      if (comparison < 0) {
        bestIndex = index;
        best = candidate;
        bestDiversity = candidateDiversity;
      }
    }
    const selected = remaining.splice(bestIndex, 1)[0]!;
    page.push(selected);
    for (const id of selected.genreIds) {
      genreCounts.set(id, (genreCounts.get(id) ?? 0) + 1);
    }
  }
  return page;
}

/**
 * Source-neutral deterministic baseline. Filters precede scoring/limiting; only
 * catalog IDs and metadata are returned. No paid calls or fixture fallbacks.
 */
export function recommendFromCatalog(
  snapshot: CatalogCandidateSnapshot,
  request: RecommendationRequest,
  now: Date,
): RecommendationResult {
  const input = parseRecommendationRequest(request);
  if (!Number.isFinite(now.getTime()))
    throw new Error("Invalid recommendation clock.");
  uniqueIndex(snapshot.candidates);
  const preferences = uniqueIndex(snapshot.preferenceTitles);
  const seeds = input.seedIds.map((id) => preferences.get(id));
  if (seeds.some((seed) => !seed || !active(seed)))
    throw new UnknownPreferenceTitlesError();
  const seedTitles = seeds as CatalogCandidate[];
  const likedTitles = input.likedIds.flatMap((id) => {
    const title = preferences.get(id);
    return title && active(title) ? [title] : [];
  });
  const seedGenres = tags(seedTitles, "genres");
  const seedKeywords = tags(seedTitles, "keywords");
  const likedGenres = tags(likedTitles, "genres");
  const likedKeywords = tags(likedTitles, "keywords");
  const excludedIds = [
    ...new Set([
      ...input.seedIds,
      ...input.watchedIds,
      ...input.dislikedIds,
      ...input.excludedIds,
    ]),
  ];
  const pool = snapshot.candidates.filter(active).map((title) => {
    const availability = currentAvailability(title, now);
    return {
      ...title,
      availability,
      genreIds: title.genres.map((genre) => genre.id),
      usStreamingServiceIds: availability.offers
        .filter((offer) =>
          ["subscription", "free", "ads"].includes(offer.access),
        )
        .map((offer) => offer.providerId),
    };
  });
  const filterInput = {
    selectedUsServiceIds: input.selectedUsServiceIds,
    excludedGenreIds: input.excludedGenreIds,
    watchedIds: excludedIds,
    format: input.format,
    length: input.length ?? undefined,
  };
  // Keep the whole strictly eligible pool for scoring, not just the first page.
  const filtered = applyHardFilters(pool, {
    ...filterInput,
    limit: Math.max(pool.length, input.limit),
  });
  const ranked = filtered.candidates.map((title) => {
    const sharedGenres = overlaps(title.genres, seedGenres);
    const sharedKeywords = overlaps(title.keywords, seedKeywords);
    const likeGenres = overlaps(title.genres, likedGenres);
    const likeKeywords = overlaps(title.keywords, likedKeywords);
    const moodGenres = title.genres
      .filter((genre) =>
        MOOD_GENRES[input.mood].includes(genre.name.trim().toLowerCase()),
      )
      .sort((a, b) => a.id - b.id);
    // Each contribution is capped so large metadata lists cannot dominate.
    const score =
      Math.min(sharedGenres.length, 3) * 3 +
      Math.min(sharedKeywords.length, 3) * 2 +
      Math.min(likeGenres.length, 3) * 2 +
      Math.min(likeKeywords.length, 3) +
      (moodGenres.length > 0 ? 2 : 0);
    const reasons: string[] = [];
    if (sharedGenres.length)
      reasons.push(
        `Shares ${sharedGenres
          .slice(0, 2)
          .map((tag) => tag.name)
          .join(" and ")} genre metadata with your favorites.`,
      );
    if (sharedKeywords.length)
      reasons.push(
        `Shares the catalog keyword “${sharedKeywords[0]!.name}” with your favorites.`,
      );
    if (likeGenres.length || likeKeywords.length)
      reasons.push(
        "Has genre or keyword metadata in common with titles you liked.",
      );
    if (moodGenres.length)
      reasons.push(
        `${moodGenres[0]!.name} metadata is a rough match for your “${input.mood}” mood.`,
      );
    if (!reasons.length)
      reasons.push(
        input.seedIds.length
          ? "Meets your explicit filters; no shared favorite metadata was found."
          : "Meets your explicit filters. Without favorites, this is a lower-confidence starting point.",
      );
    return {
      title,
      score,
      quality: metadataQuality(title),
      genreIds: [...new Set(title.genreIds)],
      reasons: reasons.slice(0, 4),
    };
  });
  // Marginal counts are independent of page size. Reuse the original pool pass
  // rather than computing every hypothetical relaxation a second time.
  const eligibleCount = filtered.exhaustion.eligibleCount;
  const missingCount = Math.max(0, input.limit - eligibleCount);
  const exhaustion = {
    ...filtered.exhaustion,
    requestedCount: input.limit,
    returnedCount: Math.min(eligibleCount, input.limit),
    missingCount,
    exhausted: eligibleCount <= input.limit,
    relaxationOptions:
      missingCount > 0 ? filtered.exhaustion.relaxationOptions : [],
  };
  const picks: RecommendationPick[] = diversePage(ranked, input.limit).map(
    ({ title, reasons }) => ({
      id: title.id,
      title: title.title,
      format: title.format,
      year: title.year,
      posterUrl: isSafeHttpsUrl(title.posterUrl) ? title.posterUrl : null,
      runtimeMinutes: title.runtimeMinutes,
      episodeRuntimeMinutes: title.episodeRuntimeMinutes,
      seasonCount: title.seasonCount,
      reasons,
      availability: title.availability,
    }),
  );
  const status =
    picks.length === 0
      ? "empty"
      : exhaustion.missingCount > 0
        ? "shortage"
        : "ok";
  const result: RecommendationResult = {
    schemaVersion: 1,
    rankingVersion: "metadata-v1",
    status,
    confidence: input.seedIds.length > 0 ? "seeded" : "cold-start",
    picks,
    exhaustion,
    message:
      status === "ok"
        ? null
        : status === "empty"
          ? "No catalog titles meet these filters. Edit your choices; no constraints were widened."
          : `Only ${picks.length} catalog ${picks.length === 1 ? "title meets" : "titles meet"} these filters. Edit your choices to see more.`,
  };
  return parseRecommendationResponse(result) as RecommendationResult;
}
