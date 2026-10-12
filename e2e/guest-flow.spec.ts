import { expect, test, type Page } from "@playwright/test";
import { mockCatalog } from "./catalog-fixture";

test.beforeEach(async ({ page }) => mockCatalog(page));

async function skipToTonight(page: Page) {
  await page.getByRole("button", { name: "Skip, show all services" }).click();
  await page.getByRole("button", { name: "Skip taste quiz" }).click();
}

async function chooseComfortMovie(page: Page) {
  await page.getByRole("radio", { name: "Comfort" }).check();
  await page.getByRole("radio", { name: "Movie" }).check();
  await page
    .getByRole("radio", { name: "Any length No runtime limit" })
    .check();
}

test("cold start shows one best match and four alternatives", async ({
  page,
}) => {
  await page.goto("/?mock=loading");
  await expect(page.getByRole("heading", { name: "CineMatch" })).toBeVisible();
  await skipToTonight(page);
  await chooseComfortMovie(page);
  await page.getByRole("button", { name: "See picks" }).click();
  await expect(page.getByText("Finding picks")).toBeVisible();
  const results = page.getByRole("region", { name: "Your picks" });
  await expect(
    results.getByRole("heading", { name: "Best match" }),
  ).toBeVisible();
  await expect(results.getByText("About Time")).toBeVisible();
  await expect(
    results.getByText("A fresh start: lower confidence"),
  ).toBeVisible();
  await expect(
    results.getByRole("heading", { name: "Alternatives" }),
  ).toBeVisible();
  await expect(results.getByText("Paddington 2")).toBeVisible();
  await expect(results.getByText("The Grand Budapest Hotel")).toHaveCount(0);
  await expect(results.getByRole("article")).toHaveCount(5);
  const best = results.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Best match" }),
  });
  const subscriptions = best.getByRole("list", {
    name: "Subscription (included)",
    exact: true,
  });
  await expect(subscriptions.getByRole("listitem")).toBeVisible();
  await expect(subscriptions.getByRole("listitem")).toHaveText([
    "Prime Video · checked 2026-09-27",
  ]);
});

test("back and edit keep earlier answers", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("checkbox", { name: "Netflix" }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("checkbox", { name: "Netflix" })).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip taste quiz" }).click();
  await chooseComfortMovie(page);
  await page.getByRole("button", { name: "See picks" }).click();
  await expect(page.getByText("Paddington 2")).toBeVisible();
  await expect(page.getByText("About Time")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit tonight" }).click();
  await expect(page.getByRole("radio", { name: "Comfort" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Movie" })).toBeChecked();
});

test("quiz seeds stay off the results step", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Skip, show all services" }).click();
  await expect(page.getByText("Quiz seeds, not recommendations")).toBeVisible();
  const continueTaste = page.getByRole("button", { name: "Continue" });
  await page
    .getByRole("checkbox", { name: /The Grand Budapest Hotel/ })
    .check();
  await page.getByRole("checkbox", { name: /Parks and Recreation/ }).check();
  await expect(continueTaste).toBeDisabled();
  await page.getByRole("checkbox", { name: /Booksmart/ }).check();
  await expect(continueTaste).toBeEnabled();
  await continueTaste.click();
  await chooseComfortMovie(page);
  await page.getByRole("button", { name: "See picks" }).click();
  const results = page.getByRole("region", { name: "Your picks" });
  await expect(results.getByText("Inspired by your favorites.")).toBeVisible();
  await expect(results.getByText("The Grand Budapest Hotel")).toHaveCount(0);
  await expect(
    results.getByText("Shares Comedy with a quiz seed").first(),
  ).toBeVisible();
});

test("subscription and rent offers stay separate on the same pick", async ({
  page,
}) => {
  await page.goto("/");
  await skipToTonight(page);
  await chooseComfortMovie(page);
  await page.getByRole("radio", { name: "Think" }).check();
  await page.getByRole("button", { name: "See picks" }).click();
  const results = page.getByRole("region", { name: "Your picks" });
  const best = results.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Best match" }),
  });
  await expect(best.getByText("Blade Runner 2049")).toBeVisible();
  const subscriptions = best.getByRole("list", {
    name: "Subscription (included)",
    exact: true,
  });
  const rentBuy = best.getByRole("list", {
    name: "Rent or buy (not included)",
    exact: true,
  });
  await expect(subscriptions).toBeVisible();
  await expect(rentBuy).toBeVisible();
  await expect(subscriptions.getByRole("listitem")).toHaveText([
    "Apple TV+ · checked 2026-09-27",
  ]);
  await expect(rentBuy.getByRole("listitem")).toHaveText([
    "Prime Video: rent · checked 2026-09-27",
  ]);
  await expect(
    best.getByRole("link", {
      name: "Where to watch (TMDB)",
      exact: true,
    }),
  ).toHaveAttribute("href", "https://example.com/provider-information");
  await expect(
    best.getByRole("link", { name: "Watch", exact: true }),
  ).toHaveCount(0);
});

test("unknown availability makes no subscription or playback claims", async ({
  page,
}) => {
  await page.goto("/?mock=unavailable");
  await skipToTonight(page);
  await chooseComfortMovie(page);
  await page.getByRole("button", { name: "See picks" }).click();
  const results = page.getByRole("region", { name: "Your picks" });
  await expect(results.getByRole("article")).toHaveCount(5);
  await expect(
    results.getByRole("link", { name: "Watch", exact: true }),
  ).toHaveCount(0);
  await expect(
    results.getByRole("list", { name: "Subscription (included)", exact: true }),
  ).toHaveCount(0);
  const best = results
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Best match" }) });
  await expect(
    best.getByText("Subscription availability is not currently verified."),
  ).toBeVisible();
  await expect(
    best.getByText("Availability unknown · never verified"),
  ).toBeVisible();
  await expect(
    best.getByText("Direct Watch unavailable:", { exact: false }),
  ).toBeVisible();
});

test("empty, shortage, and error states stay honest", async ({ page }) => {
  await page.goto("/?mock=empty");
  await skipToTonight(page);
  await chooseComfortMovie(page);
  await page.getByRole("button", { name: "See picks" }).click();
  await expect(page.getByText("Nothing in the catalog fits")).toBeVisible();
  await expect(page.getByText("About Time")).toHaveCount(0);

  await page.goto("/?mock=shortage");
  await skipToTonight(page);
  await chooseComfortMovie(page);
  await page.getByRole("button", { name: "See picks" }).click();
  await expect(page.getByText("Only 2 matches fit")).toBeVisible();
  await expect(
    page.getByText("Nothing was added to fill the list."),
  ).toBeVisible();

  await page.goto("/?mock=error");
  await skipToTonight(page);
  await chooseComfortMovie(page);
  await page.getByRole("button", { name: "See picks" }).click();
  const errorResults = page.getByRole("region", { name: "Your picks" });
  await expect(errorResults.getByRole("alert")).toBeVisible();
  await expect(errorResults.getByRole("alert")).toHaveText(
    "Recommendations are unavailable. Please try again.",
  );
  // The client deliberately replaces upstream error text with safe copy.
  await expect(
    errorResults.getByText(
      "Catalog recommendations could not be loaded. Please try again.",
    ),
  ).toHaveCount(0);
  await expect(errorResults.getByRole("article")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("phone width shows the shell without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "CineMatch" })).toBeVisible();
  const box = await page
    .getByRole("heading", { name: "CineMatch" })
    .boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  await skipToTonight(page);
  await chooseComfortMovie(page);
  await page.getByRole("button", { name: "See picks" }).click();
  await expect(page.getByText("About Time")).toBeVisible();
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
});
