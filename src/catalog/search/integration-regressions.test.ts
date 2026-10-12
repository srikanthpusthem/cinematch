import { describe, expect, it, vi } from "vitest";
import { createSearchHandler } from "./http";
import { createSearchService } from "./service";
import type { SearchDocument } from "./engine";

const NOW = new Date("2026-10-01T00:00:00Z");
const doc = (id: number, eligible = true): SearchDocument => ({
  titleId: id,
  kind: "movie",
  tmdbId: id + 100,
  title: `Star ${String(id).padStart(4, "0")}`,
  originalTitle: null,
  alternateTitles: [],
  year: null,
  posterPath: null,
  availabilityCheckedAt: null,
  eligible,
});

function liveSearch(count: number) {
  const eligible = new Set(Array.from({ length: count }, (_, n) => n + 1));
  const loadDocuments = vi.fn(async () => [...eligible].map((id) => doc(id)));
  const loadEligibleTitleIds = vi.fn(
    async (ids: readonly number[]) =>
      new Set(ids.filter((id) => eligible.has(id))),
  );
  const service = createSearchService({
    loadDocuments,
    loadEligibleTitleIds,
    loadQuizSeeds: async () => [],
    now: () => NOW,
  });
  return { service, eligible, loadDocuments, loadEligibleTitleIds };
}

