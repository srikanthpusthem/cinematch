import { expect, test } from "@playwright/test";

test("credits page shows the required TMDB and JustWatch attribution", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "About & credits" }).click();
  await expect(page).toHaveURL(/\/about$/);

  await expect(
    page.getByRole("heading", { name: "About & credits" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "TMDB (The Movie Database)" }),
  ).toBeVisible();
  await expect(
    page.getByText("Streaming availability data by JustWatch."),
  ).toBeVisible();
  // Provider information must never be presented as direct playback.
  await expect(page.getByText("Watch now")).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
