// Normalize raw detail responses before any lossy source DTO conversion.
// The existing CatalogSource/store contract remains compatible with fixtures.
import {
  MalformedResponseError,
  type MovieDetails,
  type SeriesDetails,
} from "../tmdb/schema";
import { normalizeMovie, normalizeSeries, type SkipReason } from "./normalize";

export type SourceSkipReason =
  Exclude<SkipReason, "not_an_object" | "invalid_id"> | "ineligible_status";

/** Safe record-level exclusion, distinct from malformed envelopes or outages. */
export class SourceRecordSkippedError extends Error {
  constructor(readonly reason: SourceSkipReason) {
    super(`Catalog detail skipped: ${reason}`);
    this.name = "SourceRecordSkippedError";
  }
}

function reject(reason: SkipReason, kind: "movie" | "series"): never {
  if (reason === "not_an_object") throw new MalformedResponseError(kind);
  if (reason === "invalid_id") throw new MalformedResponseError(`${kind}.id`);
  throw new SourceRecordSkippedError(reason);
}

const UNRELEASED_MOVIE = new Set([
  "rumored",
  "planned",
  "in_production",
  "post_production",
  "canceled",
]);
const UNRELEASED_SERIES = new Set(["planned", "in_production", "pilot"]);

export function normalizeMovieDetails(raw: unknown): MovieDetails {
  const result = normalizeMovie(raw);
  if (!result.ok) return reject(result.reason, "movie");
  const record = result.record;
  if (UNRELEASED_MOVIE.has(record.status))
    throw new SourceRecordSkippedError("ineligible_status");
  return {
    id: record.tmdbId,
    title: record.title,
    originalTitle: record.originalTitle,
    originalLanguage: record.originalLanguage,
    overview: record.overview,
    releaseDate: record.releaseDate,
    runtime: record.runtimeMinutes,
    genres: record.genres,
    posterPath: record.posterPath,
    voteAverage: record.voteAverage,
    voteCount: record.voteCount,
    popularity: record.popularity,
    imdbId: record.imdbId,
    keywords: record.keywords,
    normalization: record,
  };
}

export function normalizeSeriesDetails(raw: unknown): SeriesDetails {
  const result = normalizeSeries(raw);
  if (!result.ok) return reject(result.reason, "series");
  const record = result.record;
  if (UNRELEASED_SERIES.has(record.status))
    throw new SourceRecordSkippedError("ineligible_status");
  return {
    id: record.tmdbId,
    name: record.title,
    originalName: record.originalTitle,
    originalLanguage: record.originalLanguage,
    overview: record.overview,
    firstAirDate: record.releaseDate,
    lastAirDate: record.lastAirDate,
    status: record.status,
    genres: record.genres,
    posterPath: record.posterPath,
    voteAverage: record.voteAverage,
    voteCount: record.voteCount,
    popularity: record.popularity,
    // Existing store consumes the first value. It now gets the single canonical
    // median/fallback, with [] meaning genuinely unknown rather than zero.
    episodeRunTimes:
      record.episodeRuntimeMinutes === null
        ? []
        : [record.episodeRuntimeMinutes],
    seasonCount: record.seasonCount,
    seasons: record.seasons.map((season) => ({
      seasonNumber: season.seasonNumber,
      episodeCount: season.episodeCount,
      airDate: season.airDate,
      name: season.name,
      overview: season.overview,
      posterPath: season.posterPath,
    })),
    keywords: record.keywords,
    normalization: record,
  };
}
