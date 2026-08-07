import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function source(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

test("installed build identity is not keyed by VERSION alone", async () => {
  const install = await source("scripts/offline/install.sh");

  assert.match(
    install,
    /RELEASE_METADATA_SHA256="\$\(sha256_of "\$BUNDLE_ROOT\/release\.json"\)"/u
  );
  assert.match(
    install,
    /RELEASE_ID="\$\{VERSION\}-\$\{RELEASE_METADATA_SHA256:0:12\}"/u
  );
  assert.match(install, /RELEASE_DIR="\$RELEASES_DIR\/\$RELEASE_ID"/u);
  assert.doesNotMatch(install, /RELEASE_DIR="\$RELEASES_DIR\/\$VERSION"/u);
  assert.doesNotMatch(install, /Подготовьте новый номер версии/u);
});

test("normal install/update accepts user-owned bundle paths and strict mode is opt-in", async () => {
  for (const relativePath of [
    "scripts/offline/install.sh",
    "scripts/offline/update.sh"
  ]) {
    const text = await source(relativePath);
    const strictCondition = text.indexOf(
      '[[ "${DOCOMATOR_STRICT_BUNDLE_PATH:-0}" == "1" ]]'
    );
    const ownershipGuard = text.indexOf(
      'require_trusted_bundle "$SCRIPT_DIR"'
    );
    const verification = text.indexOf("verify-bundle.sh");
    assert.ok(strictCondition >= 0, `${relativePath}: strict mode must be explicit`);
    assert.ok(
      ownershipGuard > strictCondition,
      `${relativePath}: ownership guard must only exist inside strict mode`
    );
    assert.ok(
      verification > ownershipGuard,
      `${relativePath}: bundle verification must still run after optional path hardening`
    );
  }

  for (const relativePath of [
    "scripts/offline/ux-acceptance-gate.sh",
    "scripts/offline/target-acceptance.sh"
  ]) {
    const text = await source(relativePath);
    assert.doesNotMatch(text, /require_trusted_bundle/u);
    assert.match(text, /verify-bundle\.sh/u);
  }
});

test("update remains serialized and always delegates to upgrade install", async () => {
  const update = await source("scripts/offline/update.sh");
  assert.match(update, /flock -n 9/u);
  assert.match(update, /install\.sh" --upgrade/u);
  assert.doesNotMatch(update, /VERSION.*уже установлена/u);
});
