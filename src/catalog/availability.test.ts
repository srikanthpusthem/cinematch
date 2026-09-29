import { describe, expect, it } from "vitest";
import type { RegionProviders, WatchProviders } from "../tmdb/schema";
import { createFakeSource } from "./__fixtures__/fake-source";
import {
  JUSTWATCH_ATTRIBUTION,
  STORED_AVAILABILITY_LINK_KIND,
  TMDB_NOTICE,
  availabilityLinkLabel,
} from "./attribution";
import {
  AvailabilityAbortedError,
  refreshAvailability,
  usAvailability,
  type AvailabilityOptions,
  type AvailabilityStats,
  type AvailabilityStore,
  type AvailabilityTarget,
  type UsAvailability,
} from "./availability";

const provider = (id: number, name: string) => ({
  providerId: id,
  providerName: name,
  logoPath: `/logo-${id}.png`,
  displayPriority: 1,
});

const region = (r: Partial<RegionProviders>): RegionProviders => ({
  link: "https://www.themoviedb.org/movie/1/watch?locale=US",
  flatrate: [],
  free: [],
  ads: [],
  rent: [],
  buy: [],
  ...r,
});

describe("usAvailability", () => {
  it("keeps only the US region, one offer per provider and monetization", () => {
    const providers: WatchProviders = {
      US: region({
        flatrate: [provider(8, "Netflix"), provider(8, "Netflix")],
        rent: [provider(2, "Apple TV"), provider(8, "Netflix")],
        ads: [provider(300, "Pluto TV")],
      }),
      GB: region({ flatrate: [provider(39, "Now TV")] }),
    };
    const us = usAvailability(providers);

    expect(us.link).toContain("locale=US");
    expect(us.providers.map((p) => p.id)).toEqual([2, 8, 300]);
    expect(us.offers).toEqual([
      { providerId: 8, monetization: "flatrate" },
      { providerId: 300, monetization: "ads" },
      { providerId: 2, monetization: "rent" },
      { providerId: 8, monetization: "rent" },
    ]);
  });

  it("treats a response without US as checked with no offers", () => {
    expect(
      usAvailability({ GB: region({ flatrate: [provider(39, "Now TV")] }) }),
    ).toEqual({
      link: null,
      providers: [],
      offers: [],
    });
    expect(usAvailability({})).toEqual({
      link: null,
      providers: [],
      offers: [],
    });
  });

  it("drops provider entries with no usable identity", () => {
    const us = usAvailability({
      US: region({ flatrate: [provider(0, "Ghost"), provider(9, "   ")] }),
    });
    expect(us.offers).toEqual([]);
  });
});

describe("attribution", () => {
  it("uses TMDB's exact required notice and credits JustWatch", () => {
    expect(TMDB_NOTICE).toBe(
      "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    );
    expect(JUSTWATCH_ATTRIBUTION).toMatch(/JustWatch/);
  });

  it("never labels a stored TMDB provider link as playback", () => {
    expect(STORED_AVAILABILITY_LINK_KIND).toBe("provider-info");
    expect(availabilityLinkLabel("provider-info")).not.toMatch(/watch now/i);
    expect(availabilityLinkLabel("verified-playback")).toBe("Watch now");
  });
});

/** In-memory store mirroring the database store's replace/keep semantics. */
function memoryStore(targets: AvailabilityTarget[]) {
  const saved = new Map<number, { us: UsAvailability; at: Date }>();
  const store: AvailabilityStore = {
    dueForRefresh: (before, limit) =>
      Promise.resolve(
        targets
          .filter((t) => {
            const s = saved.get(t.titleId);
            return !s || s.at < before;
          })
          .slice(0, limit),
      ),
    saveAvailability: (titleId, us, at) => {
      saved.set(titleId, { us, at });
      return Promise.resolve();
    },
    stats: (): Promise<AvailabilityStats> =>
      Promise.resolve({
        titles: targets.length,
        checked: saved.size,
        neverChecked: targets.length - saved.size,
        stale: 0,
        withOffers: [...saved.values()].filter((s) => s.us.offers.length)
          .length,
        offers: 0,
        providers: 0,
        oldestFetchedAt: null,
        newestFetchedAt: null,
      }),
  };
  return { store, saved };
}

const NOW = new Date("2026-09-29T00:00:00Z");
const options = (
  o: Partial<AvailabilityOptions> = {},
): AvailabilityOptions => ({
  maxAgeDays: 1,
  limit: 100,
  concurrency: 2,
  maxFailureRate: 0.5,
  minAttemptsBeforeAbort: 4,
  now: () => NOW,
  ...o,
});

describe("refreshAvailability", () => {
  const targets: AvailabilityTarget[] = [
    { titleId: 1, kind: "movie", tmdbId: 550 },
    { titleId: 2, kind: "series", tmdbId: 1396 },
    { titleId: 3, kind: "movie", tmdbId: 13 },
  ];
  const providers = new Map<string, WatchProviders>([
    ["movie:550", { US: region({ flatrate: [provider(8, "Netflix")] }) }],
    ["series:1396", { US: region({ flatrate: [provider(8, "Netflix")] }) }],
    ["movie:13", { GB: region({ flatrate: [provider(39, "Now TV")] }) }],
  ]);

  it("checks due titles with the kind-specific endpoint and counts outcomes", async () => {
    const { source, calls } = createFakeSource({ providers });
    const { store } = memoryStore(targets);
    const report = await refreshAvailability(source, store, options());

    expect(calls.providers.sort()).toEqual([
      "movie:13",
      "movie:550",
      "series:1396",
    ]);
    expect(report).toMatchObject({
      status: "completed",
      due: 3,
      saved: 3,
      withUsOffers: 2,
      withoutUsOffers: 1,
      failed: {},
    });
  });

  it("keeps previous data when a fetch fails (partial outage), then retries it", async () => {
    const outage = createFakeSource({
      providers,
      failures: new Map([[1396, "server" as const]]),
    });
    const { store, saved } = memoryStore(targets);
    const first = await refreshAvailability(outage.source, store, options());
    expect(first).toMatchObject({ saved: 2, failed: { server: 1 } });
    expect(saved.has(2)).toBe(false); // nothing written for the failed title

    // Next run: only the failed title is still due.
    const recovered = createFakeSource({ providers });
    const second = await refreshAvailability(
      recovered.source,
      store,
      options(),
    );
    expect(recovered.calls.providers).toEqual(["series:1396"]);
    expect(second).toMatchObject({ due: 1, saved: 1 });
  });

  it("aborts when too many titles fail", async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      titleId: i + 1,
      kind: "movie" as const,
      tmdbId: 100 + i,
    }));
    const { source } = createFakeSource({
      failures: new Map(many.map((t) => [t.tmdbId, "timeout" as const])),
    });
    const { store } = memoryStore(many);
    const error = await refreshAvailability(
      source,
      store,
      options({ concurrency: 1 }),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AvailabilityAbortedError);
    const { report } = error as AvailabilityAbortedError;
    expect(report.status).toBe("aborted");
    expect(report.attempted).toBe(4);
    expect(report.failed).toEqual({ timeout: 4 });
  });
});
