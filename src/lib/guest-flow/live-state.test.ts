import { describe, expect, it } from "vitest";
import {
  createFeedbackEvent,
  emptySnapshot,
  undoLatestEvent,
} from "@/lib/guest-persistence";
import { EMPTY_ANSWERS, type GuestAnswers } from "./types";
import {
  createLiveRequest,
  deriveLiveFeedback,
  toPicksResult,
} from "./live-state";

const answers: GuestAnswers = {
  ...EMPTY_ANSWERS,
  servicesSkipped: false,
  serviceIds: ["8"],
  avoidedGenres: ["28", "10759"],
  seedIds: [],
  tasteSkipped: true,
  mood: "comfort",
  format: "movie",
  movieLength: "any",
};

describe("live guest request", () => {
  it("uses only actual provider/genre IDs, preserving distinct movie and series genres", () => {
    const request = createLiveRequest(answers, emptySnapshot());
    expect(request.selectedUsServiceIds).toEqual([8]);
    expect(request.excludedGenreIds).toEqual([28, 10759]);
    expect(request.length).toBeNull();
    expect(request.seedIds).toEqual([]);
  });
  it("rejects unresolved legacy labels rather than guessing", () => {
    expect(() =>
      createLiveRequest(
        { ...answers, serviceIds: ["netflix"] },
        emptySnapshot(),
      ),
    ).toThrow("need updating");
    expect(() =>
      createLiveRequest(
        { ...answers, avoidedGenres: ["Horror"] },
        emptySnapshot(),
      ),
    ).toThrow("need updating");
  });
  it("allows 0 or 3–5 unique seeds and rejects partial/unresolved choices", () => {
    expect(
      createLiveRequest(
        { ...answers, seedIds: ["1", "2", "3"] },
        emptySnapshot(),
      ).seedIds,
    ).toEqual(["1", "2", "3"]);
    expect(() =>
      createLiveRequest({ ...answers, seedIds: ["1"] }, emptySnapshot()),
    ).toThrow("3 to 5");
    expect(() =>
      createLiveRequest(
        { ...answers, seedIds: ["1", "1", "2"] },
        emptySnapshot(),
      ),
    ).toThrow();
    expect(() =>
      createLiveRequest(
        { ...answers, seedIds: ["seed-a", "seed-b", "seed-c"] },
        emptySnapshot(),
      ),
    ).toThrow("live catalog");
  });
  it("keeps watched separate from taste and excludes shown titles without dropping history", () => {
    const snapshot = {
      ...emptySnapshot(),
      events: [
        createFeedbackEvent("watched", "11"),
        createFeedbackEvent("like", "12"),
        createFeedbackEvent("dislike", "13"),
        createFeedbackEvent("skip", "14"),
        createFeedbackEvent("like", "legacy-mock"),
      ],
    };
    const request = createLiveRequest(answers, snapshot, ["15", "15"]);
    expect(request.watchedIds).toEqual(["11"]);
    expect(request.likedIds).toEqual(["12"]);
    expect(request.dislikedIds).toEqual(["13"]);
    expect(request.excludedIds).toEqual(["15", "14"]);
    expect(snapshot.events).toHaveLength(5);
  });
  it("uses the latest active taste action and restores the prior action on undo", () => {
    const snapshot = {
      ...emptySnapshot(),
      events: [
        createFeedbackEvent("like", "12", "one"),
        createFeedbackEvent("dislike", "12", "two"),
      ],
    };
    expect(deriveLiveFeedback(snapshot).likedContentIds).toEqual([]);
    expect(createLiveRequest(answers, snapshot).dislikedIds).toEqual(["12"]);
    const undone = undoLatestEvent(snapshot).snapshot;
    expect(createLiveRequest(answers, undone).likedIds).toEqual(["12"]);
    expect(createLiveRequest(answers, undone).dislikedIds).toEqual([]);
  });
  it("does not silently truncate more than the backend exclusion limit", () => {
    expect(() =>
      createLiveRequest(
        answers,
        emptySnapshot(),
        Array.from({ length: 201 }, (_, i) => String(i + 1)),
      ),
    ).toThrow();
  });
});

describe("live result presentation", () => {
  it("keeps empty/error responses honest", () => {
    expect(
      toPicksResult({
        schemaVersion: 1,
        status: "error",
        code: "CATALOG_UNAVAILABLE",
        message: "Catalog unavailable.",
      }),
    ).toEqual({ status: "error", message: "Catalog unavailable." });
  });
});

import { LiveHistoryLimitError } from "./live-state";

describe("bounded history recovery", () => {
  it("offers explicit recovery for watched history above the request limit", () => {
    const snapshot = {
      ...emptySnapshot(),
      events: Array.from({ length: 201 }, (_, index) =>
        createFeedbackEvent("watched", String(index + 1)),
      ),
    };
    let failure: unknown;
    try {
      createLiveRequest(answers, snapshot);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(LiveHistoryLimitError);
    expect(failure).toMatchObject({
      recovery: "undo-feedback",
      feedbackKind: "watched",
    });
    expect((failure as Error).message).toContain("Nothing was cleared");
    expect(snapshot.events).toHaveLength(201);
    const undone = undoLatestEvent(snapshot).snapshot;
    expect(createLiveRequest(answers, undone).watchedIds).toHaveLength(200);
    expect(undone.events).toHaveLength(202);
  });

  it("checks saved-skip and show-more exclusions as a deduplicated union", () => {
    const snapshot = {
      ...emptySnapshot(),
      events: [
        createFeedbackEvent("skip", "500"),
        createFeedbackEvent("watched", "600"),
      ],
    };
    const seen = Array.from({ length: 200 }, (_, index) => String(index + 1));
    let failure: unknown;
    try {
      createLiveRequest(answers, snapshot, seen);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      recovery: "restart-search",
      feedbackKind: null,
    });
    const restarted = createLiveRequest(answers, snapshot, []);
    expect(restarted.excludedIds).toEqual(["500"]);
    expect(restarted.watchedIds).toEqual(["600"]);
    expect(snapshot.events).toHaveLength(2);
    expect(createLiveRequest(answers, snapshot, ["500"]).excludedIds).toEqual([
      "500",
    ]);
  });
});
