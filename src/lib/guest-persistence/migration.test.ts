import { describe, expect, it, vi } from "vitest";
import { EMPTY_ANSWERS, type GuestAnswers } from "@/lib/guest-flow/types";
import {
  appendEvent,
  appendFeedbackEvent,
  clearGuestPersistence,
  createMemoryStorage,
  deriveFeedbackState,
  getBrowserLocalStorage,
  GUEST_PERSISTENCE_SCHEMA_VERSION,
  GUEST_PERSISTENCE_STORAGE_KEY,
  GUEST_PERSISTENCE_V1_BACKUP_STORAGE_KEY,
  loadGuestPersistence,
  migrateOrReset,
  parseGuestAnswers,
  recordFeedback,
  saveGuestAnswers,
  saveGuestSnapshot,
  undoLatestEvent,
  undoLatestFeedback,
  type GuestFeedbackEvent,
  type KeyValueStorage,
} from "./index";

const liveAnswers: GuestAnswers = {
  ...EMPTY_ANSWERS,
  serviceIds: ["8", "1899"],
  seedIds: ["101", "102", "103"],
  avoidedGenres: ["27"],
  mood: "think",
  format: "series",
  movieLength: "epic",
  seriesLength: "short-episodes",
};

const legacyEvents: GuestFeedbackEvent[] = [
  { id: "watched:old", kind: "watched", contentId: "mock-title" },
  { id: "like:one", kind: "like", contentId: "101" },
  { id: "dislike:two", kind: "dislike", contentId: "102" },
  { id: "skip:three", kind: "skip", contentId: "103" },
  { id: "undo:skip", kind: "undo", targetEventId: "skip:three" },
  // Replayed IDs must survive migration without changing first-write-wins.
  { id: "like:one", kind: "dislike", contentId: "101" },
];

function legacySnapshot() {
  return {
    version: 1,
    answers: {
      ...liveAnswers,
      serviceIds: ["netflix", "8", "max"],
      seedIds: ["mock-inception", "101", "seed-b"],
      avoidedGenres: ["Horror", "27"],
      servicesSkipped: true,
      tasteSkipped: true,
    },
    events: legacyEvents,
  };
}

function legacyStorage() {
  // Whitespace and harmless extra metadata must remain recoverable verbatim.
  const raw = JSON.stringify(
    { ...legacySnapshot(), oldMetadata: "kept" },
    null,
    2,
  );
  return {
    raw,
    storage: createMemoryStorage({ [GUEST_PERSISTENCE_STORAGE_KEY]: raw }),
  };
}

function blockBackup(storage: KeyValueStorage): KeyValueStorage {
  return {
    ...storage,
    setItem(key, value) {
      if (key === GUEST_PERSISTENCE_V1_BACKUP_STORAGE_KEY) {
        const error = new Error("Backup quota exceeded");
        error.name = "QuotaExceededError";
        throw error;
      }
      storage.setItem(key, value);
    },
  };
}

describe("live-catalog snapshot version", () => {
  it("round-trips numeric selections through reload without coercion", () => {
    expect(GUEST_PERSISTENCE_SCHEMA_VERSION).toBe(2);
    const storage = createMemoryStorage();
    const answers = {
      ...liveAnswers,
      seedIds: ["1", "9007199254740991"],
    };
    const saved = saveGuestAnswers(answers, storage);
    expect(saved.status).toEqual({ ok: true });
    expect(saved.migrated).toBe(false);
    const loaded = loadGuestPersistence(storage);
    expect(loaded.snapshot.answers).toEqual(answers);
    expect(loaded.snapshot.version).toBe(2);
    expect(loaded.migrationNotice).toBeNull();
  });

  it.each([
    "0",
    "-1",
    "01",
    "1.2",
    "1e2",
    "+1",
    " 1",
    "1 ",
    "",
    "9007199254740992",
    "netflix",
  ])(
    "rejects noncanonical or unsafe live ID %j in every selection field",
    (id) => {
      for (const field of ["serviceIds", "seedIds", "avoidedGenres"] as const) {
        expect(parseGuestAnswers({ ...liveAnswers, [field]: [id] })).toBeNull();
      }
    },
  );
});

