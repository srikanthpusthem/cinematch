export const EVALUATION_CORPUS_VERSION = "1.0.0";

export type Format = "movie" | "series";
export type ServiceId =
  "apple" | "disney" | "hulu" | "max" | "netflix" | "prime";
export type Mood = "comfort" | "cry" | "laugh" | "think" | "thrill";
export type MovieLength = "any" | "epic" | "under-100";
export type SeriesLength =
  "any" | "long-running" | "one-season" | "short-episodes";
export type ConstraintReason =
  | "excluded-genre"
  | "format"
  | "movie-length"
  | "series-length"
  | "service"
  | "watched";

export interface EvaluationTitle {
  id: string;
  title: string;
  format: Format;
  genres: readonly string[];
  services: readonly ServiceId[];
  overview: string;
  availabilityCheckedAt: string;
  runtimeMinutes?: number;
  episodeRuntimeMinutes?: number;
  seasons?: number;
}

export interface EvaluationInputs {
  seedTitleIds: readonly string[];
  candidateTitleIds: readonly string[];
  mood: Mood;
  format: Format | "any";
  serviceIds: readonly ServiceId[];
  excludedGenres: readonly string[];
  watchedTitleIds: readonly string[];
  movieLength?: MovieLength;
  seriesLength?: SeriesLength;
}

export interface ExpectedIneligibleTitle {
  titleId: string;
  reasons: readonly ConstraintReason[];
}

export interface EvaluationCase {
  id: string;
  description: string;
  tags: readonly string[];
  inputs: EvaluationInputs;
  expected: {
    eligibleTitleIds: readonly string[];
    ineligibleTitles: readonly ExpectedIneligibleTitle[];
    intentionalShortage: boolean;
  };
  humanReviewPrompts: readonly string[];
}

export interface EvaluationCorpus {
  version: string;
  fixtureVersion: string;
  titles: readonly EvaluationTitle[];
  cases: readonly EvaluationCase[];
}

const CHECKED_AT = "2026-09-01T00:00:00.000Z";

