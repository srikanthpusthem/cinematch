"use client";

import { type GuestAnswers, type ServiceId } from "@/lib/guest-flow/types";
import { StepHeader } from "./ui";

export type ServicesStepProps = {
  answers: GuestAnswers;
  services: readonly { id: string; name: string }[];
  onToggle: (id: ServiceId) => void;
  onSkip: () => void;
  onContinue: () => void;
  canContinue: boolean;
};

/** True when the answer set marks this subscription as chosen (not skip-all). */
export function isServiceSelected(
  answers: GuestAnswers,
  id: ServiceId,
): boolean {
  return !answers.servicesSkipped && answers.serviceIds.includes(id);
}

export function ServicesStep({
  answers,
  services,
  onToggle,
  onSkip,
  onContinue,
  canContinue,
}: ServicesStepProps) {
  const selectedCount = answers.servicesSkipped ? 0 : answers.serviceIds.length;
  const familiarNames = [
    ["netflix"],
    ["max", "hbomax"],
    ["hulu"],
    ["disney", "disneyplus"],
    ["primevideo", "amazonprimevideo"],
    ["appletv", "appletvplus"],
    ["peacock", "peacockpremium"],
    ["paramount", "paramountplus"],
  ];
  const rank = (name: string) =>
    familiarNames.findIndex((names) =>
      names.includes(
        name
          .toLowerCase()
          .replace(/\+/g, "plus")
          .replace(/[^a-z0-9]/g, ""),
      ),
    );
  const familiarServices = services
    .filter((service) => rank(service.name) >= 0)
    .sort((a, b) => rank(a.name) - rank(b.name));
  const visibleServices =
    familiarServices.length > 0
      ? familiarServices.slice(0, 8)
      : services.slice(0, 6);
  const extraServices = services.filter(
    (service) => !visibleServices.some((visible) => visible.id === service.id),
  );
  const selectedExtras = extraServices.filter((service) =>
    isServiceSelected(answers, service.id),
  ).length;
  const renderCards = (items: ServicesStepProps["services"]) =>
    items.map((service) => {
      const selected = isServiceSelected(answers, service.id);
      const stateId = `service-${service.id}-state`;
      return (
        <li key={service.id} className="min-w-0">
          <label
            className="service-card min-h-11 touch-manipulation"
            data-selected={selected}
          >
            <span className="service-monogram" aria-hidden="true">
              {service.name.slice(0, 1)}
            </span>
            <input
              type="checkbox"
              className="service-checkbox"
              name="services"
              value={service.id}
              checked={selected}
              onChange={() => onToggle(service.id)}
              aria-describedby={stateId}
            />
            <span className="service-copy">
              <span className="service-name">{service.name}</span>
              <span id={stateId} className="service-state">
                {selected ? "Selected · subscription" : "Not selected"}
              </span>
            </span>
            {selected ? (
              <span className="service-check" aria-hidden="true">
                ✓
              </span>
            ) : null}
          </label>
        </li>
      );
    });
  return (
    <section className="flow-step" aria-labelledby="services-heading">
      <StepHeader
        id="services-heading"
        eyebrow="First things first"
        title="Which subscriptions do you have?"
      >
        <p>
          Pick the US services you use. This is subscription access only. Rent
          and buy cost extra and are never treated as included.
        </p>
      </StepHeader>
      <fieldset className="service-fieldset">
        <legend className="sr-only">US streaming subscriptions</legend>
        <ul className="service-grid grid grid-cols-2">
          {renderCards(visibleServices)}
        </ul>
        {extraServices.length > 0 ? (
          <details className="service-details">
            <summary>
              More subscriptions ({extraServices.length})
              {selectedExtras > 0 ? (
                <span className="selected-extras">
                  {selectedExtras} selected
                </span>
              ) : null}
            </summary>
            <ul className="service-grid grid grid-cols-2">
              {renderCards(extraServices)}
            </ul>
          </details>
        ) : null}
      </fieldset>
      {answers.servicesSkipped ? (
        <p className="selection-summary" role="status">
          Showing every service. Rent and buy options can appear, and they are
          not free.
        </p>
      ) : (
        <p className="selection-summary">
          {selectedCount === 0
            ? "Choose at least one subscription, or skip to include all services."
            : `${selectedCount} selected. Continue with these subscriptions.`}
        </p>
      )}
      <div className="step-actions">
        <button
          type="button"
          className="button-primary"
          onClick={onContinue}
          disabled={!canContinue}
        >
          Continue
        </button>
        <button type="button" className="button-secondary" onClick={onSkip}>
          Skip, show all services
        </button>
      </div>
    </section>
  );
}
