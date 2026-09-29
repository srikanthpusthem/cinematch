"use client";

import {
  isFreshnessStale,
  type FlowStep,
  type PickFeedbackAction,
  type RecommendResult,
  type Recommendation,
  type ServiceOffer,
} from "@/lib/guest-flow/types";

type Phase =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "ready"; result: RecommendResult };

export type PicksStepProps = {
  phase: Phase;
  onBack: () => void;
  onEdit: (step: FlowStep) => void;
  onRetry: () => void;
  /** Event output only — persistence belongs to #28. */
  onFeedback?: (pickId: string, action: PickFeedbackAction) => void;
  /** Event output only — persistence belongs to #28. */
  onShowMore?: () => void;
};

export function PicksStep({
  phase,
  onBack,
  onEdit,
  onRetry,
  onFeedback,
  onShowMore,
}: PicksStepProps) {
  return (
    <section className="mt-8 min-w-0" aria-labelledby="picks-heading">
      <h2 id="picks-heading" className="text-xl font-semibold text-pretty">
        Your picks
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Mock catalog only. Not live availability. Watch opens only when a
        verified link exists on the offer.
      </p>

      {phase.type === "loading" ? (
        <p className="mt-6" role="status">
          Finding picks
        </p>
      ) : null}

      {phase.type === "ready" && phase.result.status === "error" ? (
        <div className="mt-6">
          <p role="alert">{phase.result.message}</p>
          <button
            type="button"
            className="mt-4 min-h-11 touch-manipulation rounded-lg bg-zinc-950 px-4 text-white dark:bg-zinc-50 dark:text-zinc-950"
            onClick={onRetry}
          >
            Try again
          </button>
        </div>
      ) : null}

      {phase.type === "ready" && phase.result.status === "empty" ? (
        <div className="mt-6 space-y-4">
          <p role="status">{phase.result.message}</p>
          <EditRow onEdit={onEdit} />
        </div>
      ) : null}

      {phase.type === "ready" && hasPicks(phase.result) ? (
        <ResultsBody
          result={phase.result}
          onEdit={onEdit}
          onFeedback={onFeedback}
          onShowMore={onShowMore}
        />
      ) : null}

      <button
        type="button"
        className="mt-4 min-h-11 touch-manipulation px-4 text-left"
        onClick={onBack}
      >
        Back
      </button>
    </section>
  );
}

type PicksResult = Extract<
  RecommendResult,
  { status: "ok" | "shortage" | "unavailable" }
>;

function hasPicks(result: RecommendResult): result is PicksResult {
  return (
    result.status === "ok" ||
    result.status === "shortage" ||
    result.status === "unavailable"
  );
}

