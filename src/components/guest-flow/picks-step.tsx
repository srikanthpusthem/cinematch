"use client";

import { type FlowStep, type RecommendResult } from "@/lib/guest-flow/types";

type Phase =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "ready"; result: RecommendResult };

export function PicksStep({
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
