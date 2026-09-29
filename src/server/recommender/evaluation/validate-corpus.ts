import {
  MOVIE_EPIC_MIN_MINUTES,
  MOVIE_SHORT_MAX_MINUTES,
  SERIES_LONG_RUNNING_MIN_SEASONS,
  SERIES_ONE_SEASON_COUNT,
  SERIES_SHORT_EPISODE_MAX_MINUTES,
} from "@/lib/recommendation-length";

import type {
  ConstraintReason,
  EvaluationCase,
  EvaluationCorpus,
  EvaluationTitle,
} from "./corpus";

export class EvaluationCorpusError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid evaluation corpus:\n- ${problems.join("\n- ")}`);
    this.name = "EvaluationCorpusError";
  }
}

export function validateEvaluationCorpus(corpus: EvaluationCorpus): void {
  const problems: string[] = [];
  const titles = uniqueById(corpus.titles, "title", problems);
  const cases = uniqueById(corpus.cases, "case", problems);

  if (!/^\d+\.\d+\.\d+$/.test(corpus.version)) {
    problems.push("corpus version must use semantic versioning");
  }
  if (!corpus.fixtureVersion.trim()) {
    problems.push("fixture version must not be empty");
  }
  if (corpus.cases.length < 30) {
    problems.push("published corpus must contain at least 30 cases");
  }

  for (const evaluationCase of cases.values()) {
    validateCase(evaluationCase, titles, problems);
  }

  if (problems.length > 0) {
    throw new EvaluationCorpusError(problems);
  }
}

function uniqueById<T extends { id: string }>(
  values: readonly T[],
  label: string,
  problems: string[],
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    if (!value.id.trim()) {
      problems.push(`${label} id must not be empty`);
      continue;
    }
    if (result.has(value.id)) {
      problems.push(`duplicate ${label} id: ${value.id}`);
      continue;
    }
    result.set(value.id, value);
  }
  return result;
}

function validateCase(
  evaluationCase: EvaluationCase,
  titles: ReadonlyMap<string, EvaluationTitle>,
  problems: string[],
): void {
  const prefix = `case ${evaluationCase.id}`;
  const { inputs, expected } = evaluationCase;

  if (!evaluationCase.description.trim()) {
    problems.push(`${prefix}: description must not be empty`);
  }
  if (evaluationCase.humanReviewPrompts.length === 0) {
    problems.push(`${prefix}: at least one human-review prompt is required`);
  }
  if (inputs.format === "movie" && inputs.seriesLength !== undefined) {
    problems.push(
      `${prefix}: movie format contradicts series-length constraint`,
    );
  }
  if (inputs.format === "series" && inputs.movieLength !== undefined) {
    problems.push(
      `${prefix}: series format contradicts movie-length constraint`,
    );
  }

  const candidateIds = new Set<string>();
  for (const id of inputs.candidateTitleIds) {
    if (candidateIds.has(id)) {
      problems.push(`${prefix}: duplicate candidate title id ${id}`);
    }
    candidateIds.add(id);
  }

  for (const id of [
    ...inputs.seedTitleIds,
    ...inputs.candidateTitleIds,
    ...inputs.watchedTitleIds,
    ...expected.eligibleTitleIds,
    ...expected.ineligibleTitles.map(({ titleId }) => titleId),
  ]) {
    if (!titles.has(id)) {
      problems.push(`${prefix}: unknown fixture title id ${id}`);
    }
  }

  const eligibleIds = new Set(expected.eligibleTitleIds);
  const ineligibleIds = new Set(
    expected.ineligibleTitles.map(({ titleId }) => titleId),
  );

  for (const id of eligibleIds) {
    if (ineligibleIds.has(id)) {
      problems.push(`${prefix}: title ${id} is both eligible and ineligible`);
    }
    if (!candidateIds.has(id)) {
      problems.push(`${prefix}: eligible title ${id} is not a candidate`);
    }
  }
  for (const id of ineligibleIds) {
    if (!candidateIds.has(id)) {
      problems.push(`${prefix}: ineligible title ${id} is not a candidate`);
    }
  }
  for (const id of candidateIds) {
    if (!eligibleIds.has(id) && !ineligibleIds.has(id)) {
      problems.push(
        `${prefix}: candidate ${id} has no expected classification`,
      );
    }
    const title = titles.get(id);
    const metadataProblem = title
      ? missingLengthMetadata(evaluationCase, title)
      : null;
    if (metadataProblem) problems.push(`${prefix}: ${metadataProblem}`);
  }

  for (const id of eligibleIds) {
    const title = titles.get(id);
    if (!title) continue;
    const violations = hardConstraintViolations(evaluationCase, title);
    if (violations.length > 0) {
      problems.push(
        `${prefix}: eligible title ${id} violates ${violations.join(", ")}`,
      );
    }
  }

  for (const expectedTitle of expected.ineligibleTitles) {
    const title = titles.get(expectedTitle.titleId);
    if (!title) continue;
    const actual = hardConstraintViolations(evaluationCase, title).sort();
    const declared = [...new Set(expectedTitle.reasons)].sort();
    if (actual.length === 0) {
      problems.push(
        `${prefix}: ineligible title ${title.id} violates no hard constraint`,
      );
    } else if (actual.join("|") !== declared.join("|")) {
      problems.push(
        `${prefix}: ineligible title ${title.id} declares [${declared.join(", ")}] but violates [${actual.join(", ")}]`,
      );
    }
  }

  const isShortage = expected.eligibleTitleIds.length < 1;
  if (expected.intentionalShortage !== isShortage) {
    problems.push(
      `${prefix}: intentionalShortage must match whether eligible results are empty`,
    );
  }
}

export function hardConstraintViolations(
  evaluationCase: EvaluationCase,
  title: EvaluationTitle,
): ConstraintReason[] {
  const { inputs } = evaluationCase;
  const violations: ConstraintReason[] = [];

  if (inputs.format !== "any" && title.format !== inputs.format) {
    violations.push("format");
  }
  if (
    inputs.serviceIds.length > 0 &&
    !title.services.some((service) => inputs.serviceIds.includes(service))
  ) {
    violations.push("service");
  }
  if (title.genres.some((genre) => inputs.excludedGenres.includes(genre))) {
    violations.push("excluded-genre");
  }
  if (inputs.watchedTitleIds.includes(title.id)) {
    violations.push("watched");
  }
  if (title.format === "movie" && inputs.movieLength !== undefined) {
    if (
      inputs.movieLength === "under-100" &&
      (title.runtimeMinutes == null ||
        title.runtimeMinutes > MOVIE_SHORT_MAX_MINUTES)
    ) {
      violations.push("movie-length");
    }
    if (
      inputs.movieLength === "epic" &&
      (title.runtimeMinutes == null ||
        title.runtimeMinutes < MOVIE_EPIC_MIN_MINUTES)
    ) {
      violations.push("movie-length");
    }
  }
  if (title.format === "series" && inputs.seriesLength !== undefined) {
    if (
      inputs.seriesLength === "short-episodes" &&
      (title.episodeRuntimeMinutes == null ||
        title.episodeRuntimeMinutes > SERIES_SHORT_EPISODE_MAX_MINUTES)
    ) {
      violations.push("series-length");
    }
    if (
      inputs.seriesLength === "one-season" &&
      title.seasons !== SERIES_ONE_SEASON_COUNT
    ) {
      violations.push("series-length");
    }
    if (
      inputs.seriesLength === "long-running" &&
      (title.seasons == null || title.seasons < SERIES_LONG_RUNNING_MIN_SEASONS)
    ) {
      violations.push("series-length");
    }
  }

  return violations;
}

function missingLengthMetadata(
  evaluationCase: EvaluationCase,
  title: EvaluationTitle,
): string | null {
  const { inputs } = evaluationCase;
  if (
    title.format === "movie" &&
    inputs.movieLength !== undefined &&
    inputs.movieLength !== "any" &&
    title.runtimeMinutes == null
  ) {
    return `candidate ${title.id} requires runtimeMinutes for ${inputs.movieLength}`;
  }
  if (
    title.format === "series" &&
    inputs.seriesLength === "short-episodes" &&
    title.episodeRuntimeMinutes == null
  ) {
    return `candidate ${title.id} requires episodeRuntimeMinutes for short-episodes`;
  }
  if (
    title.format === "series" &&
    (inputs.seriesLength === "one-season" ||
      inputs.seriesLength === "long-running") &&
    title.seasons == null
  ) {
    return `candidate ${title.id} requires seasons for ${inputs.seriesLength}`;
  }
  return null;
}
