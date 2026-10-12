// Postgres implementation of LifecycleRepository (title_lifecycle, migration
// 0002), plus an operator summary. Never deletes titles or lifecycle rows.
import { and, count, eq, inArray, lt, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import {
  DEFAULT_LIFECYCLE_POLICY,
  type LifecyclePolicy,
  type LifecycleRecord,
  type LifecycleStatus,
} from "./lifecycle";
import type { LifecycleEntry, LifecycleRepository } from "./lifecycle-service";

const { titleLifecycle, titles } = schema;

type Db = PostgresJsDatabase<typeof schema>;

export interface LifecycleSummary {
  titles: number;
  /** Titles no lifecycle run has observed yet (treated as active). */
  unobserved: number;
  byStatus: Record<LifecycleStatus, number>;
  tombstonedByReason: Record<"source_deleted" | "source_id_collision", number>;
  /** Tombstoned longer than the retention period. */
  retentionElapsed: number;
  /**
   * Purge eligibility also requires zero feedback references. Feedback isn't
   * stored yet, so eligibility is unknown and nothing is reported eligible.
   */
  purgeEligible: null;
  purgeBlockedReason: "feedback_references_unknown";
}

const excluded = (column: string) => sql.raw(`excluded."${column}"`);

export function createLifecycleStore(db: Db) {
  const repository: LifecycleRepository = {
    async load(titleIds) {
      const result = new Map<number, LifecycleEntry>();
      if (!titleIds.length) return result;
      const rows = await db
        .select({ title: titles, lifecycle: titleLifecycle })
        .from(titles)
        .leftJoin(titleLifecycle, eq(titleLifecycle.titleId, titles.id))
        .where(inArray(titles.id, [...titleIds]));
      for (const { title, lifecycle } of rows) {
        const releaseYear = title.releaseDate
          ? Number(title.releaseDate.slice(0, 4))
          : null;
        result.set(title.id, {
          identity: { title: title.title, releaseYear },
          record: lifecycle
            ? {
                ...lifecycle,
                tombstoneReason: lifecycle.tombstoneReason ?? null,
              }
            : undefined,
        });
      }
      return result;
    },

    async save(records: readonly LifecycleRecord[]) {
      if (!records.length) return;
      await db
        .insert(titleLifecycle)
        .values([...records])
        .onConflictDoUpdate({
          target: titleLifecycle.titleId,
          set: {
            status: excluded("status"),
            firstSeenAt: excluded("first_seen_at"),
            lastSeenAt: excluded("last_seen_at"),
            lastSuccessfulRefreshAt: excluded("last_successful_refresh_at"),
            lastObservedAt: excluded("last_observed_at"),
            lastObservationRunId: excluded("last_observation_run_id"),
            missingSince: excluded("missing_since"),
            consecutiveMissing: excluded("consecutive_missing"),
            tombstonedAt: excluded("tombstoned_at"),
            tombstoneReason: excluded("tombstone_reason"),
            restoredAt: excluded("restored_at"),
            restoreCount: excluded("restore_count"),
          },
        });
    },
  };

  async function summary(
    now: Date,
    policy: LifecyclePolicy = DEFAULT_LIFECYCLE_POLICY,
  ): Promise<LifecycleSummary> {
    const [{ n: total } = { n: 0 }] = await db
      .select({ n: count() })
      .from(titles);
    const statuses = await db
      .select({
        status: titleLifecycle.status,
        reason: titleLifecycle.tombstoneReason,
        n: count(),
      })
      .from(titleLifecycle)
      .groupBy(titleLifecycle.status, titleLifecycle.tombstoneReason);
    const cutoff = new Date(now.getTime() - policy.retentionDays * 86_400_000);
    const [{ n: retentionElapsed } = { n: 0 }] = await db
      .select({ n: count() })
      .from(titleLifecycle)
      .where(
        and(
          eq(titleLifecycle.status, "tombstoned"),
          lt(titleLifecycle.tombstonedAt, cutoff),
        ),
      );

    const byStatus: Record<LifecycleStatus, number> = {
      active: 0,
      unavailable: 0,
      tombstoned: 0,
    };
    const tombstonedByReason = { source_deleted: 0, source_id_collision: 0 };
    let observed = 0;
    for (const row of statuses) {
      byStatus[row.status] += row.n;
      observed += row.n;
      if (row.status === "tombstoned" && row.reason)
        tombstonedByReason[row.reason] += row.n;
    }
    const unobserved = total - observed;
    byStatus.active += unobserved;
    return {
      titles: total,
      unobserved,
      byStatus,
      tombstonedByReason,
      retentionElapsed,
      purgeEligible: null,
      purgeBlockedReason: "feedback_references_unknown",
    };
  }

  return { repository, summary };
}
