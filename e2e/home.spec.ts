import { expect, test } from "@playwright/test";

test("home page loads and shows CineMatch", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "CineMatch" })).toBeVisible();
});

test("landing has no horizontal overflow", async ({ page }, testInfo) => {
  await page.goto("/");
  const heading = page.getByRole("heading", { name: "CineMatch" });
  await expect(heading).toBeVisible();

  const box = await heading.boundingBox();
  expect(box).not.toBeNull();

  const layout = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  });

  expect(
    layout.scrollWidth,
    `${testInfo.project.name} ${layout.innerWidth}x${layout.innerHeight} scrollWidth ${layout.scrollWidth} > clientWidth ${layout.clientWidth}`,
  ).toBeLessThanOrEqual(layout.clientWidth);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(layout.clientWidth);
});
