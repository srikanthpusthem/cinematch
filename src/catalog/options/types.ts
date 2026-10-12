/** Browser-safe catalog filter metadata. All IDs are stable numeric strings. */
export type CatalogMonetization = "flatrate" | "free" | "ads" | "rent" | "buy";

export interface CatalogOptions {
  providers: {
    id: string;
    name: string;
    logoPath: string | null;
    /** Offer types on presentable titles checked within 48h; rent/buy are not subscriptions. */
    monetizations: CatalogMonetization[];
  }[];
  genres: {
    id: string;
    name: string;
    /** Same-name movie/TV genre IDs remain separate; never infer IDs by label. */
    kinds: ("movie" | "series")[];
  }[];
}
