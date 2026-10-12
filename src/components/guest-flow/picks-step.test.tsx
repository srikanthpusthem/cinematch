import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  FIXTURE_FRESH_CHECKED_AT,
  FIXTURE_STALE_CHECKED_AT,
} from "@/lib/guest-flow/fixtures";
import {
  type RecommendResult,
  type Recommendation,
} from "@/lib/guest-flow/types";
import { firstVerifiedWatchUrl, PicksStep } from "./picks-step";

const basePick: Recommendation = {
  role: "recommendation",
  id: "rec-about-time",
  title: "About Time",
  year: 2013,
  format: "movie",
  timeLabel: "2h 3m",
  reason: "Cold start, lower confidence, because the taste quiz was skipped.",
  offers: [
    {
      serviceId: "prime",
      serviceName: "Prime Video",
      access: "subscription",
      freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
      verifiedWatchUrl: "https://watch.example/prime/rec-about-time",
    },
    {
      serviceId: "apple",
      serviceName: "Apple TV+",
      access: "rent",
      freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
    },
  ],
};

const altPick: Recommendation = {
  ...basePick,
  id: "rec-paddington",
  title: "Paddington 2",
  year: 2017,
  offers: [
    {
      serviceId: "netflix",
      serviceName: "Netflix",
      access: "subscription",
      freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
      verifiedWatchUrl: "https://watch.example/netflix/rec-paddington",
    },
  ],
};

function renderReady(result: RecommendResult) {
  return renderToStaticMarkup(
    <PicksStep
      phase={{ type: "ready", result }}
      onBack={() => undefined}
      onEdit={() => undefined}
      onRetry={() => undefined}
      onFeedback={() => undefined}
      onShowMore={() => undefined}
    />,
  );
}

describe("firstVerifiedWatchUrl", () => {
  it("returns the first fixture verified URL and never invents one", () => {
    expect(firstVerifiedWatchUrl(basePick.offers)).toBe(
      "https://watch.example/prime/rec-about-time",
    );
    expect(
      firstVerifiedWatchUrl([
        {
          serviceId: "prime",
          serviceName: "Prime Video",
          access: "rent",
          freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
        },
      ]),
    ).toBeUndefined();
  });
});

