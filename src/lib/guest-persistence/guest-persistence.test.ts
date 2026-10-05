import { describe, expect, it } from "vitest";
import { EMPTY_ANSWERS, type GuestAnswers } from "@/lib/guest-flow/types";
import {
  appendEvent,
  appendFeedbackEvent,
  clearGuestPersistence,
  createFeedbackEvent,
  createFeedbackEventId,
  createMemoryStorage,
  createUndoEvent,
  deriveFeedbackState,
  emptySnapshot,
  GUEST_PERSISTENCE_SCHEMA_VERSION,
  GUEST_PERSISTENCE_STORAGE_KEY,
  loadGuestPersistence,
  mapPickFeedbackAction,
  migrateOrReset,
  parseSnapshot,
  recordFeedback,
  saveGuestAnswers,
  undoLatestEvent,
  undoLatestFeedback,
  type GuestFeedbackEvent,
  type KeyValueStorage,
} from "./index";

const sampleAnswers: GuestAnswers = {
  ...EMPTY_ANSWERS,
  serviceIds: ["netflix", "max"],
  seedIds: ["seed-a", "seed-b", "seed-c"],
  avoidedGenres: ["Horror"],
  mood: "laugh",
  format: "movie",
  movieLength: "any",
};

function quotaStorage(existing?: Record<string, string>): KeyValueStorage {
  const memory = createMemoryStorage(existing);
  return {
    getItem: (key) => memory.getItem(key),
    removeItem: (key) => memory.removeItem(key),
    setItem() {
      const error = new Error("QuotaExceededError");
      error.name = "QuotaExceededError";
      throw error;
    },
  };
}

function failingWriteStorage(): KeyValueStorage {
  const memory = createMemoryStorage();
  return {
    getItem: (key) => memory.getItem(key),
    removeItem: (key) => memory.removeItem(key),
    setItem() {
      throw new Error("disk failed");
    },
  };
}

describe("mapPickFeedbackAction", () => {
  it("maps UI actions onto persisted kinds", () => {
    expect(mapPickFeedbackAction("watched")).toBe("watched");
    expect(mapPickFeedbackAction("like")).toBe("like");
    expect(mapPickFeedbackAction("not-for-me")).toBe("dislike");
  });
});

describe("parseSnapshot / migrateOrReset", () => {
  it("accepts a valid v1 snapshot", () => {
    const raw = {
      version: GUEST_PERSISTENCE_SCHEMA_VERSION,
      answers: sampleAnswers,
      events: [
        { id: "watched:t1", kind: "watched", contentId: "t1" },
        { id: "like:t2", kind: "like", contentId: "t2" },
      ],
    };
    const parsed = parseSnapshot(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.snapshot.answers.serviceIds).toEqual(["netflix", "max"]);
    expect(parsed.snapshot.events).toHaveLength(2);
  });

  it("rejects corrupt JSON shapes and resets via migrateOrReset", () => {
    expect(parseSnapshot(null).ok).toBe(false);
    expect(parseSnapshot({ version: 1 }).ok).toBe(false);
    expect(
      parseSnapshot({
        version: 1,
        answers: { ...sampleAnswers, mood: "excited" },
        events: [],
      }).ok,
    ).toBe(false);

    const migrated = migrateOrReset({ version: 1, answers: {}, events: [] });
    expect(migrated.reset).toBe(true);
    expect(migrated.reason).toBe("corrupt");
    expect(migrated.snapshot).toEqual(emptySnapshot());
  });

  it("resets unknown schema versions", () => {
    const migrated = migrateOrReset({
      version: 99,
      answers: sampleAnswers,
      events: [],
    });
    expect(migrated.reset).toBe(true);
    expect(migrated.reason).toBe("unsupported_version");
    expect(migrated.snapshot.events).toEqual([]);
  });

  it("rejects events that carry vectors, prompts, or credentials", () => {
    expect(
      parseSnapshot({
        version: 1,
        answers: sampleAnswers,
        events: [
          {
            id: "like:t1",
            kind: "like",
            contentId: "t1",
            vector: [0.1, 0.2],
          },
        ],
      }).ok,
    ).toBe(false);

    expect(
      parseSnapshot({
        version: 1,
        answers: sampleAnswers,
        events: [],
        token: "secret",
      }).ok,
    ).toBe(false);
  });
});

