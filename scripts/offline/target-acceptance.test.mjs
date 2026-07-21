import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const scriptPath = path.join(repositoryRoot, "scripts/offline/target-acceptance.sh");

function runHelp() {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [scriptPath, "--help"], {
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

test("target acceptance exposes one strict Debian/Astra command", async () => {
  const result = await runHelp();
  assert.equal(result.signal, null);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /единый fail-closed прогон/u);
  assert.match(result.stdout, /--require-network/u);
  assert.match(result.stdout, /--require-smtp/u);
  assert.match(result.stdout, /обычным пользователем/u);
});

test("target acceptance binds all mandatory target gates and artifacts", async () => {
  const source = await fs.readFile(scriptPath, "utf8");

  const verifyIndex = source.indexOf("01-verify-bundle.log");
  const smokeIndex = source.indexOf("02-root-smoke.log");
  const releaseIndex = source.indexOf("03-target-release-gate.log");
  const pilotIndex = source.indexOf("04-pilot-check.log");
  const uxIndex = source.indexOf("05-ux-acceptance.log");
  assert.ok(verifyIndex >= 0);
  assert.ok(verifyIndex < smokeIndex);
  assert.ok(smokeIndex < releaseIndex);
  assert.ok(releaseIndex < pilotIndex);
  assert.ok(pilotIndex < uxIndex);

  assert.match(source, /--run-backup/u);
  assert.match(source, /pilot\.release\?\.gitCommit !== release\.gitCommit/u);
  assert.match(source, /ux\.bundleManifestSha256 !== bundleManifestSha256/u);
  assert.match(source, /kind: "docomator\.target-acceptance"/u);
  assert.match(source, /manifest\.sha256/u);
  assert.doesNotMatch(source, /--skip-tests/u);
});
