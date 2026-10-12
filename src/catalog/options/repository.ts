// Filter IDs come from catalog relationships, never a hard-coded name mapping.
import { and, asc, eq, gte, isNull, or } from "drizzle-orm";
import {
  genres,
  titleAvailability,
  titleGenres,
  titleLifecycle,
  titleOffers,
  titles,
  watchProviders,
} from "../../db/schema";
import { DEFAULT_LIFECYCLE_POLICY } from "../lifecycle";
import type { CatalogDb } from "../store";
import type { CatalogOptions } from "./types";

const eligible = or(
  isNull(titleLifecycle.titleId),
  eq(titleLifecycle.status, "active"),
);

export async function loadCatalogOptions(
  db: CatalogDb,
  now = new Date(),
): Promise<CatalogOptions> {
  const currentSince = new Date(
    now.getTime() -
      DEFAULT_LIFECYCLE_POLICY.availabilityMaxAgeHours * 3_600_000,
  );
  const [providerRows, genreRows] = await Promise.all([
    db
      .selectDistinct({
        id: watchProviders.id,
        name: watchProviders.name,
        logoPath: watchProviders.logoPath,
        monetization: titleOffers.monetization,
      })
      .from(watchProviders)
      .innerJoin(titleOffers, eq(titleOffers.providerId, watchProviders.id))
      .innerJoin(titles, eq(titles.id, titleOffers.titleId))
      .innerJoin(
        titleAvailability,
        and(
          eq(titleAvailability.titleId, titleOffers.titleId),
          eq(titleAvailability.region, titleOffers.region),
        ),
      )
      .leftJoin(titleLifecycle, eq(titleLifecycle.titleId, titles.id))
      .where(
        and(
          eligible,
          eq(titleOffers.region, "US"),
          // A stale subscription must not make a current rental-only service
          // appear as subscription access in the selection step.
          gte(titleAvailability.fetchedAt, currentSince),
        ),
      )
      .orderBy(
        asc(watchProviders.name),
        asc(watchProviders.id),
        asc(titleOffers.monetization),
      ),
    db
      .selectDistinct({ id: genres.id, name: genres.name, kind: titles.kind })
      .from(genres)
      .innerJoin(titleGenres, eq(titleGenres.genreId, genres.id))
      .innerJoin(titles, eq(titles.id, titleGenres.titleId))
      .leftJoin(titleLifecycle, eq(titleLifecycle.titleId, titles.id))
      .where(eligible)
      .orderBy(asc(genres.name), asc(genres.id), asc(titles.kind)),
  ]);

  const providers = new Map<string, CatalogOptions["providers"][number]>();
  for (const row of providerRows) {
    const id = String(row.id);
    const provider = providers.get(id) ?? {
      id,
      name: row.name,
      logoPath: row.logoPath,
      monetizations: [],
    };
    provider.monetizations.push(row.monetization);
    providers.set(id, provider);
  }
  const groupedGenres = new Map<string, CatalogOptions["genres"][number]>();
  for (const row of genreRows) {
    const id = String(row.id);
    const genre = groupedGenres.get(id) ?? { id, name: row.name, kinds: [] };
    genre.kinds.push(row.kind);
    groupedGenres.set(id, genre);
  }
  return {
    providers: [...providers.values()],
    genres: [...groupedGenres.values()],
  };
}
