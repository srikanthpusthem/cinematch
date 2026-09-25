const DEFAULT_TIMEOUT_MS = 4_000;

export type ProviderErrorCode =
  | "ABORTED"
  | "TIMEOUT"
  | "INVALID_REQUEST"
  | "INVALID_RESPONSE"
  | "PROVIDER_FAILURE";

export class ProviderContractError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProviderContractError";
  }
}

export interface ProviderRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface EmbeddingRequest {
  readonly inputs: readonly string[];
  readonly dimensions: number;
}

export interface EmbeddingResponse {
  readonly vectors: readonly (readonly number[])[];
}

export interface EmbeddingProvider {
  embed(
    request: EmbeddingRequest,
    options?: ProviderRequestOptions,
  ): Promise<EmbeddingResponse>;
}

export interface RerankRequest {
  readonly query: string;
  readonly candidateIds: readonly string[];
  readonly limit: number;
}

export interface RerankItem {
  readonly candidateId: string;
  readonly score: number;
}

export interface RerankResponse {
  readonly ranked: readonly RerankItem[];
}

export interface RerankProvider {
  rerank(
    request: RerankRequest,
    options?: ProviderRequestOptions,
  ): Promise<RerankResponse>;
}

export function validateEmbeddingResponse(
  request: EmbeddingRequest,
  response: EmbeddingResponse,
): EmbeddingResponse {
  if (response.vectors.length !== request.inputs.length) {
    throw new ProviderContractError(
      "INVALID_RESPONSE",
      "Embedding provider returned invalid output.",
    );
  }

  for (const vector of response.vectors) {
    if (vector.length !== request.dimensions) {
      throw new ProviderContractError(
        "INVALID_RESPONSE",
        "Embedding provider returned invalid output.",
      );
    }

    for (const value of vector) {
      if (!Number.isFinite(value)) {
        throw new ProviderContractError(
          "INVALID_RESPONSE",
          "Embedding provider returned invalid output.",
        );
      }
    }
  }

  return response;
}

export function validateRerankResponse(
  request: RerankRequest,
  response: RerankResponse,
): RerankResponse {
  const allowed = new Set(request.candidateIds);

  if (response.ranked.length > request.limit) {
    throw new ProviderContractError(
      "INVALID_RESPONSE",
      "Reranker returned invalid output.",
    );
  }

  const seen = new Set<string>();

  for (const item of response.ranked) {
    if (!allowed.has(item.candidateId) || seen.has(item.candidateId)) {
      throw new ProviderContractError(
        "INVALID_RESPONSE",
        "Reranker returned invalid output.",
      );
    }

    if (!Number.isFinite(item.score)) {
      throw new ProviderContractError(
        "INVALID_RESPONSE",
        "Reranker returned invalid output.",
      );
    }

    seen.add(item.candidateId);
  }

  return response;
}

interface FixtureOptions {
  readonly latencyMs?: number;
}

interface ExecutionScope {
  readonly signal: AbortSignal;
  readonly cleanup: () => void;
  readonly didTimeout: () => boolean;
}

function normalizeTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS;

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new ProviderContractError(
      "INVALID_REQUEST",
      "Provider request timeout is invalid.",
    );
  }

  return timeoutMs;
}

function createExecutionScope(options: ProviderRequestOptions): ExecutionScope {
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);

  if (options.signal?.aborted) {
    throw new ProviderContractError(
      "ABORTED",
      "Provider request was cancelled.",
    );
  }

  const controller = new AbortController();
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let removeParentListener = () => {};
  if (options.signal) {
    const onParentAbort = () => controller.abort();
    options.signal.addEventListener("abort", onParentAbort, { once: true });
    removeParentListener = () =>
      options.signal?.removeEventListener("abort", onParentAbort);
  }

  const cleanup = () => {
    clearTimeout(timeout);
    removeParentListener();
  };

  return {
    signal: controller.signal,
    cleanup,
    didTimeout: () => timedOut,
  };
}

