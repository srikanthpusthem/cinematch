import type { CatalogOptions } from "./types";

export function createCatalogOptionsHandler(
  load: () => Promise<CatalogOptions>,
) {
  return async () => {
    const headers = {
      "content-type": "application/json",
      "cache-control": "no-store",
    };
    try {
      return new Response(JSON.stringify(await load()), { headers });
    } catch (error) {
      console.error("[catalog/options]", error);
      return new Response(JSON.stringify({ error: "internal_error" }), {
        status: 500,
        headers,
      });
    }
  };
}
