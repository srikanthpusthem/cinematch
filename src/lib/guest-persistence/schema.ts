import {
  emptySnapshot,
  GUEST_PERSISTENCE_SCHEMA_VERSION,
  isLiveCatalogId,
  parseFeedbackEvent,
  parseGuestAnswers,
  parseLegacyGuestAnswers,
  type GuestFeedbackEvent,
  type GuestPersistedSnapshot,
  type StorageFailureReason,
} from "./types";

export type ParseSnapshotResult =
  | {
      ok: true;
      snapshot: GuestPersistedSnapshot;
      migrated: boolean;
      migrationNotice: string | null;
    }
  | {
      ok: false;
      reason: Extract<StorageFailureReason, "corrupt" | "unsupported_version">;
    };

/**
 * Validate and normalize a raw JSON value into a v2 snapshot.
 * Unknown versions and corrupt payloads fail closed (caller resets).
 * v1 labels/mock IDs cannot safely be mapped to catalog IDs. Remove only those
 * selections, preserving numeric selections, preferences, and the entire log.
 */
export function parseSnapshot(raw: unknown): ParseSnapshotResult {
  if (raw == null || typeof raw !== "object") {
    return { ok: false, reason: "corrupt" };
  }

  const record = raw as Record<string, unknown>;
  if (!("version" in record) || typeof record.version !== "number") {
    return { ok: false, reason: "corrupt" };
  }

  if (
    record.version !== 1 &&
    record.version !== GUEST_PERSISTENCE_SCHEMA_VERSION
  ) {
    return { ok: false, reason: "unsupported_version" };
  }

  const migrated = record.version === 1;
  const answers = migrated
    ? parseLegacyGuestAnswers(record.answers)
    : parseGuestAnswers(record.answers);
  if (answers == null) {
    return { ok: false, reason: "corrupt" };
  }

  if (!Array.isArray(record.events)) {
    return { ok: false, reason: "corrupt" };
  }

  const events: GuestFeedbackEvent[] = [];
  for (const item of record.events) {
    const event = parseFeedbackEvent(item);
    if (event == null) {
      return { ok: false, reason: "corrupt" };
    }
    events.push(event);
  }

  // Reject unexpected top-level keys that look like PII / secrets.
  for (const key of Object.keys(record)) {
    if (key === "version" || key === "answers" || key === "events") continue;
    if (
      key === "credentials" ||
      key === "token" ||
      key === "email" ||
      key === "prompt" ||
      key === "providerResponse"
    ) {
      return { ok: false, reason: "corrupt" };
    }
  }

  const clearedSelections: string[] = [];
  if (migrated) {
    for (const [field, label] of [
      ["serviceIds", "streaming services"],
      ["seedIds", "quiz titles"],
      ["avoidedGenres", "avoided genres"],
    ] as const) {
      const liveIds = answers[field].filter(isLiveCatalogId);
      if (liveIds.length !== answers[field].length) {
        clearedSelections.push(label);
      }
      answers[field] = liveIds;
    }
  }

  return {
    ok: true,
    migrated,
    migrationNotice:
      clearedSelections.length > 0
        ? `Some saved ${clearedSelections.join(", ")} could not be matched to the live catalog. Please choose them again. Your mood, format, length, and feedback were kept.`
        : migrated
          ? "Your saved preferences were updated for the live catalog."
          : null,
    snapshot: {
      version: GUEST_PERSISTENCE_SCHEMA_VERSION,
      answers,
      events,
    },
  };
}

/**
 * Migrate supported snapshots or reset invalid data.
 * Returns the usable snapshot plus whether a reset occurred.
 */
export function migrateOrReset(raw: unknown): {
  snapshot: GuestPersistedSnapshot;
  reset: boolean;
  migrated: boolean;
  migrationNotice: string | null;
  reason?: Extract<StorageFailureReason, "corrupt" | "unsupported_version">;
} {
  if (raw === null || raw === undefined) {
    return {
      snapshot: emptySnapshot(),
      reset: false,
      migrated: false,
      migrationNotice: null,
    };
  }

  const parsed = parseSnapshot(raw);
  if (parsed.ok) {
    return {
      snapshot: parsed.snapshot,
      reset: false,
      migrated: parsed.migrated,
      migrationNotice: parsed.migrationNotice,
    };
  }

  return {
    snapshot: emptySnapshot(),
    reset: true,
    migrated: false,
    migrationNotice: null,
    reason: parsed.reason,
  };
}
