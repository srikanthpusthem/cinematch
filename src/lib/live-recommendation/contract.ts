import type {
  FilterExhaustion,
  LengthConstraint,
  MediaFormat,
} from "@/server/recommender/hard-filters";

export const RECOMMENDATION_SCHEMA_VERSION = 1;
export const MAX_RECOMMENDATION_BODY_BYTES = 32_768;
export const MAX_FEEDBACK_IDS = 200;
export const MOODS = ["laugh", "cry", "thrill", "think", "comfort"] as const;
export type RecommendationMood = (typeof MOODS)[number];

/** IDs identify records in the catalog; no external provider is selected here. */
export interface RecommendationRequest {
  schemaVersion: 1;
  selectedUsServiceIds: number[];
  excludedGenreIds: number[];
  seedIds: string[];
  watchedIds: string[];
  likedIds: string[];
  dislikedIds: string[];
  excludedIds: string[];
  mood: RecommendationMood;
  format: MediaFormat;
  length: LengthConstraint | null;
  limit: number;
}

export interface CatalogTag {
  id: number;
  name: string;
}

export interface RecommendationOffer {
  providerId: number;
  providerName: string;
  access: "subscription" | "free" | "ads" | "rent" | "buy";
}

export interface RecommendationAvailability {
  region: "US";
  state: "current" | "stale" | "unknown";
  checkedAt: string | null;
  offers: RecommendationOffer[];
  /** Provider-information page only. Never label this as direct playback. */
  infoUrl: string | null;
}

export interface RecommendationPick {
  id: string;
  title: string;
  format: MediaFormat;
  year: number | null;
  posterUrl: string | null;
  runtimeMinutes: number | null;
  episodeRuntimeMinutes: number | null;
  seasonCount: number | null;
  reasons: string[];
  availability: RecommendationAvailability;
}

export interface RecommendationResult {
  schemaVersion: 1;
  rankingVersion: "metadata-v1";
  status: "ok" | "shortage" | "empty";
  confidence: "cold-start" | "seeded";
  picks: RecommendationPick[];
  exhaustion: FilterExhaustion;
  message: string | null;
}

export type RecommendationErrorCode =
  "INVALID_REQUEST" | "UNKNOWN_TITLES" | "CATALOG_UNAVAILABLE";

export interface RecommendationFailure {
  schemaVersion: 1;
  status: "error";
  code: RecommendationErrorCode;
  message: string;
}

export type RecommendationResponse =
  RecommendationResult | RecommendationFailure;

export class RecommendationContractError extends Error {
  constructor(message = "Invalid recommendation request.") {
    super(message);
    this.name = "RecommendationContractError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function keysAre(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function integer(
  value: unknown,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= min &&
    (value as number) <= max
  );
}

function titleId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(value)
  );
}

function text(value: unknown, max: number): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}

function ids<T>(
  value: unknown,
  max: number,
  guard: (id: unknown) => id is T,
): value is T[] {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every(guard) &&
    new Set(value).size === value.length
  );
}

function nullableInteger(value: unknown, min: number, max: number): boolean {
  return value === null || integer(value, min, max);
}

export function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

/** Strict, bounded transport validation. Empty service selection means all services. */
export function parseRecommendationRequest(
  value: unknown,
): RecommendationRequest {
  if (
    !record(value) ||
    !keysAre(value, [
      "schemaVersion",
      "selectedUsServiceIds",
      "excludedGenreIds",
      "seedIds",
      "watchedIds",
      "likedIds",
      "dislikedIds",
      "excludedIds",
      "mood",
      "format",
      "length",
      "limit",
    ]) ||
    value.schemaVersion !== 1 ||
    !ids(value.selectedUsServiceIds, 30, (id): id is number =>
      integer(id, 1),
    ) ||
    !ids(value.excludedGenreIds, 50, (id): id is number => integer(id, 1)) ||
    !ids(value.seedIds, 5, titleId) ||
    (value.seedIds.length !== 0 && value.seedIds.length < 3) ||
    !ids(value.watchedIds, MAX_FEEDBACK_IDS, titleId) ||
    !ids(value.likedIds, MAX_FEEDBACK_IDS, titleId) ||
    !ids(value.dislikedIds, MAX_FEEDBACK_IDS, titleId) ||
    !ids(value.excludedIds, MAX_FEEDBACK_IDS, titleId) ||
    !MOODS.includes(value.mood as RecommendationMood) ||
    (value.format !== "movie" && value.format !== "series") ||
    !integer(value.limit, 1, 5)
  )
    throw new RecommendationContractError();

  if (value.length !== null) {
    if (
      !record(value.length) ||
      !keysAre(value.length, ["format", "category"]) ||
      value.length.format !== value.format ||
      !(
        value.format === "movie"
          ? ["under-100", "epic"]
          : ["short-episodes", "one-season", "long-running"]
      ).includes(value.length.category as string)
    )
      throw new RecommendationContractError(
        "Length must match the selected format.",
      );
  }
  const dislikedIds = new Set(value.dislikedIds);
  if (value.likedIds.some((id) => dislikedIds.has(id))) {
    throw new RecommendationContractError(
      "A title cannot be liked and disliked simultaneously.",
    );
  }
  // Copy bounded arrays so downstream code never mutates the caller's input.
  return {
    schemaVersion: 1,
    selectedUsServiceIds: [...value.selectedUsServiceIds],
    excludedGenreIds: [...value.excludedGenreIds],
    seedIds: [...value.seedIds],
    watchedIds: [...value.watchedIds],
    likedIds: [...value.likedIds],
    dislikedIds: [...value.dislikedIds],
    excludedIds: [...value.excludedIds],
    mood: value.mood as RecommendationMood,
    format: value.format,
    length:
      value.length === null ? null : ({ ...value.length } as LengthConstraint),
    limit: value.limit,
  };
}

