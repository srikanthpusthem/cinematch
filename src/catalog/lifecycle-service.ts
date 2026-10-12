// Applies a refresh run's observations through a LifecycleRepository and
// produces the operator report. The repository is the persistence contract;
// createLifecycleStore (lifecycle-store.ts) implements it on Postgres.
import {
  applyObservation,
  DEFAULT_LIFECYCLE_POLICY,
  type CreateTitleAction,
  type LifecycleEvent,
  type LifecyclePolicy,
  type LifecycleRecord,
  type LifecycleStatus,
  type Observation,
  type SourceIdentity,
  type TombstoneReason,
} from "./lifecycle";

export interface LifecycleEntry {
  record: LifecycleRecord | undefined;
  /** Identity currently stored for the title (from the catalog). */
  identity: SourceIdentity | undefined;
}

export interface LifecycleRepository {
  load(titleIds: readonly number[]): Promise<Map<number, LifecycleEntry>>;
  save(records: readonly LifecycleRecord[]): Promise<void>;
}

export interface LifecycleRunReport {
  observations: number;
  byEvent: Partial<Record<LifecycleEvent, number>>;
  /** Status of every title observed in this run, after the run. */
  statusCounts: Record<LifecycleStatus, number>;
  newlyTombstoned: Partial<Record<TombstoneReason, number>>;
  restored: number;
  /** Outages/errors: titles left exactly as they were. */
  unchangedOnError: number;
  /** Operator follow-ups (never executed automatically). */
  actions: CreateTitleAction[];
}

/**
 * Applies observations in (time, runId, titleId) order, so the result doesn't
 * depend on input order, then saves every changed record once.
 */
export async function applyObservations(
  repo: LifecycleRepository,
  observations: readonly Observation[],
  policy: LifecyclePolicy = DEFAULT_LIFECYCLE_POLICY,
): Promise<LifecycleRunReport> {
  const ordered = [...observations].sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0) ||
      a.titleId - b.titleId,
  );
  const ids = [...new Set(ordered.map((o) => o.titleId))].sort((a, b) => a - b);
  const entries = await repo.load(ids);

  const current = new Map<number, LifecycleRecord | undefined>(
    ids.map((id) => [id, entries.get(id)?.record]),
  );
  const changed = new Set<number>();
  const report: LifecycleRunReport = {
    observations: ordered.length,
    byEvent: {},
    statusCounts: { active: 0, unavailable: 0, tombstoned: 0 },
    newlyTombstoned: {},
    restored: 0,
    unchangedOnError: 0,
    actions: [],
  };

  for (const o of ordered) {
    const before = current.get(o.titleId);
    const t = applyObservation(
      before,
      entries.get(o.titleId)?.identity,
      o,
      policy,
    );
    report.byEvent[t.event] = (report.byEvent[t.event] ?? 0) + 1;
    if (t.event === "error_no_change") report.unchangedOnError++;
    if (t.event === "restored") report.restored++;
    if (t.record?.status === "tombstoned" && before?.status !== "tombstoned") {
      const reason = t.record.tombstoneReason!;
      report.newlyTombstoned[reason] =
        (report.newlyTombstoned[reason] ?? 0) + 1;
    }
    if (t.action) report.actions.push(t.action);
    if (t.changed) {
      current.set(o.titleId, t.record);
      changed.add(o.titleId);
    }
  }

  for (const record of current.values()) {
    if (record) report.statusCounts[record.status]++;
  }
  await repo.save(
    [...changed].sort((a, b) => a - b).map((id) => current.get(id)!),
  );
  return report;
}

/** In-memory repository, for tests and dry runs. */
export function createMemoryLifecycleRepository(
  identities: Map<number, SourceIdentity> = new Map(),
) {
  const records = new Map<number, LifecycleRecord>();
  const repo: LifecycleRepository = {
    async load(titleIds) {
      return new Map(
        titleIds.map((id) => [
          id,
          { record: records.get(id), identity: identities.get(id) },
        ]),
      );
    },
    async save(list) {
      for (const r of list) records.set(r.titleId, structuredClone(r));
    },
  };
  return { repo, records, identities };
}
