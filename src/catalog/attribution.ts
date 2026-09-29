// Required data attribution, and the only sanctioned labels for availability
// links. Sources and exact requirements: docs/availability.md.

export const TMDB_URL = "https://www.themoviedb.org";

/** Exact notice required by TMDB (developer.themoviedb.org/docs/faq). */
export const TMDB_NOTICE =
  "This product uses the TMDB API but is not endorsed or certified by TMDB.";

/** Official TMDB "alt short" logo (public/attribution/tmdb-logo.svg). */
export const TMDB_LOGO = {
  src: "/attribution/tmdb-logo.svg",
  alt: "TMDB (The Movie Database)",
  /** Intrinsic aspect ratio of the official SVG (273.42 x 35.52). */
  width: 273.42,
  height: 35.52,
} as const;

/**
 * TMDB's watch-provider terms: "you must attribute the source of the data as
 * JustWatch." Show this wherever streaming availability is displayed.
 */
export const JUSTWATCH_ATTRIBUTION =
  "Streaming availability data by JustWatch.";

/**
 * What an availability link points to. TMDB's `link` is a TMDB watch page
 * listing providers, explicitly not a deep link into a streaming service.
 * Only a separately verified playback URL may be presented as "Watch now",
 * and v1 has no source of verified playback links.
 */
export type AvailabilityLinkKind = "provider-info" | "verified-playback";

export function availabilityLinkLabel(kind: AvailabilityLinkKind): string {
  switch (kind) {
    case "provider-info":
      return "Where to watch (TMDB)";
    case "verified-playback":
      return "Watch now";
  }
}

/** The link stored in title_availability.link is always provider information. */
export const STORED_AVAILABILITY_LINK_KIND: AvailabilityLinkKind =
  "provider-info";
