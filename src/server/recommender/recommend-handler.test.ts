import { describe, expect, it, vi } from "vitest";
import {
  MAX_FEEDBACK_IDS,
  MAX_RECOMMENDATION_BODY_BYTES,
  parseRecommendationResponse,
  type RecommendationRequest,
} from "@/lib/live-recommendation/contract";
import {
  UnknownPreferenceTitlesError,
  type CatalogCandidate,
  type CatalogCandidateSnapshot,
} from "./baseline";
import { createRecommendationHandler } from "./recommend-handler";

const NOW = new Date("2026-10-12T00:00:00.000Z");

function input(
  overrides: Partial<RecommendationRequest> = {},
): RecommendationRequest {
  return {
    schemaVersion: 1,
    selectedUsServiceIds: [],
    excludedGenreIds: [],
    seedIds: [],
    watchedIds: [],
    likedIds: [],
    dislikedIds: [],
    excludedIds: [],
    mood: "comfort",
    format: "movie",
    length: null,
    limit: 5,
    ...overrides,
  };
}

function candidate(id: string): CatalogCandidate {
  return {
    id,
    title: `Catalog ${id}`,
    format: "movie",
    year: 2020,
    posterUrl: null,
    genres: [{ id: 35, name: "Comedy" }],
    keywords: [],
    runtimeMinutes: 90,
    episodeRuntimeMinutes: null,
    seasonCount: null,
    lifecycle: "active",
    availability: {
      region: "US",
      checkedAt: new Date("2026-10-11T00:00:00.000Z"),
      offers: [
        {
          providerId: 8,
          providerName: "Test catalog service",
          access: "subscription",
        },
      ],
      infoUrl: null,
    },
  };
}

function setup(
  snapshot: CatalogCandidateSnapshot = {
    candidates: [candidate("movie:1")],
    preferenceTitles: [],
  },
) {
  const load = vi.fn(async () => snapshot);
  return {
    load,
    handle: createRecommendationHandler({ load }, { now: () => NOW }),
  };
}

function request(value: unknown = input(), init: RequestInit = {}): Request {
  return new Request("https://cinematch.example/api/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
    ...init,
  });
}

function streamedRequest(
  body: ReadableStream<Uint8Array>,
  init: RequestInit = {},
): Request {
  return request(undefined, { body, ...init, duplex: "half" } as RequestInit);
}

async function expectInvalid(value: unknown): Promise<void> {
  const { handle, load } = setup();
  const response = await handle(request(value));
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    schemaVersion: 1,
    status: "error",
    code: "INVALID_REQUEST",
    message: "Check your recommendation choices and try again.",
  });
  expect(load).not.toHaveBeenCalled();
}