describe("PicksStep", () => {
  it("shows a loading status", () => {
    const html = renderToStaticMarkup(
      <PicksStep
        phase={{ type: "loading" }}
        onBack={() => undefined}
        onEdit={() => undefined}
        onRetry={() => undefined}
      />,
    );
    expect(html).toContain("Finding picks");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("About Time");
  });

  it("shows an error with retry and invents no titles", () => {
    const html = renderReady({
      status: "error",
      message: "The mock picker failed before choosing titles.",
    });
    expect(html).toContain("The mock picker failed before choosing titles.");
    expect(html).toContain("Try again");
    expect(html).not.toContain("About Time");
    expect(html).not.toContain("https://");
  });

  it("shows empty with edit controls and invents no titles", () => {
    const html = renderReady({
      status: "empty",
      message: "Nothing in the mock catalog fits these constraints.",
    });
    expect(html).toContain("Nothing in the mock catalog fits");
    expect(html).toContain("Edit services");
    expect(html).toContain("Edit taste");
    expect(html).toContain("Edit tonight");
    expect(html).not.toContain("About Time");
    expect(html).not.toContain(">Watch<");
  });

  it("renders best match plus alternatives with time and reason", () => {
    const html = renderReady({
      status: "ok",
      confidence: "seeded",
      best: basePick,
      alternatives: [altPick],
    });
    expect(html).toContain("Best match");
    expect(html).toContain("About Time");
    expect(html).toContain("Paddington 2");
    expect(html).toContain("2h 3m");
    expect(html).toContain("Cold start, lower confidence");
    expect(html).toContain("Inspired by your favorites.");
    expect(html).toContain("Alternatives");
  });

  it("explains shortage without inventing filler titles", () => {
    const html = renderReady({
      status: "shortage",
      confidence: "cold-start",
      message:
        "Only 1 match fits these constraints. Nothing was added to fill the list.",
      best: basePick,
      alternatives: [],
    });
    expect(html).toContain("Only 1 match fits");
    expect(html).toContain("Nothing was added");
    expect(html).toContain("No alternatives fit.");
    expect(html).toContain("A fresh start: lower confidence");
  });

  it("labels subscription separately from rent/buy and shows freshness", () => {
    const html = renderReady({
      status: "ok",
      confidence: "seeded",
      best: basePick,
      alternatives: [],
    });
    expect(html).toContain("Subscription (included)");
    expect(html).toContain('<ul aria-label="Subscription (included)"');
    expect(html).toContain("Prime Video");
    expect(html).toContain("Rent or buy (not included)");
    expect(html).toContain('<ul aria-label="Rent or buy (not included)"');
    expect(html).toContain("Apple TV+: rent");
    expect(html).toContain("checked 2026-09-27");
  });

  it("renders Watch only when a verified URL exists on the offer", () => {
    const withLink = renderReady({
      status: "ok",
      confidence: "seeded",
      best: basePick,
      alternatives: [],
    });
    expect(withLink).toContain(
      'href="https://watch.example/prime/rec-about-time"',
    );
    expect(withLink).toContain(">Watch</a>");

    const noLinkPick: Recommendation = {
      ...basePick,
      offers: [
        {
          serviceId: "prime",
          serviceName: "Prime Video",
          access: "subscription",
          freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
        },
      ],
    };
    const without = renderReady({
      status: "ok",
      confidence: "seeded",
      best: noLinkPick,
      alternatives: [],
    });
    expect(without).not.toContain('href="');
    expect(without).toContain("Watch unavailable");
    expect(without).toContain("no verified playback link");
  });

  it("covers unavailable result status without inventing links", () => {
    const html = renderReady({
      status: "unavailable",
      confidence: "cold-start",
      message:
        "These mock titles have no verified Watch link and no included subscription.",
      best: {
        ...basePick,
        offers: [
          {
            serviceId: "prime",
            serviceName: "Prime Video",
            access: "rent",
            freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
          },
        ],
      },
      alternatives: [],
    });
    expect(html).toContain("no verified Watch link");
    expect(html).toContain("Watch unavailable");
    expect(html).not.toContain('href="');
    expect(html).toContain("Rent or buy (not included)");
  });

  it("shows a stale availability message when freshness is old", () => {
    const stalePick: Recommendation = {
      ...basePick,
      offers: [
        {
          serviceId: "prime",
          serviceName: "Prime Video",
          access: "subscription",
          freshnessCheckedAt: FIXTURE_STALE_CHECKED_AT,
          verifiedWatchUrl: "https://watch.example/prime/rec-about-time",
        },
      ],
    };
    const html = renderReady({
      status: "ok",
      confidence: "seeded",
      best: stalePick,
      alternatives: [],
    });
    expect(html).toContain("Availability looks stale");
    expect(html).toContain("stale");
    expect(html).toContain("checked 2026-09-18");
  });

  it("exposes feedback, show more, and edit controls with large touch targets", () => {
    const html = renderReady({
      status: "ok",
      confidence: "seeded",
      best: basePick,
      alternatives: [altPick],
    });
    expect(html).toContain("Watched");
    expect(html).toContain("Like");
    expect(html).toContain("Not for me");
    expect(html).toContain("Show more");
    expect(html).toContain("Edit services");
    expect(html).toContain("Edit taste");
    expect(html).toContain("Edit tonight");
    expect(html).toContain("min-h-11");
    expect(html).toContain("touch-manipulation");
    expect(html).toContain("min-w-0");
  });

  it("accepts feedback callbacks without invoking them during static render", () => {
    const onFeedback = vi.fn();
    const onShowMore = vi.fn();
    expect(() =>
      renderToStaticMarkup(
        <PicksStep
          phase={{
            type: "ready",
            result: {
              status: "ok",
              confidence: "seeded",
              best: basePick,
              alternatives: [],
            },
          }}
          onBack={() => undefined}
          onEdit={() => undefined}
          onRetry={() => undefined}
          onFeedback={onFeedback}
          onShowMore={onShowMore}
        />,
      ),
    ).not.toThrow();
    expect(onFeedback).not.toHaveBeenCalled();
    expect(onShowMore).not.toHaveBeenCalled();
  });
});

describe("live catalog presentation", () => {
  it("never calls provider information a direct Watch link", () => {
    const html = renderToStaticMarkup(
      <PicksStep
        source="catalog"
        phase={{
          type: "ready",
          result: {
            status: "ok",
            confidence: "cold-start",
            best: {
              ...basePick,
              year: null,
              offers: [],
              availability: {
                state: "unknown",
                checkedAt: null,
                infoUrl: "https://example.com/providers",
              },
            },
            alternatives: [],
          },
        }}
        onBack={() => undefined}
        onEdit={() => undefined}
        onRetry={() => undefined}
        canShowMore={false}
      />,
    );
    expect(html).toContain(
      "Subscription availability is not currently verified.",
    );
    expect(html).toContain("Availability unknown");
    expect(html).toContain("never verified");
    expect(html).toContain("Where to watch (TMDB)");
    expect(html).toContain("Streaming availability data by JustWatch.");
    expect(html).not.toContain(">Watch</a>");
    expect(html).not.toContain("Mock catalog only");
    expect(html).not.toContain("(null)");
    expect(html).toContain("No more titles match these constraints.");
  });

  it("uses server stale state instead of the fixed mock clock", () => {
    const html = renderToStaticMarkup(
      <PicksStep
        source="catalog"
        phase={{
          type: "ready",
          result: {
            status: "ok",
            confidence: "seeded",
            best: {
              ...basePick,
              offers: [],
              availability: {
                state: "stale",
                checkedAt: "2026-09-27T18:00:00.000Z",
                infoUrl: null,
              },
            },
            alternatives: [],
          },
        }}
        onBack={() => undefined}
        onEdit={() => undefined}
        onRetry={() => undefined}
      />,
    );
    expect(html).toContain("Availability looks stale");
    expect(html).toContain(
      "Subscription availability is not currently verified.",
    );
    expect(html).not.toContain("mock clock");
    expect(html).not.toContain('<ul aria-label="Subscription (included)"');
  });
});

