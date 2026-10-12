import { getRecommendationRepository } from "@/server/recommender/default-service";
import { createRecommendationHandler } from "@/server/recommender/recommend-handler";

export const runtime = "nodejs";

/** The repository is resolved only after the handler validates the whole body. */
export const POST = createRecommendationHandler({
  load: (request, signal) =>
    getRecommendationRepository().load(request, signal),
});
