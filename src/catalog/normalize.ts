// The single interpretation of raw TMDB records (issue #69). Pure: no I/O, no
// locale or timezone APIs, deterministic regardless of input key order.
// Every lossy step adds a code to `notes`; docs/catalog-normalization.md
// documents each rule. Problems are reported as codes and field names only,
// never as source values.

/** TMDB is queried in its default language, so display titles are English. */
export const DISPLAY_LANGUAGE = "en";

export const LIMITS = {
  titleLength: 500,
  overviewLength: 10_000,
  termNameLength: 200,
  genres: 50,
  keywords: 500,
  seasons: 500,
  movieRuntimeMinutes: 1440,
  episodeRuntimeMinutes: 600,
  statusLength: 100,
  batchSize: 10_000,
  minYear: 1870,
  maxYear: 2100,
} as const;

export type NormalizationNote =
  | "title_from_original"
  | "original_title_invalid"
  | "overview_invalid"
  | "overview_too_long"
  | "original_language_invalid"
  | "release_date_invalid"
  | "last_air_date_invalid"
  | "runtime_invalid"
  | "runtime_rounded"
  | "episode_runtime_from_last_episode"
  | "episode_runtime_invalid"
  | "status_missing"
  | "status_unknown"
  | "genres_invalid"
  | "genre_dropped"
  | "genres_truncated"
  | "keywords_invalid"
  | "keyword_dropped"
  | "keywords_truncated"
  | "duplicate_term"
  | "popularity_invalid"
  | "vote_average_invalid"
  | "vote_count_invalid"
  | "poster_path_invalid"
  | "backdrop_path_invalid"
  | "imdb_id_invalid"
  | "seasons_invalid"
  | "season_dropped"
  | "duplicate_season"
  | "seasons_truncated"
  | "season_field_invalid";

export type SkipReason =
  "not_an_object" | "invalid_id" | "missing_title" | "title_too_long" | "adult";

export interface Term {
  id: number;
  name: string;
}

export type MovieStatus =
  | "rumored"
  | "planned"
  | "in_production"
  | "post_production"
  | "released"
  | "canceled"
  | "unknown";

export type SeriesStatus =
  | "returning"
  | "planned"
  | "in_production"
  | "pilot"
  | "ended"
  | "canceled"
  | "unknown";

interface NormalizedTitle {
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  displayLanguage: typeof DISPLAY_LANGUAGE;
  originalLanguage: string | null;
  overview: string | null;
  /** Movie release date or series first air date (YYYY-MM-DD). */
  releaseDate: string | null;
  releaseYear: number | null;
  genres: Term[];
  keywords: Term[];
  popularity: number | null;
  voteAverage: number | null;
  voteCount: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  /** Source values kept verbatim (canonicalized text) for audits. */
  provenance: { source: "tmdb"; sourceStatus: string | null };
  /** Sorted, unique codes for every lossy transformation applied. */
  notes: NormalizationNote[];
}

export interface NormalizedMovie extends NormalizedTitle {
  kind: "movie";
  status: MovieStatus;
  runtimeMinutes: number | null;
  imdbId: string | null;
}

export interface NormalizedSeason {
  seasonNumber: number;
  isSpecials: boolean;
  name: string | null;
  overview: string | null;
  airDate: string | null;
  episodeCount: number | null;
  posterPath: string | null;
}

export interface NormalizedSeries extends NormalizedTitle {
  kind: "series";
  status: SeriesStatus;
  lastAirDate: string | null;
  episodeRuntimeMinutes: number | null;
  /** Regular seasons (excludes season 0, Specials). */
  seasonCount: number;
  seasons: NormalizedSeason[];
}

export type Normalized<T> =
  | { ok: true; record: T }
  | { ok: false; severity: "skip"; reason: SkipReason; tmdbId: number | null };

