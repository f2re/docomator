#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile
} from "node:fs/promises";
import { get as httpGet } from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const bundleRoot = path.dirname(fileURLToPath(import.meta.url));
const sha256Pattern = /^[a-f0-9]{64}$/u;
const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

class UxGateError extends Error {}

function usage() {
  process.stdout.write(
    "Использование: ./ux-acceptance-gate.sh --output КАТАЛОГ [--base-url URL]\n"
  );
}

function fail(message) {
  throw new UxGateError(message);
}

function parseArguments(values) {
  const options = {
    baseURL: "http://127.0.0.1:18080",
    outputDirectory: null
  };
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (argument === "-h" || argument === "--help") {
      usage();
      process.exit(0);
    }
    const value = values[index + 1];
    if (argument === "--base-url" && value !== undefined) {
      options.baseURL = value;
      index += 1;
    } else if (argument === "--output" && value !== undefined) {
      options.outputDirectory = value;
      index += 1;
    } else {
      fail(`Неизвестный или неполный параметр: ${argument ?? ""}`);
    }
  }
  if (options.outputDirectory === null) {
    fail("Укажите новый каталог свидетельств через --output.");
  }
  return options;
}

function localBaseURL(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("Адрес Docomator должен быть корректным локальным HTTP URL.");
  }
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname !== "/"
  ) {
    fail("UX-gate разрешает только корневой HTTP-адрес 127.0.0.1 или ::1.");
  }
  return parsed.href;
}

function safeText(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail(`release.json: некорректное поле ${label}.`);
  }
  return value;
}

async function trustedNewOutput(value) {
  const requested = path.resolve(value);
  const parent = path.dirname(requested);
  let canonicalParent;
  try {
    canonicalParent = await realpath(parent);
  } catch {
    fail("Родительский каталог свидетельств не найден.");
  }
  if (canonicalParent !== parent) {
    fail("Путь каталога свидетельств не должен содержать символические ссылки.");
  }
  const information = await stat(canonicalParent);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    !information.isDirectory() ||
    (uid !== null && information.uid !== uid) ||
    (information.mode & 0o022) !== 0
  ) {
    fail(
      "Родительский каталог свидетельств должен принадлежать текущему пользователю и запрещать запись группе и остальным."
    );
  }
  const relativeToBundle = path.relative(bundleRoot, requested);
  if (
    relativeToBundle === "" ||
    (!relativeToBundle.startsWith("..") && !path.isAbsolute(relativeToBundle))
  ) {
    fail("Свидетельства необходимо сохранять вне неизменяемого комплекта.");
  }
  try {
    await lstat(requested);
    fail("Каталог свидетельств уже существует; укажите новое имя.");
  } catch (error) {
    if (error instanceof UxGateError) throw error;
    if (error === null || typeof error !== "object" || error.code !== "ENOENT") {
      fail("Не удалось безопасно проверить каталог свидетельств.");
    }
  }
  await mkdir(requested, { mode: 0o700 });
  return requested;
}

