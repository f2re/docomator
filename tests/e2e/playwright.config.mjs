import { defineConfig } from "@playwright/test";

const baseURL =
  process.env.DOCOMATOR_E2E_BASE_URL || "http://127.0.0.1:18080";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.mjs",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 7_000
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: ".tmp/playwright-report", open: "never" }]
  ],
  snapshotPathTemplate:
    "{testDir}/snapshots/{testFilePath}/{projectName}/{arg}{ext}",
  outputDir: ".tmp/playwright-results",
  use: {
    baseURL,
    actionTimeout: 7_000,
    deviceScaleFactor: 1,
    locale: "ru-RU",
    navigationTimeout: 15_000,
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    timezoneId: "Europe/Moscow",
    trace: "retain-on-failure",
    video: "off"
  },
  projects: [
    {
      name: "chromium-320",
      use: { browserName: "chromium", viewport: { width: 320, height: 800 } }
    },
    {
      name: "chromium-768",
      use: { browserName: "chromium", viewport: { width: 768, height: 900 } }
    },
    {
      name: "chromium-1440",
      use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } }
    }
  ]
});