/** A batch-level problem: the whole input is unusable, not just one record. */
export class NormalizationFatalError extends Error {
  constructor(readonly reason: "batch_not_array" | "batch_too_large") {
    super(`TMDB batch rejected: ${reason}`);
    this.name = "NormalizationFatalError";
  }
}

// --- Text

// Invisible characters with no meaning in display text. ZWJ (U+200D) and ZWNJ
// (U+200C) are kept: they change rendering in emoji and several scripts.
const INVISIBLE = /[\u200B\u2060\uFEFF\u00AD]/g; // ZWSP, word joiner, BOM, soft hyphen
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const UNICODE_SPACE = /[\t\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;

/** Canonical single-line text: NFC, invisible/control chars removed, spaces collapsed. */
export function canonicalLine(value: string): string {
  return value
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(/\r\n?|\n|\u2028|\u2029/g, " ")
    .replace(CONTROL, "")
    .replace(UNICODE_SPACE, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** Canonical multi-line text: as canonicalLine, but paragraph breaks survive. */
export function canonicalParagraphs(value: string): string {
  return value
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(/\r\n?|\u2028|\u2029/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(CONTROL, "")
        .replace(UNICODE_SPACE, " ")
        .replace(/ {2,}/g, " ")
        .trim(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// --- Field readers (each returns a value or null, adding notes on loss)

type Raw = Record<string, unknown>;
type Notes = Set<NormalizationNote>;

const isObject = (v: unknown): v is Raw =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function optLine(
  v: unknown,
  notes: Notes,
  invalid: NormalizationNote,
): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") {
    notes.add(invalid);
    return null;
  }
  return canonicalLine(v) || null;
}

function overview(v: unknown, notes: Notes): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") {
    notes.add("overview_invalid");
    return null;
  }
  const text = canonicalParagraphs(v);
  if (text.length > LIMITS.overviewLength) {
    notes.add("overview_too_long");
    return null;
  }
  return text || null;
}

function positiveId(v: unknown): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null;
}

function language(v: unknown, notes: Notes): string | null {
  if (v === null || v === undefined || v === "") return null;
  // ASCII-only lowercasing: independent of the runtime locale.
  if (typeof v === "string" && /^[A-Za-z]{2}$/.test(v)) {
    const code = v.replace(/[A-Z]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) + 32),
    );
    if (code !== "xx") return code; // TMDB uses "xx" for "no language"
  }
  notes.add("original_language_invalid");
  return null;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** A real calendar date in YYYY-MM-DD, checked arithmetically (no Date/timezone). */
function calendarDate(
  v: unknown,
  notes: Notes,
  invalid: NormalizationNote,
): string | null {
  if (v === null || v === undefined || v === "") return null;
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  if (m) {
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const maxDay = month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1];
    if (
      year >= LIMITS.minYear &&
      year <= LIMITS.maxYear &&
      maxDay !== undefined &&
      day >= 1 &&
      day <= maxDay
    ) {
      return v as string;
    }
  }
  notes.add(invalid);
  return null;
}

function number(
  v: unknown,
  notes: Notes,
  invalid: NormalizationNote,
  ok: (n: number) => boolean,
): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v) && ok(v)) return v;
  notes.add(invalid);
  return null;
}

// TMDB image paths look like "/kqjL17yufvn9OVLyXYpvtyrFfak.jpg".
const IMAGE_PATH = /^\/[A-Za-z0-9_-]{1,128}\.(?:jpe?g|png|webp|svg)$/;

function imagePath(
  v: unknown,
  notes: Notes,
  invalid: NormalizationNote,
): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" && IMAGE_PATH.test(v)) return v;
  notes.add(invalid); // full URLs, schemes, traversal, odd extensions
  return null;
}

