"use client";

import { useId, useMemo, useState } from "react";
import { QUIZ_SEEDS } from "@/lib/guest-flow/fixtures";
import {
  AVOIDABLE_GENRES,
  type AvoidableGenre,
  type GuestAnswers,
  type SeedTitle,
} from "@/lib/guest-flow/types";

export type TasteCatalogStatus = "ready" | "loading" | "empty" | "error";

export type TasteStepProps = {
  answers: GuestAnswers;
  error: string | null;
  onToggleSeed: (id: string) => void;
  onToggleGenre: (genre: AvoidableGenre) => void;
  onSkip: () => void;
  onBack: () => void;
  onContinue: () => void;
  canContinue: boolean;
  /** Fixture seeds; defaults to QUIZ_SEEDS. No network. */
  seeds?: SeedTitle[];
  /** Catalog display state for loading / empty catalog / error paths. */
  catalogStatus?: TasteCatalogStatus;
  catalogErrorMessage?: string;
};

/** Case-insensitive title/year filter over fixture quiz seeds. */
export function filterQuizSeeds(
  seeds: SeedTitle[],
  query: string,
): SeedTitle[] {
  const q = query.trim().toLowerCase();
  if (!q) return seeds;
  return seeds.filter(
    (seed) =>
      seed.title.toLowerCase().includes(q) || String(seed.year).includes(q),
  );
}

function SeedPoster({ seed }: { seed: SeedTitle }) {
  const [failed, setFailed] = useState(false);
  const posterUrl = seed.posterUrl;

  if (posterUrl == null || failed) {
    return (
      <span
        className="flex aspect-[2/3] w-12 shrink-0 items-center justify-center rounded bg-zinc-200 text-center text-[10px] leading-tight text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
        aria-hidden="true"
        data-testid={`poster-fallback-${seed.id}`}
      >
        No poster
      </span>
    );
  }

  return (
    // Fixture data URIs / static paths only — no remote catalog fetch.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={posterUrl}
      alt=""
      width={48}
      height={72}
      className="aspect-[2/3] w-12 shrink-0 rounded object-cover"
      data-testid={`poster-image-${seed.id}`}
      onError={() => setFailed(true)}
    />
  );
}

