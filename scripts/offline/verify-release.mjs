#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

function fail(message) {
  process.stderr.write(`[ОШИБКА] ${message}\n`);
  process.exit(1);
}

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label}: ожидался объект.`);
  }
  return value;
}

function string(value, label, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail(`${label}: некорректное строковое значение.`);
  }
  return value;
}

function integer(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${label}: целое значение должно быть от ${minimum} до ${maximum}.`);
  }
  return value;
}

function parseEnvironment(source, label) {
  const values = new Map();
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (match === null) {
      fail(`${label}:${index + 1}: ожидалось простое присваивание КЛЮЧ=ЗНАЧЕНИЕ.`);
    }
    const [, key, value] = match;
    if (values.has(key)) fail(`${label}: ключ ${key} указан повторно.`);
    values.set(key, value);
  }
  return values;
}

function requiredEnvironment(values, key) {
  const value = values.get(key);
  if (value === undefined || value.length === 0) {
    fail(`В конфигурации комплекта отсутствует ${key}.`);
  }
  return value;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function sameSet(actual, expected) {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((item) => actual.includes(item))
  );
}

async function exactRegularFiles(root, prefix = "") {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    fail(`Не удалось прочитать каталог ${root}.`);
  }
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await exactRegularFiles(target, relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      fail(`В UX acceptance-наборе запрещён объект: ${relative}.`);
    }
  }
  return files.sort();
}

async function packageVersion(packageRoot, packageName) {
  try {
    const metadata = object(
      JSON.parse(
        await readFile(path.join(packageRoot, packageName, "package.json"), "utf8")
      ),
      `package.json ${packageName}`
    );
    return string(
      metadata.version,
      `package.json ${packageName} version`,
      /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      fail(`Пакет ${packageName} содержит некорректный package.json.`);
    }
    throw error;
  }
}

const bundleArgument = process.argv[2];
if (bundleArgument === undefined || process.argv.length !== 3) {
  fail("Использование: verify-release.mjs КАТАЛОГ_КОМПЛЕКТА");
}
const bundleRoot = path.resolve(bundleArgument);

let release;
let version;
let configSource;
try {
  release = object(
    JSON.parse(await readFile(path.join(bundleRoot, "release.json"), "utf8")),
    "release.json"
  );
  version = (await readFile(path.join(bundleRoot, "VERSION"), "utf8")).trim();
  configSource = await readFile(
    path.join(bundleRoot, "payload/config/docomator.env.example"),
    "utf8"
  );
} catch {
  fail("Не удалось прочитать или разобрать метаданные выпуска.");
}

if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(version)) {
  fail("VERSION автономного комплекта содержит запрещённые символы.");
}
if (release.name !== "docomator" || release.version !== version) {
  fail("Имя или версия в release.json не совпадают с комплектом.");
}
const targetArchitecture = string(
  release.targetArchitecture,
  "release.json targetArchitecture",
  /^(?:x64|arm64)$/u
);
if (typeof release.previewEnabled !== "boolean") {
  fail("release.json previewEnabled должен быть логическим значением.");
}
const converterPath = string(
  release.previewConverterPath,
  "release.json previewConverterPath",
  /^\/(?:[^\u0000-\u001f\u007f/]+\/)*[^\u0000-\u001f\u007f/]+$/u
);
const previewTimeoutMs = integer(
  release.previewTimeoutMs,
  "release.json previewTimeoutMs",
  5_000,
  900_000
);
const previewMaxBytes = integer(
  release.previewMaxBytes,
  "release.json previewMaxBytes",
  1_024,
  512 * 1024 * 1024
);
if (typeof release.osPackagesIncluded !== "boolean") {
  fail("release.json osPackagesIncluded должен быть логическим значением.");
}
const manifestSha256 = string(
  release.osPackagesManifestSha256,
  "release.json osPackagesManifestSha256",
  /^(?:|[a-f0-9]{64})$/u
);
const inventorySha256 = string(
  release.osPackagesInventorySha256,
  "release.json osPackagesInventorySha256",
  /^(?:|[a-f0-9]{64})$/u
);
if (typeof release.uxAcceptanceIncluded !== "boolean") {
  fail("release.json uxAcceptanceIncluded должен быть логическим значением.");
}
const uxChromiumPackage = string(
  release.uxChromiumPackage,
  "release.json uxChromiumPackage",
  /^(?:|[a-z0-9][a-z0-9+.-]*)$/u
);
const uxChromiumPackageVersion = string(
  release.uxChromiumPackageVersion,
  "release.json uxChromiumPackageVersion",
  /^(?:|[A-Za-z0-9][A-Za-z0-9.+:~_-]*)$/u
);
const uxChromiumPath = string(
  release.uxChromiumPath,
  "release.json uxChromiumPath",
  /^(?:|\/[A-Za-z0-9._/+:-]+)$/u
);
const uxPlaywrightVersion = string(
  release.uxPlaywrightVersion,
  "release.json uxPlaywrightVersion",
  /^(?:|\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)$/u
);
const uxAxePlaywrightVersion = string(
  release.uxAxePlaywrightVersion,
  "release.json uxAxePlaywrightVersion",
  /^(?:|\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)$/u
);

