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
    expect(html).toContain("Based on your quiz seeds.");
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
    expect(html).toContain("Cold start: lower confidence");
  });

  it("labels subscription separately from rent/buy and shows freshness", () => {
    const html = renderReady({
      status: "ok",
      confidence: "seeded",
      best: basePick,
      alternatives: [],
    });
    expect(html).toContain("Subscription (included)");
    expect(html).toContain("Prime Video");
    expect(html).toContain("Rent or buy (not included)");
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
