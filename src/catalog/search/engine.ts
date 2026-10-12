// Catalog title search (issue #15). Pure: query validation, matching,
// deterministic ranking, opaque cursors and freshness metadata. Measured by
// the frozen benchmark in src/catalog/search-benchmark (issue #71).

export const SEARCH_LIMITS = {
  minQueryLength: 2,
  maxQueryLength: 100,
  defaultLimit: 20,
  maxLimit: 50,
} as const;

/** Same window as the catalog lifecycle's presentable availability (#70). */
export const AVAILABILITY_MAX_AGE_HOURS = 48;

export type TitleKind = "movie" | "series";

export interface SearchDocument {
  /** Internal stable title id (returned to clients as `id`). */
  titleId: number;
  kind: TitleKind;
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  alternateTitles: readonly string[];
  year: number | null;
  posterPath: string | null;
  availabilityCheckedAt: Date | null;
  /** False for titles that must never be returned (adult, tombstoned...). */
  eligible: boolean;
}

export interface Availability {
  state: "current" | "stale" | "unknown";
  checkedAt: string | null;
}

/** The only fields a search result exposes. */
export interface SearchResultItem {
  id: number;
  kind: TitleKind;
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  availability: Availability;
}

export type SearchError =
  "invalid_query" | "invalid_kind" | "invalid_limit" | "invalid_cursor";

const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

/** Accent-, case- and punctuation-insensitive form used for matching. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function canonicalQuery(
  raw: unknown,
): { ok: true; folded: string } | { ok: false } {
  if (typeof raw !== "string") return { ok: false };
  const text = raw.replace(CONTROL, "").trim();
  if (
    text.length < SEARCH_LIMITS.minQueryLength ||
    text.length > SEARCH_LIMITS.maxQueryLength
  ) {
    return { ok: false };
  }
  const folded = fold(text);
  return folded ? { ok: true, folded } : { ok: false };
}

export function parseLimit(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "")
    return SEARCH_LIMITS.defaultLimit;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (n < 1) return null;
  return Math.min(n, SEARCH_LIMITS.maxLimit); // clamp, don't reject
}

export function parseKind(
  raw: string | null | undefined,
): TitleKind | undefined | null {
  if (raw === null || raw === undefined || raw === "") return undefined;
  return raw === "movie" || raw === "series" ? raw : null;
}

// --- Prepared index

interface Prepared {
  doc: SearchDocument;
  names: { full: string; bare: string; tokens: string[]; joined: string }[];
}

export type SearchIndex = readonly Prepared[];

const stripArticle = (s: string) => s.replace(/^(the|a|an) /, "");

/** Folds every searchable name once; only eligible documents are indexed. */
export function buildIndex(docs: readonly SearchDocument[]): SearchIndex {
  return docs
    .filter((d) => d.eligible)
    .map((doc) => ({
      doc,
      names: [doc.title, doc.originalTitle, ...doc.alternateTitles]
        .filter((n): n is string => !!n)
        .map(fold)
        .filter(Boolean)
        .map((full) => ({
          full,
          bare: stripArticle(full),
          tokens: full.split(" "),
          joined: full.replace(/ /g, ""),
        })),
    }));
}

function score(
  p: Prepared,
  q: string,
  qTokens: string[],
  qJoined: string,
): number {
  let best = 0;
  for (const n of p.names) {
    let s = 0;
    if (n.full === q) s = 100;
    else if (n.bare === q) s = 95;
    else if (n.full.startsWith(q) || n.bare.startsWith(q)) s = 80;
    else if (qTokens.every((qt) => n.tokens.some((t) => t.startsWith(qt))))
      s = 60;
    else if (qJoined.length >= 3 && n.joined.startsWith(qJoined)) s = 50;
    if (s > best) best = s;
  }
  return best;
}

/** Matches, best first; ties broken by title length, year, kind, tmdb id. */
export function rank(
  index: SearchIndex,
  folded: string,
  kind?: TitleKind,
): SearchDocument[] {
  const qTokens = folded.split(" ");
  const qJoined = folded.replace(/ /g, "");
  return index
    .filter((p) => !kind || p.doc.kind === kind)
    .map((p) => ({ doc: p.doc, s: score(p, folded, qTokens, qJoined) }))
    .filter((h) => h.s > 0)
    .sort(
      (a, b) =>
        b.s - a.s ||
        a.doc.title.length - b.doc.title.length ||
        (a.doc.year ?? 0) - (b.doc.year ?? 0) ||
        (a.doc.kind < b.doc.kind ? -1 : a.doc.kind > b.doc.kind ? 1 : 0) ||
        a.doc.tmdbId - b.doc.tmdbId,
    )
    .map((h) => h.doc);
}

// --- Cursors: opaque, and only valid for the query/filters that produced them

function fingerprint(folded: string, kind: TitleKind | undefined): string {
  let h = 0x811c9dc5; // FNV-1a
  for (const ch of `${folded}|${kind ?? ""}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function encodeCursor(
  offset: number,
  folded: string,
  kind?: TitleKind,
): string {
  return Buffer.from(
    JSON.stringify({ o: offset, f: fingerprint(folded, kind) }),
  ).toString("base64url");
}

export function decodeCursor(
  cursor: string | null | undefined,
  folded: string,
  kind?: TitleKind,
): number | null {
  if (cursor === null || cursor === undefined || cursor === "") return 0;
  if (cursor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    const { o, f } = value as { o?: unknown; f?: unknown };
    if (!Number.isSafeInteger(o) || (o as number) < 0) return null;
    return f === fingerprint(folded, kind) ? (o as number) : null;
  } catch {
    return null;
  }
}

export function availabilityOf(
  checkedAt: Date | null,
  now: Date,
): Availability {
  if (!checkedAt) return { state: "unknown", checkedAt: null };
  const fresh =
    now.getTime() - checkedAt.getTime() <=
    AVAILABILITY_MAX_AGE_HOURS * 3_600_000;
  return {
    state: fresh ? "current" : "stale",
    checkedAt: checkedAt.toISOString(),
  };
}

export function toResultItem(doc: SearchDocument, now: Date): SearchResultItem {
  return {
    id: doc.titleId,
    kind: doc.kind,
    tmdbId: doc.tmdbId,
    title: doc.title,
    year: doc.year,
    posterPath: doc.posterPath,
    availability: availabilityOf(doc.availabilityCheckedAt, now),
  };
}

export interface SearchRequest {
  q: unknown;
  kind?: TitleKind;
  limit: number;
  cursor?: string | null;
}

export type SearchResponse =
  | { ok: true; results: SearchResultItem[]; nextCursor: string | null }
  | { ok: false; error: SearchError };

export function search(
  index: SearchIndex,
  req: SearchRequest,
  now: Date,
): SearchResponse {
  const query = canonicalQuery(req.q);
  if (!query.ok) return { ok: false, error: "invalid_query" };
  const offset = decodeCursor(req.cursor, query.folded, req.kind);
  if (offset === null) return { ok: false, error: "invalid_cursor" };
  const limit = Math.min(
    Math.max(1, Math.floor(req.limit)),
    SEARCH_LIMITS.maxLimit,
  );

  const ranked = rank(index, query.folded, req.kind);
  const page = ranked.slice(offset, offset + limit);
  const next =
    offset + limit < ranked.length
      ? encodeCursor(offset + limit, query.folded, req.kind)
      : null;
  return {
    ok: true,
    results: page.map((d) => toResultItem(d, now)),
    nextCursor: next,
  };
}
