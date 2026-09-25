import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTmdbClient,
  createTmdbClientFromEnv,
  TmdbError,
  type TmdbClientOptions,
} from "./client";

const API_KEY = "0123456789abcdef0123456789abcdef";
const READ_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(path.join(__dirname, "__fixtures__", `${name}.json`), "utf8"),
  );

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

const status = (code: number, headers: Record<string, string> = {}) =>
  new Response("{}", { status: code, headers });

/** Fake fetch that serves one handler per call, a fake clock and a recorded sleep. */
function harness(
  handlers: Handler[],
  options: Partial<TmdbClientOptions> = {},
) {
  const requests: { url: URL; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  let clock = 0;

  const fetch = (async (input: URL, init: RequestInit) => {
    const url = new URL(input);
    requests.push({ url, init });
    const handler = handlers[requests.length - 1];
    if (!handler) throw new Error(`unexpected request #${requests.length}`);
    return handler(url, init);
  }) as typeof globalThis.fetch;

  const client = createTmdbClient({
    apiKey: API_KEY,
    minIntervalMs: 0,
    fetch,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    random: () => 0.5,
    ...options,
  });
  return { client, requests, sleeps };
}

async function caught(promise: Promise<unknown>): Promise<TmdbError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(TmdbError);
    return error as TmdbError;
  }
  throw new Error("expected promise to reject");
}

describe("TMDB client: endpoints", () => {
  it("fetches and normalizes movie details", async () => {
    const { client, requests } = harness([() => json(fixture("movie-550"))]);
    const movie = await client.getMovie(550);

    expect(requests[0]?.url.pathname).toBe("/3/movie/550");
    expect(requests[0]?.url.searchParams.get("api_key")).toBe(API_KEY);
    expect(movie).toMatchObject({
      id: 550,
      title: "Fight Club",
      runtime: 139,
      imdbId: "tt0137523",
      genres: [{ id: 18, name: "Drama" }],
    });
    expect(movie).not.toHaveProperty("budget");
  });

  it("fetches series, seasons and episodes", async () => {
    const { client, requests } = harness([
      () => json(fixture("tv-1396")),
      () => json(fixture("tv-1396-season-1")),
    ]);
    const series = await client.getSeries(1396);
    const season = await client.getSeason(1396, 1);

    expect(series.seasons).toEqual([
      { seasonNumber: 0, episodeCount: 9, airDate: "2009-02-17" },
      { seasonNumber: 1, episodeCount: 7, airDate: "2008-01-20" },
    ]);
    expect(series.episodeRunTimes).toEqual([45, 47]);
    expect(requests[1]?.url.pathname).toBe("/3/tv/1396/season/1");
    expect(season.episodes).toHaveLength(2);
    expect(season.episodes[1]).toMatchObject({
      episodeNumber: 2,
      runtime: null,
    });
  });

  it("groups watch providers by country and availability type", async () => {
    const { client, requests } = harness([
      () => json(fixture("movie-550-providers")),
    ]);
    const providers = await client.getMovieWatchProviders(550);

    expect(requests[0]?.url.pathname).toBe("/3/movie/550/watch/providers");
    expect(providers.US?.flatrate.map((p) => p.providerName)).toEqual([
      "Netflix",
    ]);
    expect(providers.US?.rent[0]?.providerId).toBe(2);
    expect(providers.US?.buy).toEqual([]);
    expect(providers.GB).toMatchObject({ flatrate: [], free: [], ads: [] });
  });

  it("sends a v4 read token as a Bearer header instead of a query param", async () => {
    const { client, requests } = harness([() => json(fixture("movie-550"))], {
      apiKey: READ_TOKEN,
    });
    await client.getMovie(550);

    expect(requests[0]?.url.searchParams.has("api_key")).toBe(false);
    expect(new Headers(requests[0]?.init.headers).get("authorization")).toBe(
      `Bearer ${READ_TOKEN}`,
    );
  });
});

