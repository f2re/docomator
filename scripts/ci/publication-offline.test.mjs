import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const implementationFiles = [
  "packages/storage/src/publications.ts",
  "apps/api/src/publication-routes.ts",
  "apps/api/ui/publication-workspace.js"
];

const forbiddenNetworkImport =
  /(?:from\s+|import\s*\()\s*["'](?:node:)?(?:http|https|net|tls|dns|dgram)["']/iu;
const forbiddenNetworkClient =
  /\b(?:axios|undici|node-fetch|superagent|xmlhttprequest|websocket)\b/iu;
const absoluteNetworkAddress = /https?:\/\//iu;

async function read(relativePath) {
  return fs.readFile(path.join(projectRoot, relativePath), "utf8");
}

test("контур публикаций не содержит внешних сетевых клиентов и адресов", async () => {
  for (const relativePath of implementationFiles) {
    const source = await read(relativePath);
    assert.doesNotMatch(
      source,
      forbiddenNetworkImport,
      `${relativePath}: запрещён импорт сетевого модуля`
    );
    assert.doesNotMatch(
      source,
      forbiddenNetworkClient,
      `${relativePath}: запрещён внешний сетевой клиент`
    );
    assert.doesNotMatch(
      source,
      absoluteNetworkAddress,
      `${relativePath}: запрещён абсолютный сетевой адрес`
    );
  }
});

test("пользовательский модуль публикаций обращается только к локальному API", async () => {
  const source = await read("apps/api/ui/publication-workspace.js");
  assert.match(
    source,
    /return `\/api\/v1\/spaces\/\$\{encodeURIComponent\(spaceId\)\}\/publications\$\{path\}`;/u
  );
  assert.doesNotMatch(
    source,
    /publicationFetch\(\s*["'`]https?:\/\//iu,
    "publicationFetch не должен принимать внешний адрес"
  );
});

test("операторская документация закрепляет полностью автономный режим", async () => {
  const documentation = await read("docs/PUBLICATION_REPORTING.md");
  assert.match(documentation, /полностью автономный режим/iu);
  assert.match(documentation, /не обращается к Интернету/iu);
  assert.match(documentation, /не отправляет запросы во внешние реестры/iu);
  assert.match(documentation, /ручной ввод оператора/iu);
  assert.match(documentation, /локальные CSV\/XLSX-файлы/iu);
});
