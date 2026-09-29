export type TasteVector = readonly number[];

export const TASTE_WEIGHTS = Object.freeze({
  seedCentroid: 1,
  like: 0.35,
  dislike: -0.35,
  watched: 0,
  skip: -0.05,
});

type Rating = "like" | "dislike";

export type TasteFeedbackEvent =
  | {
      id: string;
      kind: "like" | "dislike" | "skip";
      contentId: string;
      vector: TasteVector;
    }
  | {
      id: string;
      kind: "watched";
      contentId: string;
      rating?: Rating;
      vector?: TasteVector;
    }
  | {
      id: string;
      kind: "undo";
      targetEventId: string;
    };

export interface BuildTasteVectorInput {
  seedVectors: readonly TasteVector[];
  events?: readonly TasteFeedbackEvent[];
}

export interface TasteVectorResult {
  /** Null means a genuine zero-signal cold start. */
  vector: number[] | null;
  /** Content explicitly marked watched by active (not undone) events. */
  suppressedContentIds: string[];
  /** IDs of feedback still contributing after undo events are replayed. */
  appliedEventIds: string[];
}

/**
 * Builds a taste vector by replaying feedback from scratch.
 *
 * Seeds have equal weight and form an arithmetic centroid with weight 1. Likes
 * and dislikes have weights +/-0.35, while a skip is a deliberately weak -0.05.
 * Watched has weight 0 and only suppresses a repeat, unless it carries an
 * explicit like/dislike rating. The weighted result divides by total absolute
 * weight and clamps components to [-1, 1], so additional unique feedback stays
 * bounded. Duplicate event IDs use first-write-wins and cannot cause drift.
 */
export function buildTasteVector({
  seedVectors,
  events = [],
}: BuildTasteVectorInput): TasteVectorResult {
  let dimension: number | undefined;

  for (const seed of seedVectors) {
    dimension = validateVector(seed, dimension, "seed vector");
  }

  const seenEventIds = new Set<string>();
  const activeEvents = new Map<
    string,
    Exclude<TasteFeedbackEvent, { kind: "undo" }>
  >();

  for (const event of events) {
    validateId(event.id, "event id");

    if (seenEventIds.has(event.id)) {
      continue;
    }
    seenEventIds.add(event.id);

    if (event.kind === "undo") {
      validateId(event.targetEventId, "undo target event id");
      activeEvents.delete(event.targetEventId);
      continue;
    }

    validateId(event.contentId, "content id");

    if (event.vector !== undefined) {
      dimension = validateVector(event.vector, dimension, "feedback vector");
    }

    if (event.kind !== "watched" || event.rating !== undefined) {
      if (event.vector === undefined) {
        throw new TypeError(`${event.kind} feedback requires a vector`);
      }
    }

    activeEvents.set(event.id, event);
  }

  const suppressedContentIds = new Set<string>();
  const weightedVectors: Array<{ vector: TasteVector; weight: number }> = [];

  if (seedVectors.length > 0) {
    weightedVectors.push({
      vector: average(seedVectors, dimension!),
      weight: TASTE_WEIGHTS.seedCentroid,
    });
  }

  for (const event of activeEvents.values()) {
    if (event.kind === "watched") {
      suppressedContentIds.add(event.contentId);
      if (event.rating !== undefined) {
        weightedVectors.push({
          vector: event.vector!,
          weight: TASTE_WEIGHTS[event.rating],
        });
      }
      continue;
    }

    weightedVectors.push({
      vector: event.vector,
      weight: TASTE_WEIGHTS[event.kind],
    });
  }

  return {
    vector:
      weightedVectors.length === 0
        ? null
        : combineWeightedVectors(weightedVectors, dimension!),
    suppressedContentIds: [...suppressedContentIds].sort(),
    appliedEventIds: [...activeEvents.keys()],
  };
}

function validateId(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
}

function validateVector(
  vector: TasteVector,
  expectedDimension: number | undefined,
  label: string,
): number {
  if (vector.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
  if (expectedDimension !== undefined && vector.length !== expectedDimension) {
    throw new RangeError(
      `${label} dimension ${vector.length} does not match ${expectedDimension}`,
    );
  }
  if (vector.some((component) => !Number.isFinite(component))) {
    throw new TypeError(`${label} must contain only finite numbers`);
  }
  return vector.length;
}

function average(vectors: readonly TasteVector[], dimension: number): number[] {
  const result = Array<number>(dimension).fill(0);
  for (const vector of vectors) {
    for (let index = 0; index < dimension; index += 1) {
      result[index]! += vector[index]!;
    }
  }
  return result.map((component) => component / vectors.length);
}

function combineWeightedVectors(
  entries: ReadonlyArray<{ vector: TasteVector; weight: number }>,
  dimension: number,
): number[] {
  const result = Array<number>(dimension).fill(0);
  let totalAbsoluteWeight = 0;

  for (const { vector, weight } of entries) {
    totalAbsoluteWeight += Math.abs(weight);
    for (let index = 0; index < dimension; index += 1) {
      result[index]! += vector[index]! * weight;
    }
  }

  return result.map((component) =>
    Math.max(-1, Math.min(1, component / totalAbsoluteWeight)),
  );
}
