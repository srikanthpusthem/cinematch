// Read-only catalog audit (issue #14): counts, missing metadata, duplicates,
// broken relationships, availability freshness and lifecycle breakdown, with
// bounded samples and repair guidance. Runs in a READ ONLY transaction, so it
// cannot modify data even by mistake. Output is deterministic for a given
// database state and `asOf`.
import { sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schema";

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** M1 exit targets (docs/product.md, issue #6). */
export const M1_TARGETS = { movies: 20_000, series: 5_000 } as const;

export interface AuditOptions {
  asOf: Date;
  /** Max titles listed per finding (samples, never full dumps). */
  sampleSize?: number;
  /** Availability older than this is stale (matches #70's presentable window). */
  staleAfterHours?: number;
}

export type Severity = "error" | "warning";

export interface Finding {
  check: string;
  severity: Severity;
  count: number;
  /** Up to sampleSize entries like "movie:550", ordered by kind then tmdb id. */
  sample: string[];
  guidance: string;
}

export interface AuditReport {
  asOf: string;
  sampleSize: number;
  counts: {
    movies: number;
    series: number;
    seasons: number;
    genres: number;
    keywords: number;
    providers: number;
    offers: number;
    availabilityRows: number;
  };
  /** Computed from the database; never asserted. */
  targets: Record<
    "movies" | "series",
    { target: number; actual: number; met: boolean }
  >;
  availability: {
    staleAfterHours: number;
    neverChecked: number;
    fresh: number;
    stale: number;
    ageBuckets: {
      upTo24h: number;
      upTo48h: number;
      upTo7d: number;
      over7d: number;
    };
    oldestFetchedAt: string | null;
    newestFetchedAt: string | null;
  };
  lifecycle: {
    unobserved: number;
    active: number;
    unavailable: number;
    tombstoned: number;
    tombstonedByReason: { source_deleted: number; source_id_collision: number };
  };
  findings: Finding[];
  /** No error-severity findings. */
  healthy: boolean;
}

interface Check {
  check: string;
  severity: Severity;
  /** Rows of titles t (and optionally m/s subtype joins) matching the problem. */
  where: SQL;
  guidance: string;
}

const CHECKS: Check[] = [
  {
    check: "movie_subtype_missing",
    severity: "error",
    where: sql`t.kind = 'movie' and not exists (select 1 from movies m where m.title_id = t.id)`,
    guidance:
      "Ingestion writes a title and its movie row in one transaction, so this means a partial manual write. Re-ingest these titles; don't patch rows by hand.",
  },
  {
    check: "series_subtype_missing",
    severity: "error",
    where: sql`t.kind = 'series' and not exists (select 1 from series s where s.title_id = t.id)`,
    guidance:
      "Ingestion writes a title and its series row in one transaction, so this means a partial manual write. Re-ingest these titles.",
  },
  {
    check: "season_count_mismatch",
    severity: "error",
    where: sql`t.kind = 'series' and exists (
      select 1 from series s where s.title_id = t.id and s.season_count is distinct from
        (select count(*) from seasons x where x.series_id = t.id and x.season_number > 0))`,
    guidance:
      "series.season_count is derived from the seasons list on save; re-ingest these series to resync it. Length filters (long-running, one season) rely on it.",
  },
  {
    check: "series_without_seasons",
    severity: "warning",
    where: sql`t.kind = 'series' and not exists (select 1 from seasons x where x.series_id = t.id)`,
    guidance:
      "TMDB returned no seasons. Usually an announced show; re-check after the next ingest. These can't match season-based length filters.",
  },
  {
    check: "overview_missing",
    severity: "warning",
    where: sql`t.overview is null`,
    guidance:
      "Some TMDB records have no English overview. Recommendation explanations are weaker for these; re-ingest later or exclude them from seeds.",
  },
  {
    check: "release_date_missing",
    severity: "warning",
    where: sql`t.release_date is null`,
    guidance:
      "Unreleased or incomplete TMDB records. Re-ingest later; year-based tie-breaks treat them as unknown.",
  },
  {
    check: "poster_missing",
    severity: "warning",
    where: sql`t.poster_path is null`,
    guidance:
      "The UI shows a fallback; re-ingest later in case TMDB adds artwork.",
  },
  {
    check: "genres_missing",
    severity: "warning",
    where: sql`not exists (select 1 from title_genres g where g.title_id = t.id)`,
    guidance:
      "Genre filters and avoided-genre exclusions can't apply to these titles. Re-ingest them; if TMDB lists no genres, consider excluding them from results.",
  },
  {
    check: "keywords_missing",
    severity: "warning",
    where: sql`not exists (select 1 from title_keywords k where k.title_id = t.id)`,
    guidance:
      "Fewer taste signals for embeddings. Re-ingest; many niche TMDB records simply have no keywords.",
  },
  {
    check: "movie_runtime_missing",
    severity: "warning",
    where: sql`t.kind = 'movie' and exists (select 1 from movies m where m.title_id = t.id and m.runtime_minutes is null)`,
    guidance:
      "These movies can't match runtime filters (under 100 min, epic). Re-ingest later.",
  },
  {
    check: "series_episode_runtime_missing",
    severity: "warning",
    where: sql`t.kind = 'series' and exists (select 1 from series s where s.title_id = t.id and s.episode_runtime_minutes is null)`,
    guidance:
      "These series can't match the short-episodes filter. Re-ingest later.",
  },
];

const label = (kind: string, tmdbId: number) => `${kind}:${tmdbId}`;

async function titleFinding(
  tx: Tx,
  c: Check,
  sampleSize: number,
): Promise<Finding> {
  const rows = (await tx.execute(sql`
    select t.kind::text as kind, t.tmdb_id, count(*) over ()::int as total
    from titles t where ${c.where}
    order by t.kind, t.tmdb_id limit ${sampleSize}`)) as unknown as {
    kind: string;
    tmdb_id: number;
    total: number;
  }[];
  return {
    check: c.check,
    severity: c.severity,
    count: rows[0]?.total ?? 0,
    sample: rows.map((r) => label(r.kind, r.tmdb_id)),
    guidance: c.guidance,
  };
}

const rowsOf = async <T>(tx: Tx, query: SQL) =>
  (await tx.execute(query)) as unknown as T[];

/** Runs `fn` in a READ ONLY transaction; any write inside fails with SQLSTATE 25006. */
export function withReadOnly<T>(
  db: Db,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    return fn(tx);
  });
}