describe("deriveFeedbackState + undo", () => {
  it("treats watched as suppression only, not like", () => {
    const snapshot = {
      ...emptySnapshot(),
      events: [
        createFeedbackEvent("watched", "movie-a"),
        createFeedbackEvent("like", "movie-b"),
      ] satisfies GuestFeedbackEvent[],
    };
    const derived = deriveFeedbackState(snapshot);
    expect(derived.suppressedContentIds).toEqual(["movie-a"]);
    expect(derived.likedContentIds).toEqual(["movie-b"]);
    expect(derived.likedContentIds).not.toContain("movie-a");
  });

  it("records explicit like/dislike and weak skip signals", () => {
    const snapshot = {
      ...emptySnapshot(),
      events: [
        createFeedbackEvent("like", "a"),
        createFeedbackEvent("dislike", "b"),
        createFeedbackEvent("skip", "c"),
      ],
    };
    const derived = deriveFeedbackState(snapshot);
    expect(derived.likedContentIds).toEqual(["a"]);
    expect(derived.dislikedContentIds).toEqual(["b"]);
    expect(derived.skippedContentIds).toEqual(["c"]);
    expect(derived.suppressedContentIds).toEqual([]);
  });

  it("undoes the latest applicable event and is idempotent on replay", () => {
    let snapshot = emptySnapshot();
    snapshot = appendEvent(
      snapshot,
      createFeedbackEvent("watched", "a"),
    ).snapshot;
    snapshot = appendEvent(snapshot, createFeedbackEvent("like", "b")).snapshot;
    expect(deriveFeedbackState(snapshot).latestApplicableEventId).toBe(
      createFeedbackEventId("like", "b"),
    );

    const once = undoLatestEvent(snapshot);
    expect(once.applied).toBe(true);
    expect(once.undoneEventId).toBe(createFeedbackEventId("like", "b"));
    expect(deriveFeedbackState(once.snapshot).likedContentIds).toEqual([]);
    expect(deriveFeedbackState(once.snapshot).suppressedContentIds).toEqual([
      "a",
    ]);

    const replay = undoLatestEvent(once.snapshot, createUndoEvent("like:b").id);
    // Same undo ID already present -> no duplicate effect.
    expect(replay.applied).toBe(false);
    expect(deriveFeedbackState(replay.snapshot)).toEqual(
      deriveFeedbackState(once.snapshot),
    );

    const second = undoLatestEvent(once.snapshot);
    expect(second.undoneEventId).toBe(createFeedbackEventId("watched", "a"));
    expect(deriveFeedbackState(second.snapshot).suppressedContentIds).toEqual(
      [],
    );
  });

  it("uses first-write-wins event IDs so retries do not duplicate effects", () => {
    const event = createFeedbackEvent("like", "movie-a");
    let snapshot = emptySnapshot();
    snapshot = appendEvent(snapshot, event).snapshot;
    const retried = appendEvent(snapshot, {
      id: event.id,
      kind: "dislike",
      contentId: "movie-a",
    });
    expect(retried.applied).toBe(false);
    expect(deriveFeedbackState(retried.snapshot).likedContentIds).toEqual([
      "movie-a",
    ]);
    expect(deriveFeedbackState(retried.snapshot).dislikedContentIds).toEqual(
      [],
    );
  });
});

