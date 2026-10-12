// Maps the frozen benchmark corpus (#71) onto search documents. TMDB ids are
// assigned from the sorted corpus ids, so they don't depend on input order.
import type { BenchmarkTitle } from "../../search-benchmark/types";
import type { SearchDocument } from "../engine";

/** Adapts benchmark titles to search documents; tmdb ids follow sorted corpus ids. */
export function documentsFor(titles: readonly BenchmarkTitle[]) {
  const ids = titles.map((t) => t.id).sort();
  const numberOf = new Map(ids.map((id, i) => [id, i + 1]));
  const idOf = new Map(ids.map((id, i) => [i + 1, id]));
  const docs: SearchDocument[] = titles.map((t) => ({
    titleId: numberOf.get(t.id)!,
    kind: t.kind,
    tmdbId: numberOf.get(t.id)!,
    title: t.title,
    originalTitle: t.originalTitle,
    alternateTitles: t.alternateTitles,
    year: t.year,
    posterPath: t.posterPath,
    availabilityCheckedAt: null,
    eligible: !t.adult && t.eligible,
  }));
  return { docs, idOf };
}
