"use client";

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TonightStep } from "@/components/guest-flow/tonight-step";
import { QUIZ_SEEDS } from "@/lib/guest-flow/fixtures";
import { mockRecommend } from "@/lib/guest-flow/mock-api";
import { isTonightComplete } from "@/lib/guest-flow/tonight";
import {
  AVOIDABLE_GENRES,
  EMPTY_ANSWERS,
  FLOW_STEPS,
  SERVICE_OPTIONS,
  tasteSelectionError,
  type AvoidableGenre,
  type FlowStep,
  type GuestAnswers,
  type MockMode,
  type RecommendResult,
  type ServiceId,
} from "@/lib/guest-flow/types";

type Phase =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "ready"; result: RecommendResult };

function mockMode(value: string | null): MockMode {
  if (
    value === "empty" ||
    value === "shortage" ||
    value === "error" ||
    value === "loading"
  ) {
    return value;
  }
  return "success";
}

function toggleId<T extends string>(current: T[], id: T): T[] {
  return current.includes(id)
    ? current.filter((item) => item !== id)
    : [...current, id];
}

export function GuestFlow() {
  const mode = mockMode(useSearchParams().get("mock"));
  const [step, setStep] = useState<FlowStep>("services");
  const [answers, setAnswers] = useState<GuestAnswers>(EMPTY_ANSWERS);
  const [phase, setPhase] = useState<Phase>({ type: "idle" });
  const request = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const stepIndex = FLOW_STEPS.findIndex((item) => item.id === step);
  const stepLabel = FLOW_STEPS[stepIndex]?.label ?? "Services";

  function patch(partial: Partial<GuestAnswers>) {
    setAnswers((current) => ({ ...current, ...partial }));
  }

  function leavePicks(target: FlowStep) {
    abortRef.current?.abort();
    abortRef.current = null;
    setStep(target);
  }

  async function showPicks(next: GuestAnswers = answers) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const id = ++request.current;
    setStep("picks");
    setPhase({ type: "loading" });
    try {
      const result = await mockRecommend(next, {
        mode,
        delayMs: mode === "loading" ? 800 : 150,
        signal: controller.signal,
      });
      if (request.current === id) setPhase({ type: "ready", result });
    } catch (error) {
      if (request.current !== id) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setPhase({
        type: "ready",
        result: {
          status: "error",
          message: "The mock picker failed before choosing titles.",
        },
      });
    }
  }

  const tasteError = tasteSelectionError(answers.seedIds.length);
  const servicesReady =
    answers.servicesSkipped || answers.serviceIds.length > 0;
  const tasteReady = tasteError == null;
  const tonightReady = isTonightComplete(answers);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-8 text-zinc-950 sm:px-6 dark:text-zinc-50">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Step {stepIndex + 1} of {FLOW_STEPS.length} · {stepLabel}
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">CineMatch</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Find something to watch in under two minutes.
      </p>

      {step === "services" ? (
        <ServicesStep
          answers={answers}
          onToggle={(id) =>
            patch({
              serviceIds: toggleId(answers.serviceIds, id),
              servicesSkipped: false,
            })
          }
          onSkip={() => {
            patch({ serviceIds: [], servicesSkipped: true });
            setStep("taste");
          }}
          onContinue={() => setStep("taste")}
          canContinue={servicesReady}
        />
      ) : null}

      {step === "taste" ? (
        <TasteStep
          answers={answers}
          error={tasteError}
          onToggleSeed={(id) =>
            patch({
              seedIds: toggleId(answers.seedIds, id),
              tasteSkipped: false,
            })
          }
          onToggleGenre={(genre) =>
            patch({
              avoidedGenres: toggleId(answers.avoidedGenres, genre),
              tasteSkipped: false,
            })
          }
          onSkip={() => {
            patch({
              seedIds: [],
              avoidedGenres: [],
              tasteSkipped: true,
            });
            setStep("tonight");
          }}
          onBack={() => setStep("services")}
          onContinue={() => setStep("tonight")}
          canContinue={tasteReady}
        />
      ) : null}

      {step === "tonight" ? (
        <TonightStep
          answers={answers}
          onChange={patch}
          onBack={() => setStep("taste")}
          onContinue={() => void showPicks()}
          canContinue={tonightReady}
        />
      ) : null}

      {step === "picks" ? (
        <PicksStep
          phase={phase}
          onBack={() => leavePicks("tonight")}
          onEdit={(target) => leavePicks(target)}
          onRetry={() => void showPicks()}
        />
      ) : null}
    </main>
  );
}

