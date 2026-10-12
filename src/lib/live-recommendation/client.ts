import {
  MAX_RECOMMENDATION_BODY_BYTES,
  parseRecommendationRequest,
  parseRecommendationResponse,
  type RecommendationErrorCode,
  type RecommendationRequest,
  type RecommendationResponse,
} from "./contract";

// Bound even a compromised/misconfigured endpoint before JSON parsing.
export const MAX_RECOMMENDATION_RESPONSE_BYTES = 512 * 1024;

const ERROR_MESSAGES: Record<RecommendationErrorCode, string> = {
  INVALID_REQUEST: "Check your recommendation choices and try again.",
  UNKNOWN_TITLES:
    "Some selected favorites are no longer in the catalog. Edit your favorites and try again.",
  CATALOG_UNAVAILABLE: "Recommendations are unavailable. Please try again.",
};

function abortError(): DOMException {
  return new DOMException("Recommendation request cancelled.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

async function abortable<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  checkAborted(signal);
  if (!signal) return operation();
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

async function readResponse(
  response: Response,
  signal?: AbortSignal,
): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (
    response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() !== "application/json" ||
    (declaredLength !== null &&
      /^\d+$/.test(declaredLength) &&
      Number(declaredLength) > MAX_RECOMMENDATION_RESPONSE_BYTES)
  ) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Invalid recommendation response.");
  }
  if (!response.body) throw new Error("Missing recommendation response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  let text = "";
  let complete = false;
  try {
    while (true) {
      const chunk = await abortable(() => reader.read(), signal);
      checkAborted(signal);
      if (chunk.done) {
        complete = true;
        break;
      }
      received += chunk.value.byteLength;
      if (received > MAX_RECOMMENDATION_RESPONSE_BYTES)
        throw new Error("Recommendation response is too large.");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** One same-origin request. Errors never expose upstream bodies or credentials. */
export async function requestRecommendations(
  input: RecommendationRequest,
  {
    signal,
    fetchImpl = fetch,
  }: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<RecommendationResponse> {
  let body: string;
  try {
    checkAborted(signal);
    const request = parseRecommendationRequest(input);
    body = JSON.stringify(request);
    if (
      new TextEncoder().encode(body).byteLength > MAX_RECOMMENDATION_BODY_BYTES
    )
      throw new Error("Recommendation request is too large.");
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw abortError();
    throw new Error(ERROR_MESSAGES.INVALID_REQUEST);
  }

  try {
    const response = await abortable(
      () =>
        fetchImpl("/api/recommend", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body,
          signal,
          cache: "no-store",
          credentials: "same-origin",
        }),
      signal,
    );
    checkAborted(signal);
    const result = parseRecommendationResponse(
      await readResponse(response, signal),
    );
    checkAborted(signal);
    if (response.ok !== (result.status !== "error"))
      throw new Error("Inconsistent recommendation response.");
    if (result.status === "error") {
      return { ...result, message: ERROR_MESSAGES[result.code] };
    }
    return result;
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw abortError();
    throw new Error(ERROR_MESSAGES.CATALOG_UNAVAILABLE);
  }
}
