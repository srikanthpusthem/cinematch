// Server-only TMDB v3 client for catalog ingestion. Callers depend on the
// CatalogSource interface so the provider stays swappable.
import {
  MalformedResponseError,
  parseMovieDetails,
  parseMovieSummary,
  parsePage,
  parseSeasonDetails,
  parseSeriesDetails,
  parseSeriesSummary,
  parseWatchProviders,
  type MovieDetails,
  type MovieSummary,
  type Page,
  type SeasonDetails,
  type SeriesDetails,
  type SeriesSummary,
  type WatchProviders,
} from "./schema";

if (typeof window !== "undefined") {
  throw new Error("src/tmdb is server-only; never import it from client code");
}

export type QueryParams = Record<string, string | number | boolean>;

export interface PaginationOptions {
  /** Stop after this many pages (TMDB itself serves at most 500). */
  maxPages?: number;
}

export interface CatalogSource {
  discoverMovies(
    params?: QueryParams,
    options?: PaginationOptions,
  ): AsyncIterable<Page<MovieSummary>>;
  discoverSeries(
    params?: QueryParams,
    options?: PaginationOptions,
  ): AsyncIterable<Page<SeriesSummary>>;
  getMovie(id: number): Promise<MovieDetails>;
  getSeries(id: number): Promise<SeriesDetails>;
  getSeason(seriesId: number, seasonNumber: number): Promise<SeasonDetails>;
  getMovieWatchProviders(id: number): Promise<WatchProviders>;
  getSeriesWatchProviders(id: number): Promise<WatchProviders>;
}

export type TmdbErrorCode =
  | "unauthorized"
  | "not_found"
  | "rate_limited"
  | "server"
  | "http"
  | "network"
  | "timeout"
  | "malformed";

/**
 * Errors carry only the request path (no query string, credentials or
 * response body), so they are safe to log.
 */
export class TmdbError extends Error {
  constructor(
    readonly code: TmdbErrorCode,
    readonly path: string,
    readonly attempts: number,
    readonly status?: number,
    readonly detail?: string,
  ) {
    const parts = [status ? `HTTP ${status}` : null, detail].filter(Boolean);
    super(
      `TMDB ${code} for ${path}` +
        (parts.length ? ` (${parts.join(", ")})` : "") +
        ` after ${attempts} attempt${attempts === 1 ? "" : "s"}`,
    );
    this.name = "TmdbError";
  }
}

