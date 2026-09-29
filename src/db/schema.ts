// M1 catalog schema. Design notes, constraints and index rationale live in
// docs/catalog-schema.md; keep the two in sync.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const titleKind = pgEnum("title_kind", ["movie", "series"]);

/** TMDB watch-provider monetization types (JustWatch data via TMDB). */
export const offerMonetization = pgEnum("offer_monetization", [
  "flatrate",
  "free",
  "ads",
  "rent",
  "buy",
]);

/**
 * Unsized pgvector column. Embedding models differ in dimension, so the size
 * is stored per row (title_embeddings.dimensions) and ANN indexes are created
 * per model as partial expression indexes once a model is chosen (#17).
 */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType: () => "vector",
  toDriver: (value) => `[${value.join(",")}]`,
  fromDriver: (value) => JSON.parse(value) as number[],
});

const fetchedAt = (name: string) =>
  timestamp(name, { withTimezone: true }).notNull();

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Fields shared by movies and series. */
export const titles = pgTable(
  "titles",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    kind: titleKind("kind").notNull(),
    /** TMDB movie or TV id. The two ID spaces overlap, hence (kind, tmdb_id). */
    tmdbId: integer("tmdb_id").notNull(),
    title: text("title").notNull(),
    originalTitle: text("original_title"),
    originalLanguage: text("original_language"),
    overview: text("overview"),
    /** Movie release date, or first air date for series. */
    releaseDate: date("release_date"),
    posterPath: text("poster_path"),
    popularity: real("popularity"),
    voteAverage: real("vote_average"),
    voteCount: integer("vote_count"),
    /** When TMDB details were last fetched for this title. */
    tmdbFetchedAt: fetchedAt("tmdb_fetched_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("titles_kind_tmdb_id_key").on(t.kind, t.tmdbId),
    // Target of the subtype tables' composite FKs (id alone is already unique).
    unique("titles_id_kind_key").on(t.id, t.kind),
    check("titles_tmdb_id_positive", sql`${t.tmdbId} > 0`),
    check("titles_title_not_blank", sql`btrim(${t.title}) <> ''`),
    check("titles_popularity_nonnegative", sql`${t.popularity} >= 0`),
    check("titles_vote_average_range", sql`${t.voteAverage} between 0 and 10`),
    check("titles_vote_count_nonnegative", sql`${t.voteCount} >= 0`),
  ],
);

export const movies = pgTable(
  "movies",
  {
    titleId: bigint("title_id", { mode: "number" }).primaryKey(),
    /** Always 'movie'; lets the composite FK reject series titles. */
    kind: titleKind("kind").notNull().default("movie"),
    runtimeMinutes: smallint("runtime_minutes"),
    imdbId: text("imdb_id"),
  },
  (t) => [
    foreignKey({
      name: "movies_title_fkey",
      columns: [t.titleId, t.kind],
      foreignColumns: [titles.id, titles.kind],
    }).onDelete("cascade"),
    check("movies_kind_is_movie", sql`${t.kind} = 'movie'`),
    check("movies_runtime_positive", sql`${t.runtimeMinutes} > 0`),
    check("movies_imdb_id_format", sql`${t.imdbId} ~ '^tt[0-9]+$'`),
  ],
);

export const series = pgTable(
  "series",
  {
    titleId: bigint("title_id", { mode: "number" }).primaryKey(),
    /** Always 'series'; lets the composite FK reject movie titles. */
    kind: titleKind("kind").notNull().default("series"),
    /** TMDB status, e.g. "Returning Series", "Ended", "Canceled". */
    status: text("status"),
    lastAirDate: date("last_air_date"),
    /** Typical episode length (TMDB episode_run_time, first value). */
    episodeRuntimeMinutes: smallint("episode_runtime_minutes"),
    /** Regular seasons; excludes season 0 (specials). */
    seasonCount: smallint("season_count"),
  },
  (t) => [
    foreignKey({
      name: "series_title_fkey",
      columns: [t.titleId, t.kind],
      foreignColumns: [titles.id, titles.kind],
    }).onDelete("cascade"),
    check("series_kind_is_series", sql`${t.kind} = 'series'`),
    check(
      "series_episode_runtime_positive",
      sql`${t.episodeRuntimeMinutes} > 0`,
    ),
    check("series_season_count_nonnegative", sql`${t.seasonCount} >= 0`),
  ],
);

