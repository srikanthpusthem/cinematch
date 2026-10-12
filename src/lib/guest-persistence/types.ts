import {
  AVOIDABLE_GENRES,
  EMPTY_ANSWERS,
  FORMATS,
  MOODS,
  MOVIE_LENGTHS,
  SERIES_LENGTHS,
  SERVICE_OPTIONS,
  type GuestAnswers,
} from "@/lib/guest-flow/types";

/** Schema version stored with every snapshot. Bump when the shape changes. */
export const GUEST_PERSISTENCE_SCHEMA_VERSION = 1 as const;

/** Single localStorage key; version lives inside the JSON payload. */
export const GUEST_PERSISTENCE_STORAGE_KEY = "cinematch.guest-persistence";

/**
 * Result-feedback kinds persisted for guests.
 * - watched: repeat suppression only (not an implicit like)
 * - like / dislike: explicit taste events ("Not for me" -> dislike)
 * - skip: weak intent ("Show more" / not tonight)
 */
export type GuestFeedbackKind = "watched" | "like" | "dislike" | "skip";

export type GuestFeedbackEvent =
  | {
      id: string;
      kind: GuestFeedbackKind;
      contentId: string;
    }
  | {
      id: string;
      kind: "undo";
      targetEventId: string;
    };

export type GuestPersistedSnapshot = {
  version: typeof GUEST_PERSISTENCE_SCHEMA_VERSION;
  answers: GuestAnswers;
  events: GuestFeedbackEvent[];
};

export type StorageFailureReason =
  | "unavailable"
  | "corrupt"
  | "unsupported_version"
  | "quota_exceeded"
  | "write_failed";

export type StorageStatus =
  { ok: true } | { ok: false; reason: StorageFailureReason };

/** Minimal storage surface so tests can inject a memory backend. */
export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type DerivedFeedbackState = {
  suppressedContentIds: readonly string[];
  likedContentIds: readonly string[];
  dislikedContentIds: readonly string[];
  skippedContentIds: readonly string[];
  appliedEventIds: readonly string[];
  /** Latest non-undo event that is still active; null when nothing to undo. */
  latestApplicableEventId: string | null;
};

export function emptySnapshot(): GuestPersistedSnapshot {
  return {
    version: GUEST_PERSISTENCE_SCHEMA_VERSION,
    answers: {
      ...EMPTY_ANSWERS,
      serviceIds: [],
      seedIds: [],
      avoidedGenres: [],
    },
    events: [],
  };
}

const SERVICE_IDS = new Set<string>(SERVICE_OPTIONS.map((item) => item.id));
const MOOD_IDS = new Set<string>(MOODS.map((item) => item.id));
const FORMAT_IDS = new Set<string>(FORMATS.map((item) => item.id));
const MOVIE_LENGTH_IDS = new Set<string>(MOVIE_LENGTHS.map((item) => item.id));
const SERIES_LENGTH_IDS = new Set<string>(
  SERIES_LENGTHS.map((item) => item.id),
);
const AVOID_IDS = new Set<string>(AVOIDABLE_GENRES);
const FEEDBACK_KINDS = new Set<string>(["watched", "like", "dislike", "skip"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** Validates a GuestAnswers object; returns null when any field is invalid. */
export function parseGuestAnswers(value: unknown): GuestAnswers | null {
  if (value == null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  if (!isStringArray(raw.serviceIds)) return null;
  if (!raw.serviceIds.every((id) => SERVICE_IDS.has(id))) return null;
  if (!isBoolean(raw.servicesSkipped)) return null;

  if (!isStringArray(raw.seedIds)) return null;
  if (!raw.seedIds.every((id) => isNonEmptyString(id))) return null;

  if (!isStringArray(raw.avoidedGenres)) return null;
  if (!raw.avoidedGenres.every((id) => AVOID_IDS.has(id))) return null;

  if (!isBoolean(raw.tasteSkipped)) return null;

  if (raw.mood !== null && !MOOD_IDS.has(raw.mood as string)) return null;
  if (raw.format !== null && !FORMAT_IDS.has(raw.format as string)) return null;
  if (
    raw.movieLength !== null &&
    !MOVIE_LENGTH_IDS.has(raw.movieLength as string)
  ) {
    return null;
  }
  if (
    raw.seriesLength !== null &&
    !SERIES_LENGTH_IDS.has(raw.seriesLength as string)
  ) {
    return null;
  }

  return {
    serviceIds: [...raw.serviceIds] as GuestAnswers["serviceIds"],
    servicesSkipped: raw.servicesSkipped,
    seedIds: [...raw.seedIds],
    avoidedGenres: [...raw.avoidedGenres] as GuestAnswers["avoidedGenres"],
    tasteSkipped: raw.tasteSkipped,
    mood: raw.mood as GuestAnswers["mood"],
    format: raw.format as GuestAnswers["format"],
    movieLength: raw.movieLength as GuestAnswers["movieLength"],
    seriesLength: raw.seriesLength as GuestAnswers["seriesLength"],
  };
}

export function parseFeedbackEvent(value: unknown): GuestFeedbackEvent | null {
  if (value == null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!isNonEmptyString(raw.id)) return null;

  if (raw.kind === "undo") {
    if (!isNonEmptyString(raw.targetEventId)) return null;
    // Reject unexpected fields that look like credentials / payloads.
    if ("contentId" in raw || "vector" in raw || "token" in raw) return null;
    return { id: raw.id, kind: "undo", targetEventId: raw.targetEventId };
  }

  if (!FEEDBACK_KINDS.has(raw.kind as string)) return null;
  if (!isNonEmptyString(raw.contentId)) return null;
  // Never accept vectors, provider payloads, prompts, or credentials.
  if (
    "vector" in raw ||
    "token" in raw ||
    "credential" in raw ||
    "prompt" in raw ||
    "providerResponse" in raw
  ) {
    return null;
  }

  return {
    id: raw.id,
    kind: raw.kind as GuestFeedbackKind,
    contentId: raw.contentId,
  };
}