describe("live catalog search integration", () => {
  it("rechecks cached titles and preserves paging offsets when earlier titles disappear", async () => {
    const { service, eligible, loadDocuments } = liveSearch(6);
    const first = await service.search({ q: "star", limit: 2 });
    if (!first.ok) throw new Error("Expected first page");
    expect(first.results.map((r) => r.id)).toEqual(["1", "2"]);
    eligible.delete(1); // A title on a previous page was removed.
    eligible.delete(3); // The next title became unavailable/tombstoned.
    const second = await service.search({
      q: "star",
      limit: 2,
      cursor: first.nextCursor,
    });
    if (!second.ok) throw new Error("Expected second page");
    expect(second.results.map((r) => r.id)).toEqual(["4", "5"]);
    expect(second.nextCursor).not.toBeNull();
    eligible.delete(6);
    const third = await service.search({
      q: "star",
      limit: 2,
      cursor: second.nextCursor,
    });
    expect(third).toEqual({ ok: true, results: [], nextCursor: null });
    const freshPage = await service.search({ q: "star", limit: 50 });
    expect(freshPage.ok && freshPage.results.map((r) => r.id)).toEqual([
      "2",
      "4",
      "5",
    ]);
    expect(loadDocuments).toHaveBeenCalledTimes(1);
  });

  it.each(["delete", "insert"] as const)(
    "rejects a cursor after a TTL rebuild with an earlier %s",
    async (change) => {
      let time = NOW.getTime();
      let docs = [1, 2, 3, 4].map((id) => doc(id));
      const loadDocuments = vi.fn(async () => docs);
      const service = createSearchService({
        loadDocuments,
        loadEligibleTitleIds: async (ids) =>
          new Set(ids.filter((id) => docs.some((d) => d.titleId === id))),
        loadQuizSeeds: async () => [],
        ttlMs: 100,
        now: () => new Date(time),
      });
      const first = await service.search({ q: "star", limit: 2 });
      if (!first.ok) throw new Error("Expected first page");
      expect(first.results.map((r) => r.id)).toEqual(["1", "2"]);
      docs =
        change === "delete"
          ? docs.filter((d) => d.titleId !== 1)
          : [doc(0), ...docs];
      time += 101;
      expect(
        await service.search({ q: "star", limit: 2, cursor: first.nextCursor }),
      ).toEqual({ ok: false, error: "invalid_cursor" });
      expect(loadDocuments).toHaveBeenCalledTimes(2);
      const restarted = await service.search({ q: "star", limit: 50 });
      expect(restarted.ok && restarted.results.map((r) => r.id)).toEqual(
        change === "delete" ? ["2", "3", "4"] : ["0", "1", "2", "3", "4"],
      );
    },
  );

  it("accepts equivalent ranked snapshots across instances and rejects changed ones", async () => {
    const instance = (ids: number[]) =>
      createSearchService({
        loadDocuments: async () => ids.map((id) => doc(id)),
        loadEligibleTitleIds: async (batch) => new Set(batch),
        loadQuizSeeds: async () => [],
        now: () => NOW,
      });
    const first = await instance([1, 2, 3, 4]).search({ q: "star", limit: 2 });
    if (!first.ok) throw new Error("Expected first page");
    expect(first.nextCursor!.length).toBeLessThanOrEqual(200);
    const equivalent = await instance([4, 3, 2, 1]).search({
      q: "star",
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(equivalent.ok && equivalent.results.map((r) => r.id)).toEqual([
      "3",
      "4",
    ]);
    expect(
      await instance([2, 3, 4]).search({
        q: "star",
        limit: 2,
        cursor: first.nextCursor,
      }),
    ).toEqual({ ok: false, error: "invalid_cursor" });
  });

  it("bounds eligibility queries and looks past removed records without a false next cursor", async () => {
    const { service, eligible, loadEligibleTitleIds, loadDocuments } =
      liveSearch(205);
    await service.search({ q: "star", limit: 1 }); // Warm the full index.
    eligible.clear();
    eligible.add(201);
    eligible.add(202);
    loadEligibleTitleIds.mockClear();
    const result = await service.search({ q: "star", limit: 2 });
    expect(result.ok && result.results.map((r) => r.id)).toEqual([
      "201",
      "202",
    ]);
    expect(result.ok && result.nextCursor).toBeNull();
    expect(loadEligibleTitleIds.mock.calls.map(([ids]) => ids.length)).toEqual([
      100, 100, 5,
    ]);
    expect(loadDocuments).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid queries and cursors before any document or eligibility load", async () => {
    const { service, loadDocuments, loadEligibleTitleIds } = liveSearch(1);
    expect(await service.search({ q: "a", limit: 2 })).toEqual({
      ok: false,
      error: "invalid_query",
    });
    expect(
      await service.search({ q: "star", limit: 2, cursor: "invalid!" }),
    ).toEqual({ ok: false, error: "invalid_cursor" });
    expect(loadDocuments).not.toHaveBeenCalled();
    expect(loadEligibleTitleIds).not.toHaveBeenCalled();
  });

  it.each([
    "q=a",
    "q=star&cursor=invalid!",
    "q=star&kind=episode",
    "q=star&limit=-1",
  ])("validates %s before database initialization", async (query) => {
    const getService = vi.fn(() => {
      throw new Error("Database not configured");
    });
    const response = await createSearchHandler(getService)(
      new Request(`http://localhost/api/catalog/search?${query}`),
    );
    expect(response.status).toBe(400);
    expect(getService).not.toHaveBeenCalled();
  });

  it("never serves cached results if a live eligibility check fails", async () => {
    const { service, loadEligibleTitleIds } = liveSearch(1);
    await service.search({ q: "star", limit: 2 });
    loadEligibleTitleIds.mockRejectedValueOnce(
      new Error("Database unavailable"),
    );
    await expect(service.search({ q: "star", limit: 2 })).rejects.toThrow(
      "Database unavailable",
    );
  });

  it("returns honest null metadata, string IDs and no ineligible quiz seeds", async () => {
    const service = createSearchService({
      loadDocuments: async () => [],
      loadQuizSeeds: async () => [doc(1), doc(2, false)],
      now: () => NOW,
    });
    expect(await service.quizSeeds({ limit: 12 })).toEqual([
      {
        id: "1",
        kind: "movie",
        tmdbId: 101,
        title: "Star 0001",
        year: null,
        posterPath: null,
        availability: { state: "unknown", checkedAt: null },
      },
    ]);
    expect(await service.search({ q: "star", limit: 12 })).toEqual({
      ok: true,
      results: [],
      nextCursor: null,
    });
  });
});