function terms(
  v: unknown,
  notes: Notes,
  codes: {
    invalid: NormalizationNote;
    dropped: NormalizationNote;
    truncated: NormalizationNote;
  },
  max: number,
): Term[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) {
    notes.add(codes.invalid);
    return [];
  }
  const byId = new Map<number, Term>();
  for (const item of v) {
    const id = isObject(item) ? positiveId(item.id) : null;
    const name =
      isObject(item) && typeof item.name === "string"
        ? canonicalLine(item.name)
        : "";
    if (id === null || !name || name.length > LIMITS.termNameLength) {
      notes.add(codes.dropped);
      continue;
    }
    if (byId.has(id)) {
      notes.add("duplicate_term");
      continue;
    }
    byId.set(id, { id, name });
  }
  const sorted = [...byId.values()].sort((a, b) => a.id - b.id);
  if (sorted.length > max) notes.add(codes.truncated);
  return sorted.slice(0, max);
}

/** Movies nest keywords as {keywords: [...]}, series as {results: [...]}. */
function keywordList(raw: Raw): unknown {
  const k = raw.keywords;
  if (Array.isArray(k)) return k;
  if (isObject(k)) return k.keywords ?? k.results;
  return k;
}

const MOVIE_STATUS: Record<string, MovieStatus> = {
  Rumored: "rumored",
  Planned: "planned",
  "In Production": "in_production",
  "Post Production": "post_production",
  Released: "released",
  Canceled: "canceled",
};

const SERIES_STATUS: Record<string, SeriesStatus> = {
  "Returning Series": "returning",
  Planned: "planned",
  "In Production": "in_production",
  Pilot: "pilot",
  Ended: "ended",
  Canceled: "canceled",
};

function status<S extends string>(
  v: unknown,
  table: Record<string, S>,
  notes: Notes,
): { status: S | "unknown"; source: string | null } {
  const source =
    typeof v === "string"
      ? canonicalLine(v).slice(0, LIMITS.statusLength) || null
      : null;
  if (source === null) {
    notes.add("status_missing");
    return { status: "unknown", source };
  }
  const mapped = Object.hasOwn(table, source) ? table[source] : undefined;
  if (!mapped) notes.add("status_unknown");
  return { status: mapped ?? "unknown", source };
}

// --- Shared title handling

function titleFields(
  raw: Raw,
  keys: { title: string; original: string; date: string },
  notes: Notes,
): Omit<NormalizedTitle, "provenance" | "notes"> | { skip: SkipReason } {
  if (raw.adult === true) return { skip: "adult" };

  const tmdbId = positiveId(raw.id);
  if (tmdbId === null) return { skip: "invalid_id" };

  const original = optLine(raw[keys.original], notes, "original_title_invalid");
  let title =
    typeof raw[keys.title] === "string"
      ? canonicalLine(raw[keys.title] as string)
      : "";
  if (!title && original) {
    title = original;
    notes.add("title_from_original");
  }
  if (!title) return { skip: "missing_title" };
  if (title.length > LIMITS.titleLength) return { skip: "title_too_long" };

  const releaseDate = calendarDate(
    raw[keys.date],
    notes,
    "release_date_invalid",
  );
  return {
    tmdbId,
    title,
    originalTitle: original,
    displayLanguage: DISPLAY_LANGUAGE,
    originalLanguage: language(raw.original_language, notes),
    overview: overview(raw.overview, notes),
    releaseDate,
    releaseYear: releaseDate ? Number(releaseDate.slice(0, 4)) : null,
    genres: terms(
      raw.genres,
      notes,
      {
        invalid: "genres_invalid",
        dropped: "genre_dropped",
        truncated: "genres_truncated",
      },
      LIMITS.genres,
    ),
    keywords: terms(
      keywordList(raw),
      notes,
      {
        invalid: "keywords_invalid",
        dropped: "keyword_dropped",
        truncated: "keywords_truncated",
      },
      LIMITS.keywords,
    ),
    popularity: number(
      raw.popularity,
      notes,
      "popularity_invalid",
      (n) => n >= 0,
    ),
    voteAverage: number(
      raw.vote_average,
      notes,
      "vote_average_invalid",
      (n) => n >= 0 && n <= 10,
    ),
    voteCount: number(
      raw.vote_count,
      notes,
      "vote_count_invalid",
      (n) => Number.isSafeInteger(n) && n >= 0,
    ),
    posterPath: imagePath(raw.poster_path, notes, "poster_path_invalid"),
    backdropPath: imagePath(raw.backdrop_path, notes, "backdrop_path_invalid"),
  };
}

