export type MediaFormat = "movie" | "series";

export interface RecommendationCandidate {
  id: string;
  format: MediaFormat;
  genreIds: readonly number[];
  /** US subscription/free/ad-supported streaming services for this title. */
  usStreamingServiceIds: readonly number[];
  runtimeMinutes?: number | null;
  episodeRuntimeMinutes?: number | null;
  seasonCount?: number | null;
}

/**
 * Exact v1 length boundaries:
 * - movie under 100: runtime < 100 minutes
 * - movie epic: runtime >= 150 minutes
 * - series short episodes: episode runtime <= 30 minutes
 * - series one season: exactly 1 season
 * - series long-running: at least 3 seasons
 *
 * "Any" length is represented by omitting `length`.
 */
export type LengthConstraint =
  | { format: "movie"; category: "under-100" | "epic" }
  | {
      format: "series";
      category: "short-episodes" | "one-season" | "long-running";
    };

export interface HardFilterInput {
  selectedUsServiceIds?: readonly number[];
  excludedGenreIds?: readonly number[];
  format?: MediaFormat;
  length?: LengthConstraint;
  watchedIds?: readonly string[];
  limit: number;
}

export type EditableConstraint = "services" | "genres" | "format" | "length";

export interface RelaxationOption {
  constraint: EditableConstraint;
  /** Eligible candidates gained if only this constraint is removed. */
  additionalEligibleCount: number;
}

export interface FilterExhaustion {
  requestedCount: number;
  eligibleCount: number;
  returnedCount: number;
  missingCount: number;
  /** True when no additional eligible candidates remain after this page. */
  exhausted: boolean;
  activeEditableConstraints: readonly EditableConstraint[];
  /**
   * Options are descriptive. Callers must ask the user which constraint to edit;
   * this module never relaxes one automatically.
   */
  relaxationOptions: readonly RelaxationOption[];
}

export interface HardFilterResult<T extends RecommendationCandidate> {
  candidates: readonly T[];
  exhaustion: FilterExhaustion;
}

function activeEditableConstraints(
  input: HardFilterInput,
): EditableConstraint[] {
  const active: EditableConstraint[] = [];
  if ((input.selectedUsServiceIds?.length ?? 0) > 0) active.push("services");
  if ((input.excludedGenreIds?.length ?? 0) > 0) active.push("genres");
  if (input.format) active.push("format");
  if (input.length) active.push("length");
  return active;
}

function matchesLength(
  candidate: RecommendationCandidate,
  length: LengthConstraint,
): boolean {
  if (candidate.format !== length.format) return false;

  if (length.format === "movie") {
    if (candidate.runtimeMinutes == null) return false;
    return length.category === "under-100"
      ? candidate.runtimeMinutes < 100
      : candidate.runtimeMinutes >= 150;
  }

  if (length.category === "short-episodes") {
    return (
      candidate.episodeRuntimeMinutes != null &&
      candidate.episodeRuntimeMinutes <= 30
    );
  }
  if (candidate.seasonCount == null) return false;
  return length.category === "one-season"
    ? candidate.seasonCount === 1
    : candidate.seasonCount >= 3;
}

function isEligible(
  candidate: RecommendationCandidate,
  input: HardFilterInput,
  ignoredConstraint?: EditableConstraint,
): boolean {
  if (new Set(input.watchedIds).has(candidate.id)) return false;

  if (
    ignoredConstraint !== "services" &&
    input.selectedUsServiceIds?.length &&
    !candidate.usStreamingServiceIds.some((id) =>
      input.selectedUsServiceIds?.includes(id),
    )
  ) {
    return false;
  }

  if (
    ignoredConstraint !== "genres" &&
    input.excludedGenreIds?.length &&
    candidate.genreIds.some((id) => input.excludedGenreIds?.includes(id))
  ) {
    return false;
  }

  if (
    ignoredConstraint !== "format" &&
    input.format &&
    candidate.format !== input.format
  ) {
    return false;
  }

  return (
    ignoredConstraint === "length" ||
    !input.length ||
    matchesLength(candidate, input.length)
  );
}

function validateInput(input: HardFilterInput): void {
  if (!Number.isSafeInteger(input.limit) || input.limit < 0) {
    throw new RangeError("limit must be a non-negative safe integer");
  }
  if (input.length && input.format !== input.length.format) {
    throw new TypeError("length must match the selected format");
  }
}

/** Applies every hard constraint before limiting, preserving caller order. */
export function applyHardFilters<T extends RecommendationCandidate>(
  candidates: readonly T[],
  input: HardFilterInput,
): HardFilterResult<T> {
  validateInput(input);

  const eligible = candidates.filter((candidate) =>
    isEligible(candidate, input),
  );
  const returned = eligible.slice(0, input.limit);
  const active = activeEditableConstraints(input);
  const missingCount = Math.max(0, input.limit - eligible.length);

  const relaxationOptions =
    missingCount === 0
      ? []
      : active.map((constraint) => ({
          constraint,
          additionalEligibleCount: Math.max(
            0,
            candidates.filter((candidate) =>
              isEligible(candidate, input, constraint),
            ).length - eligible.length,
          ),
        }));

  return {
    candidates: returned,
    exhaustion: {
      requestedCount: input.limit,
      eligibleCount: eligible.length,
      returnedCount: returned.length,
      missingCount,
      exhausted: eligible.length <= input.limit,
      activeEditableConstraints: active,
      relaxationOptions,
    },
  };
}
