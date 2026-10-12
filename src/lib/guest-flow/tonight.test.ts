import { describe, expect, it } from "vitest";
import {
  MOVIE_EPIC_MIN_MINUTES,
  MOVIE_SHORT_MAX_MINUTES,
  SERIES_LONG_RUNNING_MIN_SEASONS,
  SERIES_ONE_SEASON_COUNT,
  SERIES_SHORT_EPISODE_MAX_MINUTES,
} from "@/lib/recommendation-length";
import {
  EMPTY_ANSWERS,
  MOODS,
  MOVIE_LENGTHS,
  SERIES_LENGTHS,
  type GuestAnswers,
} from "./types";
import {
  isTonightComplete,
  tonightChange,
  type TonightChange,
} from "./tonight";

const filled: GuestAnswers = {
  ...EMPTY_ANSWERS,
  serviceIds: ["netflix", "hulu"],
  servicesSkipped: false,
  seedIds: ["seed-budapest", "seed-parks", "seed-booksmart"],
  avoidedGenres: ["Horror"],
  tasteSkipped: false,
  mood: "think",
  format: "movie",
  movieLength: "epic",
  seriesLength: null,
};

function apply(answers: GuestAnswers, change: TonightChange): GuestAnswers {
  return { ...answers, ...tonightChange(answers, change) };
}

describe("tonight moods and length copy", () => {
  it("exposes exactly five moods", () => {
    expect(MOODS.map((mood) => mood.id)).toEqual([
      "laugh",
      "cry",
      "thrill",
      "think",
      "comfort",
    ]);
  });

  it("describes lengths with the shared canonical boundaries", () => {
    expect(MOVIE_LENGTHS.map((option) => option.detail)).toEqual([
      `${MOVIE_SHORT_MAX_MINUTES} minutes or less`,
      "No runtime limit",
      `${MOVIE_EPIC_MIN_MINUTES} minutes or more`,
    ]);
    expect(SERIES_LENGTHS.map((option) => option.detail)).toEqual([
      `Episodes of ${SERIES_SHORT_EPISODE_MAX_MINUTES} minutes or less`,
      "Exactly one season",
      `${SERIES_LONG_RUNNING_MIN_SEASONS} or more seasons`,
    ]);
    expect(SERIES_ONE_SEASON_COUNT).toBe(1);
  });
});

describe("tonightChange", () => {
  it("changes mood without touching format, length, or earlier answers", () => {
    const next = apply(filled, { kind: "mood", mood: "laugh" });
    expect(next.mood).toBe("laugh");
    expect(next.format).toBe("movie");
    expect(next.movieLength).toBe("epic");
    expect(next.serviceIds).toEqual(["netflix", "hulu"]);
    expect(next.seedIds).toEqual([
      "seed-budapest",
      "seed-parks",
      "seed-booksmart",
    ]);
    expect(next.avoidedGenres).toEqual(["Horror"]);
  });

  it("discards both length fields when the format changes", () => {
    const next = apply(filled, { kind: "format", format: "series" });
    expect(next.format).toBe("series");
    expect(next.movieLength).toBeNull();
    expect(next.seriesLength).toBeNull();
    expect(next.mood).toBe("think");
    expect(next.serviceIds).toEqual(filled.serviceIds);
    expect(next.seedIds).toEqual(filled.seedIds);
    expect(isTonightComplete(next)).toBe(false);
  });

  it("keeps the current length when the same format is chosen again", () => {
    expect(tonightChange(filled, { kind: "format", format: "movie" })).toEqual(
      {},
    );
    expect(isTonightComplete(filled)).toBe(true);
  });

  it("ignores a length that does not match the current format", () => {
    const series = apply(filled, { kind: "format", format: "series" });
    expect(
      tonightChange(series, { kind: "movie-length", movieLength: "under-100" }),
    ).toEqual({});
    const withSeriesLength = apply(series, {
      kind: "series-length",
      seriesLength: "long-running",
    });
    expect(withSeriesLength.seriesLength).toBe("long-running");
    expect(withSeriesLength.movieLength).toBeNull();
    expect(isTonightComplete(withSeriesLength)).toBe(true);
    expect(
      tonightChange(withSeriesLength, {
        kind: "series-length",
        seriesLength: "one-season",
      }).seriesLength,
    ).toBe("one-season");
  });

  it("is incomplete until mood, format, and a matching length are set", () => {
    expect(isTonightComplete(EMPTY_ANSWERS)).toBe(false);
    expect(isTonightComplete({ ...EMPTY_ANSWERS, mood: "cry" })).toBe(false);
    expect(
      isTonightComplete({
        ...EMPTY_ANSWERS,
        mood: "cry",
        format: "movie",
      }),
    ).toBe(false);
    expect(
      isTonightComplete({
        ...EMPTY_ANSWERS,
        mood: "cry",
        format: "movie",
        movieLength: "any",
      }),
    ).toBe(true);
  });
});
