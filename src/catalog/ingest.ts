// Resumable, idempotent catalog backfill: discover candidates, skip titles
// fetched recently, fetch details for the rest and save each in its own
// transaction. Per-title failures are counted; systemic failures abort.
import { TmdbError, type CatalogSource } from "../tmdb/client";
import { discoverCandidates, type Candidate } from "./discover";
import type { CatalogStats, CatalogStore, TitleKind } from "./store";

export interface IngestOptions {
  movies: number;
  series: number;
  /** Titles fetched within this many days are skipped (resume point). */
  maxAgeDays: number;
  /** Parallel detail requests; the TMDB client still enforces its throttle. */
  concurrency: number;
  minVotes: { movie: number; series: number };
  fromYear: number;
  toYear: number;
  /** Abort when failures exceed this share of attempts (after `minAttempts`). */
  maxFailureRate: number;
  minAttemptsBeforeAbort: number;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface KindReport {
  target: number;
  candidates: number;
  skippedFresh: number;
  attempted: number;
  inserted: number;
  updated: number;
  /** Titles TMDB no longer serves (404); skipped, not failures. */
  notFound: number;
  /** Failure counts by TmdbError code, or "db" for rejected writes. */
  failed: Record<string, number>;
}

export interface IngestReport {
  startedAt: string;
  finishedAt: string;
  status: "completed" | "aborted";
  abortReason?: string;
  movies: KindReport;
  series: KindReport;
  catalog: CatalogStats;
}

export const DEFAULT_INGEST_OPTIONS: IngestOptions = {
  movies: 20_000,
  series: 5_000,
  maxAgeDays: 7,
  concurrency: 8,
  minVotes: { movie: 50, series: 20 },
  fromYear: 1950,
  toYear: new Date().getUTCFullYear(),
  maxFailureRate: 0.05,
  minAttemptsBeforeAbort: 100,
};

export class IngestAbortedError extends Error {
  constructor(
    message: string,
    readonly report: IngestReport,
  ) {
    super(message);
    this.name = "IngestAbortedError";
  }
}

/** Failures that mean every further request will fail too. */
const FATAL_CODES = new Set(["unauthorized"]);

function emptyKindReport(target: number): KindReport {
  return {
    target,
    candidates: 0,
    skippedFresh: 0,
    attempted: 0,
    inserted: 0,
    updated: 0,
    notFound: 0,
    failed: {},
  };
}

const totalFailed = (r: KindReport) =>
  Object.values(r.failed).reduce((a, b) => a + b, 0);

/** Postgres SQLSTATE of a rejected write, if any (never the message/values). */
function pgCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)
    ? code
    : undefined;
}

export async function ingestCatalog(
  source: CatalogSource,
  store: CatalogStore,
  options: IngestOptions,
): Promise<IngestReport> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  const startedAt = now();
  const since = new Date(startedAt.getTime() - options.maxAgeDays * 86_400_000);

  const reports: Record<TitleKind, KindReport> = {
    movie: emptyKindReport(options.movies),
    series: emptyKindReport(options.series),
  };
  let abortReason: string | undefined;

  const finish = async (): Promise<IngestReport> => ({
    startedAt: startedAt.toISOString(),
    finishedAt: now().toISOString(),
    status: abortReason ? "aborted" : "completed",
    ...(abortReason ? { abortReason } : {}),
    movies: reports.movie,
    series: reports.series,
    catalog: await store.stats(),
  });

  for (const kind of ["movie", "series"] as const) {
    const report = reports[kind];
    if (report.target <= 0) continue;

    log(`[${kind}] discovering candidates (target ${report.target})`);
    const candidates = await discoverCandidates(source, {
      kind,
      target: report.target,
      minVotes: options.minVotes[kind],
      fromYear: options.fromYear,
      toYear: options.toYear,
    });
    report.candidates = candidates.length;

    const fresh = await store.recentlyFetched(kind, since);
    const todo: Candidate[] = candidates.filter((c) => !fresh.has(c.tmdbId));
    report.skippedFresh = candidates.length - todo.length;
    log(
      `[${kind}] ${candidates.length} candidates, ${report.skippedFresh} fresh, ${todo.length} to fetch`,
    );

    let next = 0;
    const worker = async () => {
      while (!abortReason && next < todo.length) {
        const candidate = todo[next++]!;
        report.attempted++;
        try {
          const result =
            kind === "movie"
              ? await store.saveMovie(
                  await source.getMovie(candidate.tmdbId),
                  now(),
                )
              : await store.saveSeries(
                  await source.getSeries(candidate.tmdbId),
                  now(),
                );
          report[result]++;
        } catch (error) {
          if (error instanceof TmdbError && error.code === "not_found") {
            report.notFound++;
          } else {
            const code =
              error instanceof TmdbError
                ? error.code
                : pgCode(error)
                  ? "db"
                  : "unexpected";
            report.failed[code] = (report.failed[code] ?? 0) + 1;
            if (FATAL_CODES.has(code)) {
              abortReason = `TMDB rejected the API key (${code}); check TMDB_API_KEY`;
            }
          }
          const failures = totalFailed(report);
          if (
            !abortReason &&
            report.attempted >= options.minAttemptsBeforeAbort &&
            failures / report.attempted > options.maxFailureRate
          ) {
            abortReason = `${kind} failure rate ${failures}/${report.attempted} exceeds ${options.maxFailureRate}`;
          }
        }
        if (report.attempted % 500 === 0) {
          log(`[${kind}] ${report.attempted}/${todo.length} processed`);
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.max(1, options.concurrency) }, worker),
    );

    if (abortReason) {
      const partial = await finish();
      throw new IngestAbortedError(abortReason, partial);
    }
    log(
      `[${kind}] done: ${report.inserted} inserted, ${report.updated} updated, ${report.notFound} not found, ${totalFailed(report)} failed`,
    );
  }

  return finish();
}
