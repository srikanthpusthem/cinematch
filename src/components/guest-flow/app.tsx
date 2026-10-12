"use client";

import { useEffect, useRef, useState } from "react";
import { requestRecommendations } from "@/lib/live-recommendation/client";
import type { RecommendationResult } from "@/lib/live-recommendation/contract";
import {
  loadCatalogOptions,
  type CatalogOptions,
} from "@/lib/guest-flow/catalog-client";
import {
  createLiveRequest,
  deriveLiveFeedback,
  LiveHistoryLimitError,
  toPicksResult,
} from "@/lib/guest-flow/live-state";
import {
  appendEvent,
  createFeedbackEvent,
  createUndoEvent,
  emptySnapshot,
  loadGuestPersistence,
  mapPickFeedbackAction,
  saveGuestSnapshot,
  undoLatestEvent,
  type GuestPersistedSnapshot,
} from "@/lib/guest-persistence";
import {
  FLOW_STEPS,
  tasteSelectionError,
  type FlowStep,
  type GuestAnswers,
  type PickFeedbackAction,
  type RecommendResult,
} from "@/lib/guest-flow/types";
import { ServicesStep } from "./services-step";
import { TasteStep } from "./taste-step";
import { TonightStep } from "./tonight-step";
import { PicksStep } from "./picks-step";
import { FilmMark } from "./ui";

type Phase =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "ready"; result: RecommendResult };
type OptionsPhase =
  | { type: "loading" }
  | { type: "ready"; options: CatalogOptions }
  | { type: "error" };

function toggleId(current: string[], id: string): string[] {
  return current.includes(id)
    ? current.filter((item) => item !== id)
    : [...current, id];
}