export function runCatalogAudit(
  db: Db,
  options: AuditOptions,
): Promise<AuditReport> {
  const sampleSize = options.sampleSize ?? 10;
  const staleAfterHours = options.staleAfterHours ?? 48;
  // Raw SQL parameters bypass column mappers, so timestamps go in as ISO text.
  const asOf = options.asOf.toISOString();

  return withReadOnly(db, async (tx) => {
    const [counts] = await rowsOf<AuditReport["counts"]>(
      tx,
      sql`select
        (select count(*)::int from titles where kind = 'movie') as "movies",
        (select count(*)::int from titles where kind = 'series') as "series",
        (select count(*)::int from seasons) as "seasons",
        (select count(*)::int from genres) as "genres",
        (select count(*)::int from keywords) as "keywords",
        (select count(*)::int from watch_providers) as "providers",
        (select count(*)::int from title_offers) as "offers",
        (select count(*)::int from title_availability) as "availabilityRows"`,
    );

    const findings: Finding[] = [];
    for (const c of CHECKS)
      findings.push(await titleFinding(tx, c, sampleSize));

    // Duplicates. The unique constraint should make source-id duplicates
    // impossible; checking anyway catches a missing or dropped constraint.
    const dupSource = await rowsOf<{
      kind: string;
      tmdb_id: number;
      total: number;
    }>(
      tx,
      sql`select kind::text as kind, tmdb_id, count(*) over ()::int as total
        from titles group by kind, tmdb_id having count(*) > 1
        order by kind, tmdb_id limit ${sampleSize}`,
    );
    findings.push({
      check: "duplicate_source_id",
      severity: "error",
      count: dupSource[0]?.total ?? 0,
      sample: dupSource.map((r) => label(r.kind, r.tmdb_id)),
      guidance:
        "Should be impossible: verify the titles_kind_tmdb_id_key constraint from migration 0001 exists before any repair.",
    });
    const dupImdb = await rowsOf<{
      imdb_id: string;
      tmdb_ids: number[];
      total: number;
    }>(
      tx,
      sql`select m.imdb_id, array_agg(t.tmdb_id order by t.tmdb_id) as tmdb_ids,
          count(*) over ()::int as total
        from movies m join titles t on t.id = m.title_id
        where m.imdb_id is not null
        group by m.imdb_id having count(*) > 1
        order by m.imdb_id limit ${sampleSize}`,
    );
    findings.push({
      check: "duplicate_imdb_id",
      severity: "warning",
      count: dupImdb[0]?.total ?? 0,
      sample: dupImdb.map(
        (r) =>
          `${r.imdb_id}=${r.tmdb_ids.map((id) => label("movie", id)).join("+")}`,
      ),
      guidance:
        "Several TMDB movies claim one IMDb title, usually a duplicate TMDB record. Check them on TMDB; once upstream merges them, the lifecycle refresh tombstones the removed one.",
    });

    // Availability freshness relative to asOf.
    const [fresh] = await rowsOf<{
      never: number;
      fresh: number;
      stale: number;
      h24: number;
      h48: number;
      d7: number;
      older: number;
      oldest: number | null;
      newest: number | null;
    }>(
      tx,
      sql`with ages as (
          select a.fetched_at, ${asOf}::timestamptz - a.fetched_at as age
          from titles t left join title_availability a on a.title_id = t.id and a.region = 'US')
        select
          count(*) filter (where fetched_at is null)::int as never,
          count(*) filter (where age <= make_interval(hours => ${staleAfterHours}::int))::int as fresh,
          count(*) filter (where age > make_interval(hours => ${staleAfterHours}::int))::int as stale,
          count(*) filter (where age <= interval '24 hours')::int as h24,
          count(*) filter (where age > interval '24 hours' and age <= interval '48 hours')::int as h48,
          count(*) filter (where age > interval '48 hours' and age <= interval '7 days')::int as d7,
          count(*) filter (where age > interval '7 days')::int as older,
          (extract(epoch from min(fetched_at)) * 1000)::float8 as oldest,
          (extract(epoch from max(fetched_at)) * 1000)::float8 as newest
        from ages`,
    );
    const neverSample = await rowsOf<{ kind: string; tmdb_id: number }>(
      tx,
      sql`select t.kind::text as kind, t.tmdb_id from titles t
        where not exists (select 1 from title_availability a where a.title_id = t.id and a.region = 'US')
        order by t.kind, t.tmdb_id limit ${sampleSize}`,
    );
    const staleSample = await rowsOf<{ kind: string; tmdb_id: number }>(
      tx,
      sql`select t.kind::text as kind, t.tmdb_id from titles t
        join title_availability a on a.title_id = t.id and a.region = 'US'
        where ${asOf}::timestamptz - a.fetched_at > make_interval(hours => ${staleAfterHours}::int)
        order by a.fetched_at, t.kind, t.tmdb_id limit ${sampleSize}`,
    );
    findings.push(
      {
        check: "availability_never_checked",
        severity: "warning",
        count: fresh?.never ?? 0,
        sample: neverSample.map((r) => label(r.kind, r.tmdb_id)),
        guidance:
          "Run `npm run catalog:availability`; never-checked titles are processed first.",
      },
      {
        check: "availability_stale",
        severity: "warning",
        count: fresh?.stale ?? 0,
        sample: staleSample.map((r) => label(r.kind, r.tmdb_id)),
        guidance: `Older than ${staleAfterHours} h, so users see "availability last checked" instead of offers. Run \`npm run catalog:availability\` and check the nightly refresh (#8).`,
      },
    );

    const lifecycleRows = await rowsOf<{
      status: string;
      reason: string | null;
      n: number;
    }>(
      tx,
      sql`select coalesce(l.status::text, 'unobserved') as status, l.tombstone_reason::text as reason,
          count(*)::int as n
        from titles t left join title_lifecycle l on l.title_id = t.id
        group by 1, 2 order by 1, 2`,
    );
    const lifecycle: AuditReport["lifecycle"] = {
      unobserved: 0,
      active: 0,
      unavailable: 0,
      tombstoned: 0,
      tombstonedByReason: { source_deleted: 0, source_id_collision: 0 },
    };
    for (const r of lifecycleRows) {
      lifecycle[
        r.status as "unobserved" | "active" | "unavailable" | "tombstoned"
      ] += r.n;
      if (r.reason === "source_deleted" || r.reason === "source_id_collision") {
        lifecycle.tombstonedByReason[r.reason] += r.n;
      }
    }

    const c = counts!;
    const problems = findings.filter((f) => f.count > 0);
    return {
      asOf,
      sampleSize,
      counts: c,
      targets: {
        movies: {
          target: M1_TARGETS.movies,
          actual: c.movies,
          met: c.movies >= M1_TARGETS.movies,
        },
        series: {
          target: M1_TARGETS.series,
          actual: c.series,
          met: c.series >= M1_TARGETS.series,
        },
      },
      availability: {
        staleAfterHours,
        neverChecked: fresh?.never ?? 0,
        fresh: fresh?.fresh ?? 0,
        stale: fresh?.stale ?? 0,
        ageBuckets: {
          upTo24h: fresh?.h24 ?? 0,
          upTo48h: fresh?.h48 ?? 0,
          upTo7d: fresh?.d7 ?? 0,
          over7d: fresh?.older ?? 0,
        },
        oldestFetchedAt:
          fresh?.oldest != null ? new Date(fresh.oldest).toISOString() : null,
        newestFetchedAt:
          fresh?.newest != null ? new Date(fresh.newest).toISOString() : null,
      },
      lifecycle,
      findings: problems,
      healthy: !problems.some((f) => f.severity === "error"),
    };
  });
}

