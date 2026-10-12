"use client";

import {
  FORMATS,
  MOODS,
  MOVIE_LENGTHS,
  SERIES_LENGTHS,
  type GuestAnswers,
  type MovieLength,
  type SeriesLength,
} from "@/lib/guest-flow/types";
import { StepHeader } from "./ui";

const moodSymbols: Record<string, string> = {
  laugh: "☺",
  cry: "◡",
  thrill: "ϟ",
  think: "✳",
  comfort: "☾",
};
const moodDetails: Record<string, string> = {
  laugh: "Keep it light",
  cry: "Feel something",
  thrill: "On the edge",
  think: "Stay curious",
  comfort: "Settle in",
};

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
    <section className="flow-step" aria-labelledby="tonight-heading">
      <StepHeader
        id="tonight-heading"
        eyebrow="Set the scene"
        title="What do you want tonight?"
      >
        <p>
          A little escapism, a big feeling, or something that stays with you.
          Choose the mood and time you have.
        </p>
      </StepHeader>
      <ChoiceGroup
        legend="Mood"
        name="mood"
        options={MOODS}
        value={answers.mood}
        onChange={(mood) => onChange({ mood })}
      />
      <ChoiceGroup
        legend="Format"
        name="format"
        options={FORMATS}
        value={answers.format}
        onChange={(format) =>
          onChange({ format, movieLength: null, seriesLength: null })
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
            answers.format === "movie"
              ? onChange({ movieLength: length as MovieLength })
              : onChange({ seriesLength: length as SeriesLength })
          }
        />
      ) : (
        <p className="selection-summary">
          Choose a movie or a series to see length boundaries.
        </p>
      )}
      <div className="step-actions">
        <button
          type="button"
          className="button-primary"
          onClick={onContinue}
          disabled={!canContinue}
        >
          See picks
        </button>
        <button type="button" className="button-text" onClick={onBack}>
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
    <fieldset className={`choice-fieldset choice-${name}`}>
      <legend>{legend}</legend>
      <div className="choice-grid">
        {options.map((option) => (
          <label
            key={option.id}
            className="choice-card"
            data-selected={value === option.id}
          >
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
            />
            {name === "mood" ? (
              <span className="mood-symbol" aria-hidden="true">
                {moodSymbols[option.id]}
              </span>
            ) : null}
            <span className="choice-copy">
              <span className="choice-title">{option.label}</span>
              {option.detail || name === "mood" ? (
                <span className="choice-detail">
                  {option.detail ?? moodDetails[option.id]}
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