const sortedNotes = (notes: Notes) => [...notes].sort();

// --- Public API

export function normalizeMovie(raw: unknown): Normalized<NormalizedMovie> {
  if (!isObject(raw))
    return {
      ok: false,
      severity: "skip",
      reason: "not_an_object",
      tmdbId: null,
    };
  const notes: Notes = new Set();
  const base = titleFields(
    raw,
    { title: "title", original: "original_title", date: "release_date" },
    notes,
  );
  if ("skip" in base) {
    return {
      ok: false,
      severity: "skip",
      reason: base.skip,
      tmdbId: positiveId(raw.id),
    };
  }

  let runtimeMinutes: number | null = null;
  const runtime = raw.runtime;
  if (typeof runtime === "number" && Number.isFinite(runtime) && runtime > 0) {
    const rounded = Math.round(runtime);
    if (rounded !== runtime) notes.add("runtime_rounded");
    if (rounded <= LIMITS.movieRuntimeMinutes) runtimeMinutes = rounded;
    else notes.add("runtime_invalid");
  } else if (runtime !== null && runtime !== undefined && runtime !== 0) {
    notes.add("runtime_invalid");
  }

  let imdbId: string | null = null;
  if (typeof raw.imdb_id === "string" && raw.imdb_id !== "") {
    if (/^tt\d{7,10}$/.test(raw.imdb_id)) imdbId = raw.imdb_id;
    else notes.add("imdb_id_invalid");
  }

  const s = status(raw.status, MOVIE_STATUS, notes);
  return {
    ok: true,
    record: {
      kind: "movie",
      ...base,
      status: s.status,
      runtimeMinutes,
      imdbId,
      provenance: { source: "tmdb", sourceStatus: s.source },
      notes: sortedNotes(notes),
    },
  };
}

/** Lower median of plausible values; deterministic for even counts. */
function medianRuntime(values: unknown): number | null {
  if (!Array.isArray(values)) return null;
  const ok = values
    .filter(
      (v): v is number =>
        typeof v === "number" &&
        Number.isInteger(v) &&
        v > 0 &&
        v <= LIMITS.episodeRuntimeMinutes,
    )
    .sort((a, b) => a - b);
  return ok.length ? ok[Math.floor((ok.length - 1) / 2)]! : null;
}

function seasonFrom(raw: unknown, notes: Notes): NormalizedSeason | null {
  if (!isObject(raw)) return null;
  const n = raw.season_number;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) return null;
  const episodes = Array.isArray(raw.episodes)
    ? raw.episodes.length
    : raw.episode_count;
  let episodeCount: number | null = null;
  if (
    typeof episodes === "number" &&
    Number.isSafeInteger(episodes) &&
    episodes >= 0
  ) {
    episodeCount = episodes;
  } else if (episodes !== null && episodes !== undefined) {
    notes.add("season_field_invalid");
  }
  return {
    seasonNumber: n,
    isSpecials: n === 0,
    name: optLine(raw.name, notes, "season_field_invalid"),
    overview: overview(raw.overview, notes),
    airDate: calendarDate(raw.air_date, notes, "season_field_invalid"),
    episodeCount,
    posterPath: imagePath(raw.poster_path, notes, "season_field_invalid"),
  };
}

