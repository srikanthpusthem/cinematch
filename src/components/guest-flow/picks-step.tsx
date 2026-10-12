"use client";

import Image from "next/image";
import { FilmMark, PosterPlaceholder, StepHeader } from "./ui";
import type { DerivedFeedbackState } from "@/lib/guest-persistence";
import {
  JUSTWATCH_ATTRIBUTION,
  availabilityLinkLabel,
} from "@/catalog/attribution";

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
  source?: "mock" | "catalog";
  selectedServiceIds?: readonly string[];
  canShowMore?: boolean;
  feedback?: DerivedFeedbackState;
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
  source = "mock",
  selectedServiceIds = [],
  canShowMore = true,
  feedback,
  phase,
  onBack,
  onEdit,
  onRetry,
  onFeedback,
  onShowMore,
}: PicksStepProps) {
  return (
    <section
      className="flow-step picks-step min-w-0"
      aria-labelledby="picks-heading"
    >
      <StepHeader
        id="picks-heading"
        eyebrow="The evening starts here"
        title="Your picks"
      >
        <p>
          {source === "mock"
            ? "Mock catalog only. Not live availability. Watch opens only when a verified link exists on the offer."
            : "US catalog recommendations. Availability can change. Provider information links are not direct playback links."}
        </p>
      </StepHeader>
      {source === "catalog" ? (
        <p className="source-credit">{JUSTWATCH_ATTRIBUTION}</p>
      ) : null}

      {phase.type === "loading" ? (
        <div className="picks-loading">
          <FilmMark className="loading-film" />
          <p role="status">Finding picks…</p>
          <p className="muted-copy">Matching your choices with the catalog.</p>
          <div className="loading-track" aria-hidden="true">
            <span />
          </div>
        </div>
      ) : null}

      {phase.type === "ready" && phase.result.status === "error" ? (
        <div className="result-state notice-error">
          <p className="eyebrow">A brief intermission</p>
          <p role="alert">{phase.result.message}</p>
          <button
            type="button"
            className="button-primary mt-4"
            onClick={onRetry}
          >
            Try again
          </button>
        </div>
      ) : null}

      {phase.type === "ready" && phase.result.status === "empty" ? (
        <div className="result-state">
          <FilmMark className="empty-film" />
          <p className="eyebrow">Let’s try a different scene</p>
          <p role="status">{phase.result.message}</p>
          <EditRow onEdit={onEdit} />
        </div>
      ) : null}

      {phase.type === "ready" && hasPicks(phase.result) ? (
        <ResultsBody
          result={phase.result}
          source={source}
          selectedServiceIds={selectedServiceIds}
          canShowMore={canShowMore}
          feedback={feedback}
          onEdit={onEdit}
          onFeedback={onFeedback}
          onShowMore={onShowMore}
        />
      ) : null}

      <button type="button" className="button-text mt-4" onClick={onBack}>
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
  source,
  selectedServiceIds,
  canShowMore,
  feedback,
  onEdit,
  onFeedback,
  onShowMore,
}: {
  result: PicksResult;
  source: "mock" | "catalog";
  selectedServiceIds: readonly string[];
  canShowMore: boolean;
  feedback?: DerivedFeedbackState;
  onEdit: (step: FlowStep) => void;
  onFeedback?: (pickId: string, action: PickFeedbackAction) => void;
  onShowMore?: () => void;
}) {
  const allPicks = [result.best, ...result.alternatives];
  const anyStale = allPicks.some((pick) => isPickStale(pick, source));

  return (
    <div className="results-body">
      {result.confidence === "cold-start" ? (
        <p className="flow-notice" role="status">
          Cold start: lower confidence because no quiz titles were chosen.
        </p>
      ) : (
        <p className="flow-notice" role="status">
          Based on your quiz seeds.
        </p>
      )}

      {result.status === "shortage" ? (
        <p className="flow-notice" role="status">
          {result.message}
        </p>
      ) : null}

      {result.status === "unavailable" ? (
        <p className="flow-notice" role="status">
          {result.message}
        </p>
      ) : null}

      {anyStale ? (
        <p className="flow-notice" role="status">
          {source === "mock"
            ? "Availability looks stale (checked more than 7 days before the mock clock). Treat service info as outdated until refreshed."
            : "Availability looks stale. Service offers need refreshing; they are not shown as current subscriptions."}
        </p>
      ) : null}

      <PickCard
        heading="Best match"
        pick={result.best}
        emphasize
        source={source}
        selectedServiceIds={selectedServiceIds}
        feedback={feedback}
        onFeedback={onFeedback}
      />

      {result.alternatives.length > 0 ? (
        <div className="alternatives-section">
          <h3>Alternatives</h3>
          <div className="alternatives-grid">
            {result.alternatives.map((pick) => (
              <PickCard
                key={pick.id}
                pick={pick}
                source={source}
                selectedServiceIds={selectedServiceIds}
                feedback={feedback}
                onFeedback={onFeedback}
              />
            ))}
          </div>
        </div>
      ) : (
        <p>No alternatives fit.</p>
      )}

      <div className="feedback-actions">
        <button
          type="button"
          className="button-secondary min-h-11 touch-manipulation"
          disabled={!canShowMore}
          onClick={() => onShowMore?.()}
        >
          Show more
        </button>
      </div>
      {!canShowMore ? (
        <p role="status">
          No more titles match these constraints. Edit a step to try different
          choices.
        </p>
      ) : null}

      <EditRow onEdit={onEdit} />
    </div>
  );
}

