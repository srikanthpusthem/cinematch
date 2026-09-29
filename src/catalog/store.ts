// Idempotent catalog writes. Each title is saved in one transaction: the
// title and subtype are upserted on their natural keys, genre/keyword links
// are replaced, and (for series) seasons are upserted and stale ones removed.
import { and, count, eq, gte, max, min, notInArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import type { Keyword, MovieDetails, SeriesDetails } from "../tmdb/schema";

const {
  genres,
  keywords,
  movies,
  seasons,
  series,
  titleGenres,
  titleKeywords,
  titles,
} = schema;

export type CatalogDb = PostgresJsDatabase<typeof schema>;
export type TitleKind = "movie" | "series";
export type SaveResult = "inserted" | "updated";

export interface CatalogStats {
  movies: number;
  series: number;
  seasons: number;
  genres: number;
  keywords: number;
  oldestFetchedAt: Date | null;
  newestFetchedAt: Date | null;
}

export interface CatalogStore {
  /** TMDB ids of this kind fetched at or after `since` (for resuming). */
  recentlyFetched(kind: TitleKind, since: Date): Promise<Set<number>>;
  saveMovie(details: MovieDetails, fetchedAt: Date): Promise<SaveResult>;
  saveSeries(details: SeriesDetails, fetchedAt: Date): Promise<SaveResult>;
  stats(): Promise<CatalogStats>;
}

// --- Row mapping (pure; TMDB values that would violate schema CHECKs become null)

const positiveOrNull = (n: number | null | undefined) =>
  n != null && Number.isFinite(n) && n > 0 ? Math.round(n) : null;

const nonNegativeOrNull = (n: number | null | undefined) =>
  n != null && Number.isFinite(n) && n >= 0 ? n : null;

const voteAverageOrNull = (n: number | null | undefined) =>
  n != null && n >= 0 && n <= 10 ? n : null;

/** Smallint columns: runtimes beyond this are data errors, not real lengths. */
const MAX_MINUTES = 32_767;

export function movieRows(d: MovieDetails, fetchedAt: Date) {
  const runtime = positiveOrNull(d.runtime);
  return {
    title: {
      kind: "movie" as const,
      tmdbId: d.id,
      title: d.title.trim(),
      originalTitle: d.originalTitle,
      originalLanguage: d.originalLanguage,
      overview: d.overview,
      releaseDate: d.releaseDate,
      posterPath: d.posterPath,
      popularity: nonNegativeOrNull(d.popularity),
      voteAverage: voteAverageOrNull(d.voteAverage),
      voteCount: nonNegativeOrNull(d.voteCount),
      tmdbFetchedAt: fetchedAt,
    },
    movie: {
      runtimeMinutes:
        runtime != null && runtime <= MAX_MINUTES ? runtime : null,
      imdbId: d.imdbId && /^tt[0-9]+$/.test(d.imdbId) ? d.imdbId : null,
    },
  };
}

export function seriesRows(d: SeriesDetails, fetchedAt: Date) {
  const episodeRuntime = positiveOrNull(d.episodeRunTimes[0]);
  // Season numbers are unique per series; keep the first if TMDB repeats one.
  const bySeason = new Map<number, (typeof d.seasons)[number]>();
  for (const s of d.seasons) {
    if (s.seasonNumber >= 0 && !bySeason.has(s.seasonNumber)) {
      bySeason.set(s.seasonNumber, s);
    }
  }
  const seasonList = [...bySeason.values()];
  return {
    title: {
      kind: "series" as const,
      tmdbId: d.id,
      title: d.name.trim(),
      originalTitle: d.originalName,
      originalLanguage: d.originalLanguage,
      overview: d.overview,
      releaseDate: d.firstAirDate,
      posterPath: d.posterPath,
      popularity: nonNegativeOrNull(d.popularity),
      voteAverage: voteAverageOrNull(d.voteAverage),
      voteCount: nonNegativeOrNull(d.voteCount),
      tmdbFetchedAt: fetchedAt,
    },
    series: {
      status: d.status,
      lastAirDate: d.lastAirDate,
      episodeRuntimeMinutes:
        episodeRuntime != null && episodeRuntime <= MAX_MINUTES
          ? episodeRuntime
          : null,
      // Regular seasons only; season 0 is Specials.
      seasonCount: seasonList.filter((s) => s.seasonNumber > 0).length,
    },
    seasons: seasonList.map((s) => ({
      seasonNumber: s.seasonNumber,
      name: s.name,
      overview: s.overview,
      airDate: s.airDate,
      episodeCount: nonNegativeOrNull(s.episodeCount),
      posterPath: s.posterPath,
    })),
  };
}

/**
 * Drops blank names and duplicate ids (first wins), sorted by id so concurrent
 * transactions lock shared genre/keyword rows in the same order (no deadlocks).
 */
export function cleanTerms(terms: readonly Keyword[]): Keyword[] {
  const seen = new Map<number, Keyword>();
  for (const t of terms) {
    const name = t.name.trim();
    if (name && t.id > 0 && !seen.has(t.id)) seen.set(t.id, { id: t.id, name });
  }
  return [...seen.values()].sort((a, b) => a.id - b.id);
}

// --- Database store

const excluded = (column: string) => sql.raw(`excluded."${column}"`);

type Tx = Parameters<Parameters<CatalogDb["transaction"]>[0]>[0];

async function upsertTitle(
  tx: Tx,
  row:
    | ReturnType<typeof movieRows>["title"]
    | ReturnType<typeof seriesRows>["title"],
) {
  const [saved] = await tx
    .insert(titles)
    .values(row)
    .onConflictDoUpdate({
      target: [titles.kind, titles.tmdbId],
      set: {
        title: excluded("title"),
        originalTitle: excluded("original_title"),
        originalLanguage: excluded("original_language"),
        overview: excluded("overview"),
        releaseDate: excluded("release_date"),
        posterPath: excluded("poster_path"),
        popularity: excluded("popularity"),
        voteAverage: excluded("vote_average"),
        voteCount: excluded("vote_count"),
        tmdbFetchedAt: excluded("tmdb_fetched_at"),
      },
    })
    // xmax = 0 only for a freshly inserted row version.
    .returning({ id: titles.id, inserted: sql<boolean>`(xmax = 0)` });
  return saved!;
}

async function replaceTerms(
  tx: Tx,
  titleId: number,
  genreList: readonly Keyword[],
  keywordList: readonly Keyword[],
) {
  const cleanGenres = cleanTerms(genreList);
  const cleanKeywords = cleanTerms(keywordList);

  if (cleanGenres.length) {
    await tx
      .insert(genres)
      .values(cleanGenres)
      .onConflictDoUpdate({
        target: genres.id,
        set: { name: excluded("name") },
      });
  }
  if (cleanKeywords.length) {
    await tx
      .insert(keywords)
      .values(cleanKeywords)
      .onConflictDoUpdate({
        target: keywords.id,
        set: { name: excluded("name") },
      });
  }

  await tx.delete(titleGenres).where(eq(titleGenres.titleId, titleId));
  if (cleanGenres.length) {
    await tx
      .insert(titleGenres)
      .values(cleanGenres.map((g) => ({ titleId, genreId: g.id })));
  }
  await tx.delete(titleKeywords).where(eq(titleKeywords.titleId, titleId));
  if (cleanKeywords.length) {
    await tx
      .insert(titleKeywords)
      .values(cleanKeywords.map((k) => ({ titleId, keywordId: k.id })));
  }
}

export function createCatalogStore(db: CatalogDb): CatalogStore {
  return {
    async recentlyFetched(kind, since) {
      const rows = await db
        .select({ tmdbId: titles.tmdbId })
        .from(titles)
        .where(and(eq(titles.kind, kind), gte(titles.tmdbFetchedAt, since)));
      return new Set(rows.map((r) => r.tmdbId));
    },

    saveMovie(details, fetchedAt) {
      const rows = movieRows(details, fetchedAt);
      return db.transaction(async (tx) => {
        const title = await upsertTitle(tx, rows.title);
        await tx
          .insert(movies)
          .values({ titleId: title.id, ...rows.movie })
          .onConflictDoUpdate({
            target: movies.titleId,
            set: {
              runtimeMinutes: excluded("runtime_minutes"),
              imdbId: excluded("imdb_id"),
            },
          });
        await replaceTerms(tx, title.id, details.genres, details.keywords);
        return title.inserted ? "inserted" : "updated";
      });
    },

    saveSeries(details, fetchedAt) {
      const rows = seriesRows(details, fetchedAt);
      return db.transaction(async (tx) => {
        const title = await upsertTitle(tx, rows.title);
        await tx
          .insert(series)
          .values({ titleId: title.id, ...rows.series })
          .onConflictDoUpdate({
            target: series.titleId,
            set: {
              status: excluded("status"),
              lastAirDate: excluded("last_air_date"),
              episodeRuntimeMinutes: excluded("episode_runtime_minutes"),
              seasonCount: excluded("season_count"),
            },
          });

        const numbers = rows.seasons.map((s) => s.seasonNumber);
        await tx
          .delete(seasons)
          .where(
            numbers.length
              ? and(
                  eq(seasons.seriesId, title.id),
                  notInArray(seasons.seasonNumber, numbers),
                )
              : eq(seasons.seriesId, title.id),
          );
        if (rows.seasons.length) {
          await tx
            .insert(seasons)
            .values(rows.seasons.map((s) => ({ seriesId: title.id, ...s })))
            .onConflictDoUpdate({
              target: [seasons.seriesId, seasons.seasonNumber],
              set: {
                name: excluded("name"),
                overview: excluded("overview"),
                airDate: excluded("air_date"),
                episodeCount: excluded("episode_count"),
                posterPath: excluded("poster_path"),
              },
            });
        }

        await replaceTerms(tx, title.id, details.genres, details.keywords);
        return title.inserted ? "inserted" : "updated";
      });
    },

    async stats() {
      const [t] = await db
        .select({
          movies: sql<number>`count(*) filter (where ${titles.kind} = 'movie')::int`,
          series: sql<number>`count(*) filter (where ${titles.kind} = 'series')::int`,
          oldest: min(titles.tmdbFetchedAt),
          newest: max(titles.tmdbFetchedAt),
        })
        .from(titles);
      const [s] = await db.select({ n: count() }).from(seasons);
      const [g] = await db.select({ n: count() }).from(genres);
      const [k] = await db.select({ n: count() }).from(keywords);
      return {
        movies: t?.movies ?? 0,
        series: t?.series ?? 0,
        seasons: s?.n ?? 0,
        genres: g?.n ?? 0,
        keywords: k?.n ?? 0,
        oldestFetchedAt: t?.oldest ?? null,
        newestFetchedAt: t?.newest ?? null,
      };
    },
  };
}
