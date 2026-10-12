import { describe, expect, it } from "vitest";
import { catalogPosterUrl } from "./catalog-image";

describe("catalogPosterUrl", () => {
  it.each(["/poster-abc_123.jpg", "/poster.png", "/poster.webp"])(
    "maps a valid provider image path %s",
    (path) => {
      expect(catalogPosterUrl(path)).toBe(
        `https://image.tmdb.org/t/p/w500${path}`,
      );
    },
  );
  it("normalizes only allowlisted provider image URLs", () => {
    expect(catalogPosterUrl("https://image.tmdb.org/t/p/original/a.jpg")).toBe(
      "https://image.tmdb.org/t/p/w500/a.jpg",
    );
  });
  it.each([
    null,
    "",
    "poster.jpg",
    "//attacker.test/a.jpg",
    "/../a.jpg",
    "/%2e%2e/a.jpg",
    "/a.jpg?token=secret",
    "/a.svg",
    "javascript:alert(1)",
    "http://image.tmdb.org/t/p/w500/a.jpg",
    "https://attacker.test/a.jpg",
    "https://image.tmdb.org.evil.test/t/p/w500/a.jpg",
    "https://user:pass@image.tmdb.org/t/p/w500/a.jpg",
    "https://image.tmdb.org/t/p/w500/a.jpg#x",
  ])("withholds malformed or untrusted poster path %s", (path) => {
    expect(catalogPosterUrl(path)).toBeNull();
  });
});
