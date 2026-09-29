// Rejects benchmark corpora that are malformed or self-contradictory, so a
// search implementation is never scored against impossible expectations.
import type { BenchmarkCorpus, BenchmarkTitle } from "./types";

export class BenchmarkCorpusError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid search benchmark corpus:\n- ${problems.join("\n- ")}`);
    this.name = "BenchmarkCorpusError";
  }
}

/** Titles the exclusion policy forbids in every result. */
export const isExcluded = (t: BenchmarkTitle) => t.adult || !t.eligible;

export function validateBenchmarkCorpus(corpus: BenchmarkCorpus): void {
  const problems: string[] = [];

  if (!/^\d+\.\d+\.\d+$/.test(corpus.version)) {
    problems.push("corpus version must use semantic versioning");
  }

  const titles = new Map<string, BenchmarkTitle>();
  for (const title of corpus.titles) {
    if (!title.id.trim()) problems.push("title id must not be empty");
    else if (titles.has(title.id))
      problems.push(`duplicate title id: ${title.id}`);
    else titles.set(title.id, title);
    if (!title.title.trim())
      problems.push(`title ${title.id}: title must not be blank`);
  }

  const caseIds = new Set<string>();
  for (const c of corpus.cases) {
    const at = `case ${c.id}`;
    if (!c.id.trim()) problems.push("case id must not be empty");
    else if (caseIds.has(c.id)) problems.push(`duplicate case id: ${c.id}`);
    caseIds.add(c.id);

    const expected = c.groups.flat();
    const seen = new Set<string>();
    for (const id of expected) {
      if (seen.has(id))
        problems.push(`${at}: title ${id} appears in more than one group`);
      seen.add(id);
    }
    if (c.groups.some((g) => g.length === 0))
      problems.push(`${at}: empty relevance group`);

    for (const id of [...expected, ...(c.forbidden ?? [])]) {
      if (!titles.has(id)) problems.push(`${at}: unknown title id ${id}`);
    }
    for (const id of c.forbidden ?? []) {
      if (seen.has(id))
        problems.push(`${at}: title ${id} is both expected and forbidden`);
    }
    for (const id of expected) {
      const title = titles.get(id);
      if (!title) continue;
      if (isExcluded(title)) {
        problems.push(
          `${at}: expects ${id}, which the exclusion policy forbids`,
        );
      }
      if (c.kind && title.kind !== c.kind) {
        problems.push(
          `${at}: expects ${c.kind} results but ${id} is a ${title.kind}`,
        );
      }
    }

    if (c.outcome !== "results" && expected.length > 0) {
      problems.push(
        `${at}: outcome "${c.outcome}" contradicts expected results`,
      );
    }
    if (c.outcome === "results" && expected.length === 0) {
      problems.push(
        `${at}: outcome "results" needs at least one expected title`,
      );
    }
    if (
      c.pageSize !== undefined &&
      (!Number.isInteger(c.pageSize) || c.pageSize < 1)
    ) {
      problems.push(`${at}: pageSize must be a positive integer`);
    }
  }

  if (problems.length) throw new BenchmarkCorpusError(problems);
}