function PickCard({
  heading,
  pick,
  emphasize,
  onFeedback,
  source,
  selectedServiceIds,
  feedback,
}: {
  heading?: string;
  pick: Recommendation;
  emphasize?: boolean;
  onFeedback?: (pickId: string, action: PickFeedbackAction) => void;
  source: "mock" | "catalog";
  selectedServiceIds: readonly string[];
  feedback?: DerivedFeedbackState;
}) {
  const subscriptions = pick.offers.filter(
    (offer) => offer.access === "subscription",
  );
  const rentBuy = pick.offers.filter(
    (offer) => offer.access === "rent" || offer.access === "buy",
  );
  const freeOffers = pick.offers.filter(
    (offer) => offer.access === "free" || offer.access === "ads",
  );
  const verifiedWatchUrl = firstVerifiedWatchUrl(pick.offers);
  const stale = isPickStale(pick, source);

  return (
    <article
      className={`pick-card min-w-0 ${emphasize ? "pick-featured" : ""}`}
    >
      {heading ? (
        <h3 className="match-label">
          <span aria-hidden="true">✳</span> {heading}
        </h3>
      ) : null}
      <div className="pick-layout">
        <div className="pick-poster">
          {pick.posterUrl ? (
            <Image
              src={pick.posterUrl}
              alt=""
              width={240}
              height={360}
              unoptimized
              className="poster-image"
            />
          ) : (
            <PosterPlaceholder />
          )}
        </div>
        <div className="pick-content">
          <p className="pick-meta">
            {pick.format === "movie" ? "Movie" : "Series"}
            {pick.year !== null ? ` · ${pick.year}` : ""} · {pick.timeLabel}
          </p>
          <h4 className="pick-title">{pick.title}</h4>
          <p className="pick-reason">{pick.reason}</p>
          <OfferLists
            subscriptions={subscriptions}
            selectedServiceIds={selectedServiceIds}
            rentBuy={rentBuy}
            freeOffers={freeOffers}
            stale={stale}
            unavailable={
              source === "catalog" && pick.availability?.state !== "current"
            }
          />

          <div className="pick-links">
            {verifiedWatchUrl ? (
              <a
                href={verifiedWatchUrl}
                className="button-primary"
                rel="noopener noreferrer"
                target="_blank"
              >
                Watch
              </a>
            ) : (
              <p className="playback-note" role="status">
                {source === "mock"
                  ? "Watch unavailable — no verified playback link on this mock offer."
                  : "Direct Watch unavailable: no verified playback link. Check availability with the provider."}
              </p>
            )}
            {source === "catalog" && pick.availability?.infoUrl ? (
              <a
                href={pick.availability.infoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="provider-link"
              >
                {availabilityLinkLabel("provider-info")}
                <span className="provider-external-icon" aria-hidden="true">
                  ↗
                </span>
              </a>
            ) : null}
            {source === "catalog" && pick.availability ? (
              <p className="availability-note">
                Availability {pick.availability.state}
                {pick.availability.checkedAt
                  ? ` · checked ${formatCheckedAt(pick.availability.checkedAt)}`
                  : " · never verified"}
              </p>
            ) : null}

            <div className="feedback-actions">
              <FeedbackButton
                label="Watched"
                disabled={feedback?.suppressedContentIds.includes(pick.id)}
                onClick={() => onFeedback?.(pick.id, "watched")}
              />
              <FeedbackButton
                label="Like"
                disabled={feedback?.likedContentIds.includes(pick.id)}
                onClick={() => onFeedback?.(pick.id, "like")}
              />
              <FeedbackButton
                label="Not for me"
                disabled={feedback?.dislikedContentIds.includes(pick.id)}
                onClick={() => onFeedback?.(pick.id, "not-for-me")}
              />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function OfferLists({
  subscriptions,
  selectedServiceIds,
  rentBuy,
  freeOffers,
  stale,
  unavailable,
}: {
  subscriptions: ServiceOffer[];
  selectedServiceIds: readonly string[];
  rentBuy: ServiceOffer[];
  freeOffers: ServiceOffer[];
  stale: boolean;
  unavailable: boolean;
}) {
  return (
    <div className="offer-lists">
      <div>
        <p className="offer-heading">Subscription (included)</p>
        {subscriptions.length > 0 ? (
          <ul aria-label="Subscription (included)" className="offer-list">
            {[...subscriptions]
              .sort(
                (a, b) =>
                  Number(selectedServiceIds.includes(b.serviceId)) -
                  Number(selectedServiceIds.includes(a.serviceId)),
              )
              .map((offer) => (
                <li
                  key={`${offer.serviceId}-${offer.access}`}
                  className={
                    selectedServiceIds.includes(offer.serviceId)
                      ? "selected-offer"
                      : undefined
                  }
                >
                  {offer.serviceName}
                  {selectedServiceIds.includes(offer.serviceId) ? (
                    <span className="selected-offer-label">
                      Your selected service
                    </span>
                  ) : null}
                  <span className="offer-date">
                    {" "}
                    · checked {formatCheckedAt(offer.freshnessCheckedAt)}
                    {stale ? " · stale" : ""}
                  </span>
                </li>
              ))}
          </ul>
        ) : (
          <p className="offer-empty">
            {unavailable
              ? "Subscription availability is not currently verified."
              : "No included subscription on selected US services."}
          </p>
        )}
      </div>
      <div>
        <p className="offer-heading">Rent or buy (not included)</p>
        {rentBuy.length > 0 ? (
          <ul aria-label="Rent or buy (not included)" className="offer-list">
            {rentBuy.map((offer) => (
              <li key={`${offer.serviceId}-${offer.access}`}>
                {offer.serviceName}: {offer.access}
                <span className="offer-date">
                  {" "}
                  · checked {formatCheckedAt(offer.freshnessCheckedAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="offer-empty">
            {unavailable
              ? "Rent or buy availability is not currently verified."
              : "No rent or buy options listed for this title."}
          </p>
        )}
      </div>
      {freeOffers.length > 0 ? (
        <div>
          <p className="offer-heading">
            Free or ad-supported (not a subscription)
          </p>
          <ul aria-label="Free or ad-supported" className="offer-list">
            {freeOffers.map((offer) => (
              <li key={`${offer.serviceId}-${offer.access}`}>
                {offer.serviceName}:{" "}
                {offer.access === "ads" ? "with ads" : "free"} · checked{" "}
                {formatCheckedAt(offer.freshnessCheckedAt)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function FeedbackButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="button-secondary min-h-11 touch-manipulation"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function EditRow({ onEdit }: { onEdit: (step: FlowStep) => void }) {
  return (
    <div className="edit-row" aria-label="Edit constraints">
      <button
        type="button"
        className="button-text"
        onClick={() => onEdit("services")}
      >
        Edit services
      </button>
      <button
        type="button"
        className="button-text"
        onClick={() => onEdit("taste")}
      >
        Edit taste
      </button>
      <button
        type="button"
        className="button-text"
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

function formatCheckedAt(iso: string | null): string {
  if (iso === null) return "unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toISOString().slice(0, 10);
}

function isPickStale(
  pick: Recommendation,
  source: "mock" | "catalog",
): boolean {
  if (source === "catalog") return pick.availability?.state === "stale";
  return pick.offers.some((offer) =>
    isFreshnessStale(offer.freshnessCheckedAt ?? ""),
  );
}
