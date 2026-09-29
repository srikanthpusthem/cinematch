import { expect, test, type Page } from "@playwright/test";

async function assertNoHorizontalOverflow(page: Page) {
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
}

test.describe("Services step", () => {
  test("multi-select grid keeps keyboard focus and selection labels", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Which subscriptions do you have?" }),
    ).toBeVisible();
    await expect(page.getByText("subscription access only")).toBeVisible();
    await expect(page.getByText("Rent and buy")).toBeVisible();

    const netflix = page.getByRole("checkbox", { name: /Netflix/ });
    await netflix.focus();
    await expect(netflix).toBeFocused();
    await page.keyboard.press("Space");
    await expect(netflix).toBeChecked();
    await expect(
      page.getByText("Selected · subscription").first(),
    ).toBeVisible();
    await expect(page.getByText("1 selected.")).toBeVisible();

    await page.keyboard.press("Tab");
    const max = page.getByRole("checkbox", { name: /Max/ });
    await expect(max).toBeFocused();
    await page.keyboard.press("Space");
    await expect(max).toBeChecked();
    await expect(page.getByText("2 selected.")).toBeVisible();

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Optional taste quiz")).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(netflix).toBeChecked();
    await expect(max).toBeChecked();
  });

  test("Skip means all services and can be overridden after back", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Skip, show all services" }).click();
    await expect(page.getByText("Optional taste quiz")).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByText("Showing every service")).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: /Netflix/ }),
    ).not.toBeChecked();

    await page.getByRole("checkbox", { name: /Hulu/ }).check();
    await expect(page.getByText("Showing every service")).toHaveCount(0);
    await expect(page.getByText("1 selected.")).toBeVisible();
    await expect(page.getByText("Selected · subscription")).toBeVisible();
  });

  test("phone and laptop services grid has touch targets and no overflow", async ({
    page,
  }) => {
    for (const size of [
      { width: 390, height: 844 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(size);
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: "Which subscriptions do you have?" }),
      ).toBeVisible();

      const netflixLabel = page.locator("label").filter({ hasText: "Netflix" });
      const box = await netflixLabel.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);

      await assertNoHorizontalOverflow(page);

      // Tap/click a second service to confirm the grid stays usable.
      await page.getByRole("checkbox", { name: /Disney\+/ }).check();
      await expect(page.getByText("1 selected.")).toBeVisible();
      await assertNoHorizontalOverflow(page);
    }
  });
});
