import { describe, expect, it, vi } from "vitest";
import { loadQuizSeeds, searchCatalog } from "./catalog-client";

const item = {
  id: "101",
  kind: "movie",
  tmdbId: 42,
  title: "A catalog title",
  year: null,
  posterPath: null,
  availability: { state: "unknown", checkedAt: null },
};

function responder(body: unknown, status = 200) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe("live catalog client", () => {
  it("loads catalog IDs and nullable metadata without fixture substitution", async () => {
    const fetchImpl = responder({ results: [item], limit: 12 });
    const result = await loadQuizSeeds({ fetchImpl });
    expect(result).toEqual({ results: [item], limit: 12, nextCursor: null });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "/api/catalog/quiz-seeds?limit=12",
    );
  });

  it("encodes a trimmed search and forwards cancellation", async () => {
    const controller = new AbortController();
    const fetchImpl = responder({
      results: [],
      limit: 12,
      nextCursor: "cursor:1",
    });
    await searchCatalog("  One & Two  ", {
      fetchImpl,
      signal: controller.signal,
      cursor: "next value",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/catalog/search?q=One+%26+Two&limit=12&cursor=next+value",
      expect.objectContaining({ signal: controller.signal, cache: "no-store" }),
    );
  });

  it("does not send a too-short search", async () => {
    const fetchImpl = responder({ results: [], limit: 12 });
    await expect(searchCatalog(" x ", { fetchImpl })).rejects.toThrow(
      "at least 2",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports catalog outages without substituting quiz fixtures", async () => {
    await expect(
      loadQuizSeeds({ fetchImpl: responder({ error: "internal_error" }, 500) }),
    ).rejects.toThrow("could not be loaded");
  });

  it("preserves AbortError for the owning request", async () => {
    const error = new DOMException("Aborted", "AbortError");
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(error);
    await expect(loadQuizSeeds({ fetchImpl })).rejects.toBe(error);
  });

  it.each([
    { ...item, id: "seed-fictional" },
    { ...item, title: "" },
    { ...item, availability: { state: "fresh", checkedAt: null } },
    { ...item, availability: { state: "current", checkedAt: "invalid" } },
  ])("rejects malformed catalog records", async (invalid) => {
    await expect(
      loadQuizSeeds({
        fetchImpl: responder({ results: [invalid], limit: 12 }),
      }),
    ).rejects.toThrow("unreadable");
  });

  it("rejects duplicate IDs", async () => {
    await expect(
      loadQuizSeeds({
        fetchImpl: responder({ results: [item, item], limit: 12 }),
      }),
    ).rejects.toThrow("duplicate");
  });
});

import { isCatalogId, loadCatalogOptions } from "./catalog-client";

describe("catalog constraint options", () => {
  it("keeps distinct numeric IDs for genres with the same label", async () => {
    const data = {
      providers: [
        {
          id: "8",
          name: "Netflix",
          logoPath: null,
          monetizations: ["flatrate"],
        },
      ],
      genres: [
        { id: "28", name: "Action", kinds: ["movie"] },
        { id: "10759", name: "Action & Adventure", kinds: ["series"] },
      ],
    };
    await expect(
      loadCatalogOptions({ fetchImpl: responder(data) }),
    ).resolves.toEqual(data);
  });

  it("rejects slug options and unsafe numeric IDs instead of guessing", async () => {
    expect(isCatalogId("netflix")).toBe(false);
    expect(isCatalogId("01")).toBe(false);
    expect(isCatalogId("9007199254740992")).toBe(false);
    await expect(
      loadCatalogOptions({
        fetchImpl: responder({
          providers: [
            {
              id: "netflix",
              name: "Netflix",
              logoPath: null,
              monetizations: ["flatrate"],
            },
          ],
          genres: [],
        }),
      }),
    ).rejects.toThrow("unreadable");
  });
});
