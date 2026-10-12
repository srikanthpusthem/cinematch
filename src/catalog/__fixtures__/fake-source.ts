// In-memory CatalogSource for ingestion tests: serves synthetic titles through
// discover pages (filtered by the year/vote params the real API honors) and
// detail lookups, and can inject per-id failures.
import type { CatalogSource, QueryParams } from "../../tmdb/client";
import { TmdbError } from "../../tmdb/client";
import type {
  MovieDetails,
  MovieSummary,
  Page,
  SeriesDetails,
  SeriesSummary,
} from "../../tmdb/schema";

export function fakeMovie(
  id: number,
  overrides: Partial<MovieDetails> = {},
): MovieDetails {
  return {
    id,
    title: `Movie ${id}`,
    originalTitle: `Movie ${id}`,
    originalLanguage: "en",
    overview: `Overview ${id}`,
    releaseDate: "2020-06-01",
    runtime: 100,
    genres: [{ id: 18, name: "Drama" }],
    posterPath: null,
    voteAverage: 7,
    voteCount: 1000 - id,
    popularity: 10,
    imdbId: `tt${1000000 + id}`,
    keywords: [{ id: 900 + (id % 3), name: `kw-${id % 3}` }],
    ...overrides,
  };
}

export function fakeSeries(
  id: number,
  overrides: Partial<SeriesDetails> = {},
): SeriesDetails {
  return {
    id,
    name: `Series ${id}`,
    originalName: `Series ${id}`,
    originalLanguage: "en",
    overview: `Overview ${id}`,
    firstAirDate: "2019-01-01",
    lastAirDate: "2021-01-01",
    status: "Ended",
    genres: [{ id: 18, name: "Drama" }],
    posterPath: null,
    voteAverage: 8,
    voteCount: 500 - id,
    popularity: 20,
    episodeRunTimes: [45],
    seasons: [
      {
        seasonNumber: 0,
        episodeCount: 2,
        airDate: null,
        name: "Specials",
        overview: null,
        posterPath: null,
      },
      {
        seasonNumber: 1,
        episodeCount: 8,
        airDate: "2019-01-01",
        name: "Season 1",
        overview: null,
        posterPath: null,
      },
      {
        seasonNumber: 2,
        episodeCount: 8,
        airDate: "2020-01-01",
        name: "Season 2",
        overview: null,
        posterPath: null,
      },
    ],
    keywords: [{ id: 950, name: "family" }],
    ...overrides,
  };
}

type Failure = TmdbError["code"];

export interface FakeSourceOptions {
  movies?: MovieDetails[];
  series?: SeriesDetails[];
  /** Detail requests for these ids fail with the given TmdbError code. */
  failures?: Map<number, Failure>;
  pageSize?: number;
}

const yearOf = (date: string | null) =>
  date ? Number(date.slice(0, 4)) : null;

export function createFakeSource(options: FakeSourceOptions) {
  const {
    movies = [],
    series = [],
    failures = new Map(),
    pageSize = 2,
  } = options;
  const calls = { discover: [] as QueryParams[], details: [] as number[] };

  function matches(
    params: QueryParams,
    date: string | null,
    votes: number | null,
  ) {
    const year = yearOf(date);
    const exact = params.primary_release_year ?? params.first_air_date_year;
    const before =
      params["primary_release_date.lte"] ?? params["first_air_date.lte"];
    if ((votes ?? 0) < Number(params["vote_count.gte"] ?? 0)) return false;
    if (exact !== undefined) return year === Number(exact);
    if (before !== undefined) return year !== null && `${date}` <= `${before}`;
    return true;
  }

  async function* pages<T>(items: T[]): AsyncGenerator<Page<T>> {
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    for (let page = 1; page <= totalPages; page++) {
      yield {
        page,
        totalPages: items.length ? totalPages : 0,
        totalResults: items.length,
        results: items.slice((page - 1) * pageSize, page * pageSize),
      };
    }
  }

  function detail<T>(list: T[], id: number, path: string): Promise<T> {
    calls.details.push(id);
    const failure = failures.get(id);
    if (failure) return Promise.reject(new TmdbError(failure, path, 1));
    const found = list.find((x) => (x as { id: number }).id === id);
    return found
      ? Promise.resolve(structuredClone(found))
      : Promise.reject(new TmdbError("not_found", path, 1, 404));
  }

  const source: CatalogSource = {
    discoverMovies(params = {}) {
      calls.discover.push(params);
      const hits: MovieSummary[] = movies
        .filter((m) => matches(params, m.releaseDate, m.voteCount))
        .map((m) => ({
          id: m.id,
          title: m.title,
          releaseDate: m.releaseDate,
          genreIds: m.genres.map((g) => g.id),
          popularity: m.popularity,
          voteCount: m.voteCount,
        }));
      return pages(hits);
    },
    discoverSeries(params = {}) {
      calls.discover.push(params);
      const hits: SeriesSummary[] = series
        .filter((s) => matches(params, s.firstAirDate, s.voteCount))
        .map((s) => ({
          id: s.id,
          name: s.name,
          firstAirDate: s.firstAirDate,
          genreIds: s.genres.map((g) => g.id),
          popularity: s.popularity,
          voteCount: s.voteCount,
        }));
      return pages(hits);
    },
    getMovie: (id) => detail(movies, id, `/3/movie/${id}`),
    getSeries: (id) => detail(series, id, `/3/tv/${id}`),
    getSeason: () => Promise.reject(new Error("not used by ingestion")),
    getMovieWatchProviders: () =>
      Promise.reject(new Error("not used by ingestion")),
    getSeriesWatchProviders: () =>
      Promise.reject(new Error("not used by ingestion")),
  };
  return { source, calls };
}
