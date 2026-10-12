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
  return (
    <section className="flow-step" aria-labelledby="services-heading">
      <StepHeader
        id="services-heading"
        eyebrow="First, your front-row seats"
        title="Which subscriptions do you have?"
      >
        <p>
          Choose US streaming subscriptions you can use. This step covers
          subscription access only. Rent and buy are separate and are never
          treated as included.
        </p>
      </StepHeader>
      <fieldset className="service-fieldset">
        <legend className="sr-only">US streaming subscriptions</legend>
        <ul className="service-grid grid grid-cols-2">
          {services.map((service) => {
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
          })}
        </ul>
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
