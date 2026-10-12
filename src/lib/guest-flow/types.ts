import {
  MOVIE_EPIC_MIN_MINUTES,
  MOVIE_SHORT_MAX_MINUTES,
  SERIES_LONG_RUNNING_MIN_SEASONS,
  SERIES_ONE_SEASON_COUNT,
  SERIES_SHORT_EPISODE_MAX_MINUTES,
} from "@/lib/recommendation-length";

export const SERVICE_OPTIONS = [
  { id: "netflix", name: "Netflix" },
  { id: "max", name: "Max" },
  { id: "hulu", name: "Hulu" },
  { id: "disney", name: "Disney+" },
  { id: "prime", name: "Prime Video" },
  { id: "apple", name: "Apple TV+" },
  { id: "peacock", name: "Peacock" },
  { id: "paramount", name: "Paramount+" },
] as const;

export type ServiceId = (typeof SERVICE_OPTIONS)[number]["id"];

export const MOODS = [
  { id: "laugh", label: "Laugh" },
  { id: "cry", label: "Cry" },
  { id: "thrill", label: "Thrill" },
  { id: "think", label: "Think" },
  { id: "comfort", label: "Comfort" },
] as const;

export type Mood = (typeof MOODS)[number]["id"];

export const FORMATS = [
  { id: "movie", label: "Movie" },
  { id: "series", label: "Series" },
] as const;

export type WatchFormat = (typeof FORMATS)[number]["id"];

/** Movie runtime boundaries used by the mock filter. */
export const MOVIE_LENGTHS = [
  {
    id: "under-100",
    label: `Under ${MOVIE_SHORT_MAX_MINUTES + 1} minutes`,
    detail: `${MOVIE_SHORT_MAX_MINUTES} minutes or less`,
  },
  { id: "any", label: "Any length", detail: "No runtime limit" },
  {
    id: "epic",
    label: "Epic",
    detail: `${MOVIE_EPIC_MIN_MINUTES} minutes or more`,
  },
] as const;

export type MovieLength = (typeof MOVIE_LENGTHS)[number]["id"];

/** Series length boundaries used by the mock filter. */
export const SERIES_LENGTHS = [
  {
    id: "short-episodes",
    label: "Short episodes",
    detail: `Episodes of ${SERIES_SHORT_EPISODE_MAX_MINUTES} minutes or less`,
  },
  {
    id: "one-season",
    label: "One season",
    detail: "Exactly one season",
  },
  {
    id: "long-running",
    label: "Long-running",
    detail: `${SERIES_LONG_RUNNING_MIN_SEASONS} or more seasons`,
  },
] as const;

export type SeriesLength = (typeof SERIES_LENGTHS)[number]["id"];

export const AVOIDABLE_GENRES = [
  "Action",
  "Horror",
  "Romance",
  "Animation",
  "Documentary",
] as const;

export type AvoidableGenre = (typeof AVOIDABLE_GENRES)[number];

export const FLOW_STEPS = [
  { id: "services", label: "Services" },
  { id: "taste", label: "Taste" },
  { id: "tonight", label: "Tonight" },
  { id: "picks", label: "Picks" },
] as const;

export type FlowStep = (typeof FLOW_STEPS)[number]["id"];

export type Access = "subscription" | "rent" | "buy";

/** Fixed mock "now" for freshness comparisons in fixtures and UI. */
export const MOCK_NOW = "2026-09-28T18:00:00.000Z";

/** Availability older than this (relative to MOCK_NOW) is treated as stale. */
export const FRESHNESS_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export function isFreshnessStale(
  checkedAt: string,
  nowIso: string = MOCK_NOW,
): boolean {
  const checked = Date.parse(checkedAt);
  const now = Date.parse(nowIso);
  if (Number.isNaN(checked) || Number.isNaN(now)) return true;
  return now - checked > FRESHNESS_STALE_MS;
}

export type PickFeedbackAction = "watched" | "like" | "not-for-me";

export type GuestAnswers = {
  serviceIds: ServiceId[];
  servicesSkipped: boolean;
  seedIds: string[];
  avoidedGenres: AvoidableGenre[];
  /** True when the taste quiz was explicitly skipped (vs continuing with zero seeds). */
  tasteSkipped: boolean;
  mood: Mood | null;
  format: WatchFormat | null;
  movieLength: MovieLength | null;
  seriesLength: SeriesLength | null;
};

export const EMPTY_ANSWERS: GuestAnswers = {
  serviceIds: [],
  servicesSkipped: false,
  seedIds: [],
  avoidedGenres: [],
  tasteSkipped: false,
  mood: null,
  format: null,
  movieLength: null,
  seriesLength: null,
};

/** Quiz seed. Never a recommendation. */
export type SeedTitle = {
  role: "seed";
  id: string;
  title: string;
  year: number;
  genres: string[];
};

export type ServiceOffer = {
  serviceId: ServiceId;
  serviceName: string;
  access: Access;
  /** ISO timestamp when this offer's availability was last checked. */
  freshnessCheckedAt: string;
  /**
   * Verified HTTPS playback deep-link from fixtures only.
   * Never invent in the UI; omit when no verified link exists.
   */
  verifiedWatchUrl?: string;
};

export type Recommendation = {
  role: "recommendation";
  id: string;
  title: string;
  year: number;
  format: WatchFormat;
  timeLabel: string;
  reason: string;
  offers: ServiceOffer[];
};

export type RecommendConfidence = "cold-start" | "seeded";

export type RecommendResult =
  | {
      status: "ok";
      confidence: RecommendConfidence;
      best: Recommendation;
      alternatives: Recommendation[];
    }
  | {
      status: "shortage";
      confidence: RecommendConfidence;
      message: string;
      best: Recommendation;
      alternatives: Recommendation[];
    }
  | {
      status: "unavailable";
      confidence: RecommendConfidence;
      message: string;
      best: Recommendation;
      alternatives: Recommendation[];
    }
  | { status: "empty"; message: string }
  | { status: "error"; message: string };

export type MockMode =
  | "success"
  | "empty"
  | "shortage"
  | "error"
  | "loading"
  | "stale"
  | "unavailable";

export function movieLengthMatches(
  minutes: number,
  length: MovieLength,
): boolean {
  if (length === "under-100") return minutes <= MOVIE_SHORT_MAX_MINUTES;
  if (length === "epic") return minutes >= MOVIE_EPIC_MIN_MINUTES;
  return true;
}

export function seriesLengthMatches(
  episodeMinutes: number,
  seasons: number,
  length: SeriesLength,
): boolean {
  if (length === "short-episodes") {
    return episodeMinutes <= SERIES_SHORT_EPISODE_MAX_MINUTES;
  }
  if (length === "one-season") return seasons === SERIES_ONE_SEASON_COUNT;
  return seasons >= SERIES_LONG_RUNNING_MIN_SEASONS;
}

export function tasteSelectionError(seedCount: number): string | null {
  if (seedCount === 0 || (seedCount >= 3 && seedCount <= 5)) return null;
  if (seedCount > 5) return "Choose at most 5 quiz titles.";
  return "Choose 3 to 5 quiz titles, or skip.";
}
