import { describe, expect, it, vi } from "vitest";
import {
  MAX_RECOMMENDATION_BODY_BYTES,
  type RecommendationRequest,
  type RecommendationResult,
} from "./contract";
import {
  MAX_RECOMMENDATION_RESPONSE_BYTES,
  requestRecommendations,
} from "./client";

function input(
  overrides: Partial<RecommendationRequest> = {},
): RecommendationRequest {
  return {
    schemaVersion: 1,
    selectedUsServiceIds: [8],
    excludedGenreIds: [27],
    seedIds: [],
    watchedIds: ["watched:1"],
    likedIds: ["liked:1"],
    dislikedIds: ["disliked:1"],
    excludedIds: ["dismissed:1"],
    mood: "comfort",
    format: "movie",
    length: { format: "movie", category: "under-100" },
    limit: 1,
    ...overrides,
  };
}

function result(): RecommendationResult {
  return {
    schemaVersion: 1,
    rankingVersion: "metadata-v1",
    status: "ok",
    confidence: "cold-start",
    picks: [
      {
        id: "movie:1",
        title: "Catalog Movie",
        format: "movie",
        year: 2020,
        posterUrl: null,
        runtimeMinutes: 90,
        episodeRuntimeMinutes: null,
        seasonCount: null,
        reasons: ["Meets your explicit filters."],
        availability: {
          region: "US",
          state: "current",
          checkedAt: "2026-10-12T00:00:00.000Z",
          offers: [
            {
              providerId: 8,
              providerName: "Catalog Service",
              access: "subscription",
            },
          ],
          infoUrl: "https://catalog.example/title/movie-1",
        },
      },
    ],
    exhaustion: {
      requestedCount: 1,
      eligibleCount: 1,
      returnedCount: 1,
      missingCount: 0,
      exhausted: true,
      activeEditableConstraints: ["services", "genres", "format", "length"],
      relaxationOptions: [],
    },
    message: null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

const SAFE_ERROR = "Recommendations are unavailable. Please try again.";

describe("requestRecommendations", () => {
  it("sends one bounded same-origin POST with all choices and forwards cancellation", async () => {
    const controller = new AbortController();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(result()));
    const response = await requestRecommendations(input(), {
      signal: controller.signal,
      fetchImpl,
    });
    expect(response).toEqual(result());
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith("/api/recommend", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(input()),
      signal: controller.signal,
      cache: "no-store",
      credentials: "same-origin",
    });
  });

  it("gives edit-choices guidance for invalid local input without fetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      requestRecommendations(input({ limit: 6 }), { fetchImpl }),
    ).rejects.toThrow("Check your recommendation choices and try again.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a valid-shaped but oversized request without sending it", async () => {
    const ids = Array.from(
      { length: 200 },
      (_, index) => `${String(index).padStart(3, "0")}${"a".repeat(125)}`,
    );
    const value = input({ watchedIds: ids, excludedIds: ids });
    expect(
      new TextEncoder().encode(JSON.stringify(value)).byteLength,
    ).toBeGreaterThan(MAX_RECOMMENDATION_BODY_BYTES);
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(requestRecommendations(value, { fetchImpl })).rejects.toThrow(
      "Check your recommendation choices and try again.",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [
      "INVALID_REQUEST",
      400,
      "Check your recommendation choices and try again.",
    ],
    [
      "UNKNOWN_TITLES",
      422,
      "Some selected favorites are no longer in the catalog. Edit your favorites and try again.",
    ],
    ["CATALOG_UNAVAILABLE", 503, SAFE_ERROR],
  ])(
    "returns sanitized %s errors instead of arbitrary response text",
    async (code, status, message) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(
          {
            schemaVersion: 1,
            status: "error",
            code,
            message: "provider key=private-secret",
          },
          status as number,
        ),
      );
      expect(await requestRecommendations(input(), { fetchImpl })).toEqual({
        schemaVersion: 1,
        status: "error",
        code,
        message,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["bad schema version", { ...result(), schemaVersion: 2 }],
    ["invented ranking", { ...result(), rankingVersion: "paid-model-v9" }],
    ["wrong shape", { providerError: "private upstream detail" }],
    [
      "too many picks",
      {
        ...result(),
        picks: Array.from({ length: 6 }, () => result().picks[0]),
      },
    ],
    [
      "duplicate picks",
      { ...result(), picks: [result().picks[0], result().picks[0]] },
    ],
    [
      "unsafe URL",
      {
        ...result(),
        picks: [{ ...result().picks[0], posterUrl: "javascript:alert(1)" }],
      },
    ],
    [
      "oversized title",
      {
        ...result(),
        picks: [{ ...result().picks[0], title: "a".repeat(501) }],
      },
    ],
    [
      "impossible exhaustion",
      { ...result(), exhaustion: { ...result().exhaustion, returnedCount: 0 } },
    ],
    [
      "unknown error code",
      {
        schemaVersion: 1,
        status: "error",
        code: "UPSTREAM",
        message: "private",
      },
    ],
    [
      "oversized error text",
      {
        schemaVersion: 1,
        status: "error",
        code: "CATALOG_UNAVAILABLE",
        message: "p".repeat(501),
      },
    ],
  ])("rejects malformed responses: %s", async (_, body) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(body));
    await expect(
      requestRecommendations(input(), { fetchImpl }),
    ).rejects.toThrow(SAFE_ERROR);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    new Response("<html>private reverse-proxy error</html>", {
      status: 502,
      headers: { "Content-Type": "text/html" },
    }),
    new Response("{ private malformed JSON", {
      headers: { "Content-Type": "application/json" },
    }),
    new Response(null, { status: 204 }),
    new Response(JSON.stringify(result())),
    jsonResponse(result(), 503),
    jsonResponse(
      {
        schemaVersion: 1,
        status: "error",
        code: "CATALOG_UNAVAILABLE",
        message: "private",
      },
      200,
    ),
  ])(
    "rejects invalid media, JSON, body, or HTTP status without exposing it (%#)",
    async (response) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(
        requestRecommendations(input(), { fetchImpl }),
      ).rejects.toThrow(SAFE_ERROR);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    new Error("https://private-provider.example/key=secret"),
    "private connection failure",
  ])(
    "sanitizes fetch failures without retries or fixture fallback (%s)",
    async (error) => {
      const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(error);
      await expect(
        requestRecommendations(input(), { fetchImpl }),
      ).rejects.toThrow(SAFE_ERROR);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it.each([undefined, "1"])(
    "bounds actual streamed response bytes regardless of Content-Length %s",
    async (declaredLength) => {
      const cancel = vi.fn();
      const bytes = new TextEncoder().encode(
        `"${"é".repeat(MAX_RECOMMENDATION_RESPONSE_BYTES / 2)}"`,
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
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(stream, { headers }));
      await expect(
        requestRecommendations(input(), { fetchImpl }),
      ).rejects.toThrow(SAFE_ERROR);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects an oversized declared response without consuming it", async () => {
    const cancel = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(MAX_RECOMMENDATION_RESPONSE_BYTES + 1),
        },
      }),
    );
    await expect(
      requestRecommendations(input(), { fetchImpl }),
    ).rejects.toThrow(SAFE_ERROR);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("accepts valid JSON exactly at the response cap", async () => {
    const body = JSON.stringify(result()).padEnd(
      MAX_RECOMMENDATION_RESPONSE_BYTES,
      " ",
    );
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(body, { headers: { "Content-Type": "application/json" } }),
      );
    expect(await requestRecommendations(input(), { fetchImpl })).toEqual(
      result(),
    );
  });

  it("decodes split multibyte UTF-8 without corrupting titles", async () => {
    const value = result();
    value.picks[0]!.title = "Amélie";
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const split = bytes.indexOf(0xc3) + 1;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, split));
        controller.enqueue(bytes.subarray(split));
        controller.close();
      },
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(stream, {
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(await requestRecommendations(input(), { fetchImpl })).toEqual(value);
  });

  it("rejects invalid UTF-8", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([0xff]), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(
      requestRecommendations(input(), { fetchImpl }),
    ).rejects.toThrow(SAFE_ERROR);
  });

  it("does not fetch when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort("private cancellation reason");
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      requestRecommendations(input(), { signal: controller.signal, fetchImpl }),
    ).rejects.toMatchObject({
      name: "AbortError",
      message: "Recommendation request cancelled.",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects promptly when cancelled during a fetch that ignores its signal", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(
      () => new Promise<Response>(() => {}),
    );
    const pending = requestRecommendations(input(), {
      signal: controller.signal,
      fetchImpl,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      name: "AbortError",
      message: "Recommendation request cancelled.",
    });
    controller.abort("private cancellation reason");
    await assertion;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("preserves fetch AbortError as cancellation and sanitizes its message", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new DOMException("private cancellation detail", "AbortError"),
      );
    await expect(
      requestRecommendations(input(), { fetchImpl }),
    ).rejects.toMatchObject({
      name: "AbortError",
      message: "Recommendation request cancelled.",
    });
  });

  it("cancels an in-flight response body read", async () => {
    const controller = new AbortController();
    let reading!: () => void;
    const started = new Promise<void>((resolve) => {
      reading = resolve;
    });
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>(
      {
        pull() {
          reading();
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(stream, {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const pending = requestRecommendations(input(), {
      signal: controller.signal,
      fetchImpl,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await started;
    controller.abort();
    await assertion;
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("never returns success after a fetch cancels the request", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      controller.abort();
      return jsonResponse(result());
    });
    await expect(
      requestRecommendations(input(), { signal: controller.signal, fetchImpl }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
