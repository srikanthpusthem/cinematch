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
  const payload = JSON.stringify(snapshot);
  return writeStorageValue(storage, GUEST_PERSISTENCE_STORAGE_KEY, payload)
    .status;
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
    };
  }

  if (read.value == null) {
    return {
      snapshot: emptySnapshot(),
      status: { ok: true },
      reset: false,
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
    };
  }

  return {
    snapshot: migrated.snapshot,
    status: { ok: true },
    reset: false,
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
      reset: false,
    };
  }

  const snapshot = validated.snapshot;
  const status = persistSnapshot(snapshot, backend);
  return { snapshot, status, reset: false };
}

/** Append a feedback event with first-write-wins idempotency. */
export function appendFeedbackEvent(
  event: GuestFeedbackEvent,
  storage?: KeyValueStorage | null,
): AppendFeedbackResult {
  const backend = resolveStorage(storage);
  const current = loadGuestPersistence(backend);
  const next = appendEvent(current.snapshot, event);
  const status = next.applied
    ? persistSnapshot(next.snapshot, backend)
    : current.status.ok
      ? { ok: true as const }
      : persistSnapshot(next.snapshot, backend);
  return {
    snapshot: next.snapshot,
    status: next.applied ? status : { ok: true },
    reset: current.reset,
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
    : { ok: true as const };
  return {
    snapshot: next.snapshot,
    status,
    reset: current.reset,
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
  return { snapshot, status, reset: false };
}
