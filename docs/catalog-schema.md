# Catalog schema (M1)

Source of truth: `src/db/schema.ts`, migrated by `drizzle/0001_catalog_schema.sql`.
Verified against pgvector Postgres by `src/db/catalog-schema.db.test.ts`
(`npm run test:db`, CI `db` job). Keep this page in sync with the schema.

## Model

```text
titles (kind: movie | series)
├─ movies        1:1, title_id + kind → titles(id, kind)
├─ series        1:1, title_id + kind → titles(id, kind)
│  └─ seasons    series_id → series(title_id)
├─ title_genres   → genres
├─ title_keywords → keywords
├─ title_availability (title_id, region)
│  └─ title_offers (provider, monetization) → watch_providers
└─ title_embeddings (title_id, model)
```

- **Titles and subtypes.** `titles` holds the fields that movies and series share.
  `movies` and `series` hold kind-specific fields. Each subtype row has a constant
  `kind` column (CHECKed) and a composite FK to `titles(id, kind)`, so a movie row
  can never point at a series title, and vice versa.
- **TMDB ids.** TMDB's movie and TV id spaces overlap, so titles are unique on
  `(kind, tmdb_id)`. Genres, keywords and watch providers use the TMDB id as their
  primary key.
- **Release and runtime.** `titles.release_date` is the movie release date or the
  series first air date. `movies.runtime_minutes` is the full runtime.
  `series.episode_runtime_minutes` is the typical episode length and
  `series.season_count` counts regular seasons (not specials).
- **Seasons, not episodes.** Seasons belong to `series` (FK to `series`, not
  `titles`, so they can't attach to a movie). Season 0 is TMDB's Specials. Episodes
  are not modeled because they are never recommended (docs/product.md).
- **US availability.** `title_availability` has one row per title and region that
  has been checked, holding `fetched_at`, the `source` (`tmdb-justwatch`, for
  attribution) and the TMDB watch `link`. A row with no offers means
  _checked, not streamable_; no row means _never checked_. `title_offers` lists
  each provider × monetization (`flatrate`, `free`, `ads`, `rent`, `buy`). `region`
  is CHECKed to `'US'`: expanding beyond the US is an owner decision and a
  migration.
- **Embeddings.** `title_embeddings` stores one vector per title and `model`
  (provider, model and input-template version, e.g. `provider/model@v1`). The
  column is an unsized `vector`, and a CHECK ties `vector_dims(embedding)` to
  `dimensions`, so models of different sizes can coexist during a migration.
  `content_hash` identifies the embedded text, so ingestion re-embeds only titles
  whose input changed.

## Delete behavior

| From → to                                                               | On delete | Why                                        |
| ----------------------------------------------------------------------- | --------- | ------------------------------------------ |
| title → subtype, seasons, genre/keyword links, availability, embeddings | cascade   | A removed title owns nothing afterward     |
| availability → offers                                                   | cascade   | Refresh = replace the checked row + offers |
| genre, keyword, watch provider ← links/offers                           | restrict  | Reference data can't vanish under use      |

No `ON UPDATE` actions: ids are identities or stable TMDB ids.

## Indexes

Every foreign key is backed by an index on its leading columns (primary keys
cover most; the test enforces this). Added secondary indexes, each tied to a
known query:

| Index                                                    | Query                                                     |
| -------------------------------------------------------- | --------------------------------------------------------- |
| `title_offers (provider_id, monetization, title_id)`     | Titles on the user's services (hard filter, #19)          |
| `title_availability (fetched_at)`                        | Stale availability for nightly refresh / checks (#8, #14) |
| `title_genres (genre_id)`, `title_keywords (keyword_id)` | Reverse lookups and RESTRICT checks                       |

Deliberately **not** added yet: the ANN index, title search and popularity
ordering. They belong with the issues that write those queries (#17, #15, #19)
so they can be justified with `EXPLAIN`.

**ANN index (#17).** pgvector HNSW indexes need a fixed dimension. Once a model is
chosen, add a partial expression index per model, and query with the same cast and
predicate so the planner uses it:

```sql
create index title_embeddings_<model>_hnsw on title_embeddings
  using hnsw ((embedding::vector(1024)) vector_cosine_ops)
  where model = '<provider/model@v1>';
```

## Migration conventions

Generate with `npm run db:generate`, then make the SQL re-runnable
(`CREATE ... IF NOT EXISTS`, and `DO` blocks catching `duplicate_object` for types
and constraints, since Postgres has no `ADD CONSTRAINT IF NOT EXISTS`). Don't
edit `drizzle/meta/*`. After generating, `npm run db:generate` must report no
changes. Pull `main` before choosing a migration number (AGENTS.md).
