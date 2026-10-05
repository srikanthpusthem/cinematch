// HTTP layer for the catalog read endpoints (issue #15): parse and bound
// parameters, map to the service, and never leak internal errors.
import { parseKind, parseLimit } from "./engine";
import { QUIZ_SEED_LIMITS } from "./repository";
import type { SearchService } from "./service";

const headers = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

const fail = (error: string, status = 400) => json({ error }, status);

type GetService = () => SearchService | Promise<SearchService>;

async function guarded(
  label: string,
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    // Full details go to server logs only; clients get a generic error code.
    console.error(`[${label}]`, error);
    return fail("internal_error", 500);
  }
}

/** GET /api/catalog/search?q=&kind=&limit=&cursor= */
export function createSearchHandler(getService: GetService) {
  return (request: Request) =>
    guarded("catalog/search", async () => {
      const params = new URL(request.url).searchParams;
      const kind = parseKind(params.get("kind"));
      if (kind === null) return fail("invalid_kind");
      const limit = parseLimit(params.get("limit"));
      if (limit === null) return fail("invalid_limit");

      const service = await getService();
      const result = await service.search({
        q: params.get("q") ?? "",
        kind,
        limit,
        cursor: params.get("cursor"),
      });
      if (!result.ok) return fail(result.error);
      return json({
        results: result.results,
        nextCursor: result.nextCursor,
        limit,
      });
    });
}

/** GET /api/catalog/quiz-seeds?kind=&limit= */
export function createQuizSeedsHandler(getService: GetService) {
  return (request: Request) =>
    guarded("catalog/quiz-seeds", async () => {
      const params = new URL(request.url).searchParams;
      const kind = parseKind(params.get("kind"));
      if (kind === null) return fail("invalid_kind");
      const rawLimit = params.get("limit");
      let limit: number = QUIZ_SEED_LIMITS.defaultLimit;
      if (rawLimit !== null && rawLimit !== "") {
        if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1)
          return fail("invalid_limit");
        limit = Math.min(Number(rawLimit), QUIZ_SEED_LIMITS.maxLimit);
      }
      const service = await getService();
      return json({ results: await service.quizSeeds({ kind, limit }), limit });
    });
}
