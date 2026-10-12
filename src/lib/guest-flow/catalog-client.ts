/** Browser-safe catalog metadata. IDs are internal catalog IDs, not TMDB IDs. */
export type CatalogTitle = {
  id: string;
  kind: "movie" | "series";
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  availability: {
    state: "current" | "stale" | "unknown";
    checkedAt: string | null;
  };
};

export type CatalogPage = {
  results: CatalogTitle[];
  limit: number;
  nextCursor: string | null;
};

type RequestOptions = {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function title(value: unknown): value is CatalogTitle {
  if (!record(value) || !record(value.availability)) return false;
  return (
    isCatalogId(value.id) &&
    (value.kind === "movie" || value.kind === "series") &&
    Number.isSafeInteger(value.tmdbId) &&
    (value.tmdbId as number) > 0 &&
    typeof value.title === "string" &&
    value.title.trim().length > 0 &&
    (value.year === null || Number.isSafeInteger(value.year)) &&
    (value.posterPath === null || typeof value.posterPath === "string") &&
    ["current", "stale", "unknown"].includes(
      value.availability.state as string,
    ) &&
    (value.availability.checkedAt === null ||
      (typeof value.availability.checkedAt === "string" &&
        Number.isFinite(Date.parse(value.availability.checkedAt))))
  );
}

async function loadCatalog(
  url: string,
  options: RequestOptions,
): Promise<CatalogPage> {
  const response = await (options.fetchImpl ?? fetch)(url, {
    signal: options.signal,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new Error("The catalog could not be loaded. Please try again.");
  const data: unknown = await response.json();
  if (
    !record(data) ||
    !Array.isArray(data.results) ||
    data.results.length > 50 ||
    !data.results.every(title) ||
    !Number.isSafeInteger(data.limit) ||
    (data.limit as number) < 1 ||
    (data.limit as number) > 50 ||
    (data.nextCursor !== undefined &&
      data.nextCursor !== null &&
      typeof data.nextCursor !== "string")
  )
    throw new Error(
      "The catalog returned an unreadable response. Please try again.",
    );
  if (
    new Set(data.results.map((item) => item.id)).size !== data.results.length
  ) {
    throw new Error("The catalog returned duplicate titles. Please try again.");
  }
  return {
    results: data.results,
    limit: data.limit as number,
    nextCursor: (data.nextCursor as string | null) ?? null,
  };
}

export function loadQuizSeeds(
  options: RequestOptions = {},
): Promise<CatalogPage> {
  return loadCatalog("/api/catalog/quiz-seeds?limit=12", options);
}

export function searchCatalog(
  query: string,
  options: RequestOptions & { cursor?: string } = {},
): Promise<CatalogPage> {
  const q = query.trim();
  if (q.length < 2)
    return Promise.reject(new Error("Enter at least 2 characters to search."));
  const params = new URLSearchParams({ q, limit: "12" });
  if (options.cursor) params.set("cursor", options.cursor);
  return loadCatalog(`/api/catalog/search?${params}`, options);
}

export type CatalogOptions = {
  providers: {
    id: string;
    name: string;
    logoPath: string | null;
    monetizations: ("flatrate" | "free" | "ads" | "rent" | "buy")[];
  }[];
  genres: { id: string; name: string; kinds: ("movie" | "series")[] }[];
};

export function isCatalogId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[1-9]\d*$/.test(value) &&
    Number.isSafeInteger(Number(value))
  );
}

export async function loadCatalogOptions(
  options: RequestOptions = {},
): Promise<CatalogOptions> {
  const response = await (options.fetchImpl ?? fetch)("/api/catalog/options", {
    signal: options.signal,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(
      "Streaming services and genres could not be loaded. Please try again.",
    );
  const data: unknown = await response.json();
  const named = (item: unknown): item is Record<string, unknown> =>
    record(item) &&
    isCatalogId(item.id) &&
    typeof item.name === "string" &&
    item.name.trim().length > 0;
  if (
    !record(data) ||
    !Array.isArray(data.providers) ||
    !Array.isArray(data.genres) ||
    !data.providers.every(
      (provider) =>
        named(provider) &&
        (provider.logoPath === null || typeof provider.logoPath === "string") &&
        Array.isArray(provider.monetizations) &&
        provider.monetizations.every((access) =>
          ["flatrate", "free", "ads", "rent", "buy"].includes(access),
        ),
    ) ||
    !data.genres.every(
      (genre) =>
        named(genre) &&
        Array.isArray(genre.kinds) &&
        genre.kinds.length > 0 &&
        genre.kinds.every((kind) => kind === "movie" || kind === "series"),
    ) ||
    new Set(data.providers.map((provider) => provider.id)).size !==
      data.providers.length ||
    new Set(data.genres.map((genre) => genre.id)).size !== data.genres.length
  )
    throw new Error(
      "The catalog returned unreadable service or genre options.",
    );
  return data as CatalogOptions;
}
