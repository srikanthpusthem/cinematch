import { describe, expect, it } from "vitest";
import {
  buildTasteVector,
  TASTE_WEIGHTS,
  type TasteFeedbackEvent,
} from "./taste-vector";

describe("buildTasteVector", () => {
  it("averages seed embeddings with equal documented weight", () => {
    expect(
      buildTasteVector({
        seedVectors: [
          [1, 0],
          [0, 1],
          [0.5, 0.5],
        ],
      }).vector,
    ).toEqual([0.5, 0.5]);
    expect(TASTE_WEIGHTS.seedCentroid).toBe(1);
  });

  it("supports a zero-seed, zero-feedback cold start", () => {
    expect(buildTasteVector({ seedVectors: [] })).toEqual({
      vector: null,
      suppressedContentIds: [],
      appliedEventIds: [],
    });
  });

  it("can leave cold start when explicit feedback supplies the first dimension", () => {
    const result = buildTasteVector({
      seedVectors: [],
      events: [
        { id: "like-1", kind: "like", contentId: "a", vector: [0.2, 0.8] },
      ],
    });

    expect(result.vector?.[0]).toBeCloseTo(0.2);
    expect(result.vector?.[1]).toBeCloseTo(0.8);
  });

  it("applies strong explicit likes and dislikes and a weak skip", () => {
    const result = buildTasteVector({
      seedVectors: [[0, 0]],
      events: [
        { id: "like-1", kind: "like", contentId: "a", vector: [1, 0] },
        {
          id: "dislike-1",
          kind: "dislike",
          contentId: "b",
          vector: [0, 1],
        },
        { id: "skip-1", kind: "skip", contentId: "c", vector: [1, 1] },
      ],
    });

    expect(TASTE_WEIGHTS.like).toBe(0.35);
    expect(TASTE_WEIGHTS.dislike).toBe(-0.35);
    expect(TASTE_WEIGHTS.skip).toBe(-0.05);
    expect(result.vector?.[0]).toBeCloseTo(0.3 / 1.75);
    expect(result.vector?.[1]).toBeCloseTo(-0.4 / 1.75);
  });

  it("treats watched as suppression only without an explicit rating", () => {
    const result = buildTasteVector({
      seedVectors: [[0.25, 0.75]],
      events: [
        { id: "watched-1", kind: "watched", contentId: "movie-b" },
        {
          id: "watched-2",
          kind: "watched",
          contentId: "movie-a",
          rating: "like",
          vector: [1, 0],
        },
      ],
    });

    expect(TASTE_WEIGHTS.watched).toBe(0);
    expect(result.suppressedContentIds).toEqual(["movie-a", "movie-b"]);
    expect(result.vector?.[0]).toBeCloseTo(0.6 / 1.35);
    expect(result.vector?.[1]).toBeCloseTo(0.75 / 1.35);
  });

  it("uses first-write-wins event IDs to prevent retry drift", () => {
    const event: TasteFeedbackEvent = {
      id: "stable-id",
      kind: "like",
      contentId: "movie-a",
      vector: [1, 0],
    };

    const once = buildTasteVector({ seedVectors: [[0, 1]], events: [event] });
    const retried = buildTasteVector({
      seedVectors: [[0, 1]],
      events: [
        event,
        event,
        {
          id: "stable-id",
          kind: "dislike",
          contentId: "movie-a",
          vector: [1, 0],
        },
      ],
    });

    expect(retried).toEqual(once);
  });

  it("undoes both vector feedback and watched suppression idempotently", () => {
    const events: TasteFeedbackEvent[] = [
      { id: "like-1", kind: "like", contentId: "a", vector: [1, 0] },
      { id: "watched-1", kind: "watched", contentId: "b" },
      { id: "undo-like", kind: "undo", targetEventId: "like-1" },
      { id: "undo-watch", kind: "undo", targetEventId: "watched-1" },
      { id: "undo-watch", kind: "undo", targetEventId: "watched-1" },
    ];

    expect(buildTasteVector({ seedVectors: [[0, 1]], events })).toEqual({
      vector: [0, 1],
      suppressedContentIds: [],
      appliedEventIds: [],
    });
  });

  it("keeps feedback output bounded even for large vector components", () => {
    const result = buildTasteVector({
      seedVectors: [[100, -100]],
      events: [
        { id: "like-1", kind: "like", contentId: "a", vector: [100, -100] },
      ],
    });

    expect(result.vector).toEqual([1, -1]);
  });

  it.each([
    {
      name: "empty vectors",
      input: { seedVectors: [[]] },
      error: "must not be empty",
    },
    {
      name: "non-finite seeds",
      input: { seedVectors: [[Number.NaN, 0]] },
      error: "finite numbers",
    },
    {
      name: "mismatched seed dimensions",
      input: { seedVectors: [[1, 0], [1]] },
      error: "does not match",
    },
    {
      name: "mismatched feedback dimensions",
      input: {
        seedVectors: [[1, 0]],
        events: [
          { id: "like-1", kind: "like", contentId: "a", vector: [1] },
        ] satisfies TasteFeedbackEvent[],
      },
      error: "does not match",
    },
    {
      name: "rated watched events without a vector",
      input: {
        seedVectors: [[1, 0]],
        events: [
          {
            id: "watched-1",
            kind: "watched",
            contentId: "a",
            rating: "like",
          },
        ] satisfies TasteFeedbackEvent[],
      },
      error: "requires a vector",
    },
  ])("rejects $name", ({ input, error }) => {
    expect(() => buildTasteVector(input)).toThrow(error);
  });
});