function runPlaywright(nodePath, cliPath, configPath, workingDirectory, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      nodePath,
      [cliPath, "test", "--config", configPath],
      {
        cwd: workingDirectory,
        env: environment,
        stdio: "inherit"
      }
    );
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal !== null) {
        reject(new UxGateError(`Playwright остановлен сигналом ${signal}.`));
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

function safeLocale(value) {
  return typeof value === "string" && /^[A-Za-z0-9._@-]{1,64}$/u.test(value)
    ? value
    : "C.UTF-8";
}

function commandEnvironment(home = "/tmp") {
  return {
    HOME: home,
    LANG: safeLocale(process.env.LANG),
    LC_ALL: safeLocale(process.env.LC_ALL ?? process.env.LANG),
    PATH: "/usr/bin:/bin"
  };
}

async function installedChromiumPackage(
  chromiumPath,
  packageName,
  packageVersion
) {
  let installed;
  let owners;
  try {
    [installed, owners] = await Promise.all([
      execFileAsync(
        "/usr/bin/dpkg-query",
        ["-W", "-f=${Status}\\t${Version}", packageName],
        {
          encoding: "utf8",
          timeout: 10_000,
          maxBuffer: 16_384,
          env: commandEnvironment()
        }
      ),
      execFileAsync("/usr/bin/dpkg-query", ["-S", chromiumPath], {
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 16_384,
        env: commandEnvironment()
      })
    ]);
  } catch {
    fail("Не удалось подтвердить установленный Debian-пакет Chromium.");
  }
  if (installed.stdout.trim() !== `install ok installed\t${packageVersion}`) {
    fail("Версия установленного Chromium не совпадает с автономным комплектом.");
  }
  const ownsConfiguredPath = owners.stdout
    .split("\n")
    .some((line) => {
      const separator = line.indexOf(": ");
      if (separator < 1 || line.slice(separator + 2) !== chromiumPath) return false;
      const owner = line.slice(0, separator);
      return owner === packageName || owner.startsWith(`${packageName}:`);
    });
  if (!ownsConfiguredPath) {
    fail("Закреплённый Debian-пакет не владеет путём Chromium.");
  }
}

function requestReleaseIdentity(baseURL) {
  const endpoint = new URL("/api/v1/system/release", baseURL);
  return new Promise((resolve, reject) => {
    const request = httpGet(
      endpoint,
      { headers: { accept: "application/json" } },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 64 * 1024) {
            response.destroy(new Error("release identity response is too large"));
          } else {
            chunks.push(chunk);
          }
        });
        response.on("error", reject);
        response.on("end", () => {
          if (response.statusCode !== 200) {
            reject(new Error("release identity endpoint is unavailable"));
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new Error("release identity response is not JSON"));
          }
        });
      }
    );
    request.setTimeout(10_000, () => {
      request.destroy(new Error("release identity request timed out"));
    });
    request.on("error", reject);
  });
}

process.umask(0o077);

