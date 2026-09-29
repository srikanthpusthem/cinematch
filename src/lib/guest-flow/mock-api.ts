import { formatRuntime } from "@/lib/runtime";
import { CATALOG, QUIZ_SEEDS, type CatalogTitle } from "./fixtures";
import {
  SERVICE_OPTIONS,
  movieLengthMatches,
  seriesLengthMatches,
  tasteSelectionError,
  type GuestAnswers,
  type MockMode,
  type RecommendResult,
  type Recommendation,
  type ServiceOffer,
} from "./types";

const EMPTY_MESSAGE =
  "Nothing in the mock catalog fits these constraints. Edit a step instead of widening them automatically.";
const ERROR_MESSAGE =
  "The mock picker failed before choosing titles. No picks were invented.";

export async function getQuizSeeds(): Promise<typeof QUIZ_SEEDS> {
  return QUIZ_SEEDS;
}

export function answersError(answers: GuestAnswers): string | null {
  if (!answers.servicesSkipped && answers.serviceIds.length === 0) {
    return "Choose a subscription or skip to all services.";
  }
  const taste = tasteSelectionError(answers.seedIds.length);
  if (taste) return taste;
  if (!answers.mood) return "Choose a mood.";
  if (!answers.format) return "Choose a movie or a series.";
  if (answers.format === "movie" && !answers.movieLength) {
    return "Choose a movie length.";
  }
  if (answers.format === "series" && !answers.seriesLength) {
    return "Choose a series length.";
  }
  return null;
}

function serviceName(id: GuestAnswers["serviceIds"][number]): string {
  return SERVICE_OPTIONS.find((service) => service.id === id)?.name ?? id;
}

function toOffer(offer: CatalogTitle["offers"][number]): ServiceOffer {
  return {
    serviceId: offer.serviceId,
    serviceName: serviceName(offer.serviceId),
    access: offer.access,
  };
}

function eligible(title: CatalogTitle, answers: GuestAnswers): boolean {
  if (answers.format && title.format !== answers.format) return false;
  if (answers.format === "movie") {
    if (
      !answers.movieLength ||
      !movieLengthMatches(title.minutes, answers.movieLength)
    ) {
      return false;
    }
  }
  if (answers.format === "series") {
    if (
      !answers.seriesLength ||
      title.seasons == null ||
      !seriesLengthMatches(title.minutes, title.seasons, answers.seriesLength)
    ) {
      return false;
    }
  }
  if (!answers.mood || !title.moods.includes(answers.mood)) return false;
  if (answers.avoidedGenres.some((genre) => title.genres.includes(genre))) {
    return false;
  }
  if (!answers.servicesSkipped) {
    const subscribed = title.offers.some(
      (offer) =>
        offer.access === "subscription" &&
        answers.serviceIds.includes(offer.serviceId),
    );
    if (!subscribed) return false;
  }
  if (answers.seedIds.length > 0) {
    const seedGenres = new Set(
      QUIZ_SEEDS.filter((seed) => answers.seedIds.includes(seed.id)).flatMap(
        (seed) => seed.genres,
      ),
    );
    if (!title.genres.some((genre) => seedGenres.has(genre))) return false;
  }
  return true;
}

function visibleOffers(
  title: CatalogTitle,
  answers: GuestAnswers,
): ServiceOffer[] {
  const offers = answers.servicesSkipped
    ? title.offers
    : title.offers.filter((offer) =>
        answers.serviceIds.includes(offer.serviceId),
      );
  return offers.map(toOffer);
}

function timeLabel(title: CatalogTitle): string {
  if (title.format === "series" && title.seasons != null) {
    const seasonLabel = title.seasons === 1 ? "season" : "seasons";
    return `${formatRuntime(title.minutes)} episodes · ${title.seasons} ${seasonLabel}`;
  }
  return formatRuntime(title.minutes);
}

function reason(title: CatalogTitle, answers: GuestAnswers): string {
  const offers = visibleOffers(title, answers);
  const subscription = offers.find((offer) => offer.access === "subscription");
  const shown = subscription ?? offers[0];
  const access = !shown
    ? "No verified service on this mock title."
    : shown.access === "subscription"
      ? `Included with ${shown.serviceName}.`
      : `Only to ${shown.access} on ${shown.serviceName}, not included with a subscription.`;
  const taste =
    answers.seedIds.length === 0
      ? "Cold start, lower confidence, because no quiz titles were chosen."
      : `Shares ${title.genres.find((genre) =>
          QUIZ_SEEDS.some(
            (seed) =>
              answers.seedIds.includes(seed.id) && seed.genres.includes(genre),
          ),
        )} with a quiz seed.`;
  return `${taste} ${timeLabel(title)} ${title.format}. ${access}`;
}

function toRecommendation(
  title: CatalogTitle,
  answers: GuestAnswers,
): Recommendation {
  return {
    role: "recommendation",
    id: title.id,
    title: title.title,
    year: title.year,
    format: title.format,
    timeLabel: timeLabel(title),
    reason: reason(title, answers),
    offers: visibleOffers(title, answers),
  };
}

function fromMatches(
  matches: CatalogTitle[],
  answers: GuestAnswers,
): RecommendResult {
  const confidence = answers.seedIds.length >= 3 ? "seeded" : "cold-start";
  const picks = matches.map((title) => toRecommendation(title, answers));
  const best = picks[0];
  if (!best) return { status: "empty", message: EMPTY_MESSAGE };
  if (picks.length < 5) {
    return {
      status: "shortage",
      confidence,
      message: `Only ${picks.length} ${picks.length === 1 ? "match fits" : "matches fit"} these constraints. Nothing was added to fill the list.`,
      best,
      alternatives: picks.slice(1),
    };
  }
  return {
    status: "ok",
    confidence,
    best,
    alternatives: picks.slice(1, 5),
  };
}

export async function mockRecommend(
  answers: GuestAnswers,
  options?: { mode?: MockMode; delayMs?: number; signal?: AbortSignal },
): Promise<RecommendResult> {
  const mode = options?.mode ?? "success";
  const delayMs = options?.delayMs ?? (mode === "loading" ? 800 : 0);
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  if (options?.signal?.aborted) {
    throw new DOMException("The pick request was aborted.", "AbortError");
  }
  if (mode === "error") return { status: "error", message: ERROR_MESSAGE };

  const invalid = answersError(answers);
  if (invalid) return { status: "error", message: invalid };
  if (mode === "empty") return { status: "empty", message: EMPTY_MESSAGE };

  const matches = CATALOG.filter((title) => eligible(title, answers)).sort(
    (a, b) => a.title.localeCompare(b.title),
  );
  if (mode === "shortage") return fromMatches(matches.slice(0, 2), answers);
  return fromMatches(matches, answers);
}
