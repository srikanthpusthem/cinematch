import { expect, test, type Page } from "@playwright/test";
import { mockCatalog } from "./catalog-fixture";

const storageKey = "cinematch.guest-persistence";

test.beforeEach(async ({ page }) => mockCatalog(page));

async function coldPicks(page: Page) {
  await page.getByRole("button", { name: "Skip, show all services" }).click();
  await page.getByRole("button", { name: "Skip taste quiz" }).click();
  await page.getByRole("radio", { name: "Comfort" }).check();
  await page.getByRole("radio", { name: "Movie", exact: true }).check();
  await page
    .getByRole("radio", { name: "Any length No runtime limit" })
    .check();
  const pendingRequest = page.waitForRequest((req) =>
    req.url().endsWith("/api/recommend"),
  );
  await page.getByRole("button", { name: "See picks" }).click();
  await pendingRequest;
  await expect(page.getByRole("heading", { name: "Best match" })).toBeVisible();
}

test("watched feedback survives reload and undo restores future eligibility", async ({
  page,
}) => {
  await page.goto("/");
  await coldPicks(page);
  const first = page.getByRole("article").filter({ hasText: "About Time" });
  await first.getByRole("button", { name: "Watched", exact: true }).click();
  await expect(
    first.getByRole("button", { name: "Watched", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("it was not marked liked.", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await coldPicks(page);
  await expect(
    page.getByRole("article").filter({ hasText: "About Time" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Undo latest feedback" }).click();
  await page.getByRole("button", { name: "Edit tonight" }).click();
  await page.getByRole("button", { name: "See picks" }).click();
  await expect(
    page.getByRole("article").filter({ hasText: "About Time" }),
  ).toBeVisible();
});

test("show more excludes the current batch and reports exhaustion honestly", async ({
  page,
}) => {
  await page.goto("/");
  await coldPicks(page);
  const request = page.waitForRequest(
    (req) => req.url().endsWith("/api/recommend") && req.method() === "POST",
  );
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  expect((await request).postDataJSON().excludedIds).toEqual([
    "101",
    "102",
    "103",
    "104",
    "105",
  ]);
  await expect(page.getByText("The Farewell")).toBeVisible();
  await expect(page.getByText("About Time")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Show more", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("No more titles match these constraints.", { exact: false }),
  ).toBeVisible();
});

test("leaving a pending result cannot overwrite a newer request", async ({
  page,
}) => {
  let count = 0;
  await page.route("**/api/recommend", async (route) => {
    count += 1;
    if (count === 1) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.fulfill({
        status: 503,
        json: {
          schemaVersion: 1,
          status: "error",
          code: "CATALOG_UNAVAILABLE",
          message: "Old request failed.",
        },
      });
    } else await route.fallback();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Skip, show all services" }).click();
  await page.getByRole("button", { name: "Skip taste quiz" }).click();
  await page.getByRole("radio", { name: "Comfort" }).check();
  await page.getByRole("radio", { name: "Movie", exact: true }).check();
  await page
    .getByRole("radio", { name: "Any length No runtime limit" })
    .check();
  const oldRequest = page.waitForRequest((req) =>
    req.url().endsWith("/api/recommend"),
  );
  await page.getByRole("button", { name: "See picks" }).click();
  await oldRequest;
  await expect(page.getByText("Finding picks")).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("radio", { name: "Think" }).check();
  await page.getByRole("button", { name: "See picks" }).click();
  await expect(page.getByText("Blade Runner 2049")).toBeVisible();
  await page.waitForTimeout(1300);
  await expect(page.getByText("Blade Runner 2049")).toBeVisible();
  await expect(page.getByText("Old request failed.")).toHaveCount(0);
});

test("catalog search preserves chosen IDs and never substitutes fictional titles", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Skip, show all services" }).click();
  await page.getByRole("checkbox", { name: /Booksmart/ }).check();
  await page.getByLabel("Search for a favorite").fill("Arrival");
  await page
    .getByRole("button", { name: "Search titles", exact: true })
    .click();
  await expect(
    page
      .getByRole("group", { name: "Search results", exact: true })
      .getByRole("checkbox", { name: /Arrival/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove Booksmart" }),
  ).toBeVisible();
  await page.getByLabel("Search for a favorite").fill("unmatched title");
  await page
    .getByRole("button", { name: "Search titles", exact: true })
    .click();
  await expect(
    page.getByText("No matching titles. Try another search."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove Booksmart" }),
  ).toBeVisible();
});

test("invalid saved JSON is disclosed and does not block the journey", async ({
  page,
}) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, "{broken"),
    storageKey,
  );
  await page.goto("/");
  await expect(
    page.getByText("Saved preferences could not be read and were reset.", {
      exact: false,
    }),
  ).toBeVisible();
  await coldPicks(page);
});

test("legacy selections migrate visibly with a recoverable backup", async ({
  page,
}) => {
  const legacy = JSON.stringify({
    version: 1,
    answers: {
      serviceIds: ["netflix"],
      servicesSkipped: false,
      seedIds: ["seed-a", "seed-b", "seed-c"],
      avoidedGenres: ["Horror"],
      tasteSkipped: false,
      mood: "comfort",
      format: "movie",
      movieLength: "any",
      seriesLength: null,
    },
    events: [{ id: "watched:101", kind: "watched", contentId: "101" }],
  });
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: storageKey, value: legacy },
  );
  await page.goto("/");
  await expect(
    page.getByText("could not be matched to the live catalog.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeDisabled();
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    storageKey,
  );
  expect(saved.version).toBe(2);
  expect(saved.answers.serviceIds).toEqual([]);
  expect(saved.events[0].contentId).toBe("101");
  const backups = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.includes("backup"))
      .map((key) => localStorage.getItem(key)),
  );
  expect(backups).toContain(legacy);
  await expect(
    page.getByRole("button", { name: "Undo latest feedback" }),
  ).toBeVisible();
});

test("oversized watched history offers explicit undo without clearing saved feedback", async ({
  page,
}) => {
  await page.addInitScript(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 2,
          answers: {
            serviceIds: [],
            servicesSkipped: true,
            seedIds: [],
            avoidedGenres: [],
            tasteSkipped: true,
            mood: "comfort",
            format: "movie",
            movieLength: "any",
            seriesLength: null,
          },
          events: Array.from({ length: 201 }, (_, index) => ({
            id: `watched:${index + 1}`,
            kind: "watched",
            contentId: String(index + 1),
          })),
        }),
      ),
    storageKey,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Skip, show all services" }).click();
  await page.getByRole("button", { name: "Skip taste quiz" }).click();
  await page.getByRole("button", { name: "See picks" }).click();
  await expect(
    page.getByText("Your saved watched history contains 201 titles", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Undo watched for catalog 1", exact: true })
    .click();
  const request = page.waitForRequest((req) =>
    req.url().endsWith("/api/recommend"),
  );
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  const input = (await request).postDataJSON();
  expect(input.watchedIds).toHaveLength(200);
  expect(input.watchedIds).not.toContain("1");
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    storageKey,
  );
  expect(saved.events).toHaveLength(202);
  expect(saved.events.at(-1).kind).toBe("undo");
});
