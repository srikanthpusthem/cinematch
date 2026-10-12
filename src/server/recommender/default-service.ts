import { getCatalogDb } from "@/catalog/database";
import { createPostgresCatalogCandidateRepository } from "./catalog-repository";
import type { CatalogCandidateRepository } from "./baseline";

const globalForRecommendations = globalThis as unknown as {
  recommendationRepository?: CatalogCandidateRepository;
};

/** Lazy shared read pool; importing or validating a request needs no credentials. */
export function getRecommendationRepository(): CatalogCandidateRepository {
  return (globalForRecommendations.recommendationRepository ??=
    createPostgresCatalogCandidateRepository(getCatalogDb()));
}
