import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const verifierPath = path.join(
  repositoryRoot,
  "scripts/offline/verify-bundle.sh"
);

function runVerifier(bundle) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [verifierPath, bundle], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    const output = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => output.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        output: Buffer.concat(output).toString("utf8")
      });
    });
  });
}

async function preflightBundle() {
  const bundle = await fs.mkdtemp(
    path.join(os.tmpdir(), "docomator-pilot-bundle-")
  );
  const regularFiles = [
    "VERSION",
    "RELEASE_NOTES.md",
    "SUPPORT_MATRIX.md",
    "release.json",
    "manifest.sha256",
    "manifest.symlinks",
    "ux-acceptance-gate.mjs",
    "http-check.mjs",
    "verify-release.mjs",
    "payload/config/docomator.env.example",
    "payload/app/scripts/ci/release-gate.mjs",
    "payload/app/scripts/ci/release-gate-crash-worker.mjs",
    "payload/app/scripts/ci/libreoffice-release-gate.mjs",
    "payload/app/scripts/runtime/automatic-backup.mjs",
    "payload/app/scripts/runtime/pilot-readiness.mjs",
    "payload/deploy/systemd/docomator-backup.service.in",
    "payload/deploy/systemd/docomator-backup.timer.in",
    "payload/app/examples/README.md",
    "payload/app/examples/manifest.sha256"
  ];
  const executableFiles = [
    "payload/runtime/node/bin/node",
    "smoke-test.sh",
    "target-release-gate.sh",
    "target-acceptance.sh",
    "ux-acceptance-gate.sh"
  ];
  for (const relative of [...regularFiles, ...executableFiles]) {
    const target = path.join(bundle, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${relative}\n`);
  }
  for (const relative of executableFiles) {
    await fs.chmod(path.join(bundle, relative), 0o755);
  }
  const launcher = path.join(
    bundle,
    "payload/app/scripts/runtime/pilot-check.sh"
  );
  await fs.writeFile(
    launcher,
    '#!/usr/bin/env bash\nPILOT_SCRIPT="$SCRIPT_DIR/pilot-check.mjs"\n'
  );
  return bundle;
}

test("offline bundle explicitly requires the release-bound pilot runtime", async () => {
  const [verifier, prepareBundle, pilotLauncher] = await Promise.all([
    fs.readFile(verifierPath, "utf8"),
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

test("offline verifier rejects each missing pilot release-binding module", async () => {
  const bundle = await preflightBundle();
  try {
    const missingOrchestrator = await runVerifier(bundle);
    assert.equal(missingOrchestrator.code, 1);
    assert.match(missingOrchestrator.output, /оркестратор пилотной приёмки/iu);

    await fs.writeFile(
      path.join(bundle, "payload/app/scripts/runtime/pilot-check.mjs"),
      "// fixture\n"
    );
    const missingIdentity = await runVerifier(bundle);
    assert.equal(missingIdentity.code, 1);
    assert.match(
      missingIdentity.output,
      /проверка идентичности пилотного релиза/iu
    );
  } finally {
    await fs.rm(bundle, { recursive: true, force: true });
  }
});
