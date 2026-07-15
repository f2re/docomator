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

test("ordinary employee flow does not ask for machine keys", async () => {
  const { app, dataDir } = await testApp();
  try {
    const [shell, appScript, workflowScript] = await Promise.all([
      app.inject({ method: "GET", url: "/" }),
      app.inject({ method: "GET", url: "/ui/app.js" }),
      app.inject({ method: "GET", url: "/ui/document-intake.js" })
    ]);

    assert.match(shell.body, /data-view="employees"/u);
    assert.match(shell.body, />Сотрудники</u);
    assert.match(shell.body, />Создать документы</u);
    assert.match(appScript.body, /\/employees/u);
    assert.match(workflowScript.body, /Какое поле сотрудника поставить сюда\?/u);
    for (const body of [shell.body, appScript.body, workflowScript.body]) {
      assert.doesNotMatch(
        body,
        /Стабильный ключ|Устойчивый ключ|Технический ключ|Ключ свойства|Ключ группы|Ключ получателя/u
      );
    }
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("template connection is a space-scoped sequential wizard", async () => {
  const { app, dataDir } = await testApp();
  try {
    const [shell, styles, appScript, workflowScript] = await Promise.all([
      app.inject({ method: "GET", url: "/" }),
      app.inject({ method: "GET", url: "/ui/styles.css" }),
      app.inject({ method: "GET", url: "/ui/app.js" }),
      app.inject({ method: "GET", url: "/ui/document-intake.js" })
    ]);

    assert.match(shell.body, /id="templateWizard"/u);
    assert.equal(shell.body.match(/data-template-wizard-go="[1-4]"/gu)?.length, 4);
    assert.match(shell.body, /data-template-wizard-go="2" disabled/u);
    assert.match(shell.body, /id="templateWizardBack"[^>]*hidden/u);
    assert.match(workflowScript.body, /dataset\.templateWizardPanel = "2"/u);
    assert.equal(
      workflowScript.body.match(/dataset\.templateWizardPanel = "3"/gu)?.length,
      2
    );
    assert.match(workflowScript.body, /dataset\.templateWizardPanel = "4"/u);
    assert.match(workflowScript.body, /docomator\.templateWizard\.v1:\$\{key\}/u);
    assert.match(workflowScript.body, /value\.spaceId === key/u);
    assert.match(
      workflowScript.body,
      /spaces\/\$\{encodeURIComponent\(spaceId\)\}\/document-sources/u
    );
    assert.match(workflowScript.body, /docomator:space-changed/u);
    assert.match(
      workflowScript.body,
      /return Boolean\(globalThis\.docomatorTemplateWizard\?\.isComplete\(1\)\)/u
    );
    assert.equal(
      workflowScript.body.match(/docomatorTemplateWizard\?\.complete\(3/gu)?.length,
      2
    );
    assert.doesNotMatch(appScript.body, /function updateTemplateRail/u);
    assert.match(appScript.body, /docomator:template-wizard-step-completed/u);
    assert.match(styles.body, /@media \(max-width: 400px\)/u);
    assert.match(
      styles.body,
      /\.template-step-rail \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/u
    );
    assert.match(styles.body, /\.template-step-rail button \{[^}]*min-height: 54px/u);
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
