import type { GuestAnswers } from "@/lib/guest-flow/types";
import {
  appendEvent,
  createFeedbackEvent,
  deriveFeedbackState,
  undoLatestEvent,
} from "./events";
import { migrateOrReset, parseSnapshot } from "./schema";
import {
  clearStorageValue,
  getBrowserLocalStorage,
  readStorageValue,
  writeStorageValue,
} from "./storage";
import {
  emptySnapshot,
  GUEST_PERSISTENCE_STORAGE_KEY,
  GUEST_PERSISTENCE_V1_BACKUP_STORAGE_KEY,
  parseFeedbackEvent,
  type DerivedFeedbackState,
  type GuestFeedbackEvent,
  type GuestFeedbackKind,
  type GuestPersistedSnapshot,
  type KeyValueStorage,
  type StorageStatus,
} from "./types";

export type GuestPersistenceResult = {
  snapshot: GuestPersistedSnapshot;
  status: StorageStatus;
  /** True when corrupt / unknown-version data was discarded. */
  reset: boolean;
  /** True when a v1 snapshot was converted to live-catalog selections. */
  migrated: boolean;
  /** Display after loading; a failed write still returns usable session state. */
  migrationNotice: string | null;
};

export type AppendFeedbackResult = GuestPersistenceResult & {
  applied: boolean;
  derived: DerivedFeedbackState;
};

export type UndoResult = GuestPersistenceResult & {
  applied: boolean;
  undoneEventId: string | null;
  derived: DerivedFeedbackState;
};

function resolveStorage(
  storage?: KeyValueStorage | null,
): KeyValueStorage | null {
  if (storage === undefined) {
    return getBrowserLocalStorage();
  }
  return storage;
}

function persistSnapshot(
  snapshot: GuestPersistedSnapshot,
  storage: KeyValueStorage | null,
): StorageStatus {
  // Guard every writer, not only load: a failed migration backup must not be
  // bypassed by a later save, feedback action, undo, or clear.
  const existing = readStorageValue(storage, GUEST_PERSISTENCE_STORAGE_KEY);
  if (!existing.status.ok) return existing.status;
  if (existing.value !== null) {
    let raw: unknown;
    try {
      raw = JSON.parse(existing.value);
    } catch {
      raw = null;
    }
    if (
      raw !== null &&
      typeof raw === "object" &&
      "version" in raw &&
      raw.version === 1
    ) {
      const backupStatus = backupLegacySnapshot(storage, existing.value);
      if (!backupStatus.ok) return backupStatus;
    }
  }
  const payload = JSON.stringify(snapshot);
  return writeStorageValue(storage, GUEST_PERSISTENCE_STORAGE_KEY, payload)
    .status;
}

function backupLegacySnapshot(
  storage: KeyValueStorage | null,
  raw: string,
): StorageStatus {
  const backup = readStorageValue(
    storage,
    GUEST_PERSISTENCE_V1_BACKUP_STORAGE_KEY,
  );
  if (!backup.status.ok) return backup.status;
  if (backup.value === raw) return { ok: true };
  // Preserve any earlier backup rather than silently replacing recoverable data.
  if (backup.value !== null) return { ok: false, reason: "write_failed" };
  const written = writeStorageValue(
    storage,
    GUEST_PERSISTENCE_V1_BACKUP_STORAGE_KEY,
    raw,
  );
  if (!written.status.ok) return written.status;
  const verified = readStorageValue(
    storage,
    GUEST_PERSISTENCE_V1_BACKUP_STORAGE_KEY,
  );
  if (!verified.status.ok) return verified.status;
  return verified.value === raw
    ? { ok: true }
    : { ok: false, reason: "write_failed" };
}

/**
 * Load guest answers + feedback events from storage.
 * Corrupt or unknown versions reset to empty and attempt to clear the key.
 */