try {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    fail("UX-приёмку нельзя запускать с правами root.");
  }
  const options = parseArguments(process.argv.slice(2));
  const baseURL = localBaseURL(options.baseURL);

  let release;
  let releaseSource;
  let manifest;
  try {
    [releaseSource, manifest] = await Promise.all([
      readFile(path.join(bundleRoot, "release.json"), "utf8"),
      readFile(path.join(bundleRoot, "manifest.sha256"))
    ]);
    release = JSON.parse(releaseSource);
  } catch {
    fail("Не удалось прочитать проверенные метаданные автономного комплекта.");
  }
  if (release?.uxAcceptanceIncluded !== true) {
    fail("Комплект собран без offline-профиля UX-приёмки.");
  }
  const commitSha = safeText(release.gitCommit, commitPattern, "gitCommit");
  const releaseVersion = safeText(
    release.version,
    /^[0-9A-Za-z][0-9A-Za-z.+~_-]{0,127}$/u,
    "version"
  );
  if (release.name !== "docomator") {
    fail("release.json: некорректное поле name.");
  }
  const chromiumPackage = safeText(
    release.uxChromiumPackage,
    /^[a-z0-9][a-z0-9+.-]{0,127}$/u,
    "uxChromiumPackage"
  );
  const chromiumPackageVersion = safeText(
    release.uxChromiumPackageVersion,
    /^[^\u0000-\u001f\u007f]{1,256}$/u,
    "uxChromiumPackageVersion"
  );
  const chromiumPath = safeText(
    release.uxChromiumPath,
    /^\/[A-Za-z0-9._/+:-]+$/u,
    "uxChromiumPath"
  );
  const bundleManifestSha256 = createHash("sha256").update(manifest).digest("hex");
  const releaseMetadataSha256 = createHash("sha256")
    .update(releaseSource)
    .digest("hex");
  if (!sha256Pattern.test(bundleManifestSha256)) {
    fail("Не удалось связать прогон с manifest автономного комплекта.");
  }

  try {
    await access(chromiumPath, constants.X_OK);
  } catch {
    fail(
      `Chromium недоступен по закреплённому пути ${chromiumPath}. Установите .deb-набор комплекта.`
    );
  }
  await installedChromiumPackage(
    chromiumPath,
    chromiumPackage,
    chromiumPackageVersion
  );
  let browserVersion;
  try {
    const { stdout, stderr } = await execFileAsync(chromiumPath, ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 4_096,
      env: commandEnvironment(
        typeof process.env.HOME === "string" && path.isAbsolute(process.env.HOME)
          ? process.env.HOME
          : "/tmp"
      )
    });
    browserVersion = stdout.trim() || stderr.trim();
  } catch {
    fail("Не удалось определить версию закреплённого Chromium.");
  }
  if (
    browserVersion.length < 3 ||
    browserVersion.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(browserVersion)
  ) {
    fail("Chromium вернул неподдерживаемую строку версии.");
  }

  let servedRelease;
  try {
    servedRelease = await requestReleaseIdentity(baseURL);
  } catch {
    fail("Локальный Docomator не предоставил идентичность установленного релиза.");
  }
  if (
    servedRelease?.name !== "docomator" ||
    servedRelease.version !== releaseVersion ||
    servedRelease.gitCommit !== commitSha ||
    servedRelease.releaseMetadataSha256 !== releaseMetadataSha256 ||
    servedRelease.source !== "installed"
  ) {
    fail("Запущенный Docomator не совпадает с проверенным автономным комплектом.");
  }

  const outputDirectory = await trustedNewOutput(options.outputDirectory);
  const kitRoot = path.join(bundleRoot, "payload/acceptance/ux");
  const nodePath = path.join(bundleRoot, "payload/runtime/node/bin/node");
  const cliPath = path.join(kitRoot, "node_modules/playwright/cli.js");
  const configPath = path.join(kitRoot, "tests/e2e/playwright.config.mjs");
  const generatedAt = new Date().toISOString();
  const runMetadata = {
    version: 1,
    kind: "docomator.ux-acceptance-run",
    releaseVersion,
    commitSha,
    bundleManifestSha256,
    releaseMetadataSha256,
    chromiumPackage,
    chromiumPackageVersion,
    chromiumPath,
    browserVersion,
    baseURL,
    generatedAt
  };
  await writeFile(
    path.join(outputDirectory, "run-metadata.json"),
    `${JSON.stringify(runMetadata, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 }
  );

  process.stdout.write(
    `Запускаем полную offline UX-матрицу для commit ${commitSha.slice(0, 12)}; Chromium: ${browserVersion}.\n`
  );
  const browserHome = path.join(outputDirectory, "browser-home");
  const browserCache = path.join(outputDirectory, "browser-cache");
  const browserConfig = path.join(outputDirectory, "browser-config");
  const temporaryDirectory = path.join(outputDirectory, "tmp");
  await Promise.all(
    [browserHome, browserCache, browserConfig, temporaryDirectory].map(
      (directory) => mkdir(directory, { mode: 0o700 })
    )
  );
  const code = await runPlaywright(nodePath, cliPath, configPath, kitRoot, {
    HOME: browserHome,
    LANG: safeLocale(process.env.LANG),
    LC_ALL: safeLocale(process.env.LC_ALL ?? process.env.LANG),
    PATH: "/usr/bin:/bin",
    TMPDIR: temporaryDirectory,
    XDG_CACHE_HOME: browserCache,
    XDG_CONFIG_HOME: browserConfig,
    DOCOMATOR_E2E_ACCEPTANCE: "1",
    DOCOMATOR_E2E_ARTIFACT_DIR: outputDirectory,
    DOCOMATOR_E2E_BASE_URL: baseURL,
    DOCOMATOR_E2E_BROWSER_VERSION: browserVersion,
    DOCOMATOR_E2E_BUNDLE_MANIFEST_SHA256: bundleManifestSha256,
    DOCOMATOR_E2E_RELEASE_METADATA_SHA256: releaseMetadataSha256,
    DOCOMATOR_E2E_CHROMIUM_BIN: chromiumPath,
    DOCOMATOR_E2E_COMMIT_SHA: commitSha
  });
  if (code !== 0) {
    fail(`Playwright/axe завершился с кодом ${code}; диагностика сохранена.`);
  }
  for (const report of ["playwright-report.json", "axe-report.json"]) {
    try {
      await access(path.join(outputDirectory, report), constants.R_OK);
    } catch {
      fail(`Успешный прогон не создал обязательный файл ${report}.`);
    }
  }
  process.stdout.write(
    `Offline UX-gate завершён. Свидетельства: ${outputDirectory}\n`
  );
} catch (error) {
  process.stderr.write(
    `Не удалось выполнить offline UX-gate: ${
      error instanceof UxGateError
        ? error.message
        : "внутренняя ошибка запуска."
    }\n`
  );
  process.exitCode = 1;
}
