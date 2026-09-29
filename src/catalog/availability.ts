// US streaming-availability refresh (issue #7). For each title that has never
// been checked or whose check is older than maxAgeDays (never-checked first,
// then oldest), fetch TMDB watch providers, keep the US region, and replace
// the title's stored availability in one transaction. If a fetch fails, the
// previous availability and its fetched_at stay untouched, so the title is
// retried first next time. Provider data comes from JustWatch via TMDB; see
// ./attribution.ts for the required attribution and link labels.
import {
  and,
  asc,
  count,
  countDistinct,
  eq,
  isNull,
  lt,
  max,
  min,
  or,
  sql,
} from "drizzle-orm";
import type { CatalogSource } from "../tmdb/client";
import type { WatchProviders } from "../tmdb/schema";
import * as schema from "../db/schema";
import { emptyTally, runPool, type FailureBudget, type Tally } from "./run";
import type { CatalogDb, TitleKind } from "./store";

const { titleAvailability, titleOffers, titles, watchProviders } = schema;

export const REGION = "US";
export const AVAILABILITY_SOURCE = "tmdb-justwatch";
const MONETIZATIONS = ["flatrate", "free", "ads", "rent", "buy"] as const;
type Monetization = (typeof MONETIZATIONS)[number];

export interface UsAvailability {
  /** TMDB watch page for the title (provider info, never a playback link). */
  link: string | null;
  providers: { id: number; name: string; logoPath: string | null }[];
  offers: { providerId: number; monetization: Monetization }[];
}

/**
 * Extracts US availability. A response without a US entry means TMDB knows
 * of no US offers: the title is "checked, not streamable", not an error.
 * Duplicate provider/monetization pairs are collapsed.
 */
export function usAvailability(providers: WatchProviders): UsAvailability {
  const us = providers[REGION];
  if (!us) return { link: null, providers: [], offers: [] };

  const providerById = new Map<number, UsAvailability["providers"][number]>();
  const offers = new Map<string, UsAvailability["offers"][number]>();
  for (const monetization of MONETIZATIONS) {
    for (const p of us[monetization]) {
      const name = p.providerName.trim();
      if (p.providerId <= 0 || !name) continue;
      if (!providerById.has(p.providerId)) {
        providerById.set(p.providerId, {
          id: p.providerId,
          name,
          logoPath: p.logoPath,
        });
      }
      offers.set(`${p.providerId}:${monetization}`, {
        providerId: p.providerId,
        monetization,
      });
    }
  }
  return {
    link: us.link,
    // Sorted so concurrent transactions lock provider rows in the same order.
    providers: [...providerById.values()].sort((a, b) => a.id - b.id),
    offers: [...offers.values()],
  };
}

export interface AvailabilityTarget {
  titleId: number;
  kind: TitleKind;
  tmdbId: number;
}

export interface AvailabilityStats {
  titles: number;
  checked: number;
  neverChecked: number;
  /** Checked, but before the staleness cutoff. */
  stale: number;
  withOffers: number;
  offers: number;
  providers: number;
  oldestFetchedAt: Date | null;
  newestFetchedAt: Date | null;
}

export interface AvailabilityStore {
  /** Titles never checked (first) or last checked before `before` (oldest first). */
  dueForRefresh(before: Date, limit: number): Promise<AvailabilityTarget[]>;
  saveAvailability(
    titleId: number,
    us: UsAvailability,
    fetchedAt: Date,
  ): Promise<void>;
  stats(staleBefore: Date): Promise<AvailabilityStats>;
}

const excluded = (column: string) => sql.raw(`excluded."${column}"`);

