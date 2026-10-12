// Candidate discovery. TMDB's discover endpoint serves at most 500 pages
// (10k results) per query, so reaching 20k+ titles requires partitioning:
// one query per release year (plus one for everything older), each sorted by
// vote count. Candidates are then ranked globally and cut to the target.
import type { CatalogSource, QueryParams } from "../tmdb/client";
import type { TitleKind } from "./store";

export interface Candidate {
  kind: TitleKind;
  tmdbId: number;
  voteCount: number;
}

export interface DiscoverOptions {
  kind: TitleKind;
  target: number;
  /** Titles need at least this many TMDB votes (keeps obscure entries out). */
  minVotes: number;
  /** Newest year queried individually. */
  toYear: number;
  /** Oldest year queried individually; earlier titles share one query. */
  fromYear: number;
}

/** The discover query partitions, newest first. Exported for tests. */
export function discoverPartitions({
  kind,
  minVotes,
  fromYear,
  toYear,
}: Omit<DiscoverOptions, "target">): QueryParams[] {
  const base: QueryParams = {
    sort_by: "vote_count.desc",
    include_adult: false,
    "vote_count.gte": minVotes,
  };
  const yearParam =
    kind === "movie" ? "primary_release_year" : "first_air_date_year";
  const beforeParam =
    kind === "movie" ? "primary_release_date.lte" : "first_air_date.lte";

  const partitions: QueryParams[] = [];
  for (let year = toYear; year >= fromYear; year--) {
    partitions.push({ ...base, [yearParam]: year });
  }
  partitions.push({ ...base, [beforeParam]: `${fromYear - 1}-12-31` });
  return partitions;
}

export async function discoverCandidates(
  source: CatalogSource,
  options: DiscoverOptions,
): Promise<Candidate[]> {
  const byId = new Map<number, Candidate>();
  for (const params of discoverPartitions(options)) {
    const pages =
      options.kind === "movie"
        ? source.discoverMovies(params)
        : source.discoverSeries(params);
    for await (const page of pages) {
      for (const item of page.results) {
        if (!byId.has(item.id)) {
          byId.set(item.id, {
            kind: options.kind,
            tmdbId: item.id,
            voteCount: item.voteCount ?? 0,
          });
        }
      }
    }
  }
  // Most-voted first; tmdb id breaks ties so runs are deterministic.
  return [...byId.values()]
    .sort((a, b) => b.voteCount - a.voteCount || a.tmdbId - b.tmdbId)
    .slice(0, options.target);
}