describe("selected subscription presentation", () => {
  it("highlights selected services first while retaining other offer information", () => {
    const html = renderToStaticMarkup(
      <PicksStep
        source="catalog"
        selectedServiceIds={["netflix"]}
        phase={{
          type: "ready",
          result: {
            status: "ok",
            confidence: "seeded",
            best: {
              ...basePick,
              offers: [
                { ...basePick.offers[0]!, verifiedWatchUrl: undefined },
                {
                  serviceId: "netflix",
                  serviceName: "Netflix",
                  access: "subscription",
                  freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
                },
                basePick.offers[1]!,
              ],
            },
            alternatives: [],
          },
        }}
        onBack={() => undefined}
        onEdit={() => undefined}
        onRetry={() => undefined}
      />,
    );
    expect(html).toContain("Your selected service");
    expect(html).toContain("Prime Video");
    expect(html).toContain("Apple TV+: rent");
    expect(html.indexOf("Netflix")).toBeLessThan(html.indexOf("Prime Video"));
    expect(html).not.toContain(">Watch</a>");
  });

  it("adds no selected-service badge when services were skipped", () => {
    const html = renderToStaticMarkup(
      <PicksStep
        selectedServiceIds={[]}
        phase={{
          type: "ready",
          result: {
            status: "ok",
            confidence: "seeded",
            best: basePick,
            alternatives: [],
          },
        }}
        onBack={() => undefined}
        onEdit={() => undefined}
        onRetry={() => undefined}
      />,
    );
    expect(html).not.toContain("Your selected service");
    expect(html).toContain("Prime Video");
    expect(html).toContain("Apple TV+: rent");
  });

  it("never badges selected rent or buy offers as included subscriptions", () => {
    const html = renderToStaticMarkup(
      <PicksStep
        selectedServiceIds={["apple"]}
        phase={{
          type: "ready",
          result: {
            status: "ok",
            confidence: "seeded",
            best: basePick,
            alternatives: [],
          },
        }}
        onBack={() => undefined}
        onEdit={() => undefined}
        onRetry={() => undefined}
      />,
    );
    expect(html).not.toContain("Your selected service");
    expect(html).toContain("Rent or buy (not included)");
    expect(html).toContain("Apple TV+: rent");
  });
});

describe("provider disclosure", () => {
  it("keeps every selected subscription visible before tucking away other offers", () => {
    const offers = Array.from({ length: 7 }, (_, index) => ({
      serviceId: `service${index}`,
      serviceName: `Service ${index}`,
      access: "subscription" as const,
      freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
    }));
    const html = renderToStaticMarkup(
      <PicksStep
        selectedServiceIds={offers.slice(0, 5).map((offer) => offer.serviceId)}
        phase={{
          type: "ready",
          result: {
            status: "ok",
            confidence: "seeded",
            best: { ...basePick, offers },
            alternatives: [],
          },
        }}
        onBack={() => undefined}
        onEdit={() => undefined}
        onRetry={() => undefined}
      />,
    );
    const visible = html.match(
      /<ul aria-label="Subscription \(included\)"[^>]*>([\s\S]*?)<\/ul>/,
    )?.[1];
    expect(visible).toBeTruthy();
    for (let index = 0; index < 5; index++)
      expect(visible).toContain(`Service ${index}`);
    expect(visible).not.toContain("Service 5");
    expect(html).toContain("More subscription options (2)");
    expect(html).toContain('aria-label="More Subscription (included)"');
    expect(html).toContain("Service 6");
  });

  it("preserves paid-offer labels and dates inside the extra-options disclosure", () => {
    const offers = Array.from({ length: 5 }, (_, index) => ({
      serviceId: `paid${index}`,
      serviceName: `Paid service ${index}`,
      access: "rent" as const,
      freshnessCheckedAt: FIXTURE_FRESH_CHECKED_AT,
    }));
    const html = renderReady({
      status: "ok",
      confidence: "seeded",
      best: { ...basePick, offers },
      alternatives: [],
    });
    expect(html).toContain("Rent or buy (not included)");
    expect(html).toContain("More rent or buy options (2)");
    expect(html).toContain("Paid service 4: rent");
    expect(html).toContain("checked 2026-09-27");
    expect(html).not.toContain("Your selected service");
    expect(html).not.toContain(">Watch</a>");
  });
});
