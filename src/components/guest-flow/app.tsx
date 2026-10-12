"use client";

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { mockRecommend } from "@/lib/guest-flow/mock-api";
import {
  EMPTY_ANSWERS,
  FLOW_STEPS,
  tasteSelectionError,
  type FlowStep,
  type GuestAnswers,
  type MockMode,
  type RecommendResult,
} from "@/lib/guest-flow/types";
import { ServicesStep } from "@/components/guest-flow/services-step";
import { TasteStep } from "@/components/guest-flow/taste-step";
import { TonightStep } from "@/components/guest-flow/tonight-step";
import { PicksStep } from "@/components/guest-flow/picks-step";

type Phase =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "ready"; result: RecommendResult };

function mockMode(value: string | null): MockMode {
  if (
    value === "empty" ||
    value === "shortage" ||
    value === "error" ||
    value === "loading" ||
    value === "stale" ||
    value === "unavailable"
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
  const tonightReady =
    answers.mood != null &&
    answers.format != null &&
    (answers.format === "movie"
      ? answers.movieLength != null
      : answers.seriesLength != null);

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
          onFeedback={() => {
            /* Event output only; persistence is #28. */
          }}
          onShowMore={() => {
            /* Event output only; persistence is #28. */
          }}
        />
      ) : null}
    </main>
  );
}