export function normalizeSeries(raw: unknown): Normalized<NormalizedSeries> {
  if (!isObject(raw))
    return {
      ok: false,
      severity: "skip",
      reason: "not_an_object",
      tmdbId: null,
    };
  const notes: Notes = new Set();
  const base = titleFields(
    raw,
    { title: "name", original: "original_name", date: "first_air_date" },
    notes,
  );
  if ("skip" in base) {
    return {
      ok: false,
      severity: "skip",
      reason: base.skip,
      tmdbId: positiveId(raw.id),
    };
  }

  let episodeRuntimeMinutes = medianRuntime(raw.episode_run_time);
  if (episodeRuntimeMinutes === null) {
    const last = isObject(raw.last_episode_to_air)
      ? raw.last_episode_to_air.runtime
      : undefined;
    const fallback = medianRuntime(last === undefined ? [] : [last]);
    if (fallback !== null) {
      episodeRuntimeMinutes = fallback;
      notes.add("episode_runtime_from_last_episode");
    } else if (
      Array.isArray(raw.episode_run_time) &&
      raw.episode_run_time.length > 0
    ) {
      notes.add("episode_runtime_invalid");
    }
  }

  const seasons = new Map<number, NormalizedSeason>();
  if (
    raw.seasons !== undefined &&
    raw.seasons !== null &&
    !Array.isArray(raw.seasons)
  ) {
    notes.add("seasons_invalid");
  }
  for (const item of Array.isArray(raw.seasons) ? raw.seasons : []) {
    const season = seasonFrom(item, notes);
    if (!season) notes.add("season_dropped");
    else if (seasons.has(season.seasonNumber)) notes.add("duplicate_season");
    else seasons.set(season.seasonNumber, season);
  }
  const seasonList = [...seasons.values()].sort(
    (a, b) => a.seasonNumber - b.seasonNumber,
  );
  if (seasonList.length > LIMITS.seasons) notes.add("seasons_truncated");
  const kept = seasonList.slice(0, LIMITS.seasons);

  const s = status(raw.status, SERIES_STATUS, notes);
  return {
    ok: true,
    record: {
      kind: "series",
      ...base,
      status: s.status,
      lastAirDate: calendarDate(
        raw.last_air_date,
        notes,
        "last_air_date_invalid",
      ),
      episodeRuntimeMinutes,
      seasonCount: kept.filter((x) => !x.isSpecials).length,
      seasons: kept,
      provenance: { source: "tmdb", sourceStatus: s.source },
      notes: sortedNotes(notes),
    },
  };
}

/** Season detail payload (/tv/{id}/season/{n}); episodes only contribute a count. */
export function normalizeSeason(
  raw: unknown,
):
  | { ok: true; record: NormalizedSeason; notes: NormalizationNote[] }
  | { ok: false; severity: "skip"; reason: "not_an_object" | "invalid_id" } {
  if (!isObject(raw))
    return { ok: false, severity: "skip", reason: "not_an_object" };
  const notes: Notes = new Set();
  const season = seasonFrom(raw, notes);
  if (!season) return { ok: false, severity: "skip", reason: "invalid_id" };
  return { ok: true, record: season, notes: sortedNotes(notes) };
}

export interface BatchResult<T> {
  records: T[];
  skipped: { index: number; reason: string; tmdbId: number | null }[];
}

/**
 * Normalizes a list of raw records. Individual bad records are skipped with a
 * reason; only a structurally unusable batch throws NormalizationFatalError.
 * Records are returned sorted by tmdbId for order-independent results.
 */
export function normalizeBatch<T extends { tmdbId: number }>(
  items: unknown,
  normalize: (raw: unknown) => Normalized<T>,
): BatchResult<T> {
  if (!Array.isArray(items))
    throw new NormalizationFatalError("batch_not_array");
  if (items.length > LIMITS.batchSize)
    throw new NormalizationFatalError("batch_too_large");
  const records: T[] = [];
  const skipped: BatchResult<T>["skipped"] = [];
  items.forEach((item, index) => {
    const result = normalize(item);
    if (result.ok) records.push(result.record);
    else skipped.push({ index, reason: result.reason, tmdbId: result.tmdbId });
  });
  records.sort((a, b) => a.tmdbId - b.tmdbId);
  return { records, skipped };
}
