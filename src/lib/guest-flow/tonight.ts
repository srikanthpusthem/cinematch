import type {
  GuestAnswers,
  Mood,
  MovieLength,
  SeriesLength,
  WatchFormat,
} from "./types";

export type TonightChange =
  | { kind: "mood"; mood: Mood }
  | { kind: "format"; format: WatchFormat }
  | { kind: "movie-length"; movieLength: MovieLength }
  | { kind: "series-length"; seriesLength: SeriesLength };

export function isTonightComplete(answers: GuestAnswers): boolean {
  if (answers.mood == null || answers.format == null) return false;
  return answers.format === "movie"
    ? answers.movieLength != null
    : answers.seriesLength != null;
}

/** Partial merged by the shell. Format changes drop both length fields. */
export function tonightChange(
  answers: GuestAnswers,
  change: TonightChange,
): Partial<GuestAnswers> {
  switch (change.kind) {
    case "mood":
      return { mood: change.mood };
    case "format":
      if (change.format === answers.format) return {};
      return {
        format: change.format,
        movieLength: null,
        seriesLength: null,
      };
    case "movie-length":
      if (answers.format !== "movie") return {};
      return { movieLength: change.movieLength };
    case "series-length":
      if (answers.format !== "series") return {};
      return { seriesLength: change.seriesLength };
  }
}