export function loadGuestPersistence(
  storage?: KeyValueStorage | null,
): GuestPersistenceResult {
  const backend = resolveStorage(storage);
  const read = readStorageValue(backend, GUEST_PERSISTENCE_STORAGE_KEY);

  if (!read.status.ok && read.value == null) {
    return {
      snapshot: emptySnapshot(),
      status: read.status,
      reset: false,
      migrated: false,
      migrationNotice: null,
    };
  }

  if (read.value == null) {
    return {
      snapshot: emptySnapshot(),
      status: { ok: true },
      reset: false,
      migrated: false,
      migrationNotice: null,
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(read.value);
  } catch {
    clearStorageValue(backend, GUEST_PERSISTENCE_STORAGE_KEY);
    return {
      snapshot: emptySnapshot(),
      status: { ok: false, reason: "corrupt" },
      reset: true,
      migrated: false,
      migrationNotice: null,
    };
  }

  const migrated = migrateOrReset(parsedJson);
  if (migrated.reset) {
    const writeStatus = persistSnapshot(migrated.snapshot, backend);
    return {
      snapshot: migrated.snapshot,
      status: writeStatus.ok
        ? { ok: false, reason: migrated.reason ?? "corrupt" }
        : writeStatus,
      reset: true,
      migrated: false,
      migrationNotice: null,
    };
  }

  return {
    snapshot: migrated.snapshot,
    status: migrated.migrated
      ? persistSnapshot(migrated.snapshot, backend)
      : { ok: true },
    reset: false,
    migrated: migrated.migrated,
    migrationNotice: migrated.migrationNotice,
  };
}

/**
 * Persist a complete session snapshot, including any in-memory-only events.
 * Callers can keep the returned snapshot after a failed write and retry later;
 * this deliberately does not reload or merge stale storage into session state.
 */
export function saveGuestSnapshot(
  snapshot: GuestPersistedSnapshot,
  storage?: KeyValueStorage | null,
): GuestPersistenceResult {
  const backend = resolveStorage(storage);
  const validated = parseSnapshot(snapshot);
  if (!validated.ok) {
    return {
      ...loadGuestPersistence(backend),
      status: { ok: false, reason: "corrupt" },
    };
  }
  return {
    snapshot: validated.snapshot,
    status: persistSnapshot(validated.snapshot, backend),
    reset: false,
    migrated: validated.migrated,
    migrationNotice: validated.migrationNotice,
  };
}

/** Replace the stored answers snapshot; events are preserved. */
export function saveGuestAnswers(
  answers: GuestAnswers,
  storage?: KeyValueStorage | null,
): GuestPersistenceResult {
  const backend = resolveStorage(storage);
  const current = loadGuestPersistence(backend);
  // Re-validate answers through the same parser used for load.
  const validated = parseSnapshot({
    version: current.snapshot.version,
    answers,
    events: current.snapshot.events,
  });
  if (!validated.ok) {
    return {
      snapshot: current.snapshot,
      status: { ok: false, reason: "corrupt" },
      reset: current.reset,
      migrated: current.migrated,
      migrationNotice: current.migrationNotice,
    };
  }

  const snapshot = validated.snapshot;
  const status = persistSnapshot(snapshot, backend);
  return {
    snapshot,
    status,
    reset: current.reset,
    migrated: current.migrated,
    migrationNotice: current.migrationNotice,
  };
}

/** Append a feedback event with first-write-wins idempotency. */
export function appendFeedbackEvent(
  event: GuestFeedbackEvent,
  storage?: KeyValueStorage | null,
): AppendFeedbackResult {
  const backend = resolveStorage(storage);
  const current = loadGuestPersistence(backend);
  const validated = parseFeedbackEvent(event);
  if (validated === null) {
    return {
      ...current,
      status: { ok: false, reason: "corrupt" },
      applied: false,
      derived: deriveFeedbackState(current.snapshot),
    };
  }
  const next = appendEvent(current.snapshot, validated);
  const status = next.applied
    ? persistSnapshot(next.snapshot, backend)
    : current.status.ok
      ? { ok: true as const }
      : persistSnapshot(next.snapshot, backend);
  return {
    snapshot: next.snapshot,
    status,
    reset: current.reset,
    migrated: current.migrated,
    migrationNotice: current.migrationNotice,
    applied: next.applied,
    derived: deriveFeedbackState(next.snapshot),
  };
}

/** Convenience: build + append a non-undo feedback event. */
export function recordFeedback(
  kind: GuestFeedbackKind,
  contentId: string,
  options?: {
    id?: string;
    storage?: KeyValueStorage | null;
  },
): AppendFeedbackResult {
  return appendFeedbackEvent(
    createFeedbackEvent(kind, contentId, options?.id),
    options?.storage,
  );
}

/** Reverse the latest still-active feedback event. */
export function undoLatestFeedback(
  storage?: KeyValueStorage | null,
  undoEventId?: string,
): UndoResult {
  const backend = resolveStorage(storage);
  const current = loadGuestPersistence(backend);
  const next = undoLatestEvent(current.snapshot, undoEventId);
  const status = next.applied
    ? persistSnapshot(next.snapshot, backend)
    : current.status;
  return {
    snapshot: next.snapshot,
    status,
    reset: current.reset,
    migrated: current.migrated,
    migrationNotice: current.migrationNotice,
    applied: next.applied,
    undoneEventId: next.undoneEventId,
    derived: deriveFeedbackState(next.snapshot),
  };
}

/** Clear all guest persistence (answers + events). */
export function clearGuestPersistence(
  storage?: KeyValueStorage | null,
): GuestPersistenceResult {
  const backend = resolveStorage(storage);
  const snapshot = emptySnapshot();
  const status = persistSnapshot(snapshot, backend);
  return {
    snapshot,
    status,
    reset: false,
    migrated: false,
    migrationNotice: null,
  };
}
