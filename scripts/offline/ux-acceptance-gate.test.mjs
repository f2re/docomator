import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const SOURCE = fileURLToPath(
  new URL("./ux-acceptance-gate.mjs", import.meta.url)
);
const COMMIT_SHA = "a".repeat(40);
const execFileAsync = promisify(execFile);

test("offline UX gate has fixed package and release preflights", async () => {
  const source = await readFile(SOURCE, "utf8");
  assert.match(source, /"\/usr\/bin\/dpkg-query"/u);
  assert.match(source, /\/api\/v1\/system\/release/u);
  assert.match(source, /servedRelease\.releaseMetadataSha256/u);
});

function run(script, arguments_, extraEnvironment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...arguments_], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...extraEnvironment }
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

async function fixture(overrides = {}, chromiumProfile = null) {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "docomator-ux-gate-"))
  );
  const root = path.join(parent, "bundle");
  await mkdir(root, { mode: 0o700 });
  await chmod(parent, 0o700);
  const script = path.join(root, "ux-acceptance-gate.mjs");
  const chromium = chromiumProfile?.path ?? path.join(root, "chromium");
  const node = path.join(root, "payload/runtime/node/bin/node");
  const cli = path.join(
    root,
    "payload/acceptance/ux/node_modules/playwright/cli.js"
  );
  const config = path.join(
    root,
    "payload/acceptance/ux/tests/e2e/playwright.config.mjs"
  );
  await Promise.all([
    mkdir(path.dirname(node), { recursive: true }),
    mkdir(path.dirname(cli), { recursive: true }),
    mkdir(path.dirname(config), { recursive: true })
  ]);
  await copyFile(SOURCE, script);
  const files = [
    writeFile(
      node,
      `#!/usr/bin/env bash\nexec ${JSON.stringify(process.execPath)} "$@"\n`
    ),
    writeFile(
      cli,
      `import { writeFile } from "node:fs/promises";
import path from "node:path";
const output = process.env.DOCOMATOR_E2E_ARTIFACT_DIR;
if (process.env.DOCOMATOR_E2E_ACCEPTANCE !== "1") process.exit(9);
if (process.env.DOCOMATOR_SMTP_PASSWORD !== undefined) process.exit(10);
await writeFile(path.join(output, "playwright-report.json"), "{}\\n");
await writeFile(path.join(output, "axe-report.json"), "{}\\n");
`
    ),
    writeFile(config, "export default {};\n"),
    writeFile(path.join(root, "manifest.sha256"), "fixture manifest\n")
  ];
  if (chromiumProfile === null) {
    files.push(
      writeFile(
        chromium,
        "#!/usr/bin/env bash\nprintf 'Chromium 130.0.1 offline\\n'\n"
      )
    );
  }
  await Promise.all(files);
  await chmod(node, 0o755);
  if (chromiumProfile === null) await chmod(chromium, 0o755);
  const releaseSource = `${JSON.stringify({
    name: "docomator",
    version: "0.1.0-test",
    gitCommit: COMMIT_SHA,
    uxAcceptanceIncluded: true,
    uxChromiumPackage: chromiumProfile?.packageName ?? "chromium",
    uxChromiumPackageVersion: chromiumProfile?.packageVersion ?? "130.0.1",
    uxChromiumPath: chromium,
    ...overrides
  })}\n`;
  await writeFile(path.join(root, "release.json"), releaseSource);
  return { parent, root, script, releaseSource };
}

async function installedExecutableProfile() {
  for (const candidate of [
    "/usr/bin/git",
    "/usr/bin/python3",
    "/usr/bin/node"
  ]) {
    try {
      const ownership = await execFileAsync("/usr/bin/dpkg-query", [
        "-S",
        candidate
      ]);
      const line = ownership.stdout
        .split("\n")
        .find((value) => value.endsWith(`: ${candidate}`));
      if (line === undefined) continue;
      const packageName = line.slice(0, line.indexOf(": ")).split(":")[0];
      if (packageName === undefined) continue;
      const installed = await execFileAsync("/usr/bin/dpkg-query", [
        "-W",
        "-f=${Version}",
        packageName
      ]);
      await execFileAsync(candidate, ["--version"]);
      return {
        path: candidate,
        packageName,
        packageVersion: installed.stdout.trim()
      };
    } catch {
      // Try the next deterministic system executable.
    }
  }
  throw new Error("Не найден подходящий Debian-пакет для теста UX-gate.");
}

async function releaseIdentityServer(releaseSource) {
  const release = JSON.parse(releaseSource);
  const response = JSON.stringify({
    name: "docomator",
    version: release.version,
    gitCommit: release.gitCommit,
    releaseMetadataSha256: createHash("sha256")
      .update(releaseSource)
      .digest("hex"),
    source: "installed"
  });
  const server = createServer((_request, reply) => {
    reply.writeHead(200, { "content-type": "application/json" });
    reply.end(response);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Не удалось открыть тестовый loopback-сервер.");
  }
  return {
    baseURL: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

test(
  "offline UX gate creates bound evidence in a new protected directory",
  { skip: process.platform !== "linux" },
  async () => {
    const profile = await installedExecutableProfile();
    const { parent, script, releaseSource } = await fixture({}, profile);
    const identity = await releaseIdentityServer(releaseSource);
    const output = path.join(parent, "evidence");
    try {
      const result = await run(
        script,
        ["--output", output, "--base-url", identity.baseURL],
        { DOCOMATOR_SMTP_PASSWORD: "не передавать в браузер" }
      );
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /offline UX-gate завершён/iu);
      const metadata = JSON.parse(
        await readFile(path.join(output, "run-metadata.json"), "utf8")
      );
      assert.equal(metadata.commitSha, COMMIT_SHA);
      assert.equal(metadata.chromiumPackage, profile.packageName);
      assert.match(metadata.bundleManifestSha256, /^[a-f0-9]{64}$/u);
      assert.match(metadata.releaseMetadataSha256, /^[a-f0-9]{64}$/u);
      assert.equal((await stat(output)).mode & 0o077, 0);
      await readFile(path.join(output, "playwright-report.json"));
      await readFile(path.join(output, "axe-report.json"));
    } finally {
      await identity.close();
      await rm(parent, { recursive: true, force: true });
    }
  }
);

test("offline UX gate rejects remote origins and disabled profiles without output", async () => {
  for (const scenario of ["remote", "disabled"]) {
    const { parent, script } = await fixture(
      scenario === "disabled" ? { uxAcceptanceIncluded: false } : {}
    );
    const output = path.join(parent, "evidence");
    try {
      const arguments_ = ["--output", output];
      if (scenario === "remote") {
        arguments_.push("--base-url", "https://example.org/");
      }
      const result = await run(script, arguments_);
      assert.equal(result.code, 1);
      assert.match(
        result.output,
        scenario === "remote" ? /локальн|127\.0\.0\.1/iu : /без offline-профиля/iu
      );
      await assert.rejects(stat(output), { code: "ENOENT" });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  }
});
