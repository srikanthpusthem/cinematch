# TMDB record normalization

`src/catalog/normalize.ts` is the single interpretation of raw TMDB movie, series
and season payloads (issue #69). Ingestion, refresh, search and recommendations
should consume its records instead of reading TMDB fields directly. It is pure:
no I/O, no locale or timezone APIs, and output is independent of input key order.

## Results

- `normalizeMovie` / `normalizeSeries` return `{ ok: true, record }` or a
  **skip**: `{ ok: false, severity: "skip", reason, tmdbId }`.
- `normalizeSeason` normalizes a season-detail payload.
- `normalizeBatch` skips bad records by index and returns records sorted by
  `tmdbId`. It throws `NormalizationFatalError` only when the batch itself is
  unusable (`batch_not_array`, `batch_too_large` > 10,000).
- Skips and errors carry **codes and field names only**, never source values.

| Skip reason      | When                                            |
| ---------------- | ----------------------------------------------- |
| `adult`          | `adult: true`. CineMatch excludes adult titles  |
| `invalid_id`     | `id` is not a positive integer                  |
| `missing_title`  | Display title and original title are both blank |
| `title_too_long` | Title longer than 500 characters                |
| `not_an_object`  | The record isn't a JSON object                  |

## Rules

Each lossy transformation adds a code to the record's sorted `notes`, so audits can
see what changed and why.

| Field                        | Rule                                                                                                                                                                                                                   | Note codes                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| All text                     | Unicode NFC. Remove zero-width space, word joiner, BOM, soft hyphen and control characters. Keep ZWJ/ZWNJ (emoji, Persian, Indic). NBSP and other spaces become a space; runs collapse; trimmed.                       | (none: meaning-preserving)                                                                           |
| `title`                      | Display title (`title`/`name`). If blank, use the original title                                                                                                                                                       | `title_from_original`                                                                                |
| `originalTitle`              | Canonical text; non-strings dropped                                                                                                                                                                                    | `original_title_invalid`                                                                             |
| `displayLanguage`            | Always `en`: CineMatch queries TMDB in its default `en-US`, so display titles and overviews are English where TMDB has them                                                                                            | none                                                                                                 |
| `originalLanguage`           | ISO 639-1, lowercased with ASCII-only rules. `xx` ("no language") and anything else become `null`                                                                                                                      | `original_language_invalid`                                                                          |
| `overview`                   | As text, but paragraph breaks kept (max one blank line). Blank → `null`. Over 10,000 chars → `null` (not truncated mid-thought)                                                                                        | `overview_invalid`, `overview_too_long`                                                              |
| `releaseDate`                | Movie `release_date` or series `first_air_date`. Must be a real calendar date `YYYY-MM-DD` between 1870 and 2100, checked arithmetically (no `Date`, no timezone). `""` → `null`                                       | `release_date_invalid`                                                                               |
| `releaseYear`                | Year of `releaseDate`                                                                                                                                                                                                  | none                                                                                                 |
| `runtimeMinutes` (movie)     | Positive, rounded to whole minutes, ≤ 1440. `0`/missing → `null` (TMDB's "unknown")                                                                                                                                    | `runtime_rounded`, `runtime_invalid`                                                                 |
| `episodeRuntimeMinutes`      | Lower median of `episode_run_time` values in 1–600. If empty, `last_episode_to_air.runtime`                                                                                                                            | `episode_runtime_from_last_episode`, `episode_runtime_invalid`                                       |
| `status`                     | Closed enum per kind (movies: rumored, planned, in_production, post_production, released, canceled; series: returning, planned, in_production, pilot, ended, canceled). Otherwise `unknown`                            | `status_missing`, `status_unknown`                                                                   |
| `genres`, `keywords`         | Positive id and non-blank canonical name (≤ 200 chars) required. Deduped by id (first wins), sorted by id. Max 50 genres, 500 keywords. Keywords read from `keywords.keywords` (movies) or `keywords.results` (series) | `genres_invalid`, `genre_dropped`, `genres_truncated`, `keywords_*`, `duplicate_term`                |
| `popularity`                 | Finite, ≥ 0                                                                                                                                                                                                            | `popularity_invalid`                                                                                 |
| `voteAverage`                | Finite, 0–10                                                                                                                                                                                                           | `vote_average_invalid`                                                                               |
| `voteCount`                  | Integer ≥ 0                                                                                                                                                                                                            | `vote_count_invalid`                                                                                 |
| `posterPath`, `backdropPath` | Only TMDB-relative image paths (`/[A-Za-z0-9_-]+.(jpg\|jpeg\|png\|webp\|svg)`). Full URLs, other schemes and path traversal → `null`                                                                                   | `poster_path_invalid`, `backdrop_path_invalid`                                                       |
| `imdbId` (movie)             | `tt` + 7–10 digits                                                                                                                                                                                                     | `imdb_id_invalid`                                                                                    |
| `seasons` (series)           | `season_number` must be an integer ≥ 0; deduped (first wins); sorted; max 500. Season 0 is `isSpecials`. `seasonCount` counts regular seasons only                                                                     | `seasons_invalid`, `season_dropped`, `duplicate_season`, `seasons_truncated`, `season_field_invalid` |
| `lastAirDate` (series)       | As `releaseDate`                                                                                                                                                                                                       | `last_air_date_invalid`                                                                              |

Wrong types from source-field changes (a number where text was expected, a string
where a list was expected) never throw. The field becomes empty and gains a note.

## Provenance

`provenance.sourceStatus` keeps TMDB's status text (canonicalized, ≤ 100 chars),
so `unknown` statuses can be traced. `tmdbId`, `originalTitle` and
`originalLanguage` identify the source record. Raw payloads are **not** retained.

## Integration

Movie and series detail responses now pass through `src/catalog/source-normalization.ts`
at the raw TMDB client boundary, before lossy field parsing. The adapter preserves
`CatalogSource` compatibility while passing canonical text, dates, image paths,
runtime and seasons into the existing store. Series status uses the canonical enum
in the existing text column. The full normalized record (including backdrop,
provenance and notes) stays available internally as optional `normalization`
metadata; columns that do not exist are not invented or migrated. Search and
options expose only their explicit public field whitelists. Season-detail endpoint
normalization remains separate from this movie/series ingestion boundary.

Missing/null/non-array season lists produce an unknown (`null`) season count;
an explicitly empty list means zero. Legacy fixture adapters without a count
retain their existing derived-season behavior.

Adult records, missing titles, oversized titles and explicitly unreleased statuses
are skipped before any save. Movies skip rumored, planned, in-production,
post-production and canceled statuses. Series skip planned, in-production and
pilot; canceled series can still be watchable and remain eligible for later
availability/runtime filters. Unknown status is retained with provenance/notes;
it does not establish release or current availability. Invalid response envelopes
or IDs remain malformed-source errors, distinct from record skips and transport
outages.

Ingestion reports exact per-reason skipped counts and at most 50 deterministic
TMDB-ID/reason samples per kind. Skips are neither inserted/updated rows nor
failure-budget errors; reported catalog counts remain actual stored counts.

### Existing-row limitation

A skip rejects the incoming detail; it does not delete or quarantine a previously
stored row. If an existing title becomes adult or otherwise ineligible upstream,
its prior lifecycle status is unchanged. Operators must review skipped-ID samples
and hide affected existing rows through a separately reviewed lifecycle action
before refreshing an already populated catalog for release. Do not treat a skipped
refresh as proof that the old row is safe. The initial private database was empty;
no automatic lifecycle reinterpretation or destructive repair is added here.
