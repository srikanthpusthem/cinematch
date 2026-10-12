// Shared runner for catalog jobs: a bounded worker pool with per-item error
// accounting and a failure budget. A single bad item is counted and skipped;
// a systemic failure (bad API key, high failure rate) stops the run.
import { TmdbError } from "../tmdb/client";

export interface FailureBudget {
  /** Abort when failures exceed this share of attempts... */
  maxFailureRate: number;
  /** ...but only after this many attempts, so early noise doesn't abort. */
  minAttemptsBeforeAbort: number;
}

export interface Tally {
  attempted: number;
  /** Items the source no longer serves (404); skipped, not failures. */
  notFound: number;
  /** Failure counts by TmdbError code, "db" for rejected writes, or "unexpected". */
  failed: Record<string, number>;
}

export const emptyTally = (): Tally => ({
  attempted: 0,
  notFound: 0,
  failed: {},
});

export const totalFailed = (t: Tally) =>
  Object.values(t.failed).reduce((a, b) => a + b, 0);

/** Failures that mean every further request will fail too. */
const FATAL_CODES = new Set(["unauthorized"]);

/** Postgres SQLSTATE of a rejected write, if any (never the message or values). */
function isPgError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code);
}

export function failureCode(error: unknown): string {
  if (error instanceof TmdbError) return error.code;
  return isPgError(error) ? "db" : "unexpected";
}

export interface RunOptions {
  label: string;
  concurrency: number;
  budget: FailureBudget;
  log?: (message: string) => void;
  /** Log progress every this many attempts. */
  progressEvery?: number;
}

/**
 * Processes `items` with at most `concurrency` in flight, recording outcomes in
 * `tally`. Returns an abort reason if the run stopped early, else undefined.
 */
export async function runPool<T>(
  items: readonly T[],
  tally: Tally,
  options: RunOptions,
  handle: (item: T) => Promise<void>,
): Promise<string | undefined> {
  const { label, budget, log = () => {}, progressEvery = 500 } = options;
  let abortReason: string | undefined;
  let next = 0;

  const worker = async () => {
    while (!abortReason && next < items.length) {
      const item = items[next++]!;
      tally.attempted++;
      try {
        await handle(item);
      } catch (error) {
        if (error instanceof TmdbError && error.code === "not_found") {
          tally.notFound++;
        } else {
          const code = failureCode(error);
          tally.failed[code] = (tally.failed[code] ?? 0) + 1;
          if (FATAL_CODES.has(code)) {
            abortReason = `TMDB rejected the API key (${code}); check TMDB_API_KEY`;
          }
        }
        const failures = totalFailed(tally);
        if (
          !abortReason &&
          tally.attempted >= budget.minAttemptsBeforeAbort &&
          failures / tally.attempted > budget.maxFailureRate
        ) {
          abortReason = `${label} failure rate ${failures}/${tally.attempted} exceeds ${budget.maxFailureRate}`;
        }
      }
      if (tally.attempted % progressEvery === 0) {
        log(`[${label}] ${tally.attempted}/${items.length} processed`);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, options.concurrency) }, worker),
  );
  return abortReason;
}
