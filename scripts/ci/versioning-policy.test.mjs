import assert from "node:assert/strict";
import test from "node:test";

import { incrementVersion } from "../release/bump-version.mjs";
import { isProductChange } from "./check-version-policy.mjs";

test("SemVer bump различает fix, feature и major", () => {
  assert.equal(incrementVersion("0.2.0", "patch"), "0.2.1");
  assert.equal(incrementVersion("0.2.1", "minor"), "0.3.0");
  assert.equal(incrementVersion("0.9.4", "major"), "1.0.0");
  assert.equal(incrementVersion("0.2.0", "0.4.0"), "0.4.0");
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
