// Read-only catalog queries behind search and quiz seeds (issue #15).
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../db/schema";
import type { SearchDocument, TitleKind } from "./engine";

const { titleAvailability, titles } = schema;

type Db = PostgresJsDatabase<typeof schema>;

export const QUIZ_SEED_LIMITS = { defaultLimit: 12, maxLimit: 50 } as const;

const yearOf = (date: string | null) =>
  date ? Number(date.slice(0, 4)) : null;

/**
 * Eligibility: adult titles are never ingested (#6). When the lifecycle table
 * (#70) lands, non-presentable titles (unavailable/tombstoned) are excluded
 * here, in one place, for both search and quiz seeds.
 */
const eligible = sql`true`;

const usAvailability = and(
  eq(titleAvailability.titleId, titles.id),
  eq(titleAvailability.region, "US"),
);

const documentFields = {
  titleId: titles.id,
  kind: titles.kind,
  tmdbId: titles.tmdbId,
  title: titles.title,
  originalTitle: titles.originalTitle,
  releaseDate: titles.releaseDate,
  posterPath: titles.posterPath,
  availabilityCheckedAt: titleAvailability.fetchedAt,
};

type Row = {
  titleId: number;
  kind: TitleKind;
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  releaseDate: string | null;
  posterPath: string | null;
  availabilityCheckedAt: Date | null;
};

const toDocument = (r: Row): SearchDocument => ({
  titleId: r.titleId,
  kind: r.kind,
  tmdbId: r.tmdbId,
  title: r.title,
  originalTitle: r.originalTitle,
  alternateTitles: [],
  year: yearOf(r.releaseDate),
  posterPath: r.posterPath,
  availabilityCheckedAt: r.availabilityCheckedAt,
  eligible: true,
});

/** Every eligible title as a compact search document. */
export async function loadSearchDocuments(db: Db): Promise<SearchDocument[]> {
  const rows = await db
    .select(documentFields)
    .from(titles)
    .leftJoin(titleAvailability, usAvailability)
    .where(eligible);
  return rows.map(toDocument);
}

/**
 * Quiz seeds: the most-voted eligible titles that have a poster (quiz cards
 * are visual), deterministic for a given catalog.
 */
export async function loadQuizSeeds(
  db: Db,
  options: { kind?: TitleKind; limit: number },
): Promise<SearchDocument[]> {
  const limit = Math.min(Math.max(1, options.limit), QUIZ_SEED_LIMITS.maxLimit);
  const rows = await db
    .select(documentFields)
    .from(titles)
    .leftJoin(titleAvailability, usAvailability)
    .where(
      and(
        eligible,
        isNotNull(titles.posterPath),
        options.kind ? eq(titles.kind, options.kind) : undefined,
      ),
    )
    .orderBy(
      sql`${titles.voteCount} desc nulls last`,
      asc(titles.kind),
      asc(titles.tmdbId),
    )
    .limit(limit);
  return rows.map(toDocument);
}
