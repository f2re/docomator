#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

function fail(message) {
  process.stderr.write(`[ОШИБКА] ${message}\n`);
  process.exit(1);
}

function parseEnvironment(source, label) {
  const result = new Map();
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match) fail(`${label}:${index + 1}: ожидалось КЛЮЧ=ЗНАЧЕНИЕ.`);
    if (result.has(match[1])) fail(`${label}: ключ ${match[1]} указан повторно.`);
    result.set(match[1], match[2]);
  }
  return result;
}

function required(values, key, label) {
  const value = values.get(key);
  if (value === undefined || value === "") fail(`${label}: отсутствует ${key}.`);
  return value;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

const argument = process.argv[2];
if (!argument || process.argv.length !== 3) {
  fail("Использование: verify-target-profile.mjs КАТАЛОГ_КОМПЛЕКТА");
}
const bundleRoot = path.resolve(argument);

let release;
try {
  release = JSON.parse(await readFile(path.join(bundleRoot, "release.json"), "utf8"));
} catch {
  fail("Не удалось прочитать release.json.");
}

if (release.bundleSchemaVersion !== 2) {
  fail("Неподдерживаемая версия схемы автономного комплекта.");
}
if (!["generic", "debian", "astra"].includes(release.targetProfile)) {
  fail("release.json содержит неизвестный targetProfile.");
}
if (typeof release.osPackagesIncluded !== "boolean") {
  fail("release.json: osPackagesIncluded должен быть логическим значением.");
}

if (!release.osPackagesIncluded) {
  if (release.targetProfile !== "generic") {
    fail("Комплект без пакетов ОС должен иметь targetProfile=generic.");
  }
  if (release.dependencyClosure !== "not-applicable") {
    fail("Комплект без пакетов ОС должен иметь dependencyClosure=not-applicable.");
  }
  process.stdout.write("Профиль автономного комплекта корректен.\n");
  process.exit(0);
}

if (release.targetProfile === "generic") {
  fail("Комплект с пакетами ОС обязан иметь профиль debian или astra.");
}
if (release.dependencyClosure !== "full") {
  fail("Автономный комплект не подтверждает полное замыкание зависимостей.");
}

let sourceText;
let requestedPackages;
try {
  [sourceText, requestedPackages] = await Promise.all([
    readFile(path.join(bundleRoot, "payload/os-packages/source-os.env"), "utf8"),
    readFile(path.join(bundleRoot, "payload/os-packages/requested-packages.txt"))
  ]);
} catch {
  fail("Набор пакетов ОС не содержит профиль или исходный список пакетов.");
}
const source = parseEnvironment(sourceText, "source-os.env");
const family = required(source, "OS_FAMILY", "source-os.env");
const closure = required(source, "DEPENDENCY_CLOSURE", "source-os.env");
const recommends = required(source, "APT_INSTALL_RECOMMENDS", "source-os.env");
const requestedSha256 = required(
  source,
  "REQUESTED_PACKAGES_SHA256",
  "source-os.env"
);
if (!["debian", "astra"].includes(family)) {
  fail("source-os.env содержит неизвестное семейство ОС.");
}
if (family !== release.targetProfile) {
  fail("targetProfile не совпадает с семейством ОС набора .deb.");
}
if (closure !== "full" || recommends !== "false") {
  fail("Набор .deb не подтверждает обязательное замыкание без recommends.");
}
if (!/^[a-f0-9]{64}$/u.test(requestedSha256)) {
  fail("REQUESTED_PACKAGES_SHA256 заполнен некорректно.");
}
if (sha256(requestedPackages) !== requestedSha256) {
  fail("Контрольная сумма requested-packages.txt не совпадает с source-os.env.");
}

const sourceMetadata = release.osPackageSource;
if (
  sourceMetadata === null ||
  typeof sourceMetadata !== "object" ||
  Array.isArray(sourceMetadata) ||
  sourceMetadata.family !== family ||
  sourceMetadata.dependencyClosure !== "full"
) {
  fail("release.json не закрепляет семейство ОС и полное замыкание зависимостей.");
}

process.stdout.write("Профиль автономного комплекта корректен.\n");
