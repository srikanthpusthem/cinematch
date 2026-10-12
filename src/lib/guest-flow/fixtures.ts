import type { Mood, SeedTitle, ServiceId, WatchFormat } from "./types";

export type CatalogOffer = {
  serviceId: ServiceId;
  access: "subscription" | "rent" | "buy";
  /** ISO timestamp; omit to let mock-api default to a fresh MOCK_NOW-relative value. */
  freshnessCheckedAt?: string;
  /** Fixture-only verified HTTPS deep-link. Never invent in UI. */
  verifiedWatchUrl?: string;
};

/** Fresh mock check: one day before MOCK_NOW. */
export const FIXTURE_FRESH_CHECKED_AT = "2026-09-27T18:00:00.000Z";

/** Deliberately stale mock check: ten days before MOCK_NOW. */
export const FIXTURE_STALE_CHECKED_AT = "2026-09-18T18:00:00.000Z";

/** Fixed mock catalog. Not live availability. */
export type CatalogTitle = {
  id: string;
  title: string;
  year: number;
  format: WatchFormat;
  minutes: number;
  seasons?: number;
  genres: string[];
  moods: Mood[];
  offers: CatalogOffer[];
};

export const QUIZ_SEEDS: SeedTitle[] = [
  {
    role: "seed",
    id: "seed-budapest",
    title: "The Grand Budapest Hotel",
    year: 2014,
    genres: ["Comedy"],
  },
  {
    role: "seed",
    id: "seed-mad-max",
    title: "Mad Max: Fury Road",
    year: 2015,
    genres: ["Action"],
  },
  {
    role: "seed",
    id: "seed-spirited",
    title: "Spirited Away",
    year: 2001,
    genres: ["Animation"],
  },
  {
    role: "seed",
    id: "seed-social",
    title: "The Social Network",
    year: 2010,
    genres: ["Drama"],
  },
  {
    role: "seed",
    id: "seed-get-out",
    title: "Get Out",
    year: 2017,
    genres: ["Horror"],
  },
  {
    role: "seed",
    id: "seed-parks",
    title: "Parks and Recreation",
    year: 2009,
    genres: ["Comedy"],
  },
  {
    role: "seed",
    id: "seed-arrival",
    title: "Arrival",
    year: 2016,
    genres: ["Science Fiction"],
  },
  {
    role: "seed",
    id: "seed-booksmart",
    title: "Booksmart",
    year: 2019,
    genres: ["Comedy"],
  },
];