export const evaluationTitles: readonly EvaluationTitle[] = [
  {
    id: "m-city-laughs",
    title: "City Laughs",
    format: "movie",
    genres: ["comedy"],
    services: ["netflix"],
    overview: "Roommates turn a neighborhood contest into a comic rivalry.",
    availabilityCheckedAt: CHECKED_AT,
    runtimeMinutes: 95,
  },
  {
    id: "m-orbit-signal",
    title: "Orbit Signal",
    format: "movie",
    genres: ["science-fiction", "drama"],
    services: ["netflix", "prime"],
    overview: "A patient engineer deciphers a signal from a failing station.",
    availabilityCheckedAt: CHECKED_AT,
    runtimeMinutes: 142,
  },
  {
    id: "m-quiet-harbor",
    title: "Quiet Harbor",
    format: "movie",
    genres: ["drama"],
    services: ["hulu"],
    overview: "Estranged siblings reunite to restore their family ferry.",
    availabilityCheckedAt: CHECKED_AT,
    runtimeMinutes: 108,
  },
  {
    id: "m-midnight-clue",
    title: "Midnight Clue",
    format: "movie",
    genres: ["mystery", "thriller"],
    services: ["max"],
    overview: "A radio host follows a coded message through a sleeping city.",
    availabilityCheckedAt: CHECKED_AT,
    runtimeMinutes: 98,
  },
  {
    id: "m-sunny-trail",
    title: "Sunny Trail",
    format: "movie",
    genres: ["adventure", "family"],
    services: ["disney"],
    overview: "Two cousins guide a lost rescue dog home through the mountains.",
    availabilityCheckedAt: CHECKED_AT,
    runtimeMinutes: 88,
  },
  {
    id: "m-glass-room",
    title: "The Glass Room",
    format: "movie",
    genres: ["horror"],
    services: ["hulu"],
    overview:
      "An architect discovers that her newest house remembers its owners.",
    availabilityCheckedAt: CHECKED_AT,
    runtimeMinutes: 104,
  },
  {
    id: "m-archive-mind",
    title: "Archive of the Mind",
    format: "movie",
    genres: ["documentary", "science"],
    services: ["prime"],
    overview:
      "Researchers explain how memory changes each time it is recalled.",
    availabilityCheckedAt: CHECKED_AT,
    runtimeMinutes: 82,
  },
  {
    id: "m-ember-song",
    title: "Ember Song",
    format: "movie",
    genres: ["music", "romance"],
    services: ["netflix"],
    overview: "Former bandmates reunite for one final hometown performance.",
    availabilityCheckedAt: CHECKED_AT,
    runtimeMinutes: 116,
  },
  {
    id: "s-corner-cafe",
    title: "Corner Cafe",
    format: "series",
    genres: ["comedy"],
    services: ["netflix"],
    overview: "A small cafe crew solves everyday problems with bad ideas.",
    availabilityCheckedAt: CHECKED_AT,
    episodeRuntimeMinutes: 25,
    seasons: 3,
  },
  {
    id: "s-deep-station",
    title: "Deep Station",
    format: "series",
    genres: ["science-fiction", "thriller"],
    services: ["apple"],
    overview: "An ocean-floor research team receives impossible transmissions.",
    availabilityCheckedAt: CHECKED_AT,
    episodeRuntimeMinutes: 52,
    seasons: 2,
  },
  {
    id: "s-gentle-garden",
    title: "The Gentle Garden",
    format: "series",
    genres: ["comfort", "family"],
    services: ["disney"],
    overview:
      "Neighbors revive a community garden one quiet weekend at a time.",
    availabilityCheckedAt: CHECKED_AT,
    episodeRuntimeMinutes: 28,
    seasons: 1,
  },
  {
    id: "s-case-files",
    title: "Northbridge Case Files",
    format: "series",
    genres: ["crime", "mystery"],
    services: ["max"],
    overview: "A patient detective revisits the town's long-unsolved cases.",
    availabilityCheckedAt: CHECKED_AT,
    episodeRuntimeMinutes: 45,
    seasons: 6,
  },
  {
    id: "s-long-road",
    title: "The Long Road West",
    format: "series",
    genres: ["drama", "western"],
    services: ["prime"],
    overview: "Three families build a new life along a changing frontier.",
    availabilityCheckedAt: CHECKED_AT,
    episodeRuntimeMinutes: 60,
    seasons: 5,
  },
  {
    id: "s-night-tales",
    title: "Night Tales",
    format: "series",
    genres: ["horror"],
    services: ["hulu"],
    overview: "Each story uncovers a different secret after midnight.",
    availabilityCheckedAt: CHECKED_AT,
    episodeRuntimeMinutes: 35,
    seasons: 1,
  },
  {
    id: "s-bright-lab",
    title: "The Bright Lab",
    format: "series",
    genres: ["documentary", "science"],
    services: ["netflix"],
    overview: "Working scientists demonstrate experiments with everyday tools.",
    availabilityCheckedAt: CHECKED_AT,
    episodeRuntimeMinutes: 30,
    seasons: 2,
  },
  {
    id: "s-heart-strings",
    title: "Heart Strings",
    format: "series",
    genres: ["drama", "romance"],
    services: ["apple"],
    overview:
      "An orchestra balances artistic ambition and complicated romance.",
    availabilityCheckedAt: CHECKED_AT,
    episodeRuntimeMinutes: 42,
    seasons: 4,
  },
];

const HUMAN_REVIEW_PROMPTS = [
  "Are the strongest picks relevant to the stated mood and seed taste?",
  "Do the picks avoid needless similarity while remaining relevant?",
  "Does every explanation use only fixture metadata and stated inputs?",
] as const;

function evaluationCase(
  id: string,
  description: string,
  tags: readonly string[],
  inputs: EvaluationInputs,
  eligibleTitleIds: readonly string[],
  ineligibleTitles: readonly ExpectedIneligibleTitle[],
  intentionalShortage = false,
): EvaluationCase {
  return {
    id,
    description,
    tags,
    inputs,
    expected: { eligibleTitleIds, ineligibleTitles, intentionalShortage },
    humanReviewPrompts: HUMAN_REVIEW_PROMPTS,
  };
}

const baseInputs = {
  seedTitleIds: [],
  serviceIds: [],
  excludedGenres: [],
  watchedTitleIds: [],
} as const;

