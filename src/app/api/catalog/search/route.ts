import { getSearchService } from "@/catalog/search/default-service";
import { createSearchHandler } from "@/catalog/search/http";

// Reads request.url, so this runs per request (route handlers aren't cached).
export const GET = createSearchHandler(getSearchService);