export function TasteStep({
  answers,
  error,
  onToggleSeed,
  onToggleGenre,
  onSkip,
  onBack,
  onContinue,
  canContinue,
  seeds = QUIZ_SEEDS,
  catalogStatus = "ready",
  catalogErrorMessage = "Quiz titles could not be loaded. Skip for a cold start, or try again later.",
}: TasteStepProps) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterQuizSeeds(seeds, query), [seeds, query]);
  const selectedCount = answers.seedIds.length;
  const searchEmpty =
    catalogStatus === "ready" && filtered.length === 0 && query.trim() !== "";

  return (
    <section className="mt-8 min-w-0" aria-labelledby="taste-heading">
      <h2 id="taste-heading" className="text-xl font-semibold text-pretty">
        Optional taste quiz
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Quiz seeds, not recommendations. Pick 3 to 5 favorites you already know,
        or skip for a cold start. You do not have to choose unfamiliar titles.
      </p>

      <div className="mt-4 min-w-0">
        <label htmlFor={searchId} className="text-sm font-medium">
          Search taste seeds
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by title or year"
          autoComplete="off"
          className="mt-2 min-h-11 w-full min-w-0 touch-manipulation rounded-lg border border-zinc-300 bg-transparent px-3 focus:outline-none focus:ring-2 focus:ring-zinc-950 dark:border-zinc-700 dark:focus:ring-zinc-50"
          disabled={catalogStatus === "loading" || catalogStatus === "error"}
        />
      </div>

      {catalogStatus === "loading" ? (
        <p className="mt-4 text-sm" role="status" aria-live="polite">
          Loading taste seeds…
        </p>
      ) : null}

      {catalogStatus === "error" ? (
        <p className="mt-4 text-sm" role="alert">
          {catalogErrorMessage}
        </p>
      ) : null}

      {catalogStatus === "empty" ? (
        <p className="mt-4 text-sm" role="status">
          No taste seeds are available right now. Skip for a cold start.
        </p>
      ) : null}

      {catalogStatus === "ready" ? (
        <fieldset className="mt-4 min-w-0">
          <legend className="text-sm font-medium">Taste seed titles</legend>
          {searchEmpty ? (
            <p className="mt-3 text-sm" role="status">
              No taste seeds match “{query.trim()}”. Try another search, or skip
              for a cold start.
            </p>
          ) : (
            <ul className="mt-3 grid grid-cols-2 gap-3">
              {filtered.map((seed) => {
                const selected = answers.seedIds.includes(seed.id);
                const stateId = `seed-${seed.id}-state`;
                return (
                  <li key={seed.id} className="min-w-0">
                    <label
                      className={[
                        "flex min-h-11 cursor-pointer touch-manipulation items-start gap-2 rounded-lg border-2 px-2 py-2",
                        "focus-within:ring-2 focus-within:ring-zinc-950 focus-within:ring-offset-2",
                        "dark:focus-within:ring-zinc-50 dark:focus-within:ring-offset-zinc-950",
                        selected
                          ? "border-zinc-950 bg-zinc-100 font-medium dark:border-zinc-50 dark:bg-zinc-900"
                          : "border-zinc-300 font-normal dark:border-zinc-700",
                      ].join(" ")}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0"
                        name="taste-seeds"
                        value={seed.id}
                        checked={selected}
                        onChange={() => onToggleSeed(seed.id)}
                        aria-describedby={stateId}
                      />
                      <SeedPoster seed={seed} />
                      <span className="min-w-0 flex-1 break-words">
                        <span className="block text-sm leading-snug">
                          {seed.title}{" "}
                          <span className="font-normal text-zinc-500">
                            ({seed.year})
                          </span>
                        </span>
                        <span className="mt-0.5 block text-xs font-normal text-zinc-600 dark:text-zinc-400">
                          Taste seed
                        </span>
                        <span
                          id={stateId}
                          className="mt-0.5 block text-xs font-normal text-zinc-600 dark:text-zinc-400"
                        >
                          {selected ? "Selected · taste seed" : "Not selected"}
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
          )}
        </fieldset>
      ) : null}

      <p className="mt-3 text-sm" role="status">
        {answers.tasteSkipped
          ? "Taste quiz skipped · cold start with zero seeds."
          : selectedCount === 0
            ? "0 selected. Continue with zero seeds, or skip. You do not have to pick unfamiliar titles."
            : selectedCount >= 3 && selectedCount <= 5
              ? `${selectedCount} selected. Ready to continue with these taste seeds.`
              : `${selectedCount} selected.`}
      </p>
      {error && !answers.tasteSkipped ? (
        <p className="mt-1 text-sm text-red-700 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <fieldset className="mt-4 min-w-0">
        <legend className="text-sm font-medium">Genres to avoid</legend>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          Optional. Change these anytime before picks.
        </p>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {AVOIDABLE_GENRES.map((genre) => {
            const selected = answers.avoidedGenres.includes(genre);
            return (
              <li key={genre} className="min-w-0">
                <label
                  className={[
                    "flex min-h-11 cursor-pointer touch-manipulation items-center gap-2 rounded-lg border px-3 py-2",
                    "focus-within:ring-2 focus-within:ring-zinc-950 focus-within:ring-offset-2",
                    "dark:focus-within:ring-zinc-50 dark:focus-within:ring-offset-zinc-950",
                    selected
                      ? "border-zinc-950 bg-zinc-100 dark:border-zinc-50 dark:bg-zinc-900"
                      : "border-zinc-300 dark:border-zinc-700",
                  ].join(" ")}
                >
                  <input
                    type="checkbox"
                    className="size-4 shrink-0"
                    name="avoided-genres"
                    value={genre}
                    checked={selected}
                    onChange={() => onToggleGenre(genre)}
                  />
                  <span className="min-w-0 break-words text-sm">{genre}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

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
          Skip taste quiz
        </button>
        <button
          type="button"
          className="min-h-11 touch-manipulation px-4 text-left"
          onClick={onBack}
        >
          Back
        </button>
      </div>
    </section>
  );
}
