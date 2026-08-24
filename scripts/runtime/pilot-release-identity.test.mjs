#!/usr/bin/env node
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import {
  bindPilotReleaseIdentity,
  createAccessCodeSession,
  fetchInstalledReleaseIdentity,
  validateInstalledReleaseIdentity
} from "./pilot-release-identity.mjs";

const COMMIT = "a".repeat(40);
const RELEASE_SHA = "b".repeat(64);
const CODE = "0427";
const IDENTITY = {
  name: "docomator",
  version: "0.6.3",
  gitCommit: COMMIT,
  releaseMetadataSha256: RELEASE_SHA,
  source: "installed"
};

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await callback(`http://127.0.0.1:${address.port}/`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("validateInstalledReleaseIdentity принимает точный installed contract", () => {
  assert.deepEqual(validateInstalledReleaseIdentity(IDENTITY, "0.6.3"), IDENTITY);
  assert.throws(() => validateInstalledReleaseIdentity({ ...IDENTITY, extra: true }), /структуру/u);
  assert.throws(() => validateInstalledReleaseIdentity({ ...IDENTITY, source: "source" }), /идентичность/u);
  assert.throws(() => validateInstalledReleaseIdentity(IDENTITY, "0.6.2"), /не совпадает/u);
});

test("createAccessCodeSession отправляет только 4 цифры и получает session cookie", async () => {
  await withServer((request, response) => {
    if (request.url !== "/api/v1/access/unlock") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      assert.deepEqual(JSON.parse(body), { code: CODE });
      response.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": "docomator_session=token; Path=/; HttpOnly; SameSite=Strict"
      });
      response.end('{"data":{"unlocked":true}}');
    });
  }, async (baseUrl) => {
    const cookie = await createAccessCodeSession(baseUrl, CODE);
    assert.equal(cookie, "docomator_session=token");
  });
  await assert.rejects(() => createAccessCodeSession("http://127.0.0.1:1/", "123"), /4 цифр/u);
});

test("fetchInstalledReleaseIdentity открывает session кодом и читает release API", async () => {
  await withServer((request, response) => {
    if (request.url === "/api/v1/access/unlock") {
      response.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": "docomator_session=token; Path=/; HttpOnly"
      });
      response.end('{"data":{"unlocked":true}}');
      return;
    }
    if (request.url === "/api/v1/system/release") {
      assert.equal(request.headers.cookie, "docomator_session=token");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(IDENTITY));
      return;
    }
    response.writeHead(404).end();
  }, async (baseUrl) => {
    assert.deepEqual(await fetchInstalledReleaseIdentity(baseUrl, "0.6.3", CODE), IDENTITY);
  });
});

test("bindPilotReleaseIdentity добавляет обязательную release identity check", () => {
  const source = {
    version: "0.6.3",
    generatedAt: "2026-08-21T00:00:00.000Z",
    environment: { os: { name: "Test" }, architecture: "x64" },
    checks: [{ id: "base", title: "Base", state: "ok", required: true, summary: "ok" }]
  };
  const bound = bindPilotReleaseIdentity(source, IDENTITY);
  assert.equal(bound.status, "passed");
  assert.equal(bound.release.gitCommit, COMMIT);
  assert.equal(bound.checks.some((item) => item.id === "release_identity" && item.state === "ok"), true);

  const failed = bindPilotReleaseIdentity(source, null, "код неверен");
  assert.equal(failed.status, "failed");
  assert.equal(failed.summary.requiredErrors, 1);
  assert.match(failed.checks.find((item) => item.id === "release_identity")?.detail ?? "", /код неверен/u);
});
