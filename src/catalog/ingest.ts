// Resumable, idempotent catalog backfill: discover candidates, skip titles
// fetched recently, fetch details for the rest and save each in its own
// transaction. Per-title failures are counted; systemic failures abort.
import type { CatalogSource } from "../tmdb/client";
import { discoverCandidates, type Candidate } from "./discover";
import { emptyTally, runPool, totalFailed, type Tally } from "./run";
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

export interface KindReport extends Tally {
  target: number;
  candidates: number;
  skippedFresh: number;
  inserted: number;
  updated: number;
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

function emptyKindReport(target: number): KindReport {
  return {
    ...emptyTally(),
    target,
    candidates: 0,
    skippedFresh: 0,
    inserted: 0,
    updated: 0,
  };
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

    abortReason = await runPool(
      todo,
      report,
      {
        label: kind,
        concurrency: options.concurrency,
        budget: options,
        log,
      },
      async (candidate: Candidate) => {
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
      },
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
