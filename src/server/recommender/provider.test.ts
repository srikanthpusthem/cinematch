import { describe, expect, it } from "vitest";
import {
  createFixtureEmbeddingProvider,
  createFixtureRerankProvider,
  ProviderContractError,
  validateEmbeddingResponse,
  validateRerankResponse,
} from "./provider";

describe("provider contracts", () => {
  it("returns deterministic fixture embeddings with validated dimensions", async () => {
    const provider = createFixtureEmbeddingProvider();
    const request = { inputs: ["Heat", "Alien"], dimensions: 3 };

    const first = await provider.embed(request);
    const second = await provider.embed(request);

    expect(first).toEqual(second);
    expect(first.vectors).toHaveLength(2);
    expect(first.vectors[0]).toHaveLength(3);
  });

  it("times out fixture embedding calls", async () => {
    const provider = createFixtureEmbeddingProvider({ latencyMs: 25 });

    await expect(
      provider.embed(
        { inputs: ["Interstellar"], dimensions: 2 },
        { timeoutMs: 5 },
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("supports cancellation signals", async () => {
    const provider = createFixtureRerankProvider({ latencyMs: 25 });
    const controller = new AbortController();

    const pending = provider.rerank(
      {
        query: "comforting comedy",
        candidateIds: ["tt0107048", "tt0109830", "tt0110912"],
        limit: 2,
      },
      { signal: controller.signal, timeoutMs: 100 },
    );

    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("returns only candidate IDs in deterministic fixture reranks", async () => {
    const provider = createFixtureRerankProvider();
    const request = {
      query: "tense thriller",
      candidateIds: ["tt1375666", "tt0133093", "tt0816692"],
      limit: 2,
    };

    const first = await provider.rerank(request);
    const second = await provider.rerank(request);

    expect(first).toEqual(second);
    expect(first.ranked).toHaveLength(2);
    expect(
      first.ranked
        .map((item) => item.candidateId)
        .every((id) => request.candidateIds.includes(id)),
    ).toBe(true);
  });

  it("rejects rerank responses containing unknown candidate IDs", () => {
    expect(() =>
      validateRerankResponse(
        {
          query: "anything",
          candidateIds: ["id-a", "id-b"],
          limit: 2,
        },
        {
          ranked: [{ candidateId: "id-c", score: 0.9 }],
        },
      ),
    ).toThrowError(ProviderContractError);
  });

  it("rejects invalid embedding response dimensions", () => {
    expect(() =>
      validateEmbeddingResponse(
        {
          inputs: ["one"],
          dimensions: 2,
        },
        {
          vectors: [[0.1]],
        },
      ),
    ).toThrowError(ProviderContractError);
  });
});