function ResultsBody({
  result,
  onEdit,
  onFeedback,
  onShowMore,
}: {
  result: PicksResult;
  onEdit: (step: FlowStep) => void;
  onFeedback?: (pickId: string, action: PickFeedbackAction) => void;
  onShowMore?: () => void;
}) {
  const allPicks = [result.best, ...result.alternatives];
  const anyStale = allPicks.some((pick) =>
    pick.offers.some((offer) => isFreshnessStale(offer.freshnessCheckedAt)),
  );

  return (
    <div className="mt-6 space-y-4">
      {result.confidence === "cold-start" ? (
        <p role="status">
          Cold start: lower confidence because no quiz titles were chosen.
        </p>
      ) : (
        <p role="status">Based on your quiz seeds.</p>
      )}

      {result.status === "shortage" ? (
        <p role="status">{result.message}</p>
      ) : null}

      {result.status === "unavailable" ? (
        <p role="status">{result.message}</p>
      ) : null}

      {anyStale ? (
        <p role="status">
          Availability looks stale (checked more than 7 days before the mock
          clock). Treat service info as outdated until refreshed.
        </p>
      ) : null}

      <PickCard
        heading="Best match"
        pick={result.best}
        emphasize
        onFeedback={onFeedback}
      />

      {result.alternatives.length > 0 ? (
        <div>
          <h3 className="font-medium">Alternatives</h3>
          <div className="mt-3 space-y-3">
            {result.alternatives.map((pick) => (
              <PickCard key={pick.id} pick={pick} onFeedback={onFeedback} />
            ))}
          </div>
        </div>
      ) : (
        <p>No alternatives fit.</p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          className="min-h-11 touch-manipulation rounded-lg border border-zinc-300 px-4 dark:border-zinc-700"
          onClick={() => onShowMore?.()}
        >
          Show more
        </button>
      </div>

      <EditRow onEdit={onEdit} />
    </div>
  );
}

function PickCard({
  heading,
  pick,
  emphasize,
  onFeedback,
}: {
  heading?: string;
  pick: Recommendation;
  emphasize?: boolean;
  onFeedback?: (pickId: string, action: PickFeedbackAction) => void;
}) {
  const subscriptions = pick.offers.filter(
    (offer) => offer.access === "subscription",
  );
  const rentBuy = pick.offers.filter(
    (offer) => offer.access === "rent" || offer.access === "buy",
  );
  const verifiedWatchUrl = firstVerifiedWatchUrl(pick.offers);
  const stale = pick.offers.some((offer) =>
    isFreshnessStale(offer.freshnessCheckedAt),
  );

  return (
    <article
      className={[
        "min-w-0 rounded-lg border p-3",
        emphasize
          ? "border-zinc-950 ring-1 ring-zinc-950 dark:border-zinc-50 dark:ring-zinc-50"
          : "border-zinc-200 dark:border-zinc-800",
      ].join(" ")}
    >
      {heading ? (
        <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          {heading}
        </h3>
      ) : null}
      <p
        className={[
          "font-semibold text-pretty",
          heading ? "mt-1" : "",
          emphasize ? "text-lg" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {pick.title}{" "}
        <span className="font-normal text-zinc-500">({pick.year})</span>
      </p>
      <p className="mt-1 text-sm">{pick.timeLabel}</p>
      <p className="mt-2 text-sm text-pretty">{pick.reason}</p>

      <OfferLists
        subscriptions={subscriptions}
        rentBuy={rentBuy}
        stale={stale}
      />

      <div className="mt-3 flex flex-col gap-2">
        {verifiedWatchUrl ? (
          <a
            href={verifiedWatchUrl}
            className="inline-flex min-h-11 touch-manipulation items-center justify-center rounded-lg bg-zinc-950 px-4 text-center text-white dark:bg-zinc-50 dark:text-zinc-950"
            rel="noopener noreferrer"
            target="_blank"
          >
            Watch
          </a>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400" role="status">
            Watch unavailable — no verified playback link on this mock offer.
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <FeedbackButton
            label="Watched"
            onClick={() => onFeedback?.(pick.id, "watched")}
          />
          <FeedbackButton
            label="Like"
            onClick={() => onFeedback?.(pick.id, "like")}
          />
          <FeedbackButton
            label="Not for me"
            onClick={() => onFeedback?.(pick.id, "not-for-me")}
          />
        </div>
      </div>
    </article>
  );
}

function OfferLists({
  subscriptions,
  rentBuy,
  stale,
}: {
  subscriptions: ServiceOffer[];
  rentBuy: ServiceOffer[];
  stale: boolean;
}) {
  return (
    <div className="mt-3 space-y-2 text-sm">
      <div>
        <p className="font-medium">Subscription (included)</p>
        {subscriptions.length > 0 ? (
          <ul className="mt-1 list-inside list-disc">
            {subscriptions.map((offer) => (
              <li key={`${offer.serviceId}-${offer.access}`}>
                {offer.serviceName}
                <span className="text-zinc-500">
                  {" "}
                  · checked {formatCheckedAt(offer.freshnessCheckedAt)}
                  {stale && isFreshnessStale(offer.freshnessCheckedAt)
                    ? " · stale"
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            No included subscription on selected US services.
          </p>
        )}
      </div>
      <div>
        <p className="font-medium">Rent or buy (not included)</p>
        {rentBuy.length > 0 ? (
          <ul className="mt-1 list-inside list-disc">
            {rentBuy.map((offer) => (
              <li key={`${offer.serviceId}-${offer.access}`}>
                {offer.serviceName}: {offer.access}
                <span className="text-zinc-500">
                  {" "}
                  · checked {formatCheckedAt(offer.freshnessCheckedAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            No rent or buy options listed for this mock title.
          </p>
        )}
      </div>
    </div>
  );
}

function FeedbackButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="min-h-11 touch-manipulation rounded-lg border border-zinc-300 px-4 dark:border-zinc-700"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function EditRow({ onEdit }: { onEdit: (step: FlowStep) => void }) {
  return (
    <div className="flex flex-col gap-2" aria-label="Edit constraints">
      <button
        type="button"
        className="min-h-11 touch-manipulation text-left"
        onClick={() => onEdit("services")}
      >
        Edit services
      </button>
      <button
        type="button"
        className="min-h-11 touch-manipulation text-left"
        onClick={() => onEdit("taste")}
      >
        Edit taste
      </button>
      <button
        type="button"
        className="min-h-11 touch-manipulation text-left"
        onClick={() => onEdit("tonight")}
      >
        Edit tonight
      </button>
    </div>
  );
}

export function firstVerifiedWatchUrl(
  offers: ServiceOffer[],
): string | undefined {
  for (const offer of offers) {
    if (offer.verifiedWatchUrl) return offer.verifiedWatchUrl;
  }
  return undefined;
}

function formatCheckedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toISOString().slice(0, 10);
}