export interface TmdbClientOptions {
  /** TMDB v3 API key, or a v4 read access token (sent as a Bearer header). */
  apiKey: string;
  baseUrl?: string;
  /** Per-attempt timeout, including reading the body. */
  timeoutMs?: number;
  /** Retries after the first attempt, for 429, 5xx, network errors and timeouts. */
  maxRetries?: number;
  /** Minimum spacing between requests from this client. TMDB allows ~50 req/s. */
  minIntervalMs?: number;
  baseDelayMs?: number;
  /** Upper bound for any single backoff or Retry-After wait. */
  maxDelayMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

export const TMDB_MAX_PAGE = 500;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

class RetryableError extends Error {
  constructor(
    readonly code: TmdbErrorCode,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(code);
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

export function createTmdbClient(options: TmdbClientOptions): CatalogSource {
  const {
    apiKey,
    baseUrl = "https://api.themoviedb.org/3",
    timeoutMs = 10_000,
    maxRetries = 3,
    minIntervalMs = 50,
    baseDelayMs = 500,
    maxDelayMs = 10_000,
    fetch: fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    now = Date.now,
    random = Math.random,
  } = options;

  if (!apiKey) throw new Error("TMDB API key is required");
  const useBearer = apiKey.includes(".");

  // Throttle: each request reserves the next free slot synchronously, so
  // concurrent callers are spaced out rather than bursting.
  let nextSlot = 0;
  async function waitForSlot() {
    const t = now();
    const start = Math.max(t, nextSlot);
    nextSlot = start + minIntervalMs;
    if (start > t) await sleep(start - t);
  }

  function backoff(attempt: number): number {
    const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
    return Math.round(exp / 2 + (exp / 2) * random());
  }

  async function attemptOnce<T>(
    url: URL,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          signal: controller.signal,
          headers: {
            accept: "application/json",
            ...(useBearer ? { authorization: `Bearer ${apiKey}` } : {}),
          },
        });
      } catch {
        throw new RetryableError(
          controller.signal.aborted ? "timeout" : "network",
        );
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const { status } = response;
        if (status === 429) {
          throw new RetryableError(
            "rate_limited",
            status,
            parseRetryAfter(response.headers.get("retry-after")),
          );
        }
        if (status >= 500) throw new RetryableError("server", status);
        const code =
          status === 401
            ? "unauthorized"
            : status === 404
              ? "not_found"
              : "http";
        throw new TmdbError(code, url.pathname, 0, status);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        if (controller.signal.aborted) throw new RetryableError("timeout");
        throw new TmdbError(
          "malformed",
          url.pathname,
          0,
          undefined,
          "invalid JSON",
        );
      }
      return parse(body);
    } finally {
      clearTimeout(timer);
    }
  }

  async function get<T>(
    path: string,
    params: QueryParams,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const url = new URL(baseUrl.replace(/\/$/, "") + path);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
    if (!useBearer) url.searchParams.set("api_key", apiKey);
    const displayPath = new URL(baseUrl).pathname.replace(/\/$/, "") + path;

    for (let attempt = 1; ; attempt++) {
      await waitForSlot();
      try {
        return await attemptOnce(url, parse);
      } catch (error) {
        if (error instanceof TmdbError) {
          throw new TmdbError(
            error.code,
            displayPath,
            attempt,
            error.status,
            error.detail,
          );
        }
        if (error instanceof MalformedResponseError) {
          throw new TmdbError(
            "malformed",
            displayPath,
            attempt,
            undefined,
            error.message,
          );
        }
        if (!(error instanceof RetryableError)) throw error;
        if (attempt > maxRetries) {
          throw new TmdbError(error.code, displayPath, attempt, error.status);
        }
        const delay = Math.min(
          maxDelayMs,
          error.retryAfterMs ?? backoff(attempt),
        );
        if (error.code === "rate_limited") {
          // Hold back every request from this client, not just this one.
          nextSlot = Math.max(nextSlot, now() + delay);
        } else {
          await sleep(delay);
        }
      }
    }
  }

  async function* paginate<T>(
    path: string,
    params: QueryParams,
    parseItem: (value: unknown, where: string) => T,
    { maxPages = TMDB_MAX_PAGE }: PaginationOptions,
  ): AsyncGenerator<Page<T>> {
    let last = 1;
    for (let page = 1; page <= last; page++) {
      const result = await get(path, { ...params, page }, (v) =>
        parsePage(v, parseItem),
      );
      yield result;
      last = Math.min(result.totalPages, TMDB_MAX_PAGE, maxPages);
    }
  }

  return {
    discoverMovies: (params = {}, opts = {}) =>
      paginate("/discover/movie", params, parseMovieSummary, opts),
    discoverSeries: (params = {}, opts = {}) =>
      paginate("/discover/tv", params, parseSeriesSummary, opts),
    getMovie: (id) => get(`/movie/${id}`, {}, parseMovieDetails),
    getSeries: (id) => get(`/tv/${id}`, {}, parseSeriesDetails),
    getSeason: (seriesId, seasonNumber) =>
      get(`/tv/${seriesId}/season/${seasonNumber}`, {}, parseSeasonDetails),
    getMovieWatchProviders: (id) =>
      get(`/movie/${id}/watch/providers`, {}, parseWatchProviders),
    getSeriesWatchProviders: (id) =>
      get(`/tv/${id}/watch/providers`, {}, parseWatchProviders),
  };
}

/** Builds a client from TMDB_API_KEY; throws (without echoing values) if unset. */
export function createTmdbClientFromEnv(
  env: Record<string, string | undefined> = process.env,
  options: Omit<TmdbClientOptions, "apiKey"> = {},
): CatalogSource {
  const apiKey = env.TMDB_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("TMDB_API_KEY is required (see .env.example)");
  }
  return createTmdbClient({ ...options, apiKey });
}