describe("TMDB client: pagination", () => {
  it("walks every page and forwards discover params", async () => {
    const { client, requests } = harness([
      () => json(fixture("discover-movie-page-1")),
      () => json(fixture("discover-movie-page-2")),
    ]);
    const titles: string[] = [];
    for await (const page of client.discoverMovies({
      sort_by: "popularity.desc",
    })) {
      titles.push(...page.results.map((m) => m.title));
    }

    expect(titles).toEqual(["Fight Club", "Forrest Gump", "Pulp Fiction"]);
    expect(requests.map((r) => r.url.searchParams.get("page"))).toEqual([
      "1",
      "2",
    ]);
    expect(requests[1]?.url.searchParams.get("sort_by")).toBe(
      "popularity.desc",
    );
  });

  it("normalizes empty and null optional fields", async () => {
    const { client } = harness([
      () => json(fixture("discover-movie-page-1")),
      () => json(fixture("discover-movie-page-2")),
    ]);
    const pages = [];
    for await (const page of client.discoverMovies()) pages.push(page);

    expect(pages[1]?.results[0]).toMatchObject({
      releaseDate: null,
      popularity: null,
    });
  });

  it("respects maxPages", async () => {
    const { client, requests } = harness([
      () => json(fixture("discover-movie-page-1")),
    ]);
    const pages = [];
    for await (const page of client.discoverMovies({}, { maxPages: 1 }))
      pages.push(page);

    expect(pages).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it("stops at TMDB's 500-page ceiling even if more pages are reported", async () => {
    const page = (n: number) =>
      json({
        page: n,
        total_pages: 10_000,
        total_results: 200_000,
        results: [],
      });
    const { client, requests } = harness(
      Array.from({ length: 501 }, (_, i) => () => page(i + 1)),
    );
    const pages = [];
    for await (const result of client.discoverSeries()) pages.push(result);

    expect(pages).toHaveLength(500);
    expect(requests).toHaveLength(500);
    expect(requests[0]?.url.pathname).toBe("/3/discover/tv");
  });

  it("yields a single empty page when there are no results", async () => {
    const { client } = harness([
      () => json({ page: 1, total_pages: 0, total_results: 0, results: [] }),
    ]);
    const pages = [];
    for await (const page of client.discoverMovies()) pages.push(page);
    expect(pages).toEqual([
      { page: 1, totalPages: 0, totalResults: 0, results: [] },
    ]);
  });
});

describe("TMDB client: throttling and retries", () => {
  it("spaces requests by minIntervalMs", async () => {
    const { client, sleeps } = harness(
      [1, 2, 3].map(() => () => json(fixture("movie-550"))),
      { minIntervalMs: 100 },
    );
    await Promise.all([
      client.getMovie(1),
      client.getMovie(2),
      client.getMovie(3),
    ]);
    // The fake sleep advances the shared clock, so waits are 100ms apart.
    expect(sleeps).toEqual([100, 100]);
  });

  it("retries a 429 after Retry-After and succeeds", async () => {
    const { client, requests, sleeps } = harness([
      () => status(429, { "retry-after": "2" }),
      () => json(fixture("movie-550")),
    ]);
    const movie = await client.getMovie(550);

    expect(movie.id).toBe(550);
    expect(requests).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it("caps Retry-After at maxDelayMs", async () => {
    const { client, sleeps } = harness(
      [
        () => status(429, { "retry-after": "3600" }),
        () => json(fixture("movie-550")),
      ],
      { maxDelayMs: 5000 },
    );
    await client.getMovie(550);
    expect(sleeps).toEqual([5000]);
  });

  it("backs off exponentially on 5xx and gives up after maxRetries", async () => {
    const { client, requests, sleeps } = harness(
      [503, 502, 500, 500].map((code) => () => status(code)),
      { maxRetries: 3, baseDelayMs: 100 },
    );
    const error = await caught(client.getMovie(550));

    expect(requests).toHaveLength(4);
    // random() = 0.5 → 75% of 100, 200, 400
    expect(sleeps).toEqual([75, 150, 300]);
    expect(error).toMatchObject({ code: "server", status: 500, attempts: 4 });
  });

  it("reports a persistent 429 as rate_limited", async () => {
    const { client } = harness([() => status(429), () => status(429)], {
      maxRetries: 1,
    });
    const error = await caught(client.getMovie(550));
    expect(error).toMatchObject({
      code: "rate_limited",
      status: 429,
      attempts: 2,
    });
  });

  it("retries network failures (outage) then recovers", async () => {
    const { client, requests } = harness([
      () => Promise.reject(new TypeError("fetch failed")),
      () => json(fixture("movie-550")),
    ]);
    await expect(client.getMovie(550)).resolves.toMatchObject({ id: 550 });
    expect(requests).toHaveLength(2);
  });

  it("reports a full outage as network after bounded retries", async () => {
    const { client, requests } = harness(
      [1, 2, 3].map(() => () => Promise.reject(new TypeError("fetch failed"))),
      { maxRetries: 2 },
    );
    const error = await caught(client.getMovie(550));
    expect(error).toMatchObject({ code: "network", attempts: 3 });
    expect(requests).toHaveLength(3);
  });

  it("does not retry 401 or 404", async () => {
    const { client, requests } = harness([
      () => status(401),
      () => status(404),
    ]);

    expect(await caught(client.getMovie(1))).toMatchObject({
      code: "unauthorized",
      attempts: 1,
    });
    expect(await caught(client.getMovie(2))).toMatchObject({
      code: "not_found",
      status: 404,
      attempts: 1,
    });
    expect(requests).toHaveLength(2);
  });
});

describe("TMDB client: timeouts", () => {
  const hang: Handler = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });

  it("aborts a hung request and reports timeout", async () => {
    const { client } = harness([hang], { timeoutMs: 10, maxRetries: 0 });
    const error = await caught(client.getMovie(550));
    expect(error).toMatchObject({ code: "timeout", attempts: 1 });
  });

  it("retries after a timeout", async () => {
    const { client, requests } = harness(
      [hang, () => json(fixture("movie-550"))],
      { timeoutMs: 10, maxRetries: 1 },
    );
    await expect(client.getMovie(550)).resolves.toMatchObject({ id: 550 });
    expect(requests).toHaveLength(2);
  });
});

describe("TMDB client: malformed responses", () => {
  it("rejects invalid JSON without retrying", async () => {
    const { client, requests } = harness([
      () => new Response("<html>gateway</html>", { status: 200 }),
    ]);
    const error = await caught(client.getMovie(550));
    expect(error).toMatchObject({ code: "malformed", attempts: 1 });
    expect(error.message).toContain("invalid JSON");
    expect(requests).toHaveLength(1);
  });

  it("names the field that failed validation", async () => {
    const { client } = harness([
      () => json({ ...(fixture("movie-550") as object), id: "550" }),
    ]);
    const error = await caught(client.getMovie(550));
    expect(error.code).toBe("malformed");
    expect(error.message).toContain("movie.id");
  });

  it("rejects a page with the wrong shape", async () => {
    const { client } = harness([() => json({ page: 1, results: "nope" })]);
    const error = await caught(
      client.discoverMovies()[Symbol.asyncIterator]().next(),
    );
    expect(error.message).toContain("page.total_pages");
  });

  it("rejects bad provider entries", async () => {
    const { client } = harness([
      () =>
        json({ id: 1, results: { US: { flatrate: [{ provider_id: 8 }] } } }),
    ]);
    const error = await caught(client.getMovieWatchProviders(1));
    expect(error.message).toContain(
      "providers.results.US.flatrate[0].provider_name",
    );
  });
});

describe("TMDB client: redaction", () => {
  it.each([
    ["HTTP error", () => status(500)],
    [
      "network error",
      () => Promise.reject(new TypeError(`fetch failed ${API_KEY}`)),
    ],
    ["malformed", () => json({ id: API_KEY })],
  ] as const)(
    "never exposes the API key or query string (%s)",
    async (_name, handler) => {
      const { client } = harness([handler], { maxRetries: 0 });
      const error = await caught(
        client
          .discoverMovies({ with_genres: "18" })
          [Symbol.asyncIterator]()
          .next(),
      );

      const serialized = `${error.message} ${JSON.stringify(error)} ${String(error.stack)}`;
      expect(serialized).not.toContain(API_KEY);
      expect(serialized).not.toContain("api_key");
      expect(serialized).not.toContain("with_genres");
      expect(error.path).toBe("/3/discover/movie");
    },
  );

  it("never exposes a bearer token", async () => {
    const { client } = harness([() => status(401)], { apiKey: READ_TOKEN });
    const error = await caught(client.getMovie(1));
    expect(`${error.message} ${JSON.stringify(error)}`).not.toContain(
      READ_TOKEN,
    );
  });
});

describe("createTmdbClientFromEnv", () => {
  it("requires TMDB_API_KEY", () => {
    expect(() => createTmdbClientFromEnv({})).toThrow(
      /TMDB_API_KEY is required/,
    );
    expect(() => createTmdbClientFromEnv({ TMDB_API_KEY: " " })).toThrow(
      /TMDB_API_KEY is required/,
    );
  });

  it("builds a client when the key is set", () => {
    expect(createTmdbClientFromEnv({ TMDB_API_KEY: API_KEY })).toHaveProperty(
      "getMovie",
    );
  });
});