describe("v1 migration", () => {
  it("resets only unresolved selections and preserves preferences, flags, and every event", () => {
    const original = legacySnapshot();
    const before = JSON.stringify(original);
    const migrated = migrateOrReset(original);
    expect(migrated.reset).toBe(false);
    expect(migrated.migrated).toBe(true);
    expect(migrated.snapshot.answers).toEqual({
      ...original.answers,
      serviceIds: ["8"],
      seedIds: ["101"],
      avoidedGenres: ["27"],
    });
    expect(migrated.snapshot.events).toEqual(original.events);
    expect(deriveFeedbackState(migrated.snapshot)).toEqual(
      deriveFeedbackState(original),
    );
    expect(migrated.migrationNotice).toContain("streaming services");
    expect(migrated.migrationNotice).toContain("quiz titles");
    expect(migrated.migrationNotice).toContain("avoided genres");
    expect(JSON.stringify(original)).toBe(before);
  });

  it("backs up exact raw state before writing v2 and migrates only once across reloads", () => {
    const { raw, storage } = legacyStorage();
    const writes: string[] = [];
    const observed = {
      ...storage,
      setItem(key: string, value: string) {
        writes.push(key);
        storage.setItem(key, value);
      },
    };
    const loaded = loadGuestPersistence(observed);
    expect(loaded.status).toEqual({ ok: true });
    expect(loaded.migrated).toBe(true);
    expect(loaded.reset).toBe(false);
    expect(writes).toEqual([
      GUEST_PERSISTENCE_V1_BACKUP_STORAGE_KEY,
      GUEST_PERSISTENCE_STORAGE_KEY,
    ]);
    expect(storage.getItem(GUEST_PERSISTENCE_V1_BACKUP_STORAGE_KEY)).toBe(raw);
    expect(JSON.parse(storage.getItem(GUEST_PERSISTENCE_STORAGE_KEY)!)).toEqual(
      loaded.snapshot,
    );

    const reloaded = loadGuestPersistence(observed);
    expect(reloaded.snapshot).toEqual(loaded.snapshot);
    expect(reloaded.migrated).toBe(false);
    expect(reloaded.migrationNotice).toBeNull();
    expect(writes).toHaveLength(2);
  });

  it("preserves undo history and supports further undo after reload", () => {
    const { raw, storage } = legacyStorage();
    const migrated = loadGuestPersistence(storage);
    expect(migrated.snapshot.events).toEqual(legacyEvents);
    const undone = undoLatestFeedback(storage);
    expect(undone.undoneEventId).toBe("dislike:two");
    expect(undone.derived.dislikedContentIds).toEqual([]);
    expect(undone.derived.skippedContentIds).toEqual([]);
    expect(undone.derived.likedContentIds).toEqual(["101"]);
    expect(undone.derived.suppressedContentIds).toEqual(["mock-title"]);
    const reloaded = loadGuestPersistence(storage);
    expect(reloaded.snapshot.events).toEqual(undone.snapshot.events);
    expect(reloaded.snapshot.events.slice(0, legacyEvents.length)).toEqual(
      legacyEvents,
    );
    expect(storage.getItem(GUEST_PERSISTENCE_V1_BACKUP_STORAGE_KEY)).toBe(raw);
  });

  it("preserves all selections when v1 already contains canonical live IDs", () => {
    const migrated = migrateOrReset({
      version: 1,
      answers: liveAnswers,
      events: legacyEvents,
    });
    expect(migrated.migrated).toBe(true);
    expect(migrated.snapshot.answers).toEqual(liveAnswers);
    expect(migrated.migrationNotice).not.toContain("choose them again");
  });

  it("also backs up malformed v1 before resetting it", () => {
    const raw = JSON.stringify({
      version: 1,
      answers: {},
      events: legacyEvents,
    });
    const storage = createMemoryStorage({
      [GUEST_PERSISTENCE_STORAGE_KEY]: raw,
    });
    const loaded = loadGuestPersistence(storage);
    expect(loaded.reset).toBe(true);
    expect(loaded.status).toEqual({ ok: false, reason: "corrupt" });
    expect(storage.getItem(GUEST_PERSISTENCE_V1_BACKUP_STORAGE_KEY)).toBe(raw);
  });
});

