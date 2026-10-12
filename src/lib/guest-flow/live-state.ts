import {
  deriveFeedbackState,
  type DerivedFeedbackState,
  type GuestPersistedSnapshot,
  type GuestFeedbackKind,
} from "@/lib/guest-persistence";
import {
  parseRecommendationRequest,
  MAX_FEEDBACK_IDS,
  type RecommendationRequest,
  type RecommendationResponse,
} from "@/lib/live-recommendation/contract";
import { formatRuntime } from "@/lib/runtime";
import { isCatalogId } from "./catalog-client";
import {
  tasteSelectionError,
  type GuestAnswers,
  type Recommendation,
  type RecommendResult,
} from "./types";

export class LiveHistoryLimitError extends Error {
  constructor(
    public readonly recovery: "restart-search" | "undo-feedback",
    public readonly feedbackKind: GuestFeedbackKind | null,
    message: string,
  ) {
    super(message);
    this.name = "LiveHistoryLimitError";
  }
}

/** Opposite taste actions remain undoable; the latest active action wins. */
export function deriveLiveFeedback(
  snapshot: Pick<GuestPersistedSnapshot, "events">,
): DerivedFeedbackState {
  const derived = deriveFeedbackState(snapshot);
  const active = new Set(derived.appliedEventIds);
  const taste = new Map<string, "like" | "dislike">();
  for (const event of snapshot.events) {
    if (
      active.has(event.id) &&
      (event.kind === "like" || event.kind === "dislike")
    )
      taste.set(event.contentId, event.kind);
  }
  return {
    ...derived,
    likedContentIds: [...taste]
      .filter(([, kind]) => kind === "like")
      .map(([id]) => id)
      .sort(),
    dislikedContentIds: [...taste]
      .filter(([, kind]) => kind === "dislike")
      .map(([id]) => id)
      .sort(),
  };
}

function numericOptionIds(values: readonly string[]): number[] {
  if (!values.every(isCatalogId))
    throw new Error(
      "Some saved service or genre choices need updating. Edit those steps before trying again.",
    );
  return [...new Set(values)].map(Number);
}

export function createLiveRequest(
  answers: GuestAnswers,
  snapshot: Pick<GuestPersistedSnapshot, "events">,
  seenIds: readonly string[] = [],
): RecommendationRequest {
  if (!answers.servicesSkipped && answers.serviceIds.length === 0)
    throw new Error("Choose a subscription or skip to all services.");
  if (!answers.mood || !answers.format)
    throw new Error("Choose a mood and format first.");
  const tasteError = tasteSelectionError(answers.seedIds.length);
  if (tasteError) throw new Error(tasteError);
  if (!answers.seedIds.every(isCatalogId))
    throw new Error("Choose favorites from the live catalog again.");
  const category =
    answers.format === "movie" ? answers.movieLength : answers.seriesLength;
  if (!category) throw new Error("Choose a length before finding picks.");
  const feedback = deriveLiveFeedback(snapshot);
  const actualIds = (ids: readonly string[]) => [
    ...new Set(ids.filter(isCatalogId)),
  ];
  const watchedIds = actualIds(feedback.suppressedContentIds);
  const likedIds = actualIds(feedback.likedContentIds);
  const dislikedIds = actualIds(feedback.dislikedContentIds);
  const skippedIds = actualIds(feedback.skippedContentIds);
  for (const [kind, ids] of [
    ["watched", watchedIds],
    ["like", likedIds],
    ["dislike", dislikedIds],
    ["skip", skippedIds],
  ] as const) {
    if (ids.length > MAX_FEEDBACK_IDS)
      throw new LiveHistoryLimitError(
        "undo-feedback",
        kind,
        `Your saved ${kind} history contains ${ids.length} titles, above the current ${MAX_FEEDBACK_IDS}-title request limit. Nothing was cleared. Review saved feedback below and undo entries you choose before trying again.`,
      );
  }
  const excludedIds = actualIds([...seenIds, ...skippedIds]);
  if (excludedIds.length > MAX_FEEDBACK_IDS)
    throw new LiveHistoryLimitError(
      "restart-search",
      null,
      `This search plus your saved skips exceeds the ${MAX_FEEDBACK_IDS}-title request limit. Restart this search to clear only the titles shown during this search. Your saved feedback and watched exclusions will stay intact.`,
    );
  return parseRecommendationRequest({
    schemaVersion: 1,
    selectedUsServiceIds: answers.servicesSkipped
      ? []
      : numericOptionIds(answers.serviceIds),
    excludedGenreIds: numericOptionIds(answers.avoidedGenres),
    seedIds: [...answers.seedIds],
    watchedIds,
    likedIds,
    dislikedIds,
    excludedIds,
    mood: answers.mood,
    format: answers.format,
    length: category === "any" ? null : { format: answers.format, category },
    limit: 5,
  });
}

/** Adapt only validated server output; never fill missing picks with fixtures. */
export function toPicksResult(
  response: RecommendationResponse,
): RecommendResult {
  if (response.status === "error")
    return { status: "error", message: response.message };
  if (response.status === "empty")
    return {
      status: "empty",
      message: response.message ?? "No catalog titles match these choices.",
    };
  const picks: Recommendation[] = response.picks.map((pick) => {
    const runtime =
      pick.format === "movie"
        ? pick.runtimeMinutes
        : pick.episodeRuntimeMinutes;
    const time = runtime === null ? "Runtime unknown" : formatRuntime(runtime);
    const commitment =
      pick.format === "series"
        ? `${time} episodes · ${pick.seasonCount === null ? "season count unknown" : `${pick.seasonCount} ${pick.seasonCount === 1 ? "season" : "seasons"}`}`
        : time;
    return {
      role: "recommendation",
      id: pick.id,
      title: pick.title,
      year: pick.year,
      format: pick.format,
      timeLabel: commitment,
      reason: pick.reasons.join(" "),
      posterUrl: pick.posterUrl,
      offers: pick.availability.offers.map((offer) => ({
        serviceId: String(offer.providerId),
        serviceName: offer.providerName,
        access: offer.access,
        freshnessCheckedAt: pick.availability.checkedAt,
      })),
      availability: pick.availability,
    };
  });
  const best = picks[0];
  if (!best)
    return {
      status: "error",
      message: "The catalog returned no usable picks. Please try again.",
    };
  return response.status === "shortage"
    ? {
        status: "shortage",
        confidence: response.confidence,
        message:
          response.message ??
          "Fewer than five titles match. No extra titles were added.",
        best,
        alternatives: picks.slice(1),
      }
    : {
        status: "ok",
        confidence: response.confidence,
        best,
        alternatives: picks.slice(1),
      };
}
