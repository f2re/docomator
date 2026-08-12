import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadApiConfig } from "@docomator/config";
import { buildZipFixture } from "@docomator/document-intake/testing";
import { ContentAddressedObjectStore, SqliteStore } from "@docomator/storage";
import { buildApp } from "./app.js";
import { installPasswordGate } from "./password-gate.js";
import { registerProductRoutes } from "./product-routes.js";

function migrate(dataDir: string): void {
  const database = new DatabaseSync(path.join(dataDir, "docomator.db"));
  database.exec("PRAGMA foreign_keys = ON;");
  const current = path.dirname(fileURLToPath(import.meta.url));
  const migrations = path.resolve(current, "../../../migrations");
  for (const file of fs.readdirSync(migrations).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort()) database.exec(fs.readFileSync(path.join(migrations, file), "utf8"));
  database.close();
}

function docx(): Buffer {
  return buildZipFixture([
    { name: "[Content_Types].xml", content: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>' },
    { name: "_rels/.rels", content: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: "word/_rels/document.xml.rels", content: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>' },
    { name: "word/styles.xml", content: '<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>' },
    { name: "word/document.xml", content: '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Текст</w:t></w:r></w:p><w:sectPr><w:pgMar w:top="567" w:right="567" w:bottom="567" w:left="567"/></w:sectPr></w:body></w:document>' }
  ]);
}

test("ГОСТ доступен без cookie, но пространства остаются за password gate", async () => {
  const dataDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "docomator-public-gost-"));
  migrate(dataDir);
  const store = new SqliteStore({ databasePath: path.join(dataDir, "docomator.db") });
  const objectStore = new ContentAddressedObjectStore(path.join(dataDir, "objects"));
  const app = buildApp(loadApiConfig({ DOCOMATOR_DATA_DIR: dataDir, DOCOMATOR_LOG_LEVEL: "fatal" }), { store, objectStore });
  installPasswordGate(app, { mode: "required", passwordHash: null, sessionSecret: "s".repeat(64), sessionTtlSeconds: 3600 });
  registerProductRoutes(app, store, objectStore);
  try {
    const page = await app.inject({ method: "GET", url: "/gost" });
    assert.equal(page.statusCode, 200, page.body);
    assert.match(page.body, /без входа/u);

    const profiles = await app.inject({ method: "GET", url: "/api/v1/public/document-formatting/profiles" });
    assert.equal(profiles.statusCode, 200, profiles.body);

    const formatted = await app.inject({
      method: "POST",
      url: "/api/v1/public/document-formatting/format?profile=gost-r-7.0.97-2025&fileName=test.docx",
      headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      payload: docx()
    });
    assert.equal(formatted.statusCode, 200, formatted.body.slice(0, 200));
    assert.equal(formatted.headers["content-type"], "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

    const protectedApi = await app.inject({ method: "GET", url: "/api/v1/spaces" });
    assert.equal(protectedApi.statusCode, 401, protectedApi.body);
  } finally {
    await app.close();
    store.close();
    await fsPromises.rm(dataDir, { recursive: true, force: true });
  }
});
