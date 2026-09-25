// Minimal TMDB v3 response shapes used by catalog ingestion, with small
// hand-written validators. Only fields the catalog needs are typed; unknown
// fields are dropped. A validator throws MalformedResponseError on bad input.

export class MalformedResponseError extends Error {
  constructor(where: string) {
    super(`unexpected shape at ${where}`);
    this.name = "MalformedResponseError";
  }
}

type Json = Record<string, unknown>;

function obj(value: unknown, where: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MalformedResponseError(where);
  }
  return value as Json;
}

function arr(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw new MalformedResponseError(where);
  return value;
}

function int(value: unknown, where: string): number {
  if (!Number.isInteger(value)) throw new MalformedResponseError(where);
  return value as number;
}

function str(value: unknown, where: string): string {
  if (typeof value !== "string") throw new MalformedResponseError(where);
  return value;
}

/** Optional fields: null/undefined become null; a wrong type is still malformed. */
function optStr(value: unknown, where: string): string | null {
  return value === null || value === undefined || value === ""
    ? null
    : str(value, where);
}

function optNum(value: unknown, where: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MalformedResponseError(where);
  }
  return value;
}

export interface Genre {
  id: number;
  name: string;
}

export interface MovieSummary {
  id: number;
  title: string;
  releaseDate: string | null;
  genreIds: number[];
  popularity: number | null;
}

export interface SeriesSummary {
  id: number;
  name: string;
  firstAirDate: string | null;
  genreIds: number[];
  popularity: number | null;
}

export interface Page<T> {
  page: number;
  totalPages: number;
  totalResults: number;
  results: T[];
}

export interface MovieDetails {
  id: number;
  title: string;
  originalLanguage: string | null;
  overview: string | null;
  releaseDate: string | null;
  runtime: number | null;
  genres: Genre[];
  posterPath: string | null;
  voteAverage: number | null;
  voteCount: number | null;
  imdbId: string | null;
}

export interface SeasonSummary {
  seasonNumber: number;
  episodeCount: number;
  airDate: string | null;
}

export interface SeriesDetails {
  id: number;
  name: string;
  originalLanguage: string | null;
  overview: string | null;
  firstAirDate: string | null;
  status: string | null;
  genres: Genre[];
  posterPath: string | null;
  voteAverage: number | null;
  voteCount: number | null;
  episodeRunTimes: number[];
  seasons: SeasonSummary[];
}

export interface Episode {
  episodeNumber: number;
  name: string | null;
  airDate: string | null;
  runtime: number | null;
}

export interface SeasonDetails {
  seasonNumber: number;
  airDate: string | null;
  episodes: Episode[];
}

export interface Provider {
  providerId: number;
  providerName: string;
  logoPath: string | null;
  displayPriority: number | null;
}

/** Availability for one country, grouped by how the title can be watched. */
export interface RegionProviders {
  link: string | null;
  flatrate: Provider[];
  free: Provider[];
  ads: Provider[];
  rent: Provider[];
  buy: Provider[];
}

/** Keyed by ISO 3166-1 country code, e.g. "US". */
export type WatchProviders = Record<string, RegionProviders>;

function genres(value: unknown, where: string): Genre[] {
  return arr(value ?? [], where).map((g, i) => {
    const o = obj(g, `${where}[${i}]`);
    return {
      id: int(o.id, `${where}[${i}].id`),
      name: str(o.name, `${where}[${i}].name`),
    };
  });
}

function genreIds(value: unknown, where: string): number[] {
  return arr(value ?? [], where).map((id, i) => int(id, `${where}[${i}]`));
}

export function parsePage<T>(
  value: unknown,
  item: (value: unknown, where: string) => T,
): Page<T> {
  const o = obj(value, "page");
  return {
    page: int(o.page, "page.page"),
    totalPages: int(o.total_pages, "page.total_pages"),
    totalResults: int(o.total_results, "page.total_results"),
    results: arr(o.results, "page.results").map((r, i) =>
      item(r, `results[${i}]`),
    ),
  };
}

export function parseMovieSummary(
  value: unknown,
  where = "movie",
): MovieSummary {
  const o = obj(value, where);
  return {
    id: int(o.id, `${where}.id`),
    title: str(o.title, `${where}.title`),
    releaseDate: optStr(o.release_date, `${where}.release_date`),
    genreIds: genreIds(o.genre_ids, `${where}.genre_ids`),
    popularity: optNum(o.popularity, `${where}.popularity`),
  };
}

