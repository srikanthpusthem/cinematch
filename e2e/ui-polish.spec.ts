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
