import { defineConfig, devices } from "@playwright/test";
import baseConfig from "./playwright.config";

// Explicit opt-in capture. Normal browser tests never run this file.
export default defineConfig({
  ...baseConfig,
  testMatch: "**/ui-review.capture.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: "test-results/ui-review-run",
  use: { ...baseConfig.use, trace: "off", video: "off", screenshot: "off" },
  projects: [{ name: "ui-review", use: { ...devices["Desktop Chrome"] } }],
});
