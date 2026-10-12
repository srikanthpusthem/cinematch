import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecommendationRequest } from "@/lib/live-recommendation/contract";

const { getRepository, load } = vi.hoisted(() => ({
  getRepository: vi.fn(),
  load: vi.fn(),
}));
vi.mock("@/server/recommender/default-service", () => ({
  getRecommendationRepository: getRepository,
}));
import { POST, runtime } from "./route";

const input: RecommendationRequest = {
  schemaVersion: 1,
  selectedUsServiceIds: [],
  excludedGenreIds: [],
  seedIds: [],
  watchedIds: [],
  likedIds: [],
  dislikedIds: [],
  excludedIds: [],
  mood: "laugh",
  format: "movie",
  length: null,
  limit: 5,
};
const request = (body: unknown) =>
  new Request("http://localhost/api/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  getRepository.mockReset();
  load.mockReset();
  getRepository.mockReturnValue({ load });
});
describe("POST /api/recommend", () => {
  it("uses the Node runtime and imports without a database connection", () => {
    expect(runtime).toBe("nodejs");
    expect(getRepository).not.toHaveBeenCalled();
  });
  it("rejects invalid requests before constructing any repository", async () => {
    const result = await POST(request({ ...input, seedIds: ["one"] }));
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({
      status: "error",
      code: "INVALID_REQUEST",
    });
    expect(getRepository).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });
  it("returns a safe 503 when no database is configured", async () => {
    getRepository.mockImplementation(() => {
      throw new Error(
        "DATABASE_URL missing or postgres://secret:credential@host",
      );
    });
    const result = await POST(request(input));
    expect(result.status).toBe(503);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toEqual({
      schemaVersion: 1,
      status: "error",
      code: "CATALOG_UNAVAILABLE",
      message: "Recommendations are unavailable. Please try again.",
    });
    expect(load).not.toHaveBeenCalled();
  });
  it("distinguishes a configured empty catalog from an outage", async () => {
    load.mockResolvedValue({ candidates: [], preferenceTitles: [] });
    const result = await POST(request(input));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ status: "empty", picks: [] });
    expect(load).toHaveBeenCalledTimes(1);
  });
});
