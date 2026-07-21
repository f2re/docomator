import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function source(relative) {
  return fs.readFile(path.join(root, relative), "utf8");
}

test("final contour exposes target acceptance and release evidence commands", async () => {
  const packageJson = JSON.parse(await source("package.json"));
  assert.equal(
    packageJson.scripts["acceptance:target"],
    "bash scripts/offline/target-acceptance.sh"
  );
  assert.equal(
    packageJson.scripts["release:evidence:init"],
    "node scripts/ci/release-evidence-gate.mjs init"
  );
  assert.equal(
    packageJson.scripts["release:evidence"],
    "node scripts/ci/release-evidence-gate.mjs validate"
  );
  assert.match(
    packageJson.scripts["check:runtime"],
    /node --check scripts\/ci\/release-evidence-gate\.mjs/u
  );
});

test("full bundle contains and verifies the target acceptance launcher", async () => {
  const [prepare, verify, verifyTest] = await Promise.all([
    source("scripts/offline/prepare-bundle.sh"),
    source("scripts/offline/verify-bundle.sh"),
    source("scripts/offline/verify-bundle.test.mjs")
  ]);

  assert.match(prepare, /target-acceptance\.sh/u);
  assert.match(verify, /-x "\$BUNDLE_ROOT\/target-acceptance\.sh"/u);
  assert.match(verifyTest, /"target-acceptance\.sh"/u);
});

test("pilot evidence is bound to the exact backup manifest", async () => {
  const [readiness, evidence] = await Promise.all([
    source("scripts/runtime/pilot-readiness.mjs"),
    source("scripts/runtime/pilot-backup-evidence.mjs")
  ]);

  assert.match(readiness, /manifestSha256/u);
  assert.match(readiness, /manifest\.sha256/u);
  assert.match(evidence, /SHA256_PATTERN/u);
  assert.match(evidence, /manifestSha256/u);
});

test("final documentation uses the red Astra marker and strict gate", async () => {
  const [readme, finalization] = await Promise.all([
    source("README.md"),
    source("docs/FINALIZATION.md")
  ]);

  assert.match(readme, /🟥 Astra Linux/u);
  assert.doesNotMatch(readme, /🟨 Astra Linux/u);
  assert.match(readme, /release:evidence/u);
  assert.match(finalization, /20 DOCX \+ 20 XLSX/u);
  assert.match(finalization, /отдельном чистом стенде/u);
});

test("temporary finalization workflows and payload are absent", async () => {
  for (const relative of [
    ".github/workflows/apply-target-acceptance.yml",
    ".github/workflows/finalize-target-acceptance.yml",
    ".github/workflows/finalize-target-acceptance-v2.yml",
    ".github/workflows/finalize-multi-field-version-pr.yml",
    "scripts/ci/finalizer-payload",
    "scripts/ci/finalize-multi-field-version.py"
  ]) {
    await assert.rejects(fs.access(path.join(root, relative)));
  }
});