describe("load / save with storage adapter", () => {
  it("round-trips answers and events through memory storage", () => {
    const storage = createMemoryStorage();
    const saved = saveGuestAnswers(sampleAnswers, storage);
    expect(saved.status).toEqual({ ok: true });

    const liked = recordFeedback("like", "title-1", { storage });
    expect(liked.applied).toBe(true);
    expect(liked.derived.likedContentIds).toEqual(["title-1"]);

    const watched = recordFeedback("watched", "title-2", { storage });
    expect(watched.derived.suppressedContentIds).toEqual(["title-2"]);

    const skip = recordFeedback("skip", "title-3", { storage });
    expect(skip.derived.skippedContentIds).toEqual(["title-3"]);

    const dislike = recordFeedback("dislike", "title-4", {
      storage,
      id: createFeedbackEventId("dislike", "title-4"),
    });
    expect(dislike.derived.dislikedContentIds).toEqual(["title-4"]);

    const loaded = loadGuestPersistence(storage);
    expect(loaded.reset).toBe(false);
    expect(loaded.snapshot.answers).toEqual(sampleAnswers);
    expect(loaded.snapshot.events).toHaveLength(4);
    expect(JSON.parse(storage.getItem(GUEST_PERSISTENCE_STORAGE_KEY)!)).toEqual(
      loaded.snapshot,
    );
  });

  it("resets corrupt storage and surfaces corrupt status", () => {
    const storage = createMemoryStorage({
      [GUEST_PERSISTENCE_STORAGE_KEY]: "{not-json",
    });
    const loaded = loadGuestPersistence(storage);
    expect(loaded.reset).toBe(true);
    expect(loaded.status).toEqual({ ok: false, reason: "corrupt" });
    expect(loaded.snapshot).toEqual(emptySnapshot());
  });

  it("resets unsupported versions on load and writes empty snapshot", () => {
    const storage = createMemoryStorage({
      [GUEST_PERSISTENCE_STORAGE_KEY]: JSON.stringify({
        version: 7,
        answers: sampleAnswers,
        events: [{ id: "x", kind: "like", contentId: "y" }],
      }),
    });
    const loaded = loadGuestPersistence(storage);
    expect(loaded.reset).toBe(true);
    expect(loaded.status).toEqual({
      ok: false,
      reason: "unsupported_version",
    });
    expect(loaded.snapshot.events).toEqual([]);
    expect(JSON.parse(storage.getItem(GUEST_PERSISTENCE_STORAGE_KEY)!)).toEqual(
      emptySnapshot(),
    );
  });

  it("degrades when storage is unavailable", () => {
    const loaded = loadGuestPersistence(null);
    expect(loaded.status).toEqual({ ok: false, reason: "unavailable" });
    expect(loaded.snapshot).toEqual(emptySnapshot());

    const saved = saveGuestAnswers(sampleAnswers, null);
    expect(saved.status).toEqual({ ok: false, reason: "unavailable" });
    // In-memory result still reflects the requested answers for the session.
    expect(saved.snapshot.answers).toEqual(sampleAnswers);
  });

  it("surfaces QuotaExceededError without throwing", () => {
    const storage = quotaStorage();
    const saved = saveGuestAnswers(sampleAnswers, storage);
    expect(saved.status).toEqual({ ok: false, reason: "quota_exceeded" });
    expect(saved.snapshot.answers).toEqual(sampleAnswers);
  });

  it("surfaces generic write failures", () => {
    const storage = failingWriteStorage();
    const result = appendFeedbackEvent(
      createFeedbackEvent("watched", "t1"),
      storage,
    );
    expect(result.status).toEqual({ ok: false, reason: "write_failed" });
    expect(result.applied).toBe(true);
    expect(result.derived.suppressedContentIds).toEqual(["t1"]);
  });

  it("undoLatestFeedback persists the undo and reverses suppression", () => {
    const storage = createMemoryStorage();
    recordFeedback("watched", "movie-z", { storage });
    recordFeedback("like", "movie-y", { storage });

    const undone = undoLatestFeedback(storage);
    expect(undone.applied).toBe(true);
    expect(undone.undoneEventId).toBe(createFeedbackEventId("like", "movie-y"));
    expect(undone.derived.likedContentIds).toEqual([]);
    expect(undone.derived.suppressedContentIds).toEqual(["movie-z"]);

    const again = undoLatestFeedback(storage);
    expect(again.undoneEventId).toBe(
      createFeedbackEventId("watched", "movie-z"),
    );
    expect(again.derived.suppressedContentIds).toEqual([]);
  });

  it("clearGuestPersistence wipes answers and events", () => {
    const storage = createMemoryStorage();
    saveGuestAnswers(sampleAnswers, storage);
    recordFeedback("like", "t1", { storage });
    const cleared = clearGuestPersistence(storage);
    expect(cleared.snapshot).toEqual(emptySnapshot());
    expect(loadGuestPersistence(storage).snapshot).toEqual(emptySnapshot());
  });

  it("rejects invalid answers on save without clobbering prior state", () => {
    const storage = createMemoryStorage();
    saveGuestAnswers(sampleAnswers, storage);
    const invalid = {
      ...sampleAnswers,
      serviceIds: ["netflix", "not-a-service"],
    } as unknown as GuestAnswers;
    const result = saveGuestAnswers(invalid, storage);
    expect(result.status).toEqual({ ok: false, reason: "corrupt" });
    expect(loadGuestPersistence(storage).snapshot.answers).toEqual(
      sampleAnswers,
    );
  });
});
