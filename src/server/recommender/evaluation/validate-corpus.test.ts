import { describe, expect, it } from "vitest";
import { evaluationCorpus, type EvaluationCorpus } from "./corpus";
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
