// Catalog lifecycle rules (issue #70). Pure: given a title's lifecycle record,
// its stored source identity and a refresh observation, decide the next state.
// Titles are never deleted here. A disappeared source record becomes
// `unavailable`, then `tombstoned` only after sustained absence, and returns to
// `active` (same internal titleId) if the source reappears. See
// docs/catalog-lifecycle.md.

export type LifecycleStatus = "active" | "unavailable" | "tombstoned";
export type TombstoneReason = "source_deleted" | "source_id_collision";

export interface LifecycleRecord {
  /** Stable internal id; never changes, so feedback references survive. */
  titleId: number;
  status: LifecycleStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** Last observation that returned the record (null if never found). */
  lastSuccessfulRefreshAt: Date | null;
  lastObservedAt: Date;
  lastObservationRunId: string;
  missingSince: Date | null;
  consecutiveMissing: number;
  tombstonedAt: Date | null;
  tombstoneReason: TombstoneReason | null;
  restoredAt: Date | null;
  restoreCount: number;
}

/** Identity-sensitive source fields, compared to detect source-id reuse. */
export interface SourceIdentity {
  title: string;
  releaseYear: number | null;
}

export type Observation =
  | {
      titleId: number;
      runId: string;
      at: Date;
      result: "found";
      identity: SourceIdentity;
    }
  /** The source answered but the record is gone: HTTP 404 or an empty body. */
  | { titleId: number; runId: string; at: Date; result: "missing" }
  /** Timeout, outage, 5xx, malformed: says nothing about the record. */
  | { titleId: number; runId: string; at: Date; result: "error" };

export interface LifecyclePolicy {
  /** Consecutive missing observations required before tombstoning... */
  tombstoneAfterMissing: number;
  /** ...spanning at least this many days, so one bad night can't do it. */
  tombstoneAfterDays: number;
  /** Availability offers older than this are stale, not current. */
  availabilityMaxAgeHours: number;
  /** Tombstoned records become purge-eligible after this many days. */
  retentionDays: number;
}

export const DEFAULT_LIFECYCLE_POLICY: LifecyclePolicy = {
  tombstoneAfterMissing: 3,
  tombstoneAfterDays: 7,
  availabilityMaxAgeHours: 48,
  retentionDays: 180,
};

export type LifecycleEvent =
  | "first_seen"
  | "first_seen_missing"
  | "seen"
  | "became_unavailable"
  | "still_unavailable"
  | "tombstoned"
  | "still_tombstoned"
  | "recovered"
  | "restored"
  | "source_id_collision"
  | "ignored_duplicate_run"
  | "ignored_out_of_order"
  | "error_no_change";

export interface CreateTitleAction {
  type: "create_new_title";
  /** The tombstoned title whose source id now names a different work. */
  replacesTitleId: number;
  identity: SourceIdentity;
}

export interface Transition {
  /** The new record; identical object if nothing changed; undefined if none exists. */
  record: LifecycleRecord | undefined;
  changed: boolean;
  event: LifecycleEvent;
  action?: CreateTitleAction;
}

const DAY_MS = 86_400_000;

