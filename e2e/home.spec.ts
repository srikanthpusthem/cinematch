import { expect, test } from "@playwright/test";

test("home page loads and shows CineMatch", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "CineMatch" })).toBeVisible();
});
