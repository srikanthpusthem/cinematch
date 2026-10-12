import { describe, expect, it, vi } from "vitest";
import { createCatalogOptionsHandler } from "./http";
import type { CatalogOptions } from "./types";

describe("catalog options HTTP", () => {
  it("returns exact provider types and distinct movie/series genre IDs", async () => {
    const data: CatalogOptions = {
      providers: [
        {
          id: "8",
          name: "Example",
          logoPath: null,
          monetizations: ["flatrate", "rent", "buy"],
        },
      ],
      genres: [
        { id: "28", name: "Action", kinds: ["movie"] },
        { id: "10759", name: "Action & Adventure", kinds: ["series"] },
      ],
    };
    const response = await createCatalogOptionsHandler(async () => data)();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(data);
  });

  it("leaves an empty catalog empty without fixture options", async () => {
    const response = await createCatalogOptionsHandler(async () => ({
      providers: [],
      genres: [],
    }))();
    expect(await response.json()).toEqual({ providers: [], genres: [] });
  });

  it("does not expose database errors to the browser", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await createCatalogOptionsHandler(async () => {
        throw new Error("postgres://user:secret@host/db");
      })();
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "internal_error" });
    } finally {
      log.mockRestore();
    }
  });
});