/** Human-readable summary of an audit report. */
export function formatAuditSummary(r: AuditReport): string {
  const lines = [
    `Catalog audit as of ${r.asOf}`,
    `Counts: ${r.counts.movies} movies, ${r.counts.series} series, ${r.counts.seasons} seasons, ` +
      `${r.counts.genres} genres, ${r.counts.keywords} keywords, ${r.counts.providers} providers, ${r.counts.offers} offers`,
    `M1 targets: movies ${r.targets.movies.actual}/${r.targets.movies.target} ${r.targets.movies.met ? "MET" : "not met"}, ` +
      `series ${r.targets.series.actual}/${r.targets.series.target} ${r.targets.series.met ? "MET" : "not met"}`,
    `Availability (stale after ${r.availability.staleAfterHours} h): ${r.availability.fresh} fresh, ` +
      `${r.availability.stale} stale, ${r.availability.neverChecked} never checked`,
    `Lifecycle: ${r.lifecycle.active} active, ${r.lifecycle.unavailable} unavailable, ` +
      `${r.lifecycle.tombstoned} tombstoned, ${r.lifecycle.unobserved} not yet observed`,
    "",
  ];
  if (!r.findings.length) {
    lines.push("No findings.");
  } else {
    for (const f of r.findings) {
      const more =
        f.count > f.sample.length
          ? ` (+${f.count - f.sample.length} more)`
          : "";
      lines.push(
        `[${f.severity.toUpperCase()}] ${f.check}: ${f.count}`,
        `  sample: ${f.sample.join(", ")}${more}`,
        `  fix: ${f.guidance}`,
      );
    }
  }
  lines.push(
    "",
    r.healthy ? "Result: HEALTHY (no errors)" : "Result: ERRORS FOUND",
  );
  return lines.join("\n");
}