describe("createRecommendationHandler", () => {
  it("passes validated filters and cancellation to one read and returns catalog results", async () => {
    const { handle, load } = setup();
    const source = request(input({ selectedUsServiceIds: [8], limit: 1 }));
    const response = await handle(source);
    const result = parseRecommendationResponse(await response.json());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(load).toHaveBeenCalledExactlyOnceWith(
      input({ selectedUsServiceIds: [8], limit: 1 }),
      source.signal,
    );
    expect(result).toMatchObject({
      schemaVersion: 1,
      rankingVersion: "metadata-v1",
      status: "ok",
      confidence: "cold-start",
      picks: [{ id: "movie:1", availability: { state: "current" } }],
    });
  });

  it("returns honest empty results when the catalog has no matches", async () => {
    const { handle } = setup({ candidates: [], preferenceTitles: [] });
    const response = await handle(request());
    expect(response.status).toBe(200);
    expect(parseRecommendationResponse(await response.json())).toMatchObject({
      status: "empty",
      picks: [],
      exhaustion: { missingCount: 5 },
    });
  });

  it.each(["GET", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "rejects %s before reading the catalog",
    async (method) => {
      const { handle, load } = setup();
      const response = await handle(
        new Request("https://cinematch.example/api/recommend", { method }),
      );
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(load).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    "text/plain",
    "application/x-www-form-urlencoded",
    "application/jsonp",
  ])("requires JSON content type (%s)", async (contentType) => {
    const { handle, load } = setup();
    const response = await handle(
      request(input(), {
        headers: contentType ? { "Content-Type": contentType } : {},
      }),
    );
    expect(response.status).toBe(415);
    expect(load).not.toHaveBeenCalled();
  });

  it("accepts JSON with charset parameters", async () => {
    const { handle, load } = setup();
    const response = await handle(
      request(input(), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }),
    );
    expect(response.status).toBe(200);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it.each(["", "{invalid private provider text", "null", "[]", '"request"'])(
    "rejects malformed or non-object JSON %j",
    async (body) => {
      const { handle, load } = setup();
      const response = await handle(request(undefined, { body }));
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain("private provider text");
      expect(load).not.toHaveBeenCalled();
    },
  );

  const invalidChanges: [string, Record<string, unknown>][] = [
    ["schema version", { schemaVersion: 2 }],
    ["mood", { mood: "angry" }],
    ["format", { format: "podcast" }],
    ["unknown property", { apiKey: "not-a-real-secret" }],
    ["zero limit", { limit: 0 }],
    ["high limit", { limit: 6 }],
    ["fractional limit", { limit: 1.5 }],
    ["string limit", { limit: "5" }],
    ["one seed", { seedIds: ["seed:1"] }],
    ["two seeds", { seedIds: ["seed:1", "seed:2"] }],
    [
      "six seeds",
      { seedIds: Array.from({ length: 6 }, (_, index) => `seed:${index}`) },
    ],
    ["duplicate seeds", { seedIds: ["seed:1", "seed:1", "seed:2"] }],
    ["invalid seed", { seedIds: ["seed:1", "seed:2", "../private"] }],
    ["negative service", { selectedUsServiceIds: [-1] }],
    ["zero service", { selectedUsServiceIds: [0] }],
    ["fractional service", { selectedUsServiceIds: [1.1] }],
    ["string service", { selectedUsServiceIds: ["8"] }],
    ["duplicate services", { selectedUsServiceIds: [8, 8] }],
    [
      "service count",
      {
        selectedUsServiceIds: Array.from(
          { length: 31 },
          (_, index) => index + 1,
        ),
      },
    ],
    ["invalid genre", { excludedGenreIds: [0] }],
    [
      "unsafe integer genre",
      { excludedGenreIds: [Number.MAX_SAFE_INTEGER + 1] },
    ],
    ["duplicate genres", { excludedGenreIds: [35, 35] }],
    [
      "genre count",
      { excludedGenreIds: Array.from({ length: 51 }, (_, index) => index + 1) },
    ],
    [
      "wrong length format",
      { length: { format: "series", category: "one-season" } },
    ],
    [
      "wrong length category",
      { length: { format: "movie", category: "one-season" } },
    ],
    [
      "extra length key",
      { length: { format: "movie", category: "epic", maximum: 5 } },
    ],
    ["string length", { length: "epic" }],
    [
      "conflicting feedback",
      { likedIds: ["movie:1"], dislikedIds: ["movie:1"] },
    ],
  ];
  it.each(invalidChanges)(
    "rejects invalid %s without any catalog reads",
    async (_, changes) => {
      await expectInvalid({ ...input(), ...changes });
    },
  );

  it("requires every request field", async () => {
    for (const key of Object.keys(input())) {
      const value: Record<string, unknown> = { ...input() };
      delete value[key];
      await expectInvalid(value);
    }
  });

  it.each(["watchedIds", "likedIds", "dislikedIds", "excludedIds"])(
    "bounds and validates %s before any catalog read",
    async (key) => {
      for (const value of [
        "movie:1",
        null,
        [1],
        [""],
        ["movie:has space"],
        ["a".repeat(129)],
        ["movie:1", "movie:1"],
        Array.from(
          { length: MAX_FEEDBACK_IDS + 1 },
          (_, index) => `movie:${index}`,
        ),
      ]) {
        await expectInvalid({ ...input(), [key]: value });
      }
    },
  );

  it.each([undefined, "1"])(
    "enforces actual streamed request bytes regardless of declared length %s",
    async (declaredLength) => {
      const { handle, load } = setup();
      const cancel = vi.fn();
      const bytes = new TextEncoder().encode(
        `{"payload":"${"é".repeat(MAX_RECOMMENDATION_BODY_BYTES / 2)}"}`,
      );
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 100));
          controller.enqueue(bytes.subarray(100));
        },
        cancel,
      });
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (declaredLength !== undefined)
        headers["Content-Length"] = declaredLength;
      const response = await handle(streamedRequest(stream, { headers }));
      expect(response.status).toBe(413);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(load).not.toHaveBeenCalled();
    },
  );

  it("rejects an oversized Content-Length before reading the stream", async () => {
    const { handle, load } = setup();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const response = await handle(
      streamedRequest(stream, {
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(MAX_RECOMMENDATION_BODY_BYTES + 1),
        },
      }),
    );
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
  });

  it("accepts a valid JSON body exactly at the byte cap", async () => {
    const { handle, load } = setup();
    const body = JSON.stringify(input());
    const response = await handle(
      request(undefined, {
        body: body.padEnd(MAX_RECOMMENDATION_BODY_BYTES, " "),
      }),
    );
    expect(response.status).toBe(200);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid UTF-8 rather than silently replacing bytes", async () => {
    const { handle, load } = setup();
    const response = await handle(
      request(undefined, { body: new Uint8Array([0xff]) }),
    );
    expect(response.status).toBe(400);
    expect(load).not.toHaveBeenCalled();
  });

  it("returns a safe 422 when requested seed IDs are absent from the catalog", async () => {
    const { handle, load } = setup();
    const response = await handle(
      request(input({ seedIds: ["seed:1", "seed:2", "seed:3"] })),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      status: "error",
      code: "UNKNOWN_TITLES",
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it.each([
    new Error("postgres://user:secret@private-host error"),
    "provider private body",
  ])("sanitizes repository failures (%s)", async (error) => {
    const load = vi.fn().mockRejectedValue(error);
    const handle = createRecommendationHandler({ load }, { now: () => NOW });
    const response = await handle(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      status: "error",
      code: "CATALOG_UNAVAILABLE",
      message: "Recommendations are unavailable. Please try again.",
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("sanitizes internal ranking/clock errors", async () => {
    const load = vi.fn(async () => ({
      candidates: [candidate("movie:1")],
      preferenceTitles: [],
    }));
    const handle = createRecommendationHandler(
      { load },
      { now: () => new Date("invalid") },
    );
    const response = await handle(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "CATALOG_UNAVAILABLE",
    });
  });

  it("only reports unknown seeds after successful catalog loading", async () => {
    const load = vi.fn().mockRejectedValue(new UnknownPreferenceTitlesError());
    const handle = createRecommendationHandler({ load }, { now: () => NOW });
    const response = await handle(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "CATALOG_UNAVAILABLE",
    });
  });

  it("rejects pre-cancelled requests without a catalog read", async () => {
    const { handle, load } = setup();
    const controller = new AbortController();
    controller.abort("private cancellation detail");
    await expect(
      handle(request(input(), { signal: controller.signal })),
    ).rejects.toMatchObject({
      name: "AbortError",
      message: "Recommendation request cancelled.",
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("cancels a stalled body read without accessing the catalog", async () => {
    const { handle, load } = setup();
    const controller = new AbortController();
    const cancel = vi.fn();
    const result = handle(
      streamedRequest(new ReadableStream({ cancel }), {
        signal: controller.signal,
      }),
    );
    const assertion = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await assertion;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
  });

  it("cancels while the repository is stalled even when it ignores the signal", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const loading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const load = vi.fn(() => {
      started();
      return new Promise<CatalogCandidateSnapshot>(() => {});
    });
    const handle = createRecommendationHandler({ load }, { now: () => NOW });
    const result = handle(request(input(), { signal: controller.signal }));
    const assertion = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    await loading;
    controller.abort("private cancellation reason");
    await assertion;
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not convert repository AbortError into an ordinary 503", async () => {
    const load = vi
      .fn()
      .mockRejectedValue(new DOMException("private detail", "AbortError"));
    const handle = createRecommendationHandler({ load });
    await expect(handle(request())).rejects.toMatchObject({
      name: "AbortError",
      message: "Recommendation request cancelled.",
    });
  });

  it("does not return a result after the repository cancels the request", async () => {
    const controller = new AbortController();
    const load = vi.fn(async () => {
      controller.abort();
      return { candidates: [candidate("movie:1")], preferenceTitles: [] };
    });
    const handle = createRecommendationHandler({ load }, { now: () => NOW });
    await expect(
      handle(request(input(), { signal: controller.signal })),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
