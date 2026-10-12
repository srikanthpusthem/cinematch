import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { catalogPosterUrl } from "@/lib/catalog-image";
import type {
  CatalogTag,
  RecommendationOffer,
  RecommendationRequest,
} from "@/lib/live-recommendation/contract";
import type { CatalogCandidate, CatalogCandidateRepository } from "./baseline";

const {
  titles,
  movies,
  series,
  titleLifecycle,
  titleAvailability,
  titleGenres,
  genres,
  titleKeywords,
  keywords,
  titleOffers,
  watchProviders,
} = schema;
type Db = PostgresJsDatabase<typeof schema>;
type RawOffer = Omit<RecommendationOffer, "access"> & {
  monetization: "flatrate" | "free" | "ads" | "rent" | "buy";
};

export interface CatalogRecommendationRow {
  id: number;
  kind: "movie" | "series";
  title: string;
  releaseDate: string | null;
  posterPath: string | null;
  popularity: number | null;
  voteAverage: number | null;
  voteCount: number | null;
  runtimeMinutes: number | null;
  episodeRuntimeMinutes: number | null;
  seasonCount: number | null;
  lifecycle: "active" | "unavailable" | "tombstoned" | null;
  availabilityRegion: string | null;
  availabilityCheckedAt: Date | null;
  availabilityLink: string | null;
  genres: CatalogTag[];
  keywords: CatalogTag[];
  offers: RawOffer[];
}

/**
 * One statement gives titles, preferences and offers one consistent snapshot.
 * Indexed per-title aggregates avoid a genres × keywords × offers cartesian join.
 * Never apply editable constraints or a candidate LIMIT here: relaxation counts
 * and narrow service/length choices must be computed over the complete pool.
 */
export function catalogRecommendationQuery(db: Db) {
  return db
    .select({
      id: titles.id,
      kind: titles.kind,
      title: titles.title,
      releaseDate: titles.releaseDate,
      posterPath: titles.posterPath,
      popularity: titles.popularity,
      voteAverage: titles.voteAverage,
      voteCount: titles.voteCount,
      runtimeMinutes: movies.runtimeMinutes,
      episodeRuntimeMinutes: series.episodeRuntimeMinutes,
      seasonCount: series.seasonCount,
      lifecycle: titleLifecycle.status,
      availabilityRegion: titleAvailability.region,
      availabilityCheckedAt: titleAvailability.fetchedAt,
      availabilityLink: titleAvailability.link,
      genres: sql<
        CatalogTag[]
      >`coalesce((select jsonb_agg(jsonb_build_object('id', ${genres.id}, 'name', ${genres.name}) order by ${genres.id})
      from ${titleGenres} inner join ${genres} on ${genres.id} = ${titleGenres.genreId}
      where ${titleGenres.titleId} = ${titles.id}), '[]'::jsonb)`,
      keywords: sql<
        CatalogTag[]
      >`coalesce((select jsonb_agg(jsonb_build_object('id', ${keywords.id}, 'name', ${keywords.name}) order by ${keywords.id})
      from ${titleKeywords} inner join ${keywords} on ${keywords.id} = ${titleKeywords.keywordId}
      where ${titleKeywords.titleId} = ${titles.id}), '[]'::jsonb)`,
      offers: sql<
        RawOffer[]
      >`coalesce((select jsonb_agg(jsonb_build_object('providerId', ${watchProviders.id}, 'providerName', ${watchProviders.name}, 'monetization', ${titleOffers.monetization}) order by ${watchProviders.id}, ${titleOffers.monetization})
      from ${titleOffers} inner join ${watchProviders} on ${watchProviders.id} = ${titleOffers.providerId}
      where ${titleOffers.titleId} = ${titles.id} and ${titleOffers.region} = 'US'), '[]'::jsonb)`,
    })
    .from(titles)
    .leftJoin(movies, eq(movies.titleId, titles.id))
    .leftJoin(series, eq(series.titleId, titles.id))
    .leftJoin(titleLifecycle, eq(titleLifecycle.titleId, titles.id))
    .leftJoin(
      titleAvailability,
      and(
        eq(titleAvailability.titleId, titles.id),
        eq(titleAvailability.region, "US"),
      ),
    )
    .where(
      or(isNull(titleLifecycle.titleId), eq(titleLifecycle.status, "active")),
    )
    .orderBy(asc(titles.id));
}

