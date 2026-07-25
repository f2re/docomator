import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Fastify from "fastify";

import { registerUiRoutes } from "./ui-routes.js";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-help-"));
  const docsDirectory = path.join(root, "docs");
  const uiDirectory = path.resolve(import.meta.dirname, "../ui");
  await fs.mkdir(path.join(docsDirectory, "adr"), { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(docsDirectory, "USER_GUIDE.md"),
      "# Руководство оператора\n\nПолный рабочий поток.\n",
      "utf8"
    ),
    fs.writeFile(
      path.join(docsDirectory, "REQUIREMENTS.md"),
      "# Требования\n\nНормативные требования.\n",
      "utf8"
    ),
    fs.writeFile(
      path.join(docsDirectory, "adr", "0001-local.md"),
      "# Локальная работа\n\nАрхитектурное решение.\n",
      "utf8"
    )
  ]);
  const app = Fastify({ logger: false });
  registerUiRoutes(app, uiDirectory, docsDirectory);
  return { app, root };
}

test("локальный API перечисляет и читает все Markdown-документы без раскрытия пути ОС", async () => {
  const { app, root } = await fixture();
  try {
    const manifest = await app.inject({
      method: "GET",
      url: "/api/v1/help/documents"
    });
    assert.equal(manifest.statusCode, 200);
    assert.equal(manifest.headers["cache-control"], "no-store");
    const body = manifest.json() as {
      data: Array<{
        id: string;
        path: string;
        title: string;
        category: string;
        sizeBytes: number;
        absolutePath?: string;
      }>;
    };
    assert.equal(body.data.length, 3);
    assert.deepEqual(
      body.data.map((document) => document.path).sort(),
      ["REQUIREMENTS.md", "USER_GUIDE.md", "adr/0001-local.md"]
    );
    assert.ok(body.data.every((document) => /^[a-f0-9]{24}$/u.test(document.id)));
    assert.ok(body.data.every((document) => document.absolutePath === undefined));
    assert.equal(
      body.data.find((document) => document.path === "USER_GUIDE.md")?.title,
      "Руководство оператора"
    );
    assert.equal(
      body.data.find((document) => document.path.startsWith("adr/"))?.category,
      "Архитектурные решения"
    );

    const guide = body.data.find((document) => document.path === "USER_GUIDE.md");
    assert.ok(guide);
    const documentResponse = await app.inject({
      method: "GET",
      url: `/api/v1/help/documents/${guide.id}`
    });
    assert.equal(documentResponse.statusCode, 200);
    const documentBody = documentResponse.json() as {
      data: { path: string; content: string; absolutePath?: string };
    };
    assert.equal(documentBody.data.path, "USER_GUIDE.md");
    assert.match(documentBody.data.content, /Полный рабочий поток/u);
    assert.equal(documentBody.data.absolutePath, undefined);

    const missing = await app.inject({
      method: "GET",
      url: `/api/v1/help/documents/${"f".repeat(24)}`
    });
    assert.equal(missing.statusCode, 404);
    assert.match(missing.body, /Документ не найден/u);
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("веб-бандлы содержат руководство и просмотр полного архива проекта", async () => {
  const { app, root } = await fixture();
  try {
    const [script, styles] = await Promise.all([
      app.inject({ method: "GET", url: "/ui/app.js" }),
      app.inject({ method: "GET", url: "/ui/styles.css" })
    ]);
    assert.equal(script.statusCode, 200);
    assert.match(script.body, /Руководство по всем рабочим потокам/u);
    assert.match(script.body, /Все документы проекта/u);
    assert.match(script.body, /\/api\/v1\/help\/documents/u);
    assert.equal(styles.statusCode, 200);
    assert.match(styles.body, /\.help-center-grid/u);
    assert.match(styles.body, /\.help-project-browser/u);
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