const config = parseEnvironment(configSource, "docomator.env.example");
const configPreview = requiredEnvironment(config, "DOCOMATOR_PREVIEW_ENABLED");
if (configPreview !== "true" && configPreview !== "false") {
  fail("DOCOMATOR_PREVIEW_ENABLED должен быть true или false.");
}
if ((configPreview === "true") !== release.previewEnabled) {
  fail("Preview-профиль release.json не совпадает с конфигурацией комплекта.");
}
if (requiredEnvironment(config, "DOCOMATOR_LIBREOFFICE_BIN") !== converterPath) {
  fail("Путь LibreOffice в release.json не совпадает с конфигурацией комплекта.");
}
if (
  Number(requiredEnvironment(config, "DOCOMATOR_PREVIEW_TIMEOUT_MS")) !==
  previewTimeoutMs
) {
  fail("Предел времени preview в release.json не совпадает с конфигурацией.");
}
if (
  Number(requiredEnvironment(config, "DOCOMATOR_PREVIEW_MAX_BYTES")) !==
  previewMaxBytes
) {
  fail("Предел размера preview в release.json не совпадает с конфигурацией.");
}

const packageRoot = path.join(bundleRoot, "payload/os-packages");
let packageFiles;
try {
  packageFiles = await readdir(packageRoot, { withFileTypes: true });
} catch {
  fail("Не удалось прочитать каталог пакетов ОС.");
}
const debFiles = packageFiles.filter(
  (entry) => entry.isFile() && entry.name.endsWith(".deb")
);
if ((debFiles.length > 0) !== release.osPackagesIncluded) {
  fail("Признак пакетов ОС в release.json не совпадает с содержимым комплекта.");
}
if (release.previewEnabled && !release.osPackagesIncluded) {
  fail("Preview-профиль обязан содержать проверенный набор пакетов ОС.");
}

if (release.osPackagesIncluded) {
  const sourceMetadata = object(
    release.osPackageSource,
    "release.json osPackageSource"
  );
  const sourceId = string(
    sourceMetadata.id,
    "release.json osPackageSource.id",
    /^[a-z0-9][a-z0-9._-]*$/u
  );
  const sourceVersionId = string(
    sourceMetadata.versionId,
    "release.json osPackageSource.versionId",
    /^[A-Za-z0-9][A-Za-z0-9.+:~_-]*$/u
  );
  const sourceArchitecture = string(
    sourceMetadata.architecture,
    "release.json osPackageSource.architecture",
    /^[a-z0-9][a-z0-9-]*$/u
  );
  const expectedArchitecture = targetArchitecture === "x64" ? "amd64" : "arm64";
  if (sourceArchitecture !== expectedArchitecture) {
    fail("Архитектура набора .deb не совпадает с целевой архитектурой выпуска.");
  }

  let manifest;
  let inventory;
  let sourceEnvironment;
  try {
    [manifest, inventory, sourceEnvironment] = await Promise.all([
      readFile(path.join(packageRoot, "manifest.sha256")),
      readFile(path.join(packageRoot, "packages.tsv")),
      readFile(path.join(packageRoot, "source-os.env"), "utf8")
    ]);
  } catch {
    fail("Набор пакетов ОС неполон.");
  }
  if (
    sha256(manifest) !== manifestSha256 ||
    sha256(inventory) !== inventorySha256
  ) {
    fail("Checksum вложенных метаданных пакетов не совпадает с release.json.");
  }
  const source = parseEnvironment(sourceEnvironment, "source-os.env");
  if (
    requiredEnvironment(source, "OS_ID") !== sourceId ||
    requiredEnvironment(source, "OS_VERSION_ID") !== sourceVersionId ||
    requiredEnvironment(source, "DEB_ARCHITECTURE") !== sourceArchitecture
  ) {
    fail("Источник пакетов в release.json не совпадает с source-os.env.");
  }
} else {
  if (release.osPackageSource !== null) {
    fail("Без пакетов ОС поле osPackageSource должно быть null.");
  }
  if (
    manifestSha256 !== "" ||
    inventorySha256 !== "" ||
    packageFiles.length !== 0
  ) {
    fail("Пустой набор пакетов ОС содержит лишние метаданные.");
  }
}