function validateTags(tags: readonly CatalogTag[]): CatalogTag[] {
  if (
    !Array.isArray(tags) ||
    tags.some(
      (tag) =>
        !Number.isSafeInteger(tag.id) ||
        tag.id <= 0 ||
        typeof tag.name !== "string" ||
        !tag.name.trim() ||
        tag.name.length > 200,
    )
  ) {
    throw new Error("Malformed catalog tags.");
  }
  return tags.map((tag) => ({ id: tag.id, name: tag.name }));
}

export function mapCatalogRecommendationRow(
  row: CatalogRecommendationRow,
): CatalogCandidate {
  if (!Number.isSafeInteger(row.id) || row.id <= 0)
    throw new Error("Invalid catalog title ID.");
  const offers: RecommendationOffer[] = row.offers.map((offer) => {
    if (
      !Number.isSafeInteger(offer.providerId) ||
      offer.providerId <= 0 ||
      typeof offer.providerName !== "string" ||
      !offer.providerName.trim() ||
      !["flatrate", "free", "ads", "rent", "buy"].includes(offer.monetization)
    ) {
      throw new Error("Malformed catalog offer.");
    }
    return {
      providerId: offer.providerId,
      providerName: offer.providerName,
      access:
        offer.monetization === "flatrate" ? "subscription" : offer.monetization,
    };
  });
  const releaseYear = row.releaseDate
    ? Number(row.releaseDate.slice(0, 4))
    : null;
  return {
    id: String(row.id),
    title: row.title,
    format: row.kind,
    year:
      releaseYear !== null &&
      Number.isInteger(releaseYear) &&
      releaseYear >= 1800 &&
      releaseYear <= 9999
        ? releaseYear
        : null,
    posterUrl: catalogPosterUrl(row.posterPath),
    popularity: row.popularity,
    voteAverage: row.voteAverage,
    voteCount: row.voteCount,
    genres: validateTags(row.genres),
    keywords: validateTags(row.keywords),
    runtimeMinutes: row.runtimeMinutes,
    episodeRuntimeMinutes: row.episodeRuntimeMinutes,
    seasonCount: row.seasonCount,
    lifecycle: row.lifecycle,
    availability: {
      region: row.availabilityRegion ?? "US",
      checkedAt: row.availabilityCheckedAt,
      offers: row.availabilityRegion === "US" ? offers : [],
      infoUrl: row.availabilityLink,
    },
  };
}

export type LoadCatalogRecommendationRows = (
  signal?: AbortSignal,
) => Promise<readonly CatalogRecommendationRow[]>;

/** Inject the read boundary for fixture-free adapter tests. */
export function createCatalogCandidateRepository(
  loadRows: LoadCatalogRecommendationRows,
): CatalogCandidateRepository {
  return {
    async load(request: RecommendationRequest, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const rows = await loadRows(signal);
      signal?.throwIfAborted();
      const candidates = rows.map(mapCatalogRecommendationRow);
      const preferences = new Set([...request.seedIds, ...request.likedIds]);
      return {
        candidates,
        preferenceTitles: candidates.filter((title) =>
          preferences.has(title.id),
        ),
      };
    },
  };
}

export function createPostgresCatalogCandidateRepository(
  db: Db,
): CatalogCandidateRepository {
  return createCatalogCandidateRepository(async (signal) => {
    signal?.throwIfAborted();
    const rows = await catalogRecommendationQuery(db);
    signal?.throwIfAborted();
    return rows;
  });
}
