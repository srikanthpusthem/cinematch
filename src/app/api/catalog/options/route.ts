import { getCatalogDb } from "@/catalog/database";
import { createCatalogOptionsHandler } from "@/catalog/options/http";
import { loadCatalogOptions } from "@/catalog/options/repository";

export const dynamic = "force-dynamic";
export const GET = createCatalogOptionsHandler(() =>
  loadCatalogOptions(getCatalogDb()),
);
