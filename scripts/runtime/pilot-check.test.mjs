import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));

function runNode(scriptPath, argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...argumentsList], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({
        code: code ?? 2,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

async function fixture(releaseSource) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-pilot-check-"));
  const scripts = path.join(root, "scripts");
  const output = path.join(root, "reports");
  await fs.mkdir(scripts, { recursive: true });
  await Promise.all(
    ["pilot-check.mjs", "pilot-release-identity.mjs"].map((name) =>
      fs.copyFile(path.join(runtimeDirectory, name), path.join(scripts, name))
    )
  );

  const identity = {
    name: "docomator",
    version: "0.1.0-alpha.0",
    gitCommit: "a".repeat(40),
    releaseMetadataSha256: "b".repeat(64),
    source: releaseSource
  };
  const server = createServer((request, response) => {
    if (request.url !== "/api/v1/system/release") {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(`${JSON.stringify(identity)}\n`);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;

  const report = {
    format: "docomator-pilot-readiness",
    version: "0.1.0-alpha.0",
    generatedAt: "2026-07-19T20:00:00.000Z",
    status: "passed",
    url,
    environment: {
      os: { name: "Debian GNU/Linux 13" },
      architecture: "x64"
    },
    summary: {
      ok: 1,
      warning: 0,
      error: 0,
      disabled: 0,
      requiredErrors: 0
    },
    checks: [
      {
        id: "readiness_endpoint",
        title: "Диагностический API",
        state: "ok",
        required: true,
        summary: "Готов",
        detail: null,
        remediation: null,
        data: {}
      }
    ]
  };
  const collectorSource = `
    import fs from "node:fs/promises";
    import path from "node:path";
    const argumentsList = process.argv.slice(2);
    if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
      process.stdout.write("Использование: pilot-readiness.mjs\\n");
      process.exit(0);
    }
    const outputIndex = argumentsList.indexOf("--output");
    const outputDirectory = path.resolve(argumentsList[outputIndex + 1]);
    await fs.mkdir(outputDirectory, { recursive: true });
    const jsonReport = path.join(outputDirectory, "pilot-20260719T200000Z.json");
    const markdownReport = path.join(outputDirectory, "pilot-20260719T200000Z.md");
    const report = ${JSON.stringify(report)};
    await fs.writeFile(jsonReport, JSON.stringify(report));
    await fs.writeFile(markdownReport, "unbound");
    process.stdout.write(JSON.stringify({
      status: report.status,
      jsonReport,
      markdownReport,
      summary: report.summary
    }) + "\\n");
  `;
  await fs.writeFile(path.join(scripts, "pilot-readiness.mjs"), collectorSource);

  return {
    root,
    output,
    identity,
    script: path.join(scripts, "pilot-check.mjs"),
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await fs.rm(root, { recursive: true, force: true });
    }
  };
}

test("pilot check publishes only a release-bound final report", async () => {
  const current = await fixture("installed");
  try {
    const result = await runNode(current.script, [
      "--json-only",
      "--output",
      current.output
    ]);
    assert.equal(result.signal, null);
    assert.equal(result.code, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, "passed");
    const report = JSON.parse(await fs.readFile(summary.jsonReport, "utf8"));
    assert.deepEqual(report.release, current.identity);
    assert.equal(report.summary.requiredErrors, 0);
    assert.deepEqual((await fs.readdir(current.output)).sort(), [
      "pilot-20260719T200000Z.json",
      "pilot-20260719T200000Z.md"
    ]);
    assert.match(await fs.readFile(summary.markdownReport, "utf8"), /Git commit: a{40}/u);
  } finally {
    await current.close();
  }
});

test("development identity publishes a blocking report", async () => {
  const current = await fixture("development");
  try {
    const result = await runNode(current.script, [
      "--json-only",
      "--output",
      current.output
    ]);
    assert.equal(result.signal, null);
    assert.equal(result.code, 2, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, "failed");
    const report = JSON.parse(await fs.readFile(summary.jsonReport, "utf8"));
    assert.equal(report.release, null);
    assert.equal(report.summary.requiredErrors, 1);
    assert.equal(
      report.checks.find((item) => item.id === "release_identity")?.state,
      "error"
    );
    assert.deepEqual((await fs.readdir(current.output)).sort(), [
      "pilot-20260719T200000Z.json",
      "pilot-20260719T200000Z.md"
    ]);
  } finally {
    await current.close();
  }
});

test("pilot check delegates help without creating report files", async () => {
  const current = await fixture("installed");
  try {
    const result = await runNode(current.script, [
      "--help",
      "--output",
      current.output
    ]);
    assert.equal(result.signal, null);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Использование/u);
    await assert.rejects(() => fs.readdir(current.output), { code: "ENOENT" });
  } finally {
    await current.close();
  }
});
