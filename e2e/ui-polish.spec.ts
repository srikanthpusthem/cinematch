import { expect, test } from "@playwright/test";
import { mockCatalog } from "./catalog-fixture";

test.beforeEach(async ({ page }) => mockCatalog(page));

for (const width of [320, 390, 1280]) {
  test(`cinematic flow remains usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const assertLayout = async (current: string) => {
      await expect(page.locator('[aria-current="step"]')).toContainText(
        current,
      );
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      const heading = page.locator("section h2");
      await expect(heading).toBeFocused();
      const box = await heading.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThan(844);
    };
    await assertLayout("Services");
    const netflix = page.getByRole("checkbox", { name: /Netflix/ });
    await netflix.focus();
    expect(
      await netflix.evaluate(
        (input) => getComputedStyle(input.closest("label")!).outlineStyle,
      ),
    ).toBe("solid");
    await page.keyboard.press("Space");
    await expect(netflix).toBeChecked();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await assertLayout("Taste");
    await page.getByRole("button", { name: "Skip taste quiz" }).click();
    await assertLayout("Tonight");
    await page.getByRole("radio", { name: /Comfort/ }).check();
    await page.getByRole("radio", { name: "Movie", exact: true }).check();
    await page.getByRole("radio", { name: /Any length/ }).check();
    await page.getByRole("button", { name: "See picks" }).click();
    await expect(
      page.getByRole("heading", { name: "Best match" }),
    ).toBeVisible();
    await assertLayout("Picks");
    await expect(page.getByText("Your selected service").first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Watch", exact: true }),
    ).toHaveCount(0);
  });
}

test("skip navigation and reduced-motion loading preserve accessibility", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?mock=loading");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await skip.focus();
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await skip.click();
  await expect(page.locator("#main-content")).toBeFocused();
  await page.getByRole("button", { name: "Skip, show all services" }).click();
  await page.getByRole("button", { name: "Skip taste quiz" }).click();
  await page.getByRole("radio", { name: /Comfort/ }).check();
  await page.getByRole("radio", { name: "Movie", exact: true }).check();
  await page.getByRole("radio", { name: /Any length/ }).check();
  await page.getByRole("button", { name: "See picks" }).click();
  await expect(page.getByText("Finding picks…")).toBeVisible();
  const animation = await page
    .locator(".loading-track span")
    .evaluate((span) => getComputedStyle(span).animationName);
  expect(animation).toBe("none");
});

test("long catalog provider names wrap inside phone service cards", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const name = "StreamingSubscription".repeat(8);
  await page.route("**/api/catalog/options", (route) =>
    route.fulfill({
      json: {
        providers: [
          { id: "8", name, logoPath: null, monetizations: ["flatrate"] },
        ],
        genres: [],
      },
    }),
  );
  await page.goto("/");
  const service = page.getByRole("checkbox", { name: new RegExp(name) });
  await service.check();
  await expect(service).toBeChecked();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("keyboard disclosure keeps chosen favorites and avoided genres", async ({
  page,
}) => {
  const { quizTitles } = await import("./catalog-fixture");
  const seeds = [
    ...quizTitles,
    ...Array.from({ length: 8 }, (_, index) => ({
      ...quizTitles[0]!,
      id: String(10 + index),
      tmdbId: 10 + index,
      title: `Fixture favorite ${index + 5}`,
    })),
  ];
  await page.route("**/api/catalog/quiz-seeds?*", (route) =>
    route.fulfill({ json: { results: seeds, limit: 12 } }),
  );
  await page.route("**/api/catalog/options", (route) =>
    route.fulfill({
      json: {
        providers: [
          ["8", "Netflix"],
          ["12", "Max"],
          ["11", "Hulu"],
          ["13", "Disney+"],
          ["9", "Prime Video"],
          ["10", "Apple TV+"],
          ["14", "Peacock"],
          ["15", "Paramount+"],
          ["900", "Fixture channel"],
        ].map(([id, name]) => ({
          id,
          name,
          logoPath: null,
          monetizations: ["flatrate"],
        })),
        genres: [{ id: "27", name: "Horror", kinds: ["movie"] }],
      },
    }),
  );
  await page.goto("/");
  const moreServices = page.locator(".service-details > summary");
  await moreServices.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("checkbox", { name: /Fixture channel/ }).check();
  await expect(moreServices).toContainText("1 selected");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".seed-card")).toHaveCount(6);
  const more = page.getByRole("button", { name: "Show more quiz titles" });
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".seed-card")).toHaveCount(12);
  await expect(
    page.getByRole("button", { name: "Show fewer quiz titles" }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("checkbox", { name: /Fixture favorite 7/ }).check();
  await page.getByRole("button", { name: "Show fewer quiz titles" }).click();
  await expect(page.locator(".seed-card")).toHaveCount(6);
  await expect(page.locator(".selected-favorites")).toContainText(
    "Fixture favorite 7",
  );
  const genres = page.locator(".genre-details > summary");
  await genres.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("checkbox", { name: /Horror/ }).check();
  await expect(genres).toContainText("1 avoided");
  await page
    .getByRole("checkbox", { name: /The Grand Budapest Hotel/ })
    .check();
  await page.getByRole("checkbox", { name: /Parks and Recreation/ }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator(".selected-favorites")).toContainText(
    "Fixture favorite 7",
  );
  await expect(page.locator(".genre-details > summary")).toContainText(
    "1 avoided",
  );
  await page.locator(".genre-details > summary").click();
  await expect(page.getByRole("checkbox", { name: /Horror/ })).toBeChecked();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator(".service-details > summary")).toContainText(
    "1 selected",
  );
  await page.locator(".service-details > summary").click();
  await expect(
    page.getByRole("checkbox", { name: /Fixture channel/ }),
  ).toBeChecked();
});

test("compact phone results reserve poster height and disclose extra providers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/recommend", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        rankingVersion: "metadata-v1",
        status: "shortage",
        confidence: "cold-start",
        picks: [
          {
            id: "909",
            title: "A",
            format: "movie",
            year: null,
            posterUrl: null,
            runtimeMinutes: 99,
            episodeRuntimeMinutes: null,
            seasonCount: null,
            reasons: ["Fits."],
            availability: {
              region: "US",
              state: "current",
              checkedAt: "2026-09-27T18:00:00.000Z",
              infoUrl: "https://example.com/provider-information",
              offers: [
                [12, "Max"],
                [11, "Hulu"],
                [13, "Disney+"],
                [9, "Prime Video"],
                [10, "Apple TV+"],
                [14, "Peacock"],
                [8, "Netflix"],
              ].map(([providerId, providerName]) => ({
                providerId,
                providerName,
                access: "subscription",
              })),
            },
          },
        ],
        exhaustion: {
          requestedCount: 5,
          eligibleCount: 1,
          returnedCount: 1,
          missingCount: 4,
          exhausted: true,
          activeEditableConstraints: ["services", "format"],
          relaxationOptions: [
            { constraint: "services", additionalEligibleCount: 0 },
            { constraint: "format", additionalEligibleCount: 0 },
          ],
        },
        message:
          "Only 1 match fits these constraints. Nothing was added to fill the list.",
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("checkbox", { name: /Netflix/ }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Skip taste quiz" }).click();
  await page.getByRole("radio", { name: /Comfort/ }).check();
  await page.getByRole("radio", { name: "Movie", exact: true }).check();
  await page.getByRole("radio", { name: /Any length/ }).check();
  await page.getByRole("button", { name: "See picks" }).click();
  const best = page.locator(".pick-featured");
  await expect(best).toBeVisible();
  const poster = await best.locator(".pick-poster").boundingBox();
  const offers = await best.locator(".offer-lists").boundingBox();
  expect(poster).not.toBeNull();
  expect(offers).not.toBeNull();
  expect(offers!.y).toBeGreaterThanOrEqual(poster!.y + poster!.height);
  const visibleSubscriptions = best.getByRole("list", {
    name: "Subscription (included)",
    exact: true,
  });
  await expect(visibleSubscriptions).toContainText("Netflix");
  await expect(visibleSubscriptions).toContainText("Your selected service");
  const summary = best.getByText("More subscription options (4)", {
    exact: true,
  });
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(
    best.getByRole("list", {
      name: "More Subscription (included)",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    best.getByRole("list", {
      name: "More Subscription (included)",
      exact: true,
    }),
  ).toContainText("Apple TV+");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