export function GuestFlow() {
  const [step, setStep] = useState<FlowStep>("services");
  const [snapshot, setSnapshot] =
    useState<GuestPersistedSnapshot>(emptySnapshot);
  const snapshotRef = useRef(snapshot);
  const [hydrated, setHydrated] = useState(false);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [migrationNotice, setMigrationNotice] = useState<string | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [historyLimit, setHistoryLimit] =
    useState<LiveHistoryLimitError | null>(null);
  const [options, setOptions] = useState<OptionsPhase>({ type: "loading" });
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [phase, setPhase] = useState<Phase>({ type: "idle" });
  const [serverResult, setServerResult] = useState<RecommendationResult | null>(
    null,
  );
  const request = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const seenIds = useRef<string[]>([]);
  const mainRef = useRef<HTMLElement | null>(null);
  const focusedStep = useRef<FlowStep>("services");
  const answers = snapshot.answers;
  const feedback = deriveLiveFeedback(snapshot);
  const stepIndex = FLOW_STEPS.findIndex((item) => item.id === step);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const loaded = loadGuestPersistence();
      snapshotRef.current = loaded.snapshot;
      setSnapshot(loaded.snapshot);
      setMigrationNotice(loaded.migrationNotice);
      if (loaded.reset)
        setStorageNotice(
          "Saved preferences could not be read and were reset. You can continue with new choices.",
        );
      else if (!loaded.status.ok)
        setStorageNotice(
          "Changes work in this tab, but could not be saved on this device.",
        );
      setHydrated(true);
    });
    return () => {
      active = false;
      request.current += 1;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadCatalogOptions({ signal: controller.signal })
      .then((loaded) => {
        if (!controller.signal.aborted)
          setOptions({ type: "ready", options: loaded });
      })
      .catch(() => {
        if (!controller.signal.aborted) setOptions({ type: "error" });
      });
    return () => controller.abort();
  }, [optionsRetry]);

  useEffect(() => {
    if (!hydrated) return;
    const heading = mainRef.current?.querySelector<HTMLElement>("section h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      if (focusedStep.current !== step) {
        heading
          .closest(".flow-step")
          ?.scrollIntoView({ block: "start", behavior: "auto" });
      }
      focusedStep.current = step;
    }
  }, [step, hydrated]);

  function store(next: GuestPersistedSnapshot) {
    snapshotRef.current = next;
    setSnapshot(next);
    const saved = saveGuestSnapshot(next);
    if (!saved.status.ok)
      setStorageNotice(
        "Changes work in this tab, but could not be saved on this device.",
      );
    else setStorageNotice(null);
    if (saved.migrationNotice) setMigrationNotice(saved.migrationNotice);
  }

  function patch(partial: Partial<GuestAnswers>) {
    const current = snapshotRef.current;
    store({ ...current, answers: { ...current.answers, ...partial } });
    seenIds.current = [];
  }

  function leavePicks(target: FlowStep) {
    request.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setStep(target);
  }

  async function showPicks(exclusions: string[] = seenIds.current) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const id = ++request.current;
    setStep("picks");
    setPhase({ type: "loading" });
    setServerResult(null);
    setHistoryLimit(null);
    try {
      const current = snapshotRef.current;
      const input = createLiveRequest(current.answers, current, exclusions);
      const result = await requestRecommendations(input, {
        signal: controller.signal,
      });
      if (request.current !== id || controller.signal.aborted) return;
      setServerResult(result.status === "error" ? null : result);
      setPhase({ type: "ready", result: toPicksResult(result) });
    } catch (error) {
      if (request.current !== id || controller.signal.aborted) return;
      if (error instanceof LiveHistoryLimitError) setHistoryLimit(error);
      setPhase({
        type: "ready",
        result: {
          status: "error",
          message:
            error instanceof Error && error.message
              ? error.message
              : "Recommendations are unavailable. Try again or edit your choices.",
        },
      });
    }
  }

  function recordPickFeedback(pickId: string, action: PickFeedbackAction) {
    const current = snapshotRef.current;
    const active = deriveLiveFeedback(current);
    if (
      (action === "watched" && active.suppressedContentIds.includes(pickId)) ||
      (action === "like" && active.likedContentIds.includes(pickId)) ||
      (action === "not-for-me" && active.dislikedContentIds.includes(pickId))
    )
      return;
    const kind = mapPickFeedbackAction(action);
    const event = createFeedbackEvent(
      kind,
      pickId,
      `${kind}:${pickId}:${crypto.randomUUID()}`,
    );
    store(appendEvent(current, event).snapshot);
    setFeedbackNotice(
      action === "watched"
        ? "Marked watched. This title will be excluded from future picks; it was not marked liked."
        : action === "like"
          ? "Liked. Future picks will use this preference."
          : "Marked not for me. This title will be excluded from future picks.",
    );
  }

  function undoFeedback() {
    const undone = undoLatestEvent(snapshotRef.current);
    if (!undone.applied) return;
    store(undone.snapshot);
    setFeedbackNotice(
      "Latest feedback undone. The change will apply to your next picks.",
    );
  }

  function undoSelectedFeedback(eventId: string) {
    const current = snapshotRef.current;
    store(appendEvent(current, createUndoEvent(eventId)).snapshot);
    setFeedbackNotice(
      "Selected feedback undone. Your other saved feedback was kept. Try finding picks again.",
    );
  }

  function showMore() {
    if (!serverResult || serverResult.exhaustion.exhausted) return;
    const next = [
      ...new Set([
        ...seenIds.current,
        ...serverResult.picks.map((pick) => pick.id),
      ]),
    ];
    seenIds.current = next;
    void showPicks(next);
  }

  const knownServices =
    options.type === "ready"
      ? options.options.providers.filter((provider) =>
          provider.monetizations.includes("flatrate"),
        )
      : [];
  const services = [
    ...knownServices,
    ...answers.serviceIds
      .filter((id) => !knownServices.some((service) => service.id === id))
      .map((id) => ({
        id,
        name: `Saved subscription not listed (catalog ${id})`,
      })),
  ];
  const genres = options.type === "ready" ? options.options.genres : [];
  const tasteError = tasteSelectionError(answers.seedIds.length);
  const servicesReady =
    hydrated && (answers.servicesSkipped || answers.serviceIds.length > 0);
  const tonightReady =
    answers.mood !== null &&
    answers.format !== null &&
    (answers.format === "movie"
      ? answers.movieLength !== null
      : answers.seriesLength !== null);

  return (
    <main
      ref={mainRef}
      id="main-content"
      tabIndex={-1}
      className="cinema-shell"
    >
      <header className="site-header">
        <div className="brand-lockup">
          <FilmMark className="brand-mark" />
          <h1 translate="no">CineMatch</h1>
        </div>
        <span className="header-note">
          <span aria-hidden="true" className="status-dot" />
          Your next good watch
        </span>
      </header>
      <div className="cinema-layout">
        <aside className="cinema-intro" aria-label="About CineMatch">
          <p className="eyebrow">Make a night of it</p>
          <p className="hero-title">
            Less scrolling.
            <br />
            <em>More watching.</em>
          </p>
          <p className="hero-description">
            Find something to watch in under two minutes.
          </p>
          <div className="cinema-art" aria-hidden="true">
            <div className="art-orbit art-orbit-one" />
            <div className="art-orbit art-orbit-two" />
            <div className="art-orbit art-orbit-three" />
            <div className="cinema-ticket">
              <FilmMark />
              <span>Settle in.</span>
              <span className="ticket-detail">A story for tonight</span>
              <div className="ticket-perforation" />
              <span className="ticket-stamp">CM / YOUR EVENING</span>
            </div>
            <svg
              className="art-star"
              width="48"
              height="48"
              viewBox="0 0 48 48"
              fill="none"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M24 4v40M4 24h40M10 10l28 28M10 38l28-28"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <p className="privacy-note">
            Private US catalog · metadata-based matching · no account needed
          </p>
        </aside>
        <div className="flow-workspace">
          <ol className="flow-progress" aria-label="Recommendation progress">
            {FLOW_STEPS.map((item, index) => (
              <li
                key={item.id}
                aria-current={step === item.id ? "step" : undefined}
                data-state={
                  index < stepIndex
                    ? "complete"
                    : index === stepIndex
                      ? "current"
                      : "upcoming"
                }
              >
                <span className="progress-number" aria-hidden="true">
                  {index < stepIndex ? "✓" : `0${index + 1}`}
                </span>
                <span>{item.label}</span>
              </li>
            ))}
          </ol>
          <p className="step-count" aria-live="polite">
            Step {stepIndex + 1} of {FLOW_STEPS.length} ·{" "}
            {FLOW_STEPS[stepIndex]?.label}
          </p>
          <div className="flow-panel">
            {migrationNotice ? (
              <p className="flow-notice" role="status">
                {migrationNotice}
              </p>
            ) : null}
            {storageNotice ? (
              <p className="flow-notice" role="status">
                {storageNotice}
              </p>
            ) : null}
            {feedbackNotice ? (
              <p className="flow-notice" role="status">
                {feedbackNotice}
              </p>
            ) : null}
            {feedback.latestApplicableEventId ? (
              <button
                type="button"
                className="button-text"
                onClick={undoFeedback}
              >
                Undo latest feedback
              </button>
            ) : null}
            {!hydrated ? (
              <p className="flow-notice loading-notice" role="status">
                Loading saved preferences…
              </p>
            ) : (
              <>
                {(step === "services" || step === "taste") &&
                options.type === "loading" ? (
                  <p className="flow-notice loading-notice" role="status">
                    Loading catalog services and genres…
                  </p>
                ) : null}
                {(step === "services" || step === "taste") &&
                options.type === "error" ? (
                  <div className="flow-notice notice-error">
                    <p role="alert">
                      Catalog options are unavailable. Retry, or skip services
                      and taste to try all catalog titles.
                    </p>
                    <button
                      type="button"
                      className="button-text"
                      onClick={() => {
                        setOptions({ type: "loading" });
                        setOptionsRetry((value) => value + 1);
                      }}
                    >
                      Retry catalog options
                    </button>
                  </div>
                ) : null}
                {step === "services" ? (
                  <>
                    <ServicesStep
                      answers={answers}
                      services={services}
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
                    {options.type === "ready" && services.length === 0 ? (
                      <p className="flow-notice" role="status">
                        No subscription providers are available in the catalog
                        yet. Skip to search all services.
                      </p>
                    ) : null}
                  </>
                ) : null}
                {step === "taste" ? (
                  <TasteStep
                    answers={answers}
                    genres={genres}
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
                    canContinue={tasteError === null}
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
                    source="catalog"
                    selectedServiceIds={
                      answers.servicesSkipped ? [] : answers.serviceIds
                    }
                    phase={phase}
                    onBack={() => leavePicks("tonight")}
                    onEdit={leavePicks}
                    onRetry={() => void showPicks()}
                    onFeedback={recordPickFeedback}
                    onShowMore={showMore}
                    canShowMore={
                      serverResult !== null &&
                      !serverResult.exhaustion.exhausted
                    }
                    feedback={feedback}
                  />
                ) : null}
                {historyLimit?.recovery === "restart-search" ? (
                  <button
                    type="button"
                    className="button-secondary mt-4"
                    onClick={() => {
                      seenIds.current = [];
                      void showPicks([]);
                    }}
                  >
                    Restart this search (keep saved feedback)
                  </button>
                ) : null}
                {historyLimit?.recovery === "undo-feedback" ? (
                  <details open className="feedback-review">
                    <summary className="min-h-11 cursor-pointer">
                      Review saved {historyLimit.feedbackKind} feedback
                    </summary>
                    <p className="text-sm">
                      Undo only entries you choose. Catalog IDs identify saved
                      titles; no history is cleared automatically.
                    </p>
                    <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                      {snapshot.events
                        .filter(
                          (event) =>
                            event.kind === historyLimit.feedbackKind &&
                            feedback.appliedEventIds.includes(event.id),
                        )
                        .map((event) =>
                          event.kind !== "undo" ? (
                            <li
                              key={event.id}
                              className="flex items-center justify-between gap-2"
                            >
                              <span>
                                {event.kind} · catalog {event.contentId}
                              </span>
                              <button
                                type="button"
                                className="button-text"
                                onClick={() => undoSelectedFeedback(event.id)}
                              >
                                Undo {event.kind} for catalog {event.contentId}
                              </button>
                            </li>
                          ) : null,
                        )}
                    </ul>
                  </details>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
