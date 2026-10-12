import { getSearchService } from "@/catalog/search/default-service";
import { createQuizSeedsHandler } from "@/catalog/search/http";

export const GET = createQuizSeedsHandler(getSearchService);