/** Case-, accent- and punctuation-insensitive title key. */
export function titleKey(title: string): string {
  return title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The source id now names a different work: the release year moved by more
 * than a year AND the title changed. A rename alone, or a date correction
 * alone, is an ordinary update.
 */
export function isSourceIdCollision(
  stored: SourceIdentity | undefined,
  observed: SourceIdentity,
): boolean {
  if (!stored || stored.releaseYear === null || observed.releaseYear === null)
    return false;
  return (
    Math.abs(stored.releaseYear - observed.releaseYear) > 1 &&
    titleKey(stored.title) !== titleKey(observed.title)
  );
}

function fresh(o: Observation, status: LifecycleStatus): LifecycleRecord {
  const found = o.result === "found";
  return {
    titleId: o.titleId,
    status,
    firstSeenAt: o.at,
    lastSeenAt: o.at,
    lastSuccessfulRefreshAt: found ? o.at : null,
    lastObservedAt: o.at,
    lastObservationRunId: o.runId,
    missingSince: found ? null : o.at,
    consecutiveMissing: found ? 0 : 1,
    tombstonedAt: null,
    tombstoneReason: null,
    restoredAt: null,
    restoreCount: 0,
  };
}

export function applyObservation(
  record: LifecycleRecord | undefined,
  stored: SourceIdentity | undefined,
  o: Observation,
  policy: LifecyclePolicy = DEFAULT_LIFECYCLE_POLICY,
): Transition {
  const same = (event: LifecycleEvent): Transition => ({
    record,
    changed: false,
    event,
  });

  if (o.result === "error") return same("error_no_change");

  if (!record) {
    return o.result === "found"
      ? { record: fresh(o, "active"), changed: true, event: "first_seen" }
      : {
          record: fresh(o, "unavailable"),
          changed: true,
          event: "first_seen_missing",
        };
  }
  if (o.runId === record.lastObservationRunId)
    return same("ignored_duplicate_run");
  if (o.at.getTime() < record.lastObservedAt.getTime())
    return same("ignored_out_of_order");

  const observed = { lastObservedAt: o.at, lastObservationRunId: o.runId };

  if (o.result === "found") {
    if (isSourceIdCollision(stored, o.identity)) {
      const alreadyCollided =
        record.status === "tombstoned" &&
        record.tombstoneReason === "source_id_collision";
      return {
        record: {
          ...record,
          ...observed,
          status: "tombstoned",
          tombstonedAt: alreadyCollided ? record.tombstonedAt : o.at,
          tombstoneReason: "source_id_collision",
        },
        changed: true,
        event: "source_id_collision",
        action: {
          type: "create_new_title",
          replacesTitleId: record.titleId,
          identity: o.identity,
        },
      };
    }
    const seen = {
      ...record,
      ...observed,
      status: "active" as const,
      lastSeenAt: o.at,
      lastSuccessfulRefreshAt: o.at,
      missingSince: null,
      consecutiveMissing: 0,
    };
    if (record.status === "tombstoned") {
      return {
        record: {
          ...seen,
          tombstonedAt: null,
          tombstoneReason: null,
          restoredAt: o.at,
          restoreCount: record.restoreCount + 1,
        },
        changed: true,
        event: "restored",
      };
    }
    return {
      record: seen,
      changed: true,
      event: record.status === "unavailable" ? "recovered" : "seen",
    };
  }

  // Missing.
  if (record.status === "tombstoned") {
    return {
      record: { ...record, ...observed },
      changed: true,
      event: "still_tombstoned",
    };
  }
  if (record.status === "active") {
    return {
      record: {
        ...record,
        ...observed,
        status: "unavailable",
        missingSince: o.at,
        consecutiveMissing: 1,
      },
      changed: true,
      event: "became_unavailable",
    };
  }
  const consecutiveMissing = record.consecutiveMissing + 1;
  const since = record.missingSince ?? o.at;
  const sustained =
    consecutiveMissing >= policy.tombstoneAfterMissing &&
    o.at.getTime() - since.getTime() >= policy.tombstoneAfterDays * DAY_MS;
  return sustained
    ? {
        record: {
          ...record,
          ...observed,
          status: "tombstoned",
          consecutiveMissing,
          tombstonedAt: o.at,
          tombstoneReason: "source_deleted",
        },
        changed: true,
        event: "tombstoned",
      }
    : {
        record: { ...record, ...observed, consecutiveMissing },
        changed: true,
        event: "still_unavailable",
      };
}

/** Only active titles may be recommended or shown as available. */
export const isPresentable = (record: LifecycleRecord | undefined) =>
  !record || record.status === "active";

export type PresentableAvailability<T> =
  | { state: "current"; offers: T[]; checkedAt: Date }
  | { state: "stale"; offers: []; checkedAt: Date }
  | { state: "unknown"; offers: []; checkedAt: null };

/**
 * Availability expires independently of title metadata. Stale offers are
 * withheld entirely (the UI shows "last checked" instead) so they can never be
 * presented as current.
 */
export function presentableAvailability<T>(
  offers: readonly T[],
  checkedAt: Date | null,
  now: Date,
  policy: LifecyclePolicy = DEFAULT_LIFECYCLE_POLICY,
): PresentableAvailability<T> {
  if (!checkedAt) return { state: "unknown", offers: [], checkedAt: null };
  const ageMs = now.getTime() - checkedAt.getTime();
  return ageMs <= policy.availabilityMaxAgeHours * 3_600_000
    ? { state: "current", offers: [...offers], checkedAt }
    : { state: "stale", offers: [], checkedAt };
}

export type PurgeDecision =
  | { eligible: true; eligibleSince: Date }
  | {
      eligible: false;
      reason:
        | "not_tombstoned"
        | "retention_pending"
        | "has_feedback_references"
        | "feedback_references_unknown";
      eligibleAt: Date | null;
    };

/**
 * Policy output only: whether a record *may* be purged. Nothing here deletes
 * data. Unknown feedback references are treated as "keep".
 */
export function purgeEligibility(
  record: LifecycleRecord,
  feedbackReferences: number | null,
  now: Date,
  policy: LifecyclePolicy = DEFAULT_LIFECYCLE_POLICY,
): PurgeDecision {
  if (record.status !== "tombstoned" || !record.tombstonedAt) {
    return { eligible: false, reason: "not_tombstoned", eligibleAt: null };
  }
  const eligibleAt = new Date(
    record.tombstonedAt.getTime() + policy.retentionDays * DAY_MS,
  );
  if (feedbackReferences === null) {
    return {
      eligible: false,
      reason: "feedback_references_unknown",
      eligibleAt: null,
    };
  }
  if (feedbackReferences > 0) {
    return {
      eligible: false,
      reason: "has_feedback_references",
      eligibleAt: null,
    };
  }
  if (now.getTime() < eligibleAt.getTime()) {
    return { eligible: false, reason: "retention_pending", eligibleAt };
  }
  return { eligible: true, eligibleSince: eligibleAt };
}
