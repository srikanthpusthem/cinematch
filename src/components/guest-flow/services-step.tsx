"use client";

import {
  SERVICE_OPTIONS,
  type GuestAnswers,
  type ServiceId,
} from "@/lib/guest-flow/types";

export type ServicesStepProps = {
  answers: GuestAnswers;
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
  onToggle,
  onSkip,
  onContinue,
  canContinue,
}: ServicesStepProps) {
  const selectedCount = answers.servicesSkipped ? 0 : answers.serviceIds.length;

  return (
    <section className="mt-8" aria-labelledby="services-heading">
      <h2 id="services-heading" className="text-xl font-semibold text-pretty">
        Which subscriptions do you have?
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Choose US streaming subscriptions you can use. This step covers
        subscription access only. Rent and buy are separate and are never
        treated as included.
      </p>

      <fieldset className="mt-4 min-w-0">
        <legend className="sr-only">US streaming subscriptions</legend>
        <ul className="grid grid-cols-2 gap-3">
          {SERVICE_OPTIONS.map((service) => {
            const selected = isServiceSelected(answers, service.id);
            const stateId = `service-${service.id}-state`;
            return (
              <li key={service.id} className="min-w-0">
                <label
                  className={[
                    "flex min-h-11 cursor-pointer touch-manipulation items-center gap-2 rounded-lg border-2 px-3 py-3",
                    "focus-within:ring-2 focus-within:ring-zinc-950 focus-within:ring-offset-2",
                    "dark:focus-within:ring-zinc-50 dark:focus-within:ring-offset-zinc-950",
                    selected
                      ? "border-zinc-950 bg-zinc-100 font-medium dark:border-zinc-50 dark:bg-zinc-900"
                      : "border-zinc-300 font-normal dark:border-zinc-700",
                  ].join(" ")}
                >
                  <input
                    type="checkbox"
                    className="size-4 shrink-0"
                    name="services"
                    value={service.id}
                    checked={selected}
                    onChange={() => onToggle(service.id)}
                    aria-describedby={stateId}
                  />
                  <span className="min-w-0 flex-1 break-words">
                    <span className="block leading-snug">{service.name}</span>
                    <span
                      id={stateId}
                      className="mt-0.5 block text-xs font-normal text-zinc-600 dark:text-zinc-400"
                    >
                      {selected ? "Selected · subscription" : "Not selected"}
                    </span>
                  </span>
                  {selected ? (
                    <span aria-hidden="true" className="shrink-0 text-base">
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
        <p className="mt-3 text-sm" role="status">
          Showing every service. Rent and buy options can appear, and they are
          not free.
        </p>
      ) : (
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          {selectedCount === 0
            ? "Choose at least one subscription, or skip to include all services."
            : `${selectedCount} selected. Continue with these subscriptions.`}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          className="min-h-11 touch-manipulation rounded-lg bg-zinc-950 px-4 text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950"
          onClick={onContinue}
          disabled={!canContinue}
        >
          Continue
        </button>
        <button
          type="button"
          className="min-h-11 touch-manipulation rounded-lg border border-zinc-300 px-4 dark:border-zinc-700"
          onClick={onSkip}
        >
          Skip, show all services
        </button>
      </div>
    </section>
  );
}
