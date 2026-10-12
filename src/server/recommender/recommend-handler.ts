import {
  MAX_RECOMMENDATION_BODY_BYTES,
  parseRecommendationRequest,
  type RecommendationErrorCode,
  type RecommendationRequest,
  type RecommendationResponse,
} from "@/lib/live-recommendation/contract";
import {
  recommendFromCatalog,
  UnknownPreferenceTitlesError,
  type CatalogCandidateRepository,
  type CatalogCandidateSnapshot,
} from "./baseline";

const ERROR_MESSAGES: Record<RecommendationErrorCode, string> = {
  INVALID_REQUEST: "Check your recommendation choices and try again.",
  UNKNOWN_TITLES:
    "Some selected favorites are no longer in the catalog. Edit your favorites and try again.",
  CATALOG_UNAVAILABLE: "Recommendations are unavailable. Please try again.",
};

class BodyTooLargeError extends Error {}

function abortError(): DOMException {
  return new DOMException("Recommendation request cancelled.", "AbortError");
}

function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function rethrowCancellation(error: unknown, signal: AbortSignal): void {
  if (signal.aborted || (error instanceof Error && error.name === "AbortError"))
    throw abortError();
}

async function abortable<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  checkAborted(signal);
  let onAbort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation(), cancelled]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function json(body: RecommendationResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(status === 405 ? { Allow: "POST" } : {}),
    },
  });
}

function failure(code: RecommendationErrorCode, status: number): Response {
  return json(
    { schemaVersion: 1, status: "error", code, message: ERROR_MESSAGES[code] },
    status,
  );
}

async function readRequest(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_RECOMMENDATION_BODY_BYTES
  ) {
    void request.body?.cancel().catch(() => {});
    throw new BodyTooLargeError();
  }
  if (!request.body) throw new Error("Missing request body.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  let text = "";
  let complete = false;
  try {
    while (true) {
      const chunk = await abortable(() => reader.read(), request.signal);
      checkAborted(request.signal);
      if (chunk.done) {
        complete = true;
        break;
      }
      received += chunk.value.byteLength;
      if (received > MAX_RECOMMENDATION_BODY_BYTES)
        throw new BodyTooLargeError();
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Injectable private seam; the route owner chooses the catalog repository. */
export function createRecommendationHandler(
  repository: CatalogCandidateRepository,
  { now = () => new Date() }: { now?: () => Date } = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    checkAborted(request.signal);
    if (request.method !== "POST") return failure("INVALID_REQUEST", 405);
    if (
      request.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    )
      return failure("INVALID_REQUEST", 415);

    let input: RecommendationRequest;
    try {
      input = parseRecommendationRequest(await readRequest(request));
      checkAborted(request.signal);
    } catch (error) {
      rethrowCancellation(error, request.signal);
      return failure(
        "INVALID_REQUEST",
        error instanceof BodyTooLargeError ? 413 : 400,
      );
    }

    let snapshot: CatalogCandidateSnapshot;
    try {
      snapshot = await abortable(
        () => repository.load(input, request.signal),
        request.signal,
      );
      checkAborted(request.signal);
    } catch (error) {
      rethrowCancellation(error, request.signal);
      return failure("CATALOG_UNAVAILABLE", 503);
    }

    try {
      const result = recommendFromCatalog(snapshot, input, now());
      checkAborted(request.signal);
      return json(result);
    } catch (error) {
      rethrowCancellation(error, request.signal);
      return error instanceof UnknownPreferenceTitlesError
        ? failure("UNKNOWN_TITLES", 422)
        : failure("CATALOG_UNAVAILABLE", 503);
    }
  };
}