describe("migration storage failures", () => {
  it.each(["load", "save", "feedback", "duplicate", "undo", "clear"] as const)(
    "never overwrites original v1 after backup failure via %s",
    (operation) => {
      const { raw, storage } = legacyStorage();
      const blocked = blockBackup(storage);
      const result =
        operation === "load"
          ? loadGuestPersistence(blocked)
          : operation === "save"
            ? saveGuestAnswers(liveAnswers, blocked)
            : operation === "feedback"
              ? recordFeedback("like", "104", { storage: blocked })
              : operation === "duplicate"
                ? recordFeedback("like", "101", {
                    storage: blocked,
                    id: "like:one",
                  })
                : operation === "undo"
                  ? undoLatestFeedback(blocked)
                  : clearGuestPersistence(blocked);
      expect(result.status).toEqual({ ok: false, reason: "quota_exceeded" });
      expect(storage.getItem(GUEST_PERSISTENCE_STORAGE_KEY)).toBe(raw);
      expect(
        storage.getItem(GUEST_PERSISTENCE_V1_BACKUP_STORAGE_KEY),
      ).toBeNull();
      if (operation !== "clear") {
        expect(result.migrated).toBe(true);
        expect(result.migrationNotice).toContain("live catalog");
        expect(result.snapshot.events.slice(0, legacyEvents.length)).toEqual(
          legacyEvents,
        );
      }
      if (operation === "save")
        expect(result.snapshot.answers).toEqual(liveAnswers);
    },
  );

  it("returns full state that can be used as a memory fallback after a failed save", () => {
    const { storage } = legacyStorage();
    const failed = saveGuestAnswers(liveAnswers, blockBackup(storage));
    const memory = createMemoryStorage({
      [GUEST_PERSISTENCE_STORAGE_KEY]: JSON.stringify(failed.snapshot),
    });
    recordFeedback("like", "104", { storage: memory });
    const undone = undoLatestFeedback(memory);
    expect(undone.undoneEventId).toBe("like:104");
    const loaded = loadGuestPersistence(memory);
    expect(loaded.snapshot.answers).toEqual(liveAnswers);
    expect(loaded.snapshot.events.slice(0, legacyEvents.length)).toEqual(
      legacyEvents,
    );
  });

  it("saves the full session snapshot without losing events after failed writes", () => {
    const { raw, storage } = legacyStorage();
    const blocked = blockBackup(storage);
    const loaded = loadGuestPersistence(blocked);
    let session = { ...loaded.snapshot, answers: liveAnswers };
    session = appendEvent(session, {
      id: "like:104",
      kind: "like",
      contentId: "104",
    }).snapshot;
    const failed = saveGuestSnapshot(session, blocked);
    expect(failed.status).toEqual({ ok: false, reason: "quota_exceeded" });
    expect(failed.snapshot).toEqual(session);
    expect(storage.getItem(GUEST_PERSISTENCE_STORAGE_KEY)).toBe(raw);
    session = undoLatestEvent(failed.snapshot).snapshot;
    const unavailable = saveGuestSnapshot(session, null);
    expect(unavailable.status).toEqual({ ok: false, reason: "unavailable" });
    expect(unavailable.snapshot).toEqual(session);
    const saved = saveGuestSnapshot(unavailable.snapshot, storage);
    expect(saved.status).toEqual({ ok: true });
    expect(loadGuestPersistence(storage).snapshot).toEqual(session);
    expect(storage.getItem(GUEST_PERSISTENCE_V1_BACKUP_STORAGE_KEY)).toBe(raw);
    expect(session.events).toHaveLength(legacyEvents.length + 2);
    expect(deriveFeedbackState(session).likedContentIds).toEqual(["101"]);
  });

  it("rejects an invalid full snapshot without clobbering valid stored state", () => {
    const storage = createMemoryStorage();
    const saved = saveGuestAnswers(liveAnswers, storage);
    const raw = storage.getItem(GUEST_PERSISTENCE_STORAGE_KEY);
    const invalid = {
      ...saved.snapshot,
      answers: { ...liveAnswers, seedIds: ["mock-title"] },
    };
    const result = saveGuestSnapshot(invalid, storage);
    expect(result.status).toEqual({ ok: false, reason: "corrupt" });
    expect(result.snapshot).toEqual(saved.snapshot);
    expect(storage.getItem(GUEST_PERSISTENCE_STORAGE_KEY)).toBe(raw);
  });

  it("does not replace v1 when backup reports success without storing the bytes", () => {
    const { raw, storage } = legacyStorage();
    const silentFailure: KeyValueStorage = {
      ...storage,
      setItem(key, value) {
        if (key !== GUEST_PERSISTENCE_V1_BACKUP_STORAGE_KEY)
          storage.setItem(key, value);
      },
    };
    const loaded = loadGuestPersistence(silentFailure);
    expect(loaded.status).toEqual({ ok: false, reason: "write_failed" });
    expect(storage.getItem(GUEST_PERSISTENCE_STORAGE_KEY)).toBe(raw);
  });

  it("retains original and backup when the v2 write fails, then can retry safely", () => {
    const { raw, storage } = legacyStorage();
    const blocked: KeyValueStorage = {
      ...storage,
      setItem(key, value) {
        if (key === GUEST_PERSISTENCE_STORAGE_KEY)
          throw new Error("disk failed");
        storage.setItem(key, value);
      },
    };
    expect(loadGuestPersistence(blocked).status).toEqual({
      ok: false,
      reason: "write_failed",
    });
    expect(storage.getItem(GUEST_PERSISTENCE_STORAGE_KEY)).toBe(raw);
    expect(storage.getItem(GUEST_PERSISTENCE_V1_BACKUP_STORAGE_KEY)).toBe(raw);
    expect(loadGuestPersistence(storage).status).toEqual({ ok: true });
    expect(loadGuestPersistence(storage).migrated).toBe(false);
  });

  it("never replaces an earlier, different v1 backup", () => {
    const { raw, storage } = legacyStorage();
    storage.setItem(GUEST_PERSISTENCE_V1_BACKUP_STORAGE_KEY, "earlier backup");
    expect(loadGuestPersistence(storage).status).toEqual({
      ok: false,
      reason: "write_failed",
    });
    expect(storage.getItem(GUEST_PERSISTENCE_V1_BACKUP_STORAGE_KEY)).toBe(
      "earlier backup",
    );
    expect(storage.getItem(GUEST_PERSISTENCE_STORAGE_KEY)).toBe(raw);
  });

  it("keeps readable browser storage available when writes are blocked", () => {
    const { raw, storage } = legacyStorage();
    const blocked = blockBackup(storage);
    vi.stubGlobal("localStorage", blocked);
    try {
      expect(getBrowserLocalStorage()).toBe(blocked);
      const loaded = loadGuestPersistence();
      expect(loaded.snapshot.events).toEqual(legacyEvents);
      expect(loaded.status).toEqual({ ok: false, reason: "quota_exceeded" });
      expect(storage.getItem(GUEST_PERSISTENCE_STORAGE_KEY)).toBe(raw);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not write when storage reads fail", () => {
    const setItem = vi.fn();
    const blocked: KeyValueStorage = {
      getItem() {
        throw new Error("private mode");
      },
      setItem,
      removeItem: vi.fn(),
    };
    const saved = saveGuestAnswers(liveAnswers, blocked);
    expect(saved.status).toEqual({ ok: false, reason: "unavailable" });
    expect(saved.snapshot.answers).toEqual(liveAnswers);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("rejects invalid feedback without poisoning a valid snapshot", () => {
    const storage = createMemoryStorage();
    saveGuestAnswers(liveAnswers, storage);
    const raw = storage.getItem(GUEST_PERSISTENCE_STORAGE_KEY);
    const result = appendFeedbackEvent(
      { id: "bad", kind: "like", contentId: "" },
      storage,
    );
    expect(result.applied).toBe(false);
    expect(result.status).toEqual({ ok: false, reason: "corrupt" });
    expect(storage.getItem(GUEST_PERSISTENCE_STORAGE_KEY)).toBe(raw);
  });
});
