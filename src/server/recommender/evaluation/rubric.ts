export const EVALUATION_RUBRIC_VERSION = "1.0.0";

export const evaluationRubric = {
  version: EVALUATION_RUBRIC_VERSION,
  scale: {
    minimum: 0,
    maximum: 4,
    labels: {
      0: "failure",
      1: "poor",
      2: "acceptable",
      3: "good",
      4: "excellent",
    },
  },
  automaticFailures: [
    "A returned title ID is absent from the case candidate IDs.",
    "A returned title violates any expected hard constraint.",
    "An explanation invents or alters title, genre, runtime, season, service, or availability metadata.",
  ],
  dimensions: {
    hardFilterValidity: {
      kind: "gate",
      pass: "Every returned ID is expected eligible and no watched ID is returned.",
      fail: "Any returned ID is unknown, ineligible, watched, or fabricated.",
    },
    relevance: {
      kind: "score",
      zero: "Picks disregard the mood and seed evidence.",
      two: "At least one pick reasonably matches the mood or seeds.",
      four: "The ordering consistently prioritizes the strongest available taste evidence.",
    },
    diversity: {
      kind: "score",
      zero: "Picks are avoidably redundant in genre and premise.",
      two: "Picks show some meaningful variation without losing relevance.",
      four: "Picks cover distinct reasonable options with no token diversity choices.",
    },
    explanationFaithfulness: {
      kind: "score",
      zero: "Any reason conflicts with or invents fixture data or user inputs.",
      two: "Reasons are accurate but generic or incomplete.",
      four: "Every reason is specific, accurate, and grounded only in fixture data and inputs.",
    },
    availabilityFreshness: {
      kind: "score",
      zero: "Availability is missing, fabricated, or presented without its fixture timestamp.",
      two: "Fixture service and timestamp are reported accurately.",
      four: "Accurate service and timestamp are clear, with uncertainty stated when data is stale.",
    },
    fallbackBehavior: {
      kind: "score",
      zero: "The system invents a result or silently relaxes a hard constraint.",
      two: "Shortage is honest and preserves constraints.",
      four: "Shortage is honest, preserves constraints, and offers a clear editable constraint.",
    },
  },
  passRule: {
    gates:
      "No automatic failure and hard-filter validity passes in every case.",
    scoredDimensions:
      "Each scored dimension is at least 2 and the macro-average is at least 3.0.",
    reporting:
      "Report every case, all failures, macro-averages, and shortage cases; do not omit outliers.",
  },
} as const;