export function parseSeriesSummary(
  value: unknown,
  where = "series",
): SeriesSummary {
  const o = obj(value, where);
  return {
    id: int(o.id, `${where}.id`),
    name: str(o.name, `${where}.name`),
    firstAirDate: optStr(o.first_air_date, `${where}.first_air_date`),
    genreIds: genreIds(o.genre_ids, `${where}.genre_ids`),
    popularity: optNum(o.popularity, `${where}.popularity`),
  };
}

export function parseMovieDetails(value: unknown): MovieDetails {
  const o = obj(value, "movie");
  return {
    id: int(o.id, "movie.id"),
    title: str(o.title, "movie.title"),
    originalLanguage: optStr(o.original_language, "movie.original_language"),
    overview: optStr(o.overview, "movie.overview"),
    releaseDate: optStr(o.release_date, "movie.release_date"),
    runtime: optNum(o.runtime, "movie.runtime"),
    genres: genres(o.genres, "movie.genres"),
    posterPath: optStr(o.poster_path, "movie.poster_path"),
    voteAverage: optNum(o.vote_average, "movie.vote_average"),
    voteCount: optNum(o.vote_count, "movie.vote_count"),
    imdbId: optStr(o.imdb_id, "movie.imdb_id"),
  };
}

export function parseSeriesDetails(value: unknown): SeriesDetails {
  const o = obj(value, "series");
  return {
    id: int(o.id, "series.id"),
    name: str(o.name, "series.name"),
    originalLanguage: optStr(o.original_language, "series.original_language"),
    overview: optStr(o.overview, "series.overview"),
    firstAirDate: optStr(o.first_air_date, "series.first_air_date"),
    status: optStr(o.status, "series.status"),
    genres: genres(o.genres, "series.genres"),
    posterPath: optStr(o.poster_path, "series.poster_path"),
    voteAverage: optNum(o.vote_average, "series.vote_average"),
    voteCount: optNum(o.vote_count, "series.vote_count"),
    episodeRunTimes: arr(
      o.episode_run_time ?? [],
      "series.episode_run_time",
    ).map((n, i) => int(n, `series.episode_run_time[${i}]`)),
    seasons: arr(o.seasons ?? [], "series.seasons").map((s, i) => {
      const where = `series.seasons[${i}]`;
      const season = obj(s, where);
      return {
        seasonNumber: int(season.season_number, `${where}.season_number`),
        episodeCount: int(season.episode_count, `${where}.episode_count`),
        airDate: optStr(season.air_date, `${where}.air_date`),
      };
    }),
  };
}

export function parseSeasonDetails(value: unknown): SeasonDetails {
  const o = obj(value, "season");
  return {
    seasonNumber: int(o.season_number, "season.season_number"),
    airDate: optStr(o.air_date, "season.air_date"),
    episodes: arr(o.episodes, "season.episodes").map((e, i) => {
      const where = `season.episodes[${i}]`;
      const ep = obj(e, where);
      return {
        episodeNumber: int(ep.episode_number, `${where}.episode_number`),
        name: optStr(ep.name, `${where}.name`),
        airDate: optStr(ep.air_date, `${where}.air_date`),
        runtime: optNum(ep.runtime, `${where}.runtime`),
      };
    }),
  };
}

function providers(value: unknown, where: string): Provider[] {
  return arr(value ?? [], where).map((p, i) => {
    const o = obj(p, `${where}[${i}]`);
    return {
      providerId: int(o.provider_id, `${where}[${i}].provider_id`),
      providerName: str(o.provider_name, `${where}[${i}].provider_name`),
      logoPath: optStr(o.logo_path, `${where}[${i}].logo_path`),
      displayPriority: optNum(
        o.display_priority,
        `${where}[${i}].display_priority`,
      ),
    };
  });
}

export function parseWatchProviders(value: unknown): WatchProviders {
  const results = obj(obj(value, "providers").results, "providers.results");
  const out: WatchProviders = {};
  for (const [country, raw] of Object.entries(results)) {
    const where = `providers.results.${country}`;
    const region = obj(raw, where);
    out[country] = {
      link: optStr(region.link, `${where}.link`),
      flatrate: providers(region.flatrate, `${where}.flatrate`),
      free: providers(region.free, `${where}.free`),
      ads: providers(region.ads, `${where}.ads`),
      rent: providers(region.rent, `${where}.rent`),
      buy: providers(region.buy, `${where}.buy`),
    };
  }
  return out;
}