function isOffer(value: unknown): value is RecommendationOffer {
  return (
    record(value) &&
    keysAre(value, ["providerId", "providerName", "access"]) &&
    integer(value.providerId, 1) &&
    text(value.providerName, 200) &&
    ["subscription", "free", "ads", "rent", "buy"].includes(
      value.access as string,
    )
  );
}

function isAvailability(value: unknown): value is RecommendationAvailability {
  if (
    !record(value) ||
    !keysAre(value, ["region", "state", "checkedAt", "offers", "infoUrl"]) ||
    value.region !== "US" ||
    !["current", "stale", "unknown"].includes(value.state as string) ||
    !Array.isArray(value.offers) ||
    value.offers.length > 100 ||
    !value.offers.every(isOffer) ||
    !(value.infoUrl === null || isSafeHttpsUrl(value.infoUrl))
  )
    return false;
  if (value.state === "unknown")
    return value.checkedAt === null && value.offers.length === 0;
  return (
    isTimestamp(value.checkedAt) &&
    (value.state === "current" || value.offers.length === 0)
  );
}

function isPick(value: unknown): value is RecommendationPick {
  return (
    record(value) &&
    keysAre(value, [
      "id",
      "title",
      "format",
      "year",
      "posterUrl",
      "runtimeMinutes",
      "episodeRuntimeMinutes",
      "seasonCount",
      "reasons",
      "availability",
    ]) &&
    titleId(value.id) &&
    text(value.title, 500) &&
    ["movie", "series"].includes(value.format as string) &&
    nullableInteger(value.year, 1800, 9999) &&
    (value.posterUrl === null || isSafeHttpsUrl(value.posterUrl)) &&
    nullableInteger(value.runtimeMinutes, 1, 32767) &&
    nullableInteger(value.episodeRuntimeMinutes, 1, 32767) &&
    nullableInteger(value.seasonCount, 0, 32767) &&
    Array.isArray(value.reasons) &&
    value.reasons.length >= 1 &&
    value.reasons.length <= 4 &&
    value.reasons.every((reason) => text(reason, 500)) &&
    isAvailability(value.availability)
  );
}

function isExhaustion(
  value: unknown,
  picks: RecommendationPick[],
): value is FilterExhaustion {
  const constraints = ["services", "genres", "format", "length"];
  if (
    !record(value) ||
    !keysAre(value, [
      "requestedCount",
      "eligibleCount",
      "returnedCount",
      "missingCount",
      "exhausted",
      "activeEditableConstraints",
      "relaxationOptions",
    ]) ||
    !integer(value.requestedCount, 1, 5) ||
    !integer(value.eligibleCount, 0) ||
    value.returnedCount !== picks.length ||
    value.returnedCount !==
      Math.min(value.requestedCount, value.eligibleCount) ||
    value.missingCount !==
      Math.max(0, value.requestedCount - value.eligibleCount) ||
    value.exhausted !== value.eligibleCount <= value.requestedCount ||
    !ids(
      value.activeEditableConstraints,
      4,
      (item): item is string =>
        typeof item === "string" && constraints.includes(item),
    ) ||
    !Array.isArray(value.relaxationOptions) ||
    value.relaxationOptions.length > 4
  )
    return false;
  const expected =
    value.missingCount === 0 ? [] : value.activeEditableConstraints;
  return (
    value.relaxationOptions.length === expected.length &&
    value.relaxationOptions.every(
      (option, index) =>
        record(option) &&
        keysAre(option, ["constraint", "additionalEligibleCount"]) &&
        option.constraint === expected[index] &&
        integer(option.additionalEligibleCount, 0),
    )
  );
}

/** Validate server output before trusting or displaying it in the guest client. */
export function parseRecommendationResponse(
  value: unknown,
): RecommendationResponse {
  const fail = () => {
    throw new RecommendationContractError("Invalid recommendation response.");
  };
  if (!record(value) || value.schemaVersion !== 1) return fail();
  if (value.status === "error") {
    if (
      !keysAre(value, ["schemaVersion", "status", "code", "message"]) ||
      !["INVALID_REQUEST", "UNKNOWN_TITLES", "CATALOG_UNAVAILABLE"].includes(
        value.code as string,
      ) ||
      !text(value.message, 500)
    )
      return fail();
    return value as unknown as RecommendationFailure;
  }
  if (
    !keysAre(value, [
      "schemaVersion",
      "rankingVersion",
      "status",
      "confidence",
      "picks",
      "exhaustion",
      "message",
    ]) ||
    value.rankingVersion !== "metadata-v1" ||
    !["ok", "shortage", "empty"].includes(value.status as string) ||
    !["cold-start", "seeded"].includes(value.confidence as string) ||
    !Array.isArray(value.picks) ||
    value.picks.length > 5 ||
    !value.picks.every(isPick) ||
    new Set(value.picks.map((pick) => pick.id)).size !== value.picks.length ||
    !isExhaustion(value.exhaustion, value.picks)
  )
    return fail();
  const expectedStatus =
    value.picks.length === 0
      ? "empty"
      : value.exhaustion.missingCount > 0
        ? "shortage"
        : "ok";
  if (
    value.status !== expectedStatus ||
    (value.status === "ok" ? value.message !== null : !text(value.message, 500))
  )
    return fail();
  return value as unknown as RecommendationResult;
}