export const evaluationCases: readonly EvaluationCase[] = [
  evaluationCase(
    "cold-movies",
    "Zero-seed movie cold start.",
    ["cold-start", "movie"],
    {
      ...baseInputs,
      candidateTitleIds: [
        "m-city-laughs",
        "m-orbit-signal",
        "m-quiet-harbor",
        "m-midnight-clue",
      ],
      mood: "think",
      format: "movie",
      movieLength: "any",
    },
    ["m-city-laughs", "m-orbit-signal", "m-quiet-harbor", "m-midnight-clue"],
    [],
  ),
  evaluationCase(
    "cold-series",
    "Zero-seed series cold start.",
    ["cold-start", "series"],
    {
      ...baseInputs,
      candidateTitleIds: [
        "s-corner-cafe",
        "s-deep-station",
        "s-gentle-garden",
        "s-case-files",
      ],
      mood: "comfort",
      format: "series",
      seriesLength: "any",
    },
    ["s-corner-cafe", "s-deep-station", "s-gentle-garden", "s-case-files"],
    [],
  ),
  evaluationCase(
    "cold-mixed",
    "Zero-seed mixed-format cold start.",
    ["cold-start", "mixed-format"],
    {
      ...baseInputs,
      candidateTitleIds: [
        "m-city-laughs",
        "m-orbit-signal",
        "s-corner-cafe",
        "s-deep-station",
      ],
      mood: "thrill",
      format: "any",
    },
    ["m-city-laughs", "m-orbit-signal", "s-corner-cafe", "s-deep-station"],
    [],
  ),
  evaluationCase(
    "mainstream-comedy",
    "Mainstream comedy seed without hard narrowing.",
    ["mainstream", "seeded"],
    {
      ...baseInputs,
      seedTitleIds: ["m-city-laughs"],
      candidateTitleIds: ["m-city-laughs", "m-quiet-harbor", "m-ember-song"],
      mood: "laugh",
      format: "movie",
      movieLength: "any",
    },
    ["m-city-laughs", "m-quiet-harbor", "m-ember-song"],
    [],
  ),
  evaluationCase(
    "niche-documentary",
    "Niche science-documentary seed.",
    ["niche", "seeded"],
    {
      ...baseInputs,
      seedTitleIds: ["m-archive-mind"],
      candidateTitleIds: ["m-archive-mind", "m-orbit-signal", "m-sunny-trail"],
      mood: "think",
      format: "movie",
      movieLength: "any",
    },
    ["m-archive-mind", "m-orbit-signal", "m-sunny-trail"],
    [],
  ),
  evaluationCase(
    "niche-scifi",
    "Cross-format science-fiction seeds.",
    ["niche", "seeded", "mixed-format"],
    {
      ...baseInputs,
      seedTitleIds: ["m-orbit-signal", "s-deep-station"],
      candidateTitleIds: ["m-orbit-signal", "s-deep-station", "m-archive-mind"],
      mood: "thrill",
      format: "any",
    },
    ["m-orbit-signal", "s-deep-station", "m-archive-mind"],
    [],
  ),
  evaluationCase(
    "netflix-movies",
    "Netflix-only movies.",
    ["service", "movie"],
    {
      ...baseInputs,
      candidateTitleIds: [
        "m-city-laughs",
        "m-orbit-signal",
        "m-quiet-harbor",
        "s-corner-cafe",
      ],
      mood: "laugh",
      format: "movie",
      serviceIds: ["netflix"],
      movieLength: "any",
    },
    ["m-city-laughs", "m-orbit-signal"],
    [
      { titleId: "m-quiet-harbor", reasons: ["service"] },
      { titleId: "s-corner-cafe", reasons: ["format"] },
    ],
  ),
  evaluationCase(
    "apple-series",
    "Apple-only series.",
    ["service", "series"],
    {
      ...baseInputs,
      candidateTitleIds: ["s-deep-station", "s-heart-strings", "s-corner-cafe"],
      mood: "cry",
      format: "series",
      serviceIds: ["apple"],
      seriesLength: "any",
    },
    ["s-deep-station", "s-heart-strings"],
    [{ titleId: "s-corner-cafe", reasons: ["service"] }],
  ),
  evaluationCase(
    "sparse-disney-movie",
    "Sparse Disney movie selection.",
    ["service", "sparse"],
    {
      ...baseInputs,
      candidateTitleIds: ["m-sunny-trail", "m-city-laughs", "m-quiet-harbor"],
      mood: "comfort",
      format: "movie",
      serviceIds: ["disney"],
      movieLength: "any",
    },
    ["m-sunny-trail"],
    [
      { titleId: "m-city-laughs", reasons: ["service"] },
      { titleId: "m-quiet-harbor", reasons: ["service"] },
    ],
  ),
  evaluationCase(
    "sparse-max-series",
    "Sparse Max series selection.",
    ["service", "sparse"],
    {
      ...baseInputs,
      candidateTitleIds: ["s-case-files", "s-deep-station", "s-night-tales"],
      mood: "thrill",
      format: "series",
      serviceIds: ["max"],
      seriesLength: "any",
    },
    ["s-case-files"],
    [
      { titleId: "s-deep-station", reasons: ["service"] },
      { titleId: "s-night-tales", reasons: ["service"] },
    ],
  ),
  evaluationCase(
    "exclude-horror-movies",
    "Movie query excludes horror.",
    ["genre-exclusion", "movie"],
    {
      ...baseInputs,
      candidateTitleIds: ["m-midnight-clue", "m-glass-room", "m-city-laughs"],
      mood: "thrill",
      format: "movie",
      excludedGenres: ["horror"],
      movieLength: "any",
    },
    ["m-midnight-clue", "m-city-laughs"],
    [{ titleId: "m-glass-room", reasons: ["excluded-genre"] }],
  ),
  evaluationCase(
    "exclude-comedy-series",
    "Series query excludes comedy.",
    ["genre-exclusion", "series"],
    {
      ...baseInputs,
      candidateTitleIds: ["s-corner-cafe", "s-deep-station", "s-gentle-garden"],
      mood: "comfort",
      format: "series",
      excludedGenres: ["comedy"],
      seriesLength: "any",
    },
    ["s-deep-station", "s-gentle-garden"],
    [{ titleId: "s-corner-cafe", reasons: ["excluded-genre"] }],
  ),
  evaluationCase(
    "watched-movie",
    "A watched movie is suppressed.",
    ["watched", "movie"],
    {
      ...baseInputs,
      candidateTitleIds: ["m-city-laughs", "m-quiet-harbor"],
      mood: "cry",
      format: "movie",
      watchedTitleIds: ["m-city-laughs"],
      movieLength: "any",
    },
    ["m-quiet-harbor"],
    [{ titleId: "m-city-laughs", reasons: ["watched"] }],
  ),
  evaluationCase(
    "watched-series",
    "A watched series is suppressed.",
    ["watched", "series"],
    {
      ...baseInputs,
      candidateTitleIds: ["s-case-files", "s-deep-station"],
      mood: "thrill",
      format: "series",
      watchedTitleIds: ["s-case-files"],
      seriesLength: "any",
    },
    ["s-deep-station"],
    [{ titleId: "s-case-files", reasons: ["watched"] }],
  ),
  evaluationCase(
    "under-100-movies",
    "Movie length under 100 minutes.",
    ["length", "movie"],
    {
      ...baseInputs,
      candidateTitleIds: [
        "m-city-laughs",
        "m-midnight-clue",
        "m-sunny-trail",
        "m-orbit-signal",
      ],
      mood: "laugh",
      format: "movie",
      movieLength: "under-100",
    },
    ["m-city-laughs", "m-midnight-clue", "m-sunny-trail"],
    [{ titleId: "m-orbit-signal", reasons: ["movie-length"] }],
  ),
  evaluationCase(
    "epic-shortage",
    "Epic movie filter intentionally exhausts candidates.",
    ["length", "shortage", "conflict"],
    {
      ...baseInputs,
      candidateTitleIds: ["m-orbit-signal", "m-quiet-harbor"],
      mood: "think",
      format: "movie",
      movieLength: "epic",
    },
    [],
    [
      { titleId: "m-orbit-signal", reasons: ["movie-length"] },
      { titleId: "m-quiet-harbor", reasons: ["movie-length"] },
    ],
    true,
  ),
  evaluationCase(
    "short-episode-series",
    "Series with episodes at most 30 minutes.",
    ["length", "series"],
    {
      ...baseInputs,
      candidateTitleIds: [
        "s-corner-cafe",
        "s-gentle-garden",
        "s-bright-lab",
        "s-deep-station",
      ],
      mood: "comfort",
      format: "series",
      seriesLength: "short-episodes",
    },
    ["s-corner-cafe", "s-gentle-garden", "s-bright-lab"],
    [{ titleId: "s-deep-station", reasons: ["series-length"] }],
  ),
  evaluationCase(
    "one-season-series",
    "Exactly one season.",
    ["length", "series"],
    {
      ...baseInputs,
      candidateTitleIds: ["s-gentle-garden", "s-night-tales", "s-corner-cafe"],
      mood: "comfort",
      format: "series",
      seriesLength: "one-season",
    },
    ["s-gentle-garden", "s-night-tales"],
    [{ titleId: "s-corner-cafe", reasons: ["series-length"] }],
  ),
  evaluationCase(
    "long-running-series",
    "At least four seasons.",
    ["length", "series"],
    {
      ...baseInputs,
      candidateTitleIds: [
        "s-case-files",
        "s-long-road",
        "s-heart-strings",
        "s-deep-station",
      ],
      mood: "think",
      format: "series",
      seriesLength: "long-running",
    },
    ["s-case-files", "s-long-road", "s-heart-strings"],
    [{ titleId: "s-deep-station", reasons: ["series-length"] }],
  ),
  evaluationCase(
    "conflicting-netflix-comedy",
    "Netflix, short movie, and comedy exclusion conflict.",
    ["conflict", "shortage"],
    {
      ...baseInputs,
      candidateTitleIds: ["m-city-laughs", "m-orbit-signal", "m-ember-song"],
      mood: "laugh",
      format: "movie",
      serviceIds: ["netflix"],
      excludedGenres: ["comedy"],
      movieLength: "under-100",
    },
    [],
    [
      { titleId: "m-city-laughs", reasons: ["excluded-genre"] },
      { titleId: "m-orbit-signal", reasons: ["movie-length"] },
      { titleId: "m-ember-song", reasons: ["movie-length"] },
    ],
    true,
  ),
  evaluationCase(
    "disney-one-season",
    "Disney one-season series.",
    ["service", "length", "sparse"],
    {
      ...baseInputs,
      candidateTitleIds: ["s-gentle-garden", "s-corner-cafe", "s-night-tales"],
      mood: "comfort",
      format: "series",
      serviceIds: ["disney"],
      seriesLength: "one-season",
    },
    ["s-gentle-garden"],
    [
      { titleId: "s-corner-cafe", reasons: ["service", "series-length"] },
      { titleId: "s-night-tales", reasons: ["service"] },
    ],
  ),
  evaluationCase(
    "netflix-long-series-shortage",
    "Netflix long-running filter has no eligible candidates.",
    ["service", "length", "shortage"],
    {
      ...baseInputs,
      candidateTitleIds: ["s-corner-cafe", "s-bright-lab", "s-heart-strings"],
      mood: "laugh",
      format: "series",
      serviceIds: ["netflix"],
      seriesLength: "long-running",
    },
    [],
    [
      { titleId: "s-corner-cafe", reasons: ["series-length"] },
      { titleId: "s-bright-lab", reasons: ["series-length"] },
      { titleId: "s-heart-strings", reasons: ["service"] },
    ],
    true,
  ),
  evaluationCase(
    "hulu-without-horror",
    "Hulu movies excluding horror.",
    ["service", "genre-exclusion"],
    {
      ...baseInputs,
      candidateTitleIds: ["m-quiet-harbor", "m-glass-room", "m-city-laughs"],
      mood: "cry",
      format: "movie",
      serviceIds: ["hulu"],
      excludedGenres: ["horror"],
      movieLength: "any",
    },
    ["m-quiet-harbor"],
    [
      { titleId: "m-glass-room", reasons: ["excluded-genre"] },
      { titleId: "m-city-laughs", reasons: ["service"] },
    ],
  ),
  evaluationCase(
    "max-under-100",
    "Max movies under 100 minutes.",
    ["service", "length"],
    {
      ...baseInputs,
      candidateTitleIds: ["m-midnight-clue", "m-city-laughs", "m-orbit-signal"],
      mood: "thrill",
      format: "movie",
      serviceIds: ["max"],
      movieLength: "under-100",
    },
    ["m-midnight-clue"],
    [
      { titleId: "m-city-laughs", reasons: ["service"] },
      { titleId: "m-orbit-signal", reasons: ["service", "movie-length"] },
    ],
  ),
  evaluationCase(
    "prime-exclude-drama",
    "Prime titles excluding drama.",
    ["service", "genre-exclusion", "mixed-format"],
    {
      ...baseInputs,
      candidateTitleIds: [
        "m-orbit-signal",
        "m-archive-mind",
        "s-long-road",
        "m-sunny-trail",
      ],
      mood: "think",
      format: "any",
      serviceIds: ["prime"],
      excludedGenres: ["drama"],
    },
    ["m-archive-mind"],
    [
      { titleId: "m-orbit-signal", reasons: ["excluded-genre"] },
      { titleId: "s-long-road", reasons: ["excluded-genre"] },
      { titleId: "m-sunny-trail", reasons: ["service"] },
    ],
  ),
  evaluationCase(
    "all-watched-shortage",
    "Every candidate is already watched.",
    ["watched", "shortage"],
    {
      ...baseInputs,
      candidateTitleIds: ["m-city-laughs", "m-quiet-harbor"],
      mood: "laugh",
      format: "movie",
      watchedTitleIds: ["m-city-laughs", "m-quiet-harbor"],
      movieLength: "any",
    },
    [],
    [
      { titleId: "m-city-laughs", reasons: ["watched"] },
      { titleId: "m-quiet-harbor", reasons: ["watched"] },
    ],
    true,
  ),
  evaluationCase(
    "two-services-movies",
    "Movies available on either Netflix or Hulu.",
    ["service", "movie"],
    {
      ...baseInputs,
      candidateTitleIds: [
        "m-city-laughs",
        "m-quiet-harbor",
        "m-glass-room",
        "m-midnight-clue",
      ],
      mood: "thrill",
      format: "movie",
      serviceIds: ["netflix", "hulu"],
      movieLength: "any",
    },
    ["m-city-laughs", "m-quiet-harbor", "m-glass-room"],
    [{ titleId: "m-midnight-clue", reasons: ["service"] }],
  ),
  evaluationCase(
    "series-only-movie-pool",
    "Series request receives only movie candidates.",
    ["format", "shortage"],
    {
      ...baseInputs,
      candidateTitleIds: ["m-city-laughs", "m-orbit-signal", "m-quiet-harbor"],
      mood: "think",
      format: "series",
      seriesLength: "any",
    },
    [],
    [
      { titleId: "m-city-laughs", reasons: ["format"] },
      { titleId: "m-orbit-signal", reasons: ["format"] },
      { titleId: "m-quiet-harbor", reasons: ["format"] },
    ],
    true,
  ),
  evaluationCase(
    "exclude-drama-romance",
    "Multiple genre exclusions retain neutral comedy.",
    ["genre-exclusion", "mixed-format"],
    {
      ...baseInputs,
      candidateTitleIds: [
        "m-quiet-harbor",
        "m-ember-song",
        "m-city-laughs",
        "s-heart-strings",
      ],
      mood: "laugh",
      format: "any",
      excludedGenres: ["drama", "romance"],
    },
    ["m-city-laughs"],
    [
      { titleId: "m-quiet-harbor", reasons: ["excluded-genre"] },
      { titleId: "m-ember-song", reasons: ["excluded-genre"] },
      { titleId: "s-heart-strings", reasons: ["excluded-genre"] },
    ],
  ),
  evaluationCase(
    "mainstream-series-seed",
    "Mainstream comedy-series seed.",
    ["mainstream", "seeded", "series"],
    {
      ...baseInputs,
      seedTitleIds: ["s-corner-cafe"],
      candidateTitleIds: ["s-corner-cafe", "s-gentle-garden", "s-bright-lab"],
      mood: "laugh",
      format: "series",
      seriesLength: "any",
    },
    ["s-corner-cafe", "s-gentle-garden", "s-bright-lab"],
    [],
  ),
  evaluationCase(
    "apple-movie-shortage",
    "Apple-only movie request has no fixture match.",
    ["service", "movie", "shortage"],
    {
      ...baseInputs,
      candidateTitleIds: ["m-city-laughs", "m-orbit-signal", "m-ember-song"],
      mood: "cry",
      format: "movie",
      serviceIds: ["apple"],
      movieLength: "any",
    },
    [],
    [
      { titleId: "m-city-laughs", reasons: ["service"] },
      { titleId: "m-orbit-signal", reasons: ["service"] },
      { titleId: "m-ember-song", reasons: ["service"] },
    ],
    true,
  ),
  evaluationCase(
    "disney-family-conflict",
    "Disney one-season request excludes family.",
    ["service", "genre-exclusion", "shortage", "conflict"],
    {
      ...baseInputs,
      candidateTitleIds: ["s-gentle-garden", "s-night-tales"],
      mood: "comfort",
      format: "series",
      serviceIds: ["disney"],
      excludedGenres: ["family"],
      seriesLength: "one-season",
    },
    [],
    [
      { titleId: "s-gentle-garden", reasons: ["excluded-genre"] },
      { titleId: "s-night-tales", reasons: ["service"] },
    ],
    true,
  ),
];

export const evaluationCorpus: EvaluationCorpus = {
  version: EVALUATION_CORPUS_VERSION,
  fixtureVersion: "synthetic-titles-1.0.0",
  titles: evaluationTitles,
  cases: evaluationCases,
};