function ServicesStep({
  answers,
  onToggle,
  onSkip,
  onContinue,
  canContinue,
}: {
  answers: GuestAnswers;
  onToggle: (id: ServiceId) => void;
  onSkip: () => void;
  onContinue: () => void;
  canContinue: boolean;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold">
        Which subscriptions do you have?
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        These are subscriptions only. Renting or buying is not treated as
        included.
      </p>
      <fieldset className="mt-4 space-y-2">
        <legend className="sr-only">US streaming subscriptions</legend>
        {SERVICE_OPTIONS.map((service) => (
          <label
            key={service.id}
            className="flex min-h-11 items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
          >
            <input
              type="checkbox"
              checked={
                !answers.servicesSkipped &&
                answers.serviceIds.includes(service.id)
              }
              onChange={() => onToggle(service.id)}
            />
            {service.name}
          </label>
        ))}
      </fieldset>
      {answers.servicesSkipped ? (
        <p className="mt-3 text-sm">
          Showing every service. Rent and buy options can appear, and they are
          not free.
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          className="min-h-11 rounded-lg bg-zinc-950 px-4 text-white dark:bg-zinc-50 dark:text-zinc-950"
          onClick={onContinue}
          disabled={!canContinue}
        >
          Continue
        </button>
        <button
          type="button"
          className="min-h-11 rounded-lg border border-zinc-300 px-4 dark:border-zinc-700"
          onClick={onSkip}
        >
          Skip, show all services
        </button>
      </div>
    </section>
  );
}

function TasteStep({
  answers,
  error,
  onToggleSeed,
  onToggleGenre,
  onSkip,
  onBack,
  onContinue,
  canContinue,
}: {
  answers: GuestAnswers;
  error: string | null;
  onToggleSeed: (id: string) => void;
  onToggleGenre: (genre: AvoidableGenre) => void;
  onSkip: () => void;
  onBack: () => void;
  onContinue: () => void;
  canContinue: boolean;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold">Optional taste quiz</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Quiz seeds, not recommendations. Pick 3 to 5 favorites, or skip. You do
        not have to choose unfamiliar titles.
      </p>
      <fieldset className="mt-4 space-y-2">
        <legend className="text-sm font-medium">Quiz seeds</legend>
        {QUIZ_SEEDS.map((seed) => (
          <label
            key={seed.id}
            className="flex min-h-11 items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
          >
            <input
              type="checkbox"
              checked={answers.seedIds.includes(seed.id)}
              onChange={() => onToggleSeed(seed.id)}
            />
            <span>
              {seed.title} <span className="text-zinc-500">({seed.year})</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="mt-3 text-sm">
        {answers.seedIds.length} selected.
        {error ? ` ${error}` : null}
      </p>
      <fieldset className="mt-4 space-y-2">
        <legend className="text-sm font-medium">Genres to avoid</legend>
        {AVOIDABLE_GENRES.map((genre) => (
          <label key={genre} className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={answers.avoidedGenres.includes(genre)}
              onChange={() => onToggleGenre(genre)}
            />
            {genre}
          </label>
        ))}
      </fieldset>
      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          className="min-h-11 rounded-lg bg-zinc-950 px-4 text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950"
          onClick={onContinue}
          disabled={!canContinue}
        >
          Continue
        </button>
        <button
          type="button"
          className="min-h-11 rounded-lg border border-zinc-300 px-4 dark:border-zinc-700"
          onClick={onSkip}
        >
          Skip taste quiz
        </button>
        <button
          type="button"
          className="min-h-11 px-4 text-left"
          onClick={onBack}
        >
          Back
        </button>
      </div>
    </section>
  );
}

function PicksStep({
  phase,
  onBack,
  onEdit,
  onRetry,
}: {
  phase: Phase;
  onBack: () => void;
  onEdit: (step: FlowStep) => void;
  onRetry: () => void;
}) {
  return (
    <section className="mt-8" aria-label="Recommendations">
      <h2 className="text-xl font-semibold">Picks</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Mock catalog only. Not live availability.
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
            className="mt-4 min-h-11 rounded-lg bg-zinc-950 px-4 text-white dark:bg-zinc-50 dark:text-zinc-950"
            onClick={onRetry}
          >
            Try again
          </button>
        </div>
      ) : null}
      {phase.type === "ready" && phase.result.status === "empty" ? (
        <div className="mt-6">
          <p>{phase.result.message}</p>
          <EditRow onEdit={onEdit} />
        </div>
      ) : null}
      {phase.type === "ready" &&
      (phase.result.status === "ok" || phase.result.status === "shortage") ? (
        <div className="mt-6 space-y-4">
          {phase.result.confidence === "cold-start" ? (
            <p>
              Cold start: lower confidence because no quiz titles were chosen.
            </p>
          ) : (
            <p>Based on your quiz seeds.</p>
          )}
          {phase.result.status === "shortage" ? (
            <p>{phase.result.message}</p>
          ) : null}
          <PickCard heading="Best match" pick={phase.result.best} />
          {phase.result.alternatives.length > 0 ? (
            <div>
              <h3 className="font-medium">Alternatives</h3>
              <div className="mt-3 space-y-3">
                {phase.result.alternatives.map((pick) => (
                  <PickCard key={pick.id} pick={pick} />
                ))}
              </div>
            </div>
          ) : (
            <p>No alternatives fit.</p>
          )}
          <EditRow onEdit={onEdit} />
        </div>
      ) : null}
      <button
        type="button"
        className="mt-4 min-h-11 px-4 text-left"
        onClick={onBack}
      >
        Back
      </button>
    </section>
  );
}

function PickCard({
  heading,
  pick,
}: {
  heading?: string;
  pick: Extract<RecommendResult, { status: "ok" }>["best"];
}) {
  return (
    <article className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      {heading ? <h3 className="text-sm font-medium">{heading}</h3> : null}
      <p className={heading ? "mt-1 font-semibold" : "font-semibold"}>
        {pick.title}{" "}
        <span className="font-normal text-zinc-500">({pick.year})</span>
      </p>
      <p className="mt-1 text-sm">{pick.timeLabel}</p>
      <p className="mt-2 text-sm">{pick.reason}</p>
      <ul className="mt-2 text-sm">
        {pick.offers.map((offer) => (
          <li key={`${offer.serviceId}-${offer.access}`}>
            {offer.serviceName}: {offer.access}
          </li>
        ))}
      </ul>
    </article>
  );
}

function EditRow({ onEdit }: { onEdit: (step: FlowStep) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="min-h-11 text-left"
        onClick={() => onEdit("services")}
      >
        Edit services
      </button>
      <button
        type="button"
        className="min-h-11 text-left"
        onClick={() => onEdit("taste")}
      >
        Edit taste
      </button>
      <button
        type="button"
        className="min-h-11 text-left"
        onClick={() => onEdit("tonight")}
      >
        Edit tonight
      </button>
    </div>
  );
}
