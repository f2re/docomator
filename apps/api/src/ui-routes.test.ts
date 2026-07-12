import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadApiConfig } from "@docomator/config";

import { buildApp } from "./app.js";

async function testApp() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-ui-"));
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: dataDir,
      DOCOMATOR_LOG_LEVEL: "fatal"
    })
  );
  return { app, dataDir };
}

test("UI shell is served locally with security headers", async () => {
  const { app, dataDir } = await testApp();
  try {
    const response = await app.inject({ method: "GET", url: "/" });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] ?? "", /^text\/html/);
    assert.match(response.headers["content-security-policy"] ?? "", /default-src 'self'/);
    assert.match(response.body, /Docomator/);
    assert.match(response.body, /aria-live="polite"/);
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("UI assets are served without external runtime dependencies", async () => {
  const { app, dataDir } = await testApp();
  try {
    const [styles, script, icon] = await Promise.all([
      app.inject({ method: "GET", url: "/ui/styles.css" }),
      app.inject({ method: "GET", url: "/ui/app.js" }),
      app.inject({ method: "GET", url: "/favicon.svg" })
    ]);

    assert.equal(styles.statusCode, 200);
    assert.match(styles.headers["content-type"] ?? "", /^text\/css/);
    assert.match(styles.body, /--surface/);

    assert.equal(script.statusCode, 200);
    assert.match(script.headers["content-type"] ?? "", /^text\/javascript/);
    assert.doesNotMatch(script.body, /https?:\/\//);

    assert.equal(icon.statusCode, 200);
    assert.match(icon.headers["content-type"] ?? "", /^image\/svg\+xml/);
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