const acceptanceRoot = path.join(bundleRoot, "payload/acceptance/ux");
if (release.uxAcceptanceIncluded) {
  if (!release.osPackagesIncluded) {
    fail("UX acceptance-профиль обязан содержать проверенный набор пакетов ОС.");
  }
  if (
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(release.gitCommit ?? "") ||
    uxChromiumPackage === "" ||
    uxChromiumPackageVersion === "" ||
    uxChromiumPath === "" ||
    uxPlaywrightVersion === "" ||
    uxAxePlaywrightVersion === ""
  ) {
    fail("UX acceptance-профиль содержит неполные метаданные выпуска.");
  }

  let acceptanceEntries;
  try {
    acceptanceEntries = await readdir(acceptanceRoot, { withFileTypes: true });
  } catch {
    fail("UX acceptance-профиль не содержит отдельный acceptance payload.");
  }
  if (
    !sameSet(
      acceptanceEntries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
      ["node_modules", "tests"]
    ) ||
    acceptanceEntries.some((entry) => !entry.isDirectory())
  ) {
    fail("Корень UX acceptance payload содержит лишние объекты.");
  }
  await exactRegularFiles(acceptanceRoot);
  const testFiles = await exactRegularFiles(path.join(acceptanceRoot, "tests/e2e"));
  const expectedTestFiles = [
    "README.md",
    "accessibility-audit.spec.mjs",
    "bulk-import.spec.mjs",
    "employee-card.spec.mjs",
    "fixtures/docomator-api.mjs",
    "fixtures/test.mjs",
    "navigation-and-accessibility.spec.mjs",
    "operation-center.spec.mjs",
    "pages/docomator-page.mjs",
    "playwright.config.mjs",
    "reporters/axe-json-reporter.mjs",
    "template-and-generation.spec.mjs",
    "visual-artifacts.spec.mjs"
  ];
  if (!sameSet(testFiles, expectedTestFiles)) {
    fail("Состав E2E-файлов UX acceptance-набора не совпадает с обязательным списком.");
  }

  let nodeModuleEntries;
  let playwrightScopeEntries;
  let axeScopeEntries;
  try {
    [nodeModuleEntries, playwrightScopeEntries, axeScopeEntries] = await Promise.all([
      readdir(path.join(acceptanceRoot, "node_modules"), { withFileTypes: true }),
      readdir(path.join(acceptanceRoot, "node_modules/@playwright"), {
        withFileTypes: true
      }),
      readdir(path.join(acceptanceRoot, "node_modules/@axe-core"), {
        withFileTypes: true
      })
    ]);
  } catch {
    fail("UX acceptance-набор не содержит закреплённые Node.js-пакеты.");
  }
  const directoryNames = (entries, label) => {
    if (entries.some((entry) => !entry.isDirectory())) {
      fail(`${label}: разрешены только каталоги закреплённых пакетов.`);
    }
    return entries.map((entry) => entry.name);
  };
  if (
    !sameSet(directoryNames(nodeModuleEntries, "node_modules"), [
      "@axe-core",
      "@playwright",
      "axe-core",
      "playwright",
      "playwright-core"
    ]) ||
    !sameSet(directoryNames(playwrightScopeEntries, "@playwright"), ["test"]) ||
    !sameSet(directoryNames(axeScopeEntries, "@axe-core"), ["playwright"])
  ) {
    fail("Состав Node.js-пакетов UX acceptance-набора не совпадает с разрешённым списком.");
  }
  const packageRoot = path.join(acceptanceRoot, "node_modules");
  try {
    await readFile(path.join(packageRoot, "playwright/cli.js"));
  } catch {
    fail("UX acceptance-набор не содержит запуск Playwright.");
  }
  const [playwrightTest, playwright, playwrightCore, axePlaywright, axeCore] =
    await Promise.all([
      packageVersion(packageRoot, "@playwright/test"),
      packageVersion(packageRoot, "playwright"),
      packageVersion(packageRoot, "playwright-core"),
      packageVersion(packageRoot, "@axe-core/playwright"),
      packageVersion(packageRoot, "axe-core")
    ]);
  if (
    playwrightTest !== uxPlaywrightVersion ||
    playwright !== uxPlaywrightVersion ||
    playwrightCore !== uxPlaywrightVersion ||
    axePlaywright !== uxAxePlaywrightVersion ||
    axeCore !== uxAxePlaywrightVersion
  ) {
    fail("Версии Node.js-пакетов UX acceptance-набора не совпадают с release.json.");
  }
  try {
    const inventory = await readFile(
      path.join(bundleRoot, "payload/os-packages/packages.tsv"),
      "utf8"
    );
    const rows = inventory
      .split(/\r?\n/u)
      .slice(1)
      .filter((line) => line.length > 0)
      .map((line) => line.split("\t"));
    const browserRows = rows.filter((columns) => columns[1] === uxChromiumPackage);
    if (
      browserRows.length !== 1 ||
      browserRows[0]?.[2] !== uxChromiumPackageVersion
    ) {
      fail("Пакет Chromium UX acceptance-профиля не совпадает с packages.tsv.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Chromium")) throw error;
    fail("Не удалось проверить пакет Chromium UX acceptance-профиля.");
  }
} else {
  if (
    uxChromiumPackage !== "" ||
    uxChromiumPackageVersion !== "" ||
    uxChromiumPath !== "" ||
    uxPlaywrightVersion !== "" ||
    uxAxePlaywrightVersion !== ""
  ) {
    fail("Без UX acceptance-профиля его метаданные должны быть пустыми.");
  }
  try {
    await readdir(acceptanceRoot);
    fail("Комплект без UX acceptance-профиля содержит лишний acceptance payload.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("лишний acceptance")) {
      throw error;
    }
    if (error === null || typeof error !== "object" || error.code !== "ENOENT") {
      fail("Не удалось проверить отсутствие UX acceptance payload.");
    }
  }
}

process.stdout.write("Метаданные автономного выпуска корректны.\n");
