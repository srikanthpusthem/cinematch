import { expect, test, type Page } from "@playwright/test";

async function skipToTonight(page: Page) {
  await page.getByRole("button", { name: "Skip, show all services" }).click();
  await page.getByRole("button", { name: "Skip taste quiz" }).click();
  await expect(
    page.getByRole("heading", { name: "What do you want tonight?" }),
  ).toBeVisible();
}

test("keyboard selects a mood, then a format-specific length", async ({
  page,
}) => {
  await page.goto("/");
  await skipToTonight(page);

  const laugh = page.getByRole("radio", { name: "Laugh" });
  await laugh.focus();
  await page.keyboard.press("Space");
  await expect(laugh).toBeChecked();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: "Cry" })).toBeChecked();
  await expect(laugh).not.toBeChecked();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("radio", { name: "Movie" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: "Series" })).toBeChecked();
  await expect(
    page.getByRole("radio", { name: /99 minutes or less/ }),
  ).toHaveCount(0);
  await expect(page.getByText("4 or more seasons")).toBeVisible();

  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("radio", { name: /Short episodes/ }),
  ).toBeChecked();
  await expect(page.getByRole("button", { name: "See picks" })).toBeEnabled();
});

test("changing format discards length and keeps other answers", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("checkbox", { name: "Netflix" }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip taste quiz" }).click();

  await page.getByRole("radio", { name: "Think" }).check();
  await page.getByRole("radio", { name: "Movie" }).check();
  await page.getByRole("radio", { name: "Epic 150 minutes or more" }).check();
  await page.getByRole("button", { name: "See picks" }).click();
  await page.getByRole("button", { name: "Edit tonight" }).click();

  await expect(page.getByRole("radio", { name: "Think" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Movie" })).toBeChecked();
  await expect(
    page.getByRole("radio", { name: "Epic 150 minutes or more" }),
  ).toBeChecked();

  await page.getByRole("radio", { name: "Series" }).check();
  await expect(
    page.getByRole("radio", { name: /150 minutes or more/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Think" })).toBeChecked();
  await expect(page.getByRole("button", { name: "See picks" })).toBeDisabled();

  await page.getByRole("radio", { name: /Long-running/ }).check();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("checkbox", { name: "Netflix" })).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("radio", { name: "Think" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Series" })).toBeChecked();
  await expect(page.getByRole("radio", { name: /Long-running/ })).toBeChecked();
});

test("phone tonight step keeps 44px targets and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await skipToTonight(page);
  await page.getByRole("radio", { name: "Comfort" }).check();
  await page.getByRole("radio", { name: "Movie" }).check();

  const laugh = page.getByRole("radio", { name: "Laugh" });
  const box = await laugh.locator("xpath=ancestor::label").boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(box?.width).toBeGreaterThanOrEqual(44);

  await page
    .getByRole("radio", { name: "Under 100 minutes 99 minutes or less" })
    .check();
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
});
