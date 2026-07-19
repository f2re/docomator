import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

test("offline bundle explicitly requires the release-bound pilot runtime", async () => {
  const [verifier, prepareBundle, pilotLauncher] = await Promise.all([
    fs.readFile(
      path.join(repositoryRoot, "scripts/offline/verify-bundle.sh"),
      "utf8"
    ),
    fs.readFile(
      path.join(repositoryRoot, "scripts/offline/prepare-bundle.sh"),
      "utf8"
    ),
    fs.readFile(
      path.join(repositoryRoot, "scripts/runtime/pilot-check.sh"),
      "utf8"
    )
  ]);

  for (const relative of [
    "payload/app/scripts/runtime/pilot-check.mjs",
    "payload/app/scripts/runtime/pilot-release-identity.mjs"
  ]) {
    assert.ok(
      verifier.includes(`[[ -f "$BUNDLE_ROOT/${relative}" ]] || \\\n`),
      `verify-bundle.sh должен явно требовать ${relative}`
    );
  }
  assert.match(
    prepareBundle,
    /cp -a "\$ROOT_DIR\/scripts\/runtime\/\." "\$BUNDLE_DIR\/payload\/app\/scripts\/runtime\/"/u
  );
  assert.match(
    pilotLauncher,
    /PILOT_SCRIPT="\$SCRIPT_DIR\/pilot-check\.mjs"/u
  );
});
