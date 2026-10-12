# US streaming availability and attribution

Implementation: `src/catalog/availability.ts` (refresh job), `src/catalog/attribution.ts`
(required texts and link labels), `src/app/about/page.tsx` (credits). Run it with
`npm run catalog:availability`. Nightly scheduling is #8.

## Source and scope

- Data: TMDB `/{movie|tv}/{id}/watch/providers`, which TMDB sources from
  **JustWatch**. This is the provisional v1 source (docs/product.md). Changing the
  vendor, or adding countries beyond the **US**, is an owner decision.
- Only the `US` region is stored (`title_availability.region` is CHECKed to `'US'`).
- Monetization types are stored as-is: `flatrate` (subscription), `free`, `ads`,
  `rent`, `buy`.

## What is stored

| Field                           | Meaning                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `title_availability` row        | The title's US availability was checked. With zero offers: checked, not streamable |
| No `title_availability` row     | Never checked                                                                      |
| `title_availability.fetched_at` | When we fetched it. TMDB returns no upstream timestamp, so this is the audit time  |
| `title_availability.source`     | `tmdb-justwatch`                                                                   |
| `title_availability.link`       | TMDB's watch page for the title (provider info; see below)                         |
| `title_offers`                  | One row per provider × monetization                                                |

**Refresh semantics.** Each run checks never-checked titles first, then the oldest
checks past `--max-age-days`. A successful check replaces the title's offers in one
transaction, so offers that disappeared upstream are removed. If a check fails
(timeout, outage, malformed response), nothing is written. The previous offers and
`fetched_at` stay as they were, so the title is retried first on the next run. The
run aborts on an invalid API key or when more than 5% of checks fail.

## Provider information is not a playback link

TMDB's reference is explicit: the `link` field points to a TMDB page, and the API
"is _not_ going to return full deep links". So:

- The stored `link` is always **provider information**
  (`STORED_AVAILABILITY_LINK_KIND = "provider-info"`), labeled
  **"Where to watch (TMDB)"** via `availabilityLinkLabel("provider-info")`.
- **"Watch now" is reserved for verified playback links**, which v1 does not have.
  UI code must get labels from `availabilityLinkLabel`, not hard-code them.

## Attribution requirements

Verified against the official pages on 2026-09-29:

- **TMDB** ([FAQ](https://developer.themoviedb.org/docs/faq),
  [logos](https://www.themoviedb.org/about/logos-attribution)):
  - Show the notice _"This product uses the TMDB API but is not endorsed or
    certified by TMDB."_
  - Show an approved TMDB logo, **less prominent** than CineMatch's own branding,
    in an **About/Credits** section.
  - Refer to it as "TMDB" or "The Movie Database" and link to
    <https://www.themoviedb.org>.
  - Implemented on `/about` (linked from every page's footer).
  - The logo is TMDB's official "alt short" SVG at
    `public/attribution/tmdb-logo.svg`. Its SHA-256
    `8e7b30f7…364db38b` matches TMDB's content-hashed filename.
- **JustWatch**
  ([watch providers reference](https://developer.themoviedb.org/reference/movie-watch-providers)):
  _"In order to use this data you must attribute the source of the data as
  JustWatch."_ `JUSTWATCH_ATTRIBUTION` is shown on `/about`, and **must also be
  shown wherever availability is displayed**. That applies to the results screen
  (#27) when it switches from mock to real data.

## Open owner decision

TMDB's free API is for **non-commercial** use; commercial use requires an agreement
with TMDB (sales@themoviedb.org). This is part of the owner's availability and
commercial-terms decision (#35) and is not decided here.