async function waitForLatency(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;

  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(
        new ProviderContractError("ABORTED", "Provider request was cancelled."),
      );
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(
        new ProviderContractError("ABORTED", "Provider request was cancelled."),
      );
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function executeWithBoundaries<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: ProviderRequestOptions | undefined,
): Promise<T> {
  const scope = createExecutionScope(options ?? {});

  try {
    const output = await operation(scope.signal);

    if (scope.signal.aborted) {
      if (scope.didTimeout()) {
        throw new ProviderContractError(
          "TIMEOUT",
          "Provider request timed out.",
        );
      }
      throw new ProviderContractError(
        "ABORTED",
        "Provider request was cancelled.",
      );
    }

    return output;
  } catch (error) {
    if (error instanceof ProviderContractError) {
      if (scope.didTimeout() && error.code === "ABORTED") {
        throw new ProviderContractError(
          "TIMEOUT",
          "Provider request timed out.",
        );
      }

      throw error;
    }

    if (scope.didTimeout()) {
      throw new ProviderContractError("TIMEOUT", "Provider request timed out.");
    }

    if (scope.signal.aborted) {
      throw new ProviderContractError(
        "ABORTED",
        "Provider request was cancelled.",
      );
    }

    throw new ProviderContractError(
      "PROVIDER_FAILURE",
      "Provider request failed.",
    );
  } finally {
    scope.cleanup();
  }
}

function validateEmbeddingRequest(request: EmbeddingRequest): void {
  if (!Number.isInteger(request.dimensions) || request.dimensions <= 0) {
    throw new ProviderContractError(
      "INVALID_REQUEST",
      "Embedding request is invalid.",
    );
  }

  for (const input of request.inputs) {
    if (typeof input !== "string") {
      throw new ProviderContractError(
        "INVALID_REQUEST",
        "Embedding request is invalid.",
      );
    }
  }
}

function validateRerankRequest(request: RerankRequest): void {
  if (typeof request.query !== "string") {
    throw new ProviderContractError(
      "INVALID_REQUEST",
      "Rerank request is invalid.",
    );
  }

  if (!Number.isInteger(request.limit) || request.limit < 0) {
    throw new ProviderContractError(
      "INVALID_REQUEST",
      "Rerank request is invalid.",
    );
  }

  if (request.limit > request.candidateIds.length) {
    throw new ProviderContractError(
      "INVALID_REQUEST",
      "Rerank request is invalid.",
    );
  }

  const unique = new Set<string>();
  for (const candidateId of request.candidateIds) {
    if (candidateId.length === 0 || unique.has(candidateId)) {
      throw new ProviderContractError(
        "INVALID_REQUEST",
        "Rerank request is invalid.",
      );
    }

    unique.add(candidateId);
  }
}

function deterministicScore(seed: string): number {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 0xffffffff;
}

function deterministicVector(
  text: string,
  dimensions: number,
): readonly number[] {
  const vector: number[] = [];

  for (let dimension = 0; dimension < dimensions; dimension += 1) {
    const score = deterministicScore(`${text}:${dimension}`);
    vector.push(Math.round((score * 2 - 1) * 1_000_000) / 1_000_000);
  }

  return vector;
}

export function createFixtureEmbeddingProvider(
  options: FixtureOptions = {},
): EmbeddingProvider {
  const latencyMs = options.latencyMs ?? 0;

  return {
    async embed(request, requestOptions) {
      validateEmbeddingRequest(request);

      return executeWithBoundaries(async (signal) => {
        await waitForLatency(latencyMs, signal);

        const response: EmbeddingResponse = {
          vectors: request.inputs.map((input) =>
            deterministicVector(input, request.dimensions),
          ),
        };

        return validateEmbeddingResponse(request, response);
      }, requestOptions);
    },
  };
}

export function createFixtureRerankProvider(
  options: FixtureOptions = {},
): RerankProvider {
  const latencyMs = options.latencyMs ?? 0;

  return {
    async rerank(request, requestOptions) {
      validateRerankRequest(request);

      return executeWithBoundaries(async (signal) => {
        await waitForLatency(latencyMs, signal);

        const ranked = [...request.candidateIds]
          .map((candidateId) => ({
            candidateId,
            score: deterministicScore(`${request.query}:${candidateId}`),
          }))
          .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            return left.candidateId.localeCompare(right.candidateId);
          })
          .slice(0, request.limit);

        return validateRerankResponse(request, { ranked });
      }, requestOptions);
    },
  };
}
