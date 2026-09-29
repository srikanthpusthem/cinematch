import { describe, expect, it } from "vitest";
import {
  applyHardFilters,
  type LengthConstraint,
  type RecommendationCandidate,
} from "../hard-filters";
import {
  evaluationCorpus,
  type EvaluationCorpus,
  type EvaluationInputs,
} from "./corpus";
import {
  EvaluationCorpusError,
  validateEvaluationCorpus,
} from "./validate-corpus";
import { evaluationRubric } from "./rubric";

function corpusWith(overrides: Partial<EvaluationCorpus>): EvaluationCorpus {
  return { ...evaluationCorpus, ...overrides };
}

describe("validateEvaluationCorpus", () => {
  it("accepts the published 32-case synthetic corpus", () => {
    expect(evaluationCorpus.cases).toHaveLength(32);
    expect(() => validateEvaluationCorpus(evaluationCorpus)).not.toThrow();
  });

  it("rejects malformed case metadata", () => {
    const malformed = {
      ...evaluationCorpus.cases[0]!,
      description: "",
      humanReviewPrompts: [],
    };

    expect(() =>
      validateEvaluationCorpus(
        corpusWith({ cases: [malformed, ...evaluationCorpus.cases.slice(1)] }),
      ),
    ).toThrow(/description must not be empty/);
  });

  it("rejects duplicate case IDs", () => {
    expect(() =>
      validateEvaluationCorpus(
        corpusWith({
          cases: [...evaluationCorpus.cases, evaluationCorpus.cases[0]!],
        }),
      ),
    ).toThrow(/duplicate case id: cold-movies/);
  });

  it("rejects unknown fixture title IDs", () => {
    const changed = {
      ...evaluationCorpus.cases[0]!,
      inputs: {
        ...evaluationCorpus.cases[0]!.inputs,
        candidateTitleIds: ["unknown-title"],
      },
      expected: {
        eligibleTitleIds: ["unknown-title"],
        ineligibleTitles: [],
        intentionalShortage: false,
      },
    };

    expect(() =>
      validateEvaluationCorpus(
        corpusWith({ cases: [changed, ...evaluationCorpus.cases.slice(1)] }),
      ),
    ).toThrow(/unknown fixture title id unknown-title/);
  });

  it("rejects contradictory eligibility and hard constraints", () => {
    const source = evaluationCorpus.cases.find(
      ({ id }) => id === "watched-movie",
    )!;
    const changed = {
      ...source,
      expected: {
        eligibleTitleIds: ["m-city-laughs", "m-quiet-harbor"],
        ineligibleTitles: [],
        intentionalShortage: false,
      },
    };

    expect(() =>
      validateEvaluationCorpus(
        corpusWith({
          cases: evaluationCorpus.cases.map((item) =>
            item.id === source.id ? changed : item,
          ),
        }),
      ),
    ).toThrow(/eligible title m-city-laughs violates watched/);
  });

  it("rejects inaccurate ineligibility reasons", () => {
    const source = evaluationCorpus.cases.find(
      ({ id }) => id === "netflix-movies",
    )!;
    const changed = {
      ...source,
      expected: {
        ...source.expected,
        ineligibleTitles: source.expected.ineligibleTitles.map((item) =>
          item.titleId === "m-quiet-harbor"
            ? { ...item, reasons: ["format" as const] }
            : item,
        ),
      },
    };

    expect(() =>
      validateEvaluationCorpus(
        corpusWith({
          cases: evaluationCorpus.cases.map((item) =>
            item.id === source.id ? changed : item,
          ),
        }),
      ),
    ).toThrow(/declares \[format\] but violates \[service\]/);
  });

  it.each([
    [
      "under-100-movies",
      "m-city-laughs",
      "runtimeMinutes",
      /requires runtimeMinutes for under-100/,
    ],
    [
      "short-episode-series",
      "s-corner-cafe",
      "episodeRuntimeMinutes",
      /requires episodeRuntimeMinutes for short-episodes/,
    ],
    [
      "long-running-series",
      "s-case-files",
      "seasons",
      /requires seasons for long-running/,
    ],
  ] as const)(
    "rejects %s when required %s metadata is missing",
    (_caseId, titleId, field, expected) => {
      const titles = evaluationCorpus.titles.map((title) =>
        title.id === titleId ? { ...title, [field]: undefined } : title,
      );

      expect(() => validateEvaluationCorpus(corpusWith({ titles }))).toThrow(
        expected,
      );
    },
  );

  it("returns all validation problems in one bounded error", () => {
    try {
      validateEvaluationCorpus(corpusWith({ version: "latest", cases: [] }));
      expect.fail("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(EvaluationCorpusError);
      expect((error as EvaluationCorpusError).problems).toEqual(
        expect.arrayContaining([
          "corpus version must use semantic versioning",
          "published corpus must contain at least 30 cases",
        ]),
      );
    }
  });
});

describe("hard-filter corpus agreement", () => {
  it("matches every frozen corpus case's exact eligible IDs", () => {
    const titlesById = new Map(
      evaluationCorpus.titles.map((title) => [title.id, title]),
    );
    const serviceIds = numericIds(
      evaluationCorpus.titles.flatMap((title) => title.services),
    );
    const genreIds = numericIds(
      evaluationCorpus.titles.flatMap((title) => title.genres),
    );

    for (const evaluationCase of evaluationCorpus.cases) {
      const candidates: RecommendationCandidate[] =
        evaluationCase.inputs.candidateTitleIds.map((id) => {
          const title = titlesById.get(id)!;
          return {
            id: title.id,
            format: title.format,
            genreIds: title.genres.map((genre) => genreIds.get(genre)!),
            usStreamingServiceIds: title.services.map((service) =>
              serviceIds.get(service)!,
            ),
            runtimeMinutes: title.runtimeMinutes,
            episodeRuntimeMinutes: title.episodeRuntimeMinutes,
            seasonCount: title.seasons,
          };
        });

      const result = applyHardFilters(candidates, {
        selectedUsServiceIds: evaluationCase.inputs.serviceIds.map((service) =>
          serviceIds.get(service)!,
        ),
        excludedGenreIds: evaluationCase.inputs.excludedGenres.map((genre) =>
          genreIds.get(genre)!,
        ),
        format:
          evaluationCase.inputs.format === "any"
            ? undefined
            : evaluationCase.inputs.format,
        length: lengthConstraint(evaluationCase.inputs),
        watchedIds: evaluationCase.inputs.watchedTitleIds,
        limit: candidates.length,
      });

      expect(
        result.candidates.map(({ id }) => id),
        evaluationCase.id,
      ).toEqual(evaluationCase.expected.eligibleTitleIds);
    }
  });
});

function numericIds(values: readonly string[]): ReadonlyMap<string, number> {
  return new Map(
    [...new Set(values)].map((value, index) => [value, index + 1]),
  );
}

function lengthConstraint(
  inputs: EvaluationInputs,
): LengthConstraint | undefined {
  if (
    inputs.format === "movie" &&
    inputs.movieLength !== undefined &&
    inputs.movieLength !== "any"
  ) {
    return { format: "movie", category: inputs.movieLength };
  }
  if (
    inputs.format === "series" &&
    inputs.seriesLength !== undefined &&
    inputs.seriesLength !== "any"
  ) {
    return { format: "series", category: inputs.seriesLength };
  }
  return undefined;
}

describe("evaluationRubric", () => {
  it("versions the scoring rules and makes fabricated output an automatic failure", () => {
    expect(evaluationRubric.version).toBe("1.0.0");
    expect(evaluationRubric.automaticFailures).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/title ID.*absent/),
        expect.stringMatching(/invents or alters/),
      ]),
    );
    expect(evaluationRubric.passRule.scoredDimensions).toMatch(
      /at least 2.*at least 3\.0/,
    );
  });
});