/** Seasons are recommendable units of a series; episodes are not modeled. */
export const seasons = pgTable(
  "seasons",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    seriesId: bigint("series_id", { mode: "number" })
      .notNull()
      .references(() => series.titleId, { onDelete: "cascade" }),
    /** 0 is TMDB's "Specials" season. */
    seasonNumber: smallint("season_number").notNull(),
    name: text("name"),
    overview: text("overview"),
    airDate: date("air_date"),
    episodeCount: smallint("episode_count"),
    posterPath: text("poster_path"),
  },
  (t) => [
    unique("seasons_series_id_season_number_key").on(
      t.seriesId,
      t.seasonNumber,
    ),
    check("seasons_season_number_nonnegative", sql`${t.seasonNumber} >= 0`),
    check("seasons_episode_count_nonnegative", sql`${t.episodeCount} >= 0`),
  ],
);

/** TMDB genres; id is the TMDB genre id. */
export const genres = pgTable(
  "genres",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
  },
  (t) => [check("genres_name_not_blank", sql`btrim(${t.name}) <> ''`)],
);

export const titleGenres = pgTable(
  "title_genres",
  {
    titleId: bigint("title_id", { mode: "number" })
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    genreId: integer("genre_id")
      .notNull()
      .references(() => genres.id, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ name: "title_genres_pkey", columns: [t.titleId, t.genreId] }),
    index("title_genres_genre_id_idx").on(t.genreId),
  ],
);

/** TMDB keywords; id is the TMDB keyword id. */
export const keywords = pgTable(
  "keywords",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
  },
  (t) => [check("keywords_name_not_blank", sql`btrim(${t.name}) <> ''`)],
);

export const titleKeywords = pgTable(
  "title_keywords",
  {
    titleId: bigint("title_id", { mode: "number" })
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    keywordId: integer("keyword_id")
      .notNull()
      .references(() => keywords.id, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({
      name: "title_keywords_pkey",
      columns: [t.titleId, t.keywordId],
    }),
    index("title_keywords_keyword_id_idx").on(t.keywordId),
  ],
);

/** Streaming services; id is the TMDB watch-provider id. */
export const watchProviders = pgTable(
  "watch_providers",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    logoPath: text("logo_path"),
  },
  (t) => [check("watch_providers_name_not_blank", sql`btrim(${t.name}) <> ''`)],
);

/**
 * One row per title and region that has been checked. Its presence with zero
 * offers means "checked, not streamable"; its absence means "never checked".
 */
export const titleAvailability = pgTable(
  "title_availability",
  {
    titleId: bigint("title_id", { mode: "number" })
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    /** v1 is US-only (docs/product.md); other regions need an owner decision. */
    region: text("region").notNull().default("US"),
    /** Attribution: TMDB watch-provider data is sourced from JustWatch. */
    source: text("source").notNull().default("tmdb-justwatch"),
    /** TMDB watch page for this title and region (attribution link). */
    link: text("link"),
    fetchedAt: fetchedAt("fetched_at"),
  },
  (t) => [
    primaryKey({
      name: "title_availability_pkey",
      columns: [t.titleId, t.region],
    }),
    check("title_availability_region_us", sql`${t.region} = 'US'`),
    index("title_availability_fetched_at_idx").on(t.fetchedAt),
  ],
);

export const titleOffers = pgTable(
  "title_offers",
  {
    titleId: bigint("title_id", { mode: "number" }).notNull(),
    region: text("region").notNull().default("US"),
    providerId: integer("provider_id")
      .notNull()
      .references(() => watchProviders.id, { onDelete: "restrict" }),
    monetization: offerMonetization("monetization").notNull(),
  },
  (t) => [
    primaryKey({
      name: "title_offers_pkey",
      columns: [t.titleId, t.region, t.providerId, t.monetization],
    }),
    // Offers only exist under a checked availability row; replacing that row
    // (a refresh) replaces its offers.
    foreignKey({
      name: "title_offers_availability_fkey",
      columns: [t.titleId, t.region],
      foreignColumns: [titleAvailability.titleId, titleAvailability.region],
    }).onDelete("cascade"),
    // "Titles on my services" filter; title_id last for index-only scans.
    index("title_offers_provider_monetization_idx").on(
      t.providerId,
      t.monetization,
      t.titleId,
    ),
  ],
);

/**
 * One embedding per title and model. `model` names the provider, model and
 * input-template version (e.g. "provider/model@v1"); re-embed when
 * content_hash no longer matches the title's current embedding input.
 */
export const titleEmbeddings = pgTable(
  "title_embeddings",
  {
    titleId: bigint("title_id", { mode: "number" })
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    dimensions: smallint("dimensions").notNull(),
    embedding: vector("embedding").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({
      name: "title_embeddings_pkey",
      columns: [t.titleId, t.model],
    }),
    check("title_embeddings_model_not_blank", sql`btrim(${t.model}) <> ''`),
    check(
      "title_embeddings_dimensions_match",
      sql`${t.dimensions} > 0 and vector_dims(${t.embedding}) = ${t.dimensions}`,
    ),
  ],
);
