import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const uiDirectory = path.join(projectRoot, "apps/api/ui");
const bundles = {
  "app.js": ["app.js"],
  "document-intake.js": [
    "document-intake.js",
    "document-structure.js",
    "template-trial.js",
    "template-multi-trial.js",
    "template-activation.js",
    "document-generation.js",
    "document-generation-preflight.js",
    "document-data-correction.js",
    "document-generation-retry.js",
    "document-delivery.js",
    "document-email-delivery.js",
    "email-recipients.js",
    "document-schedules.js",
    "document-schedule-network.js",
    "shared-document-results.js",
    "shared-document-view-labels.js",
    "shared-corporate-mode.js",
    "storage-maintenance.js",
    "bulk-data-import.js",
    "operation-center.js",
    "operations-readiness.js"
  ]
};

const temporaryDirectory = await fs.mkdtemp(
  path.join(os.tmpdir(), "docomator-ui-check-")
);

try {
  for (const [bundleName, fileNames] of Object.entries(bundles)) {
    const parts = await Promise.all(
      fileNames.map((fileName) => fs.readFile(path.join(uiDirectory, fileName)))
    );
    const bundlePath = path.join(temporaryDirectory, bundleName);
    await fs.writeFile(
      bundlePath,
      Buffer.concat(
        parts.flatMap((part, index) =>
          index === 0 ? [part] : [Buffer.from("\n\n"), part]
        )
      )
    );
    const result = spawnSync(process.execPath, ["--check", bundlePath], {
      encoding: "utf8"
    });
    if (result.status !== 0) {
      process.stderr.write(result.stderr || result.stdout);
      process.exitCode = result.status ?? 1;
      break;
    }
  }
} finally {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}

if (process.exitCode === undefined) {
  process.stdout.write("Пользовательские UI-бандлы прошли синтаксическую проверку.\n");
}
