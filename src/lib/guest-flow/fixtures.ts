import type { Mood, SeedTitle, ServiceId, WatchFormat } from "./types";

export type CatalogOffer = {
  serviceId: ServiceId;
  access: "subscription" | "rent" | "buy";
};

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
    posterUrl:
      "data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2780%27%20height=%27120%27%3E%3Crect%20width=%2780%27%20height=%27120%27%20fill=%27%23c4a35a%27/%3E%3C/svg%3E",
    genres: ["Comedy"],
  },
  {
    role: "seed",
    id: "seed-mad-max",
    title: "Mad Max: Fury Road",
    year: 2015,
    posterUrl:
      "data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2780%27%20height=%27120%27%3E%3Crect%20width=%2780%27%20height=%27120%27%20fill=%27%237a1f1f%27/%3E%3C/svg%3E",
    genres: ["Action"],
  },
  {
    role: "seed",
    id: "seed-spirited",
    title: "Spirited Away",
    year: 2001,
    posterUrl:
      "data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2780%27%20height=%27120%27%3E%3Crect%20width=%2780%27%20height=%27120%27%20fill=%27%233d7ea6%27/%3E%3C/svg%3E",
    genres: ["Animation"],
  },
  {
    role: "seed",
    id: "seed-social",
    title: "The Social Network",
    year: 2010,
    posterUrl:
      "data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2780%27%20height=%27120%27%3E%3Crect%20width=%2780%27%20height=%27120%27%20fill=%27%232c2c2c%27/%3E%3C/svg%3E",
    genres: ["Drama"],
  },
  {
    role: "seed",
    id: "seed-get-out",
    title: "Get Out",
    year: 2017,
    posterUrl: null,
    genres: ["Horror"],
  },
  {
    role: "seed",
    id: "seed-parks",
    title: "Parks and Recreation",
    year: 2009,
    posterUrl:
      "data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2780%27%20height=%27120%27%3E%3Crect%20width=%2780%27%20height=%27120%27%20fill=%27%235b8c5a%27/%3E%3C/svg%3E",
    genres: ["Comedy"],
  },
  {
    role: "seed",
    id: "seed-arrival",
    title: "Arrival",
    year: 2016,
    posterUrl:
      "data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2780%27%20height=%27120%27%3E%3Crect%20width=%2780%27%20height=%27120%27%20fill=%27%231a3a5c%27/%3E%3C/svg%3E",
    genres: ["Science Fiction"],
  },
  {
    role: "seed",
    id: "seed-booksmart",
    title: "Booksmart",
    year: 2019,
    posterUrl: null,
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
    offers: [{ serviceId: "prime", access: "subscription" }],
  },
  {
    id: "rec-wilderpeople",
    title: "Hunt for the Wilderpeople",
    year: 2016,
    format: "movie",
    minutes: 97,
    genres: ["Comedy"],
    moods: ["comfort", "laugh"],
    offers: [{ serviceId: "prime", access: "subscription" }],
  },
  {
    id: "rec-paddington",
    title: "Paddington 2",
    year: 2017,
    format: "movie",
    minutes: 104,
    genres: ["Comedy"],
    moods: ["comfort", "laugh"],
    offers: [{ serviceId: "netflix", access: "subscription" }],
  },
  {
    id: "rec-school",
    title: "School of Rock",
    year: 2003,
    format: "movie",
    minutes: 109,
    genres: ["Comedy"],
    moods: ["comfort", "laugh"],
    offers: [{ serviceId: "paramount", access: "subscription" }],
  },
  {
    id: "rec-singin",
    title: "Singin' in the Rain",
    year: 1952,
    format: "movie",
    minutes: 103,
    genres: ["Comedy"],
    moods: ["comfort"],
    offers: [{ serviceId: "max", access: "subscription" }],
  },
  {
    id: "rec-nice-guys",
    title: "The Nice Guys",
    year: 2016,
    format: "movie",
    minutes: 116,
    genres: ["Comedy"],
    moods: ["laugh"],
    offers: [{ serviceId: "max", access: "subscription" }],
  },
  {
    id: "rec-game-night",
    title: "Game Night",
    year: 2018,
    format: "movie",
    minutes: 100,
    genres: ["Comedy"],
    moods: ["laugh"],
    offers: [{ serviceId: "hulu", access: "subscription" }],
  },
  {
    id: "rec-safety",
    title: "Safety Not Guaranteed",
    year: 2012,
    format: "movie",
    minutes: 86,
    genres: ["Comedy"],
    moods: ["comfort"],
    offers: [{ serviceId: "netflix", access: "subscription" }],
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
      { serviceId: "apple", access: "subscription" },
      { serviceId: "prime", access: "rent" },
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
    offers: [{ serviceId: "max", access: "subscription" }],
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
    offers: [{ serviceId: "hulu", access: "subscription" }],
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
    offers: [{ serviceId: "prime", access: "subscription" }],
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
    offers: [{ serviceId: "hulu", access: "subscription" }],
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
    offers: [{ serviceId: "peacock", access: "subscription" }],
  },
];