export function createAvailabilityStore(db: CatalogDb): AvailabilityStore {
  const usRow = and(
    eq(titleAvailability.titleId, titles.id),
    eq(titleAvailability.region, REGION),
  );

  return {
    async dueForRefresh(before, limit) {
      const rows = await db
        .select({
          titleId: titles.id,
          kind: titles.kind,
          tmdbId: titles.tmdbId,
        })
        .from(titles)
        .leftJoin(titleAvailability, usRow)
        .where(
          or(
            isNull(titleAvailability.fetchedAt),
            lt(titleAvailability.fetchedAt, before),
          ),
        )
        .orderBy(
          sql`${titleAvailability.fetchedAt} asc nulls first`,
          asc(titles.id),
        )
        .limit(limit);
      return rows;
    },

    saveAvailability(titleId, us, fetchedAt) {
      return db.transaction(async (tx) => {
        if (us.providers.length) {
          await tx
            .insert(watchProviders)
            .values(us.providers)
            .onConflictDoUpdate({
              target: watchProviders.id,
              set: { name: excluded("name"), logoPath: excluded("logo_path") },
            });
        }
        await tx
          .insert(titleAvailability)
          .values({
            titleId,
            region: REGION,
            source: AVAILABILITY_SOURCE,
            link: us.link,
            fetchedAt,
          })
          .onConflictDoUpdate({
            target: [titleAvailability.titleId, titleAvailability.region],
            set: {
              source: excluded("source"),
              link: excluded("link"),
              fetchedAt: excluded("fetched_at"),
            },
          });
        // Replace, so offers that disappeared upstream are removed.
        await tx
          .delete(titleOffers)
          .where(
            and(
              eq(titleOffers.titleId, titleId),
              eq(titleOffers.region, REGION),
            ),
          );
        if (us.offers.length) {
          await tx
            .insert(titleOffers)
            .values(us.offers.map((o) => ({ titleId, region: REGION, ...o })));
        }
      });
    },

    async stats(staleBefore) {
      const [a] = await db
        .select({
          titles: count(titles.id),
          checked: count(titleAvailability.titleId),
          stale: sql<number>`count(*) filter (where ${titleAvailability.fetchedAt} < ${staleBefore})::int`,
          oldest: min(titleAvailability.fetchedAt),
          newest: max(titleAvailability.fetchedAt),
        })
        .from(titles)
        .leftJoin(titleAvailability, usRow);
      const [o] = await db
        .select({
          offers: count(),
          withOffers: countDistinct(titleOffers.titleId),
          providers: countDistinct(titleOffers.providerId),
        })
        .from(titleOffers)
        .where(eq(titleOffers.region, REGION));
      const total = a?.titles ?? 0;
      const checked = a?.checked ?? 0;
      return {
        titles: total,
        checked,
        neverChecked: total - checked,
        stale: a?.stale ?? 0,
        withOffers: o?.withOffers ?? 0,
        offers: o?.offers ?? 0,
        providers: o?.providers ?? 0,
        oldestFetchedAt: a?.oldest ?? null,
        newestFetchedAt: a?.newest ?? null,
      };
    },
  };
}

export interface AvailabilityOptions extends FailureBudget {
  /** Re-check availability older than this. Nightly refresh (#8) uses 1. */
  maxAgeDays: number;
  /** Most titles to check in this run. */
  limit: number;
  concurrency: number;
  now?: () => Date;
  log?: (message: string) => void;
}

export const DEFAULT_AVAILABILITY_OPTIONS: AvailabilityOptions = {
  maxAgeDays: 1,
  limit: 50_000,
  concurrency: 8,
  maxFailureRate: 0.05,
  minAttemptsBeforeAbort: 100,
};

export interface AvailabilityReport extends Tally {
  startedAt: string;
  finishedAt: string;
  status: "completed" | "aborted";
  abortReason?: string;
  due: number;
  /** Checked and stored (with or without US offers). */
  saved: number;
  withUsOffers: number;
  withoutUsOffers: number;
  availability: AvailabilityStats;
}

export class AvailabilityAbortedError extends Error {
  constructor(
    message: string,
    readonly report: AvailabilityReport,
  ) {
    super(message);
    this.name = "AvailabilityAbortedError";
  }
}

export async function refreshAvailability(
  source: CatalogSource,
  store: AvailabilityStore,
  options: AvailabilityOptions,
): Promise<AvailabilityReport> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  const startedAt = now();
  const staleBefore = new Date(
    startedAt.getTime() - options.maxAgeDays * 86_400_000,
  );

  const due = await store.dueForRefresh(staleBefore, options.limit);
  log(`[availability] ${due.length} titles due (limit ${options.limit})`);

  const tally = emptyTally();
  const counts = { saved: 0, withUsOffers: 0, withoutUsOffers: 0 };

  const abortReason = await runPool(
    due,
    tally,
    {
      label: "availability",
      concurrency: options.concurrency,
      budget: options,
      log,
    },
    async (target) => {
      const providers =
        target.kind === "movie"
          ? await source.getMovieWatchProviders(target.tmdbId)
          : await source.getSeriesWatchProviders(target.tmdbId);
      const us = usAvailability(providers);
      await store.saveAvailability(target.titleId, us, now());
      counts.saved++;
      if (us.offers.length) counts.withUsOffers++;
      else counts.withoutUsOffers++;
    },
  );

  const report: AvailabilityReport = {
    ...tally,
    ...counts,
    startedAt: startedAt.toISOString(),
    finishedAt: now().toISOString(),
    status: abortReason ? "aborted" : "completed",
    ...(abortReason ? { abortReason } : {}),
    due: due.length,
    availability: await store.stats(staleBefore),
  };
  if (abortReason) throw new AvailabilityAbortedError(abortReason, report);
  return report;
}
