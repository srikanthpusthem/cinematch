"use client";

import { tonightChange } from "@/lib/guest-flow/tonight";
import {
  FORMATS,
  MOODS,
  MOVIE_LENGTHS,
  SERIES_LENGTHS,
  type GuestAnswers,
  type MovieLength,
  type SeriesLength,
} from "@/lib/guest-flow/types";

export function TonightStep({
  answers,
  onChange,
  onBack,
  onContinue,
  canContinue,
}: {
  answers: GuestAnswers;
  onChange: (partial: Partial<GuestAnswers>) => void;
  onBack: () => void;
  onContinue: () => void;
  canContinue: boolean;
}) {
  const lengths = answers.format === "series" ? SERIES_LENGTHS : MOVIE_LENGTHS;

  return (
    <section className="mt-8" aria-label="Tonight">
      <h2 className="text-xl font-semibold">What do you want tonight?</h2>
      <ChoiceGroup
        legend="Mood"
        name="mood"
        options={MOODS}
        value={answers.mood}
        onChange={(mood) =>
          onChange(tonightChange(answers, { kind: "mood", mood }))
        }
      />
      <ChoiceGroup
        legend="Format"
        name="format"
        options={FORMATS}
        value={answers.format}
        onChange={(format) =>
          onChange(tonightChange(answers, { kind: "format", format }))
        }
      />
      {answers.format ? (
        <ChoiceGroup
          legend={answers.format === "movie" ? "Movie length" : "Series length"}
          name="length"
          options={lengths}
          value={
            answers.format === "movie"
              ? answers.movieLength
              : answers.seriesLength
          }
          onChange={(length) =>
            onChange(
              answers.format === "movie"
                ? tonightChange(answers, {
                    kind: "movie-length",
                    movieLength: length as MovieLength,
                  })
                : tonightChange(answers, {
                    kind: "series-length",
                    seriesLength: length as SeriesLength,
                  }),
            )
          }
        />
      ) : (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          Choose a movie or a series to see length boundaries.
        </p>
      )}
      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          className="min-h-11 rounded-lg bg-zinc-950 px-4 text-white focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950"
          onClick={onContinue}
          disabled={!canContinue}
        >
          See picks
        </button>
        <button
          type="button"
          className="min-h-11 px-4 text-left focus-visible:ring-2 focus-visible:outline-none"
          onClick={onBack}
        >
          Back
        </button>
      </div>
    </section>
  );
}

function ChoiceGroup<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: readonly { id: T; label: string; detail?: string }[];
  value: T | null;
  onChange: (id: T) => void;
}) {
  return (
    <fieldset className="mt-4 space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.id}
          className="flex min-h-11 items-start gap-3 rounded-lg border border-zinc-200 px-3 py-2 focus-within:ring-2 focus-within:ring-zinc-950 dark:border-zinc-800 dark:focus-within:ring-zinc-50"
        >
          <input
            className="mt-1 size-4 shrink-0"
            type="radio"
            name={name}
            checked={value === option.id}
            onChange={() => onChange(option.id)}
          />
          <span>
            {option.label}
            {option.detail ? (
              <span className="block text-sm text-zinc-500">
                {option.detail}
              </span>
            ) : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
