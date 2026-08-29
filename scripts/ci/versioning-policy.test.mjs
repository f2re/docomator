import assert from "node:assert/strict";
import test from "node:test";

import { incrementVersion, updateLockVersion, updatePlanningDocumentVersion } from "../release/bump-version.mjs";
import { isProductChange } from "./check-version-policy.mjs";

test("SemVer bump различает fix, feature и major", () => {
  assert.equal(incrementVersion("0.2.0", "patch"), "0.2.1");
  assert.equal(incrementVersion("0.2.1", "minor"), "0.3.0");
  assert.equal(incrementVersion("0.9.4", "major"), "1.0.0");
  assert.equal(incrementVersion("0.2.0", "0.4.0"), "0.4.0");
});

test("planning docs меняют текущий release binding, но не переписывают историю", () => {
  const source = [
    "# План",
    "",
    "Текущая версия: `0.6.6`.",
    "",
    "В `0.6.6` исправлена компоновка редактора.",
    "Проверить CI exact `0.6.6` перед выпуском."
  ].join("\n");
  const updated = updatePlanningDocumentVersion(source, "0.6.6", "0.6.7", "test plan");
  assert.match(updated, /Текущая версия: `0\.6\.7`\./u);
  assert.match(updated, /В `0\.6\.6` исправлена компоновка редактора\./u);
  assert.match(updated, /CI exact `0\.6\.7`/u);
  assert.doesNotMatch(updated, /В `0\.6\.7` исправлена компоновка редактора\./u);
});

test("version bump сохраняет формат package-lock и меняет только workspace binding", () => {
  const source = [
    '{',
    '  "version": "0.6.6",',
    '  "packages": {',
    '    "": {"version":"0.6.6","dependencies":{"@docomator/config":"0.6.6","external":"1.0.0"}},',
    '    "packages/config": {"version":"0.6.6"},',
    '    "node_modules/external": {"version":"1.0.0"}',
    '  }',
    '}'
  ].join("\n");
  const updated = updateLockVersion(source, "0.6.6", "0.6.7");
  assert.equal(updated, source.replaceAll("0.6.6", "0.6.7"));
  assert.match(updated, /"node_modules\/external": \{"version":"1\.0\.0"\}/u);
  assert.throws(
    () => updateLockVersion(source.replace('"node_modules/external": {"version":"1.0.0"}', '"node_modules/external": {"version":"0.6.6"}'), "0.6.6", "0.6.7"),
    /найдено 5 ссылок/u
  );
});

test("version policy требует bump только для продуктового поведения", () => {
  assert.equal(isProductChange("apps/api/src/server.ts"), true);
  assert.equal(isProductChange("packages/storage/src/index.ts"), true);
  assert.equal(isProductChange("migrations/0031_example.sql"), true);
  assert.equal(isProductChange("scripts/offline/install.sh"), true);
  assert.equal(isProductChange("apps/api/src/server.test.ts"), false);
  assert.equal(isProductChange("tests/e2e/flow.spec.mjs"), false);
  assert.equal(isProductChange("docs/VERSIONING.md"), false);
  assert.equal(isProductChange("package.json"), false);
  assert.equal(isProductChange("packages/config/src/index.ts"), false);
});
