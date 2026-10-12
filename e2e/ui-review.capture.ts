import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type {
  RecommendationPick,
  RecommendationResult,
} from "../src/lib/live-recommendation/contract";
import { mockCatalog, quizTitles } from "./catalog-fixture";

const outputDir = path.resolve("test-results/ui-review");
const checkedAt = "2026-09-27T18:00:00.000Z";
const palettes = [
  ["#e4eaf8", "#465c8d", "#f7c986"],
  ["#f6e2d8", "#a35e4e", "#eab969"],
  ["#e5eddc", "#5b774e", "#f4d278"],
  ["#eee3f5", "#806299", "#ddab9b"],
  ["#f9edcf", "#8b7041", "#dca08c"],
  ["#dcebec", "#537d7e", "#efd09a"],
];

// Neutral, clearly labelled artwork is intercepted only in this capture test.
// No production fixture fallback or external poster/availability request is used.
function samplePoster(index: number) {
  const [background, foreground, accent] = palettes[index % palettes.length]!;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750" viewBox="0 0 500 750"><rect width="500" height="750" fill="${background}"/><circle cx="330" cy="220" r="100" fill="${accent}"/><path d="M0 510 165 285 500 665v85H0Z" fill="${foreground}"/><path d="m0 655 240-270 260 245v120H0Z" fill="${accent}" opacity=".7"/><text x="250" y="90" text-anchor="middle" font-family="system-ui,sans-serif" font-size="24" font-weight="600" fill="${foreground}">SAMPLE POSTER</text></svg>`;
}

async function setupReviewFixtures(page: Page) {
  await mockCatalog(page);
  await page.route("**/t/p/w500/ui-review-sample-*.png", (route) => {
    const index = Number(
      route
        .request()
        .url()
        .match(/sample-(\d+)/)?.[1] ?? 0,
    );
    return route.fulfill({
      contentType: "image/svg+xml",
      body: samplePoster(index),
    });
  });
  const extraSeeds = [
    { id: "550", tmdbId: 550, title: "Fight Club", year: 1999, kind: "movie" },
    {
      id: "1396",
      tmdbId: 1396,
      title: "Breaking Bad",
      year: 2008,
      kind: "series",
    },
  ];
  const reviewSeeds = [...quizTitles, ...extraSeeds].map((title, index) => ({
    ...title,
    posterPath: `/ui-review-sample-${index}.png`,
    availability: { state: "current", checkedAt },
  }));
  await page.route("**/api/catalog/quiz-seeds?*", (route) =>
    route.fulfill({ json: { results: reviewSeeds, limit: 12 } }),
  );
  const titles = [
    "About Time",
    "Hunt for the Wilderpeople",
    "Paddington 2",
    "Safety Not Guaranteed",
    "School of Rock",
  ];
  const picks: RecommendationPick[] = titles.map((title, index) => ({
    id: String(101 + index),
    title,
    format: "movie",
    year: 2013,
    posterUrl: `https://image.tmdb.org/t/p/w500/ui-review-sample-${index}.png`,
    runtimeMinutes: 123,
    episodeRuntimeMinutes: null,
    seasonCount: null,
    reasons: [
      "Sample recommendation card for design review. This is mocked data.",
    ],
    availability: {
      region: "US",
      state: "current",
      checkedAt,
      infoUrl: "https://example.com/provider-information",
      offers: [
        { providerId: 8, providerName: "Netflix", access: "subscription" },
        { providerId: 9, providerName: "Prime Video", access: "rent" },
      ],
    },
  }));
  const result: RecommendationResult = {
    schemaVersion: 1,
    rankingVersion: "metadata-v1",
    status: "ok",
    confidence: "cold-start",
    picks,
    exhaustion: {
      requestedCount: 5,
      eligibleCount: 5,
      returnedCount: 5,
      missingCount: 0,
      exhausted: true,
      activeEditableConstraints: ["services", "format"],
      relaxationOptions: [],
    },
    message: null,
  };
  await page.route("**/api/recommend", (route) =>
    route.fulfill({ json: result }),
  );
}

async function waitForStableImages(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.querySelectorAll("img").forEach((img) => {
      img.loading = "eager";
    });
  });
  await expect
    .poll(
      () =>
        page
          .locator("img")
          .evaluateAll((images) =>
            images.every(
              (img) =>
                img instanceof HTMLImageElement &&
                img.complete &&
                img.naturalWidth > 0,
            ),
          ),
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.evaluate(async () => {
    await Promise.all([...document.images].map((img) => img.decode()));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(`capture four steps with sample data at ${viewport.width}px`, async ({
    page,
  }) => {
    test.skip(
      process.env.CINEMATCH_UI_REVIEW !== "1",
      "User-requested screenshot review must be explicitly enabled.",
    );
    test.setTimeout(90_000);
    await mkdir(outputDir, { recursive: true });
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await setupReviewFixtures(page);
    await page.goto("/");
    await page.evaluate((label) => {
      const banner = document.createElement("div");
      banner.textContent = label;
      banner.style.cssText =
        "padding:8px 12px;background:#efefea;color:#4f554f;text-align:center;font:12px system-ui,sans-serif;";
      document.body.prepend(banner);
    }, `Design review · Sample data · ${viewport.name} ${viewport.width} × ${viewport.height}`);
    const files: string[] = [];
    const capture = async (step: string, order: number) => {
      await waitForStableImages(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      const filename = `${viewport.name}-${viewport.width}x${viewport.height}-${order}-${step}-sample-data.png`;
      await page.screenshot({
        path: path.join(outputDir, filename),
        fullPage: true,
        animations: "disabled",
        caret: "hide",
        scale: "css",
      });
      files.push(filename);
    };
    await expect(
      page.getByRole("heading", { name: "Which subscriptions do you have?" }),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: /Netflix/ }).check();
    await capture("services", 1);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: /The Grand Budapest Hotel/ }),
    ).toBeVisible();
    await capture("taste", 2);
    await page.getByRole("button", { name: "Skip taste quiz" }).click();
    await page.getByRole("radio", { name: /Thrill/ }).check();
    await page.getByRole("radio", { name: "Movie", exact: true }).check();
    await page.getByRole("radio", { name: /Any length/ }).check();
    await capture("tonight", 3);
    await page.getByRole("button", { name: "See picks" }).click();
    await expect(
      page.getByRole("heading", { name: "Best match" }),
    ).toBeVisible();
    await capture("picks", 4);
    const sourceCommit = process.env.REVIEW_SOURCE_COMMIT;
    if (!sourceCommit || !/^[a-f\d]{40}$/.test(sourceCommit))
      throw new Error("Screenshot review needs an exact source commit.");
    const manifest = {
      sourceCommit,
      renderedCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      renderedTree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
        encoding: "utf8",
      }).trim(),
      viewport,
      services: {
        total: 8,
        initiallyVisible: 8,
        extraProviders: 0,
        note: "Small review fixture; this is not the production provider count.",
      },
      capturedAt: new Date().toISOString(),
      files,
      dataSource:
        "Repository mock catalog fixtures. Not live availability or real recommendation output.",
      posterAssets:
        "Neutral test-only SVG artwork, labelled SAMPLE POSTER and intercepted locally. No external poster request.",
      capture:
        "Actual browser rendering; fonts and images loaded; full-page PNG at CSS pixel scale.",
    };
    await writeFile(
      path.join(outputDir, `${viewport.name}-sample-data-manifest.json`),
      JSON.stringify(manifest, null, 2) + "\n",
    );
  });
}
