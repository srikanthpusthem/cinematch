import { expect, test, type Page } from "@playwright/test";

async function assertNoHorizontalOverflow(page: Page) {
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
}

async function goToTaste(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Skip, show all services" }).click();
  await expect(
    page.getByRole("heading", { name: "Optional taste quiz" }),
  ).toBeVisible();
}

test.describe("Taste step", () => {
  test("search, select 3–5 seeds, and keep selections after back", async ({
    page,
  }) => {
    await goToTaste(page);
    await expect(
      page.getByText("Quiz seeds, not recommendations"),
    ).toBeVisible();
    await expect(page.getByText("Taste seed").first()).toBeVisible();

    await page.getByLabel("Search taste seeds").fill("Grand");
    await expect(
      page.getByRole("checkbox", { name: /The Grand Budapest Hotel/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: /Parks and Recreation/ }),
    ).toHaveCount(0);

    await page.getByLabel("Search taste seeds").fill("");
    const continueTaste = page.getByRole("button", { name: "Continue" });

    await page
      .getByRole("checkbox", { name: /The Grand Budapest Hotel/ })
      .check();
    await page.getByRole("checkbox", { name: /Parks and Recreation/ }).check();
    await expect(continueTaste).toBeDisabled();
    await page.getByRole("checkbox", { name: /Booksmart/ }).check();
    await expect(continueTaste).toBeEnabled();
    await expect(page.getByText("Selected · taste seed").first()).toBeVisible();
    await expect(page.getByText("3 selected.")).toBeVisible();

    await continueTaste.click();
    await expect(
      page.getByRole("heading", { name: "What do you want tonight?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(
      page.getByRole("checkbox", { name: /The Grand Budapest Hotel/ }),
    ).toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: /Parks and Recreation/ }),
    ).toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: /Booksmart/ }),
    ).toBeChecked();
  });

  test("skip is a clear zero-seed path and genres stay editable", async ({
    page,
  }) => {
    await goToTaste(page);
    await page.getByRole("checkbox", { name: "Horror" }).check();
    await expect(page.getByRole("checkbox", { name: "Horror" })).toBeChecked();

    await page.getByRole("button", { name: "Skip taste quiz" }).click();
    await expect(
      page.getByRole("heading", { name: "What do you want tonight?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();

    // Skip cleared seeds and avoided genres (cold start).
    await expect(
      page.getByRole("checkbox", { name: /The Grand Budapest Hotel/ }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "Horror" }),
    ).not.toBeChecked();

    await page.getByRole("checkbox", { name: "Romance" }).check();
    await expect(page.getByRole("checkbox", { name: "Romance" })).toBeChecked();
    await page.getByRole("checkbox", { name: "Romance" }).uncheck();
    await expect(
      page.getByRole("checkbox", { name: "Romance" }),
    ).not.toBeChecked();
  });

  test("missing posters, keyboard focus, and no overflow on phone/laptop", async ({
    page,
  }) => {
    for (const size of [
      { width: 390, height: 844 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(size);
      await goToTaste(page);

      await expect(
        page.getByTestId("poster-fallback-seed-get-out"),
      ).toBeVisible();
      await expect(
        page.getByTestId("poster-fallback-seed-booksmart"),
      ).toBeVisible();
      await expect(
        page.getByTestId("poster-image-seed-budapest"),
      ).toBeVisible();

      const budapest = page.getByRole("checkbox", {
        name: /The Grand Budapest Hotel/,
      });
      await budapest.focus();
      await expect(budapest).toBeFocused();
      await page.keyboard.press("Space");
      await expect(budapest).toBeChecked();

      const label = page
        .locator("label")
        .filter({ hasText: "The Grand Budapest Hotel" });
      const box = await label.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);

      await assertNoHorizontalOverflow(page);

      await page.getByLabel("Search taste seeds").fill("zzzz-no-match");
      await expect(page.getByText(/No taste seeds match/)).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await page.getByLabel("Search taste seeds").fill("");
    }
  });

  test("changing prior selections after edit from picks", async ({ page }) => {
    await goToTaste(page);
    await page
      .getByRole("checkbox", { name: /The Grand Budapest Hotel/ })
      .check();
    await page.getByRole("checkbox", { name: /Parks and Recreation/ }).check();
    await page.getByRole("checkbox", { name: /Booksmart/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("radio", { name: "Comfort" }).check();
    await page.getByRole("radio", { name: "Movie" }).check();
    await page
      .getByRole("radio", { name: "Any length No runtime limit" })
      .check();
    await page.getByRole("button", { name: "See picks" }).click();
    await expect(page.getByText("Based on your quiz seeds.")).toBeVisible();
    await page.getByRole("button", { name: "Edit taste" }).click();
    await expect(
      page.getByRole("checkbox", { name: /Booksmart/ }),
    ).toBeChecked();
    await page.getByRole("checkbox", { name: /Booksmart/ }).uncheck();
    await page.getByRole("checkbox", { name: /Arrival/ }).check();
    await expect(page.getByRole("checkbox", { name: /Arrival/ })).toBeChecked();
    await expect(page.getByText("3 selected.")).toBeVisible();
  });
});
