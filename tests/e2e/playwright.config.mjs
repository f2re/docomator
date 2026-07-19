import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const artifactDirectory = process.env.DOCOMATOR_E2E_ARTIFACT_DIR
  ? path.resolve(process.env.DOCOMATOR_E2E_ARTIFACT_DIR)
  : path.join(testDirectory, ".tmp");
const evidenceContractVersion = 2;
const chromiumExecutable = process.env.DOCOMATOR_E2E_CHROMIUM_BIN;
const acceptanceRun = process.env.DOCOMATOR_E2E_ACCEPTANCE === "1";

const baseURL =
  process.env.DOCOMATOR_E2E_BASE_URL || "http://127.0.0.1:18080";

export default defineConfig({
  metadata: {
    docomatorEvidenceContractVersion: evidenceContractVersion,
    docomatorCommitSha:
      process.env.DOCOMATOR_E2E_COMMIT_SHA || "development",
    docomatorBundleManifestSha256:
      process.env.DOCOMATOR_E2E_BUNDLE_MANIFEST_SHA256 || "development",
    docomatorReleaseMetadataSha256:
      process.env.DOCOMATOR_E2E_RELEASE_METADATA_SHA256 || "development",
    docomatorBrowserVersion:
      process.env.DOCOMATOR_E2E_BROWSER_VERSION || "development"
  },
  testDir: ".",
  testMatch: "**/*.spec.mjs",
  fullyParallel: false,
  forbidOnly: acceptanceRun || Boolean(process.env.CI),
  retries: acceptanceRun ? 0 : process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 7_000
  },
  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder: path.join(artifactDirectory, "playwright-report"),
        open: "never"
      }
    ],
    [
      "json",
      { outputFile: path.join(artifactDirectory, "playwright-report.json") }
    ],
    [
      path.join(testDirectory, "reporters", "axe-json-reporter.mjs"),
      { outputFile: path.join(artifactDirectory, "axe-report.json") }
    ]
  ],
  snapshotPathTemplate:
    "{testDir}/snapshots/{testFilePath}/{projectName}/{arg}{ext}",
  outputDir: path.join(artifactDirectory, "playwright-results"),
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
    video: "off",
    ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {})
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
