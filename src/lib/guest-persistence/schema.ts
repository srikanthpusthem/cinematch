import {
  emptySnapshot,
  GUEST_PERSISTENCE_SCHEMA_VERSION,
  parseFeedbackEvent,
  parseGuestAnswers,
  type GuestFeedbackEvent,
  type GuestPersistedSnapshot,
  type StorageFailureReason,
} from "./types";

export type ParseSnapshotResult =
  | { ok: true; snapshot: GuestPersistedSnapshot }
  | {
      ok: false;
      reason: Extract<StorageFailureReason, "corrupt" | "unsupported_version">;
    };

/**
 * Validate and normalize a raw JSON value into a v1 snapshot.
 * Unknown versions and corrupt payloads fail closed (caller resets).
 * No forward migration yet — v1 is the only supported shape.
 */
export function parseSnapshot(raw: unknown): ParseSnapshotResult {
  if (raw == null || typeof raw !== "object") {
    return { ok: false, reason: "corrupt" };
  }

  const record = raw as Record<string, unknown>;
  if (!("version" in record) || typeof record.version !== "number") {
    return { ok: false, reason: "corrupt" };
  }

  if (record.version !== GUEST_PERSISTENCE_SCHEMA_VERSION) {
    return { ok: false, reason: "unsupported_version" };
  }

  const answers = parseGuestAnswers(record.answers);
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

  return {
    ok: true,
    snapshot: {
      version: GUEST_PERSISTENCE_SCHEMA_VERSION,
      answers,
      events,
    },
  };
}

/**
 * Migrate or reset. Today only v1 is supported; anything else resets.
 * Returns the usable snapshot plus whether a reset occurred.
 */
export function migrateOrReset(raw: unknown): {
  snapshot: GuestPersistedSnapshot;
  reset: boolean;
  reason?: Extract<StorageFailureReason, "corrupt" | "unsupported_version">;
} {
  if (raw === null || raw === undefined) {
    return { snapshot: emptySnapshot(), reset: false };
  }

  const parsed = parseSnapshot(raw);
  if (parsed.ok) {
    return { snapshot: parsed.snapshot, reset: false };
  }

  return {
    snapshot: emptySnapshot(),
    reset: true,
    reason: parsed.reason,
  };
}