export const CATALOG: CatalogTitle[] = [
  {
    id: "rec-about-time",
    title: "About Time",
    year: 2013,
    format: "movie",
    minutes: 123,
    genres: ["Comedy", "Romance"],
    moods: ["comfort"],
    offers: [
      {
        serviceId: "prime",
        access: "subscription",
        freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
        verifiedWatchUrl: "https://watch.example/prime/rec-about-time",
      },
    ],
  },
  {
    id: "rec-wilderpeople",
    title: "Hunt for the Wilderpeople",
    year: 2016,
    format: "movie",
    minutes: 97,
    genres: ["Comedy"],
    moods: ["comfort", "laugh"],
    offers: [
      {
        serviceId: "prime",
        access: "subscription",
        freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
        verifiedWatchUrl: "https://watch.example/prime/rec-wilderpeople",
      },
    ],
  },
  {
    id: "rec-paddington",
    title: "Paddington 2",
    year: 2017,
    format: "movie",
    minutes: 104,
    genres: ["Comedy"],
    moods: ["comfort", "laugh"],
    offers: [
      {
        serviceId: "netflix",
        access: "subscription",
        freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
        verifiedWatchUrl: "https://watch.example/netflix/rec-paddington",
      },
    ],
  },
  {
    id: "rec-school",
    title: "School of Rock",
    year: 2003,
    format: "movie",
    minutes: 109,
    genres: ["Comedy"],
    moods: ["comfort", "laugh"],
    offers: [
      {
        serviceId: "paramount",
        access: "subscription",
        freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
        verifiedWatchUrl: "https://watch.example/paramount/rec-school",
      },
    ],
  },
  {
    id: "rec-singin",
    title: "Singin' in the Rain",
    year: 1952,
    format: "movie",
    minutes: 103,
    genres: ["Comedy"],
    moods: ["comfort"],
    offers: [
      {
        serviceId: "max",
        access: "subscription",
        freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
        verifiedWatchUrl: "https://watch.example/max/rec-singin",
      },
    ],
  },
  {
    id: "rec-nice-guys",
    title: "The Nice Guys",
    year: 2016,
    format: "movie",
    minutes: 116,
    genres: ["Comedy"],
    moods: ["laugh"],
    offers: [
      {
        serviceId: "max",
        access: "subscription",
        freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
        verifiedWatchUrl: "https://watch.example/max/rec-nice-guys",
      },
    ],
  },
  {
    id: "rec-game-night",
    title: "Game Night",
    year: 2018,
    format: "movie",
    minutes: 100,
    genres: ["Comedy"],
    moods: ["laugh"],
    offers: [
      {
        serviceId: "hulu",
        access: "subscription",
        freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
        verifiedWatchUrl: "https://watch.example/hulu/rec-game-night",
      },
    ],
  },
  {
    id: "rec-safety",
    title: "Safety Not Guaranteed",
    year: 2012,
    format: "movie",
    minutes: 86,
    genres: ["Comedy"],
    moods: ["comfort"],
    offers: [
      {
        serviceId: "netflix",
        access: "subscription",
        freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
        verifiedWatchUrl: "https://watch.example/netflix/rec-safety",
      },
    ],
  },
  {
    id: "rec-blade-runner",
    title: "Blade Runner 2049",
    year: 2017,
    format: "movie",
    minutes: 164,
    genres: ["Science Fiction"],
    moods: ["think"],
    offers: [
      {
        serviceId: "apple",
        access: "subscription",
        freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
        verifiedWatchUrl: "https://watch.example/apple/rec-blade-runner",
      },
      {
        serviceId: "prime",
        access: "rent",
        freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
      },
    ],
  },
  {
    id: "rec-ex-machina",
    title: "Ex Machina",
    year: 2015,
    format: "movie",
    minutes: 108,
    genres: ["Science Fiction"],
    moods: ["think"],
    offers: [
      {
        serviceId: "max",
        access: "subscription",
        freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
        verifiedWatchUrl: "https://watch.example/max/rec-ex-machina",
      },
    ],
  },
  {
    id: "rec-bear",
    title: "The Bear",
    year: 2022,
    format: "series",
    minutes: 30,
    seasons: 4,
    genres: ["Comedy"],
    moods: ["comfort"],
    offers: [
      {
        serviceId: "hulu",
        access: "subscription",
        freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
        verifiedWatchUrl: "https://watch.example/hulu/rec-bear",
      },
    ],
  },
  {
    id: "rec-fleabag",
    title: "Fleabag",
    year: 2016,
    format: "series",
    minutes: 27,
    seasons: 2,
    genres: ["Comedy"],
    moods: ["cry"],
    offers: [
      {
        serviceId: "prime",
        access: "subscription",
        freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
        verifiedWatchUrl: "https://watch.example/prime/rec-fleabag",
      },
    ],
  },
  {
    id: "rec-chernobyl",
    title: "Chernobyl",
    year: 2019,
    format: "series",
    minutes: 60,
    seasons: 1,
    genres: ["Drama"],
    moods: ["think"],
    offers: [
      {
        serviceId: "hulu",
        access: "subscription",
        freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
        verifiedWatchUrl: "https://watch.example/hulu/rec-chernobyl",
      },
    ],
  },
  {
    id: "rec-office",
    title: "The Office",
    year: 2005,
    format: "series",
    minutes: 22,
    seasons: 9,
    genres: ["Comedy"],
    moods: ["comfort", "laugh"],
    offers: [
      {
        serviceId: "peacock",
        access: "subscription",
        freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
        verifiedWatchUrl: "https://watch.example/peacock/rec-office",
      },
    ],
  },
];
