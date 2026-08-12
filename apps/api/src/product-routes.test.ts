import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadApiConfig } from "@docomator/config";
import { ContentAddressedObjectStore, SqliteStore } from "@docomator/storage";
import { buildApp } from "./app.js";
import { registerProductRoutes } from "./product-routes.js";

function migrate(dataDir: string): void {
  const database = new DatabaseSync(path.join(dataDir, "docomator.db")); database.exec("PRAGMA foreign_keys = ON;");
  const current = path.dirname(fileURLToPath(import.meta.url)), migrations = path.resolve(current, "../../../migrations");
  for (const file of fs.readdirSync(migrations).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort()) database.exec(fs.readFileSync(path.join(migrations, file), "utf8"));
  database.close();
}

test("production product bootstrap exposes publications, bibliography and GOST formatting in one UI bundle", async () => {
  const dataDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "docomator-product-routes-")); migrate(dataDir);
  const store = new SqliteStore({ databasePath: path.join(dataDir, "docomator.db") }); const objectStore = new ContentAddressedObjectStore(path.join(dataDir, "objects"));
  const app = buildApp(loadApiConfig({ DOCOMATOR_DATA_DIR: dataDir, DOCOMATOR_LOG_LEVEL: "fatal" }), { store, objectStore }); registerProductRoutes(app, store, objectStore);
  try {
    const script = await app.inject({ method: "GET", url: "/ui/app.js" }); assert.equal(script.statusCode, 200, script.body); assert.match(script.body, /publicationWorkspace/u); assert.match(script.body, /bibliographyExchange/u); assert.match(script.body, /Форматирование по ГОСТ/u);
    const styles = await app.inject({ method: "GET", url: "/ui/styles.css" }); assert.equal(styles.statusCode, 200, styles.body); assert.match(styles.body, /product-check/u); assert.match(styles.body, /inline-size:18px/u);
    const profiles = await app.inject({ method: "GET", url: "/api/v1/document-formatting/profiles" }); assert.equal(profiles.statusCode, 200, profiles.body); assert.deepEqual(profiles.json().data.map((item: { id: string }) => item.id), ["gost-r-7.0.97-2025", "eskd-gost-r-2.105-2019"]);
  } finally { await app.close(); store.close(); await fsPromises.rm(dataDir, { recursive: true, force: true }); }
});
