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
const builderPath = path.join(
  repositoryRoot,
  "scripts/offline/build-full-bundle.sh"
);

function runBash(argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [builderPath, ...argumentsList], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

test("full bundle builder exposes the Debian/Astra contract", async () => {
  const result = await runBash(["--help"]);
  assert.equal(result.signal, null);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /--target debian\|astra/u);
  assert.match(result.stdout, /LibreOffice preview/u);
  assert.match(result.stdout, /offline UX acceptance/u);
  assert.match(result.stdout, /Astra Linux.*Chromium/su);
});

test("full bundle commands select exact target profiles", async () => {
  const [builder, packageSource] = await Promise.all([
    fs.readFile(builderPath, "utf8"),
    fs.readFile(path.join(repositoryRoot, "package.json"), "utf8")
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.equal(
    packageJson.scripts["bundle:offline:debian"],
    "bash scripts/offline/build-full-bundle.sh --target debian"
  );
  assert.equal(
    packageJson.scripts["bundle:offline:astra"],
    "bash scripts/offline/build-full-bundle.sh --target astra"
  );
  assert.match(builder, /--with-preview\n\s+--with-ux-acceptance/u);
  assert.match(builder, /offline-bundles\/targets\/\$\{TARGET\}/u);
  assert.match(builder, /verify_target_os_package_profile/u);
  assert.doesNotMatch(builder, /--skip-tests/u);
});

test(
  "Astra full build rejects an implicit Chromium profile",
  { skip: typeof process.getuid === "function" && process.getuid() === 0 },
  async () => {
    const temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "docomator-full-bundle-")
    );
    const llamaServer = path.join(temporaryDirectory, "llama-server");
    const model = path.join(temporaryDirectory, "model.gguf");
    try {
      await Promise.all([
        fs.writeFile(llamaServer, "fixture\n"),
        fs.writeFile(model, "fixture\n")
      ]);
      const result = await runBash([
        "--target",
        "astra",
        "--llama-server",
        llamaServer,
        "--model",
        model
      ]);
      assert.equal(result.signal, null);
      assert.equal(result.code, 1);
      assert.match(
        result.stderr,
        /Для Astra явно укажите --ux-chromium-package и --ux-chromium-bin/u
      );
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
);
