import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  bindPilotReleaseIdentity,
  fetchInstalledReleaseIdentity,
  pilotMarkdownReport,
  validateInstalledReleaseIdentity
} from "./pilot-release-identity.mjs";

const validIdentity = {
  name: "docomator",
  version: "0.1.0-alpha.0",
  gitCommit: "a".repeat(40),
  releaseMetadataSha256: "b".repeat(64),
  source: "installed"
};

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function reportFixture(checks = []) {
  return {
    format: "docomator-pilot-readiness",
    version: "0.1.0-alpha.0",
    generatedAt: "2026-07-19T20:00:00.000Z",
    status: "passed",
    url: "http://127.0.0.1:8080",
    environment: {
      os: { name: "Debian GNU/Linux 13" },
      architecture: "x64"
    },
    summary: {
      ok: checks.length,
      warning: 0,
      error: 0,
      disabled: 0,
      requiredErrors: 0
    },
    checks
  };
}

test("installed release identity is strict and version-bound", () => {
  assert.deepEqual(
    validateInstalledReleaseIdentity(validIdentity, "0.1.0-alpha.0"),
    validIdentity
  );
  assert.throws(
    () => validateInstalledReleaseIdentity({ ...validIdentity, source: "development" }),
    /установленного релиза/u
  );
  assert.throws(
    () => validateInstalledReleaseIdentity(validIdentity, "0.1.0-rc.1"),
    /не совпадает/u
  );
  assert.throws(
    () => validateInstalledReleaseIdentity({ ...validIdentity, unexpected: true }),
    /структуру/u
  );
});

test("release identity is fetched from the installed API endpoint", async () => {
  await withServer(
    (request, response) => {
      assert.equal(request.url, "/api/v1/system/release");
      response.setHeader("content-type", "application/json");
      response.end(`${JSON.stringify(validIdentity)}\n`);
    },
    async (baseUrl) => {
      assert.deepEqual(
        await fetchInstalledReleaseIdentity(baseUrl, "0.1.0-alpha.0"),
        validIdentity
      );
    }
  );
});

test("release identity fetch rejects oversized and invalid responses", async () => {
  await withServer(
    (_request, response) => {
      response.setHeader("content-length", String(65 * 1024));
      response.end("x");
    },
    async (baseUrl) => {
      await assert.rejects(
        () => fetchInstalledReleaseIdentity(baseUrl),
        /размер/u
      );
    }
  );

  await withServer(
    (_request, response) => {
      response.end("not-json");
    },
    async (baseUrl) => {
      await assert.rejects(
        () => fetchInstalledReleaseIdentity(baseUrl),
        /некорректный JSON/u
      );
    }
  );
});

test("pilot report records the release binding and remains idempotent", () => {
  const source = reportFixture([
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
  ]);
  const once = bindPilotReleaseIdentity(source, validIdentity);
  const twice = bindPilotReleaseIdentity(once, validIdentity);
  assert.equal(twice.checks.filter((item) => item.id === "release_identity").length, 1);
  assert.deepEqual(twice.release, validIdentity);
  assert.equal(twice.status, "passed");
  assert.equal(twice.summary.ok, 2);
  assert.match(pilotMarkdownReport(twice), new RegExp(validIdentity.gitCommit, "u"));
  assert.match(
    pilotMarkdownReport(twice),
    new RegExp(validIdentity.releaseMetadataSha256, "u")
  );
});

test("missing release identity blocks the pilot report", () => {
  const bound = bindPilotReleaseIdentity(
    reportFixture(),
    null,
    "API идентичности релиза недоступен"
  );
  assert.equal(bound.release, null);
  assert.equal(bound.status, "failed");
  assert.equal(bound.summary.requiredErrors, 1);
  assert.equal(bound.checks[0].id, "release_identity");
  assert.match(bound.checks[0].detail, /недоступен/u);
});
