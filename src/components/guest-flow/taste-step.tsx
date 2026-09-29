"use client";

import { QUIZ_SEEDS } from "@/lib/guest-flow/fixtures";
import {
  AVOIDABLE_GENRES,
  type AvoidableGenre,
  type GuestAnswers,
} from "@/lib/guest-flow/types";

export function TasteStep({
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
