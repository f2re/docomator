#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(modulePath), "../..");

const productPrefixes = [
  "apps/",
  "packages/",
  "migrations/",
  "scripts/runtime/",
  "scripts/offline/",
  "config/"
];

const derivedVersionFiles = new Set([
  "RELEASE_IDENTITY.json",
  "VERSION",
  "package.json",
  "package-lock.json",
  "apps/api/package.json",
  "apps/worker/package.json",
  "packages/config/package.json",
  "packages/contracts/package.json",
  "packages/document-intake/package.json",
  "packages/storage/package.json",
  "packages/template-compiler/package.json",
  "packages/config/src/index.ts",
  "config/docomator.env.example"
]);

// Эти файлы поставляются рядом с runtime, но определяют только release-evidence/P5:
// они не меняют API, worker, storage, renderer, install/update или пользовательские данные.
// Остальные scripts/runtime по-прежнему считаются продуктовыми изменениями.
const releaseEvidenceOnlyFiles = new Set([
  "scripts/runtime/ux-acceptance-report-contracts.mjs",
  "scripts/runtime/ux-ui-inventory.mjs"
]);

export function isProductChange(relativePath) {
  const normalized = String(relativePath).replaceAll("\\", "/");
  if (derivedVersionFiles.has(normalized)) return false;
  if (releaseEvidenceOnlyFiles.has(normalized)) return false;
  if (normalized.startsWith("tests/")) return false;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(normalized)) return false;
  return productPrefixes.some((prefix) => normalized.startsWith(prefix));
}

function git(args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function parseIdentity(content, label) {
  const value = JSON.parse(content);
  const version = String(value?.version || "").trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`${label}: недопустимая версия «${version}»`);
  }
  return version;
}

export async function checkVersionPolicy() {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    process.stdout.write("Version policy: вне pull_request проверяется только общая release identity.\n");
    return;
  }

  let baseCommit;
  try {
    baseCommit = git(["rev-parse", "HEAD^1"]);
  } catch {
    throw new Error(
      "Version policy: не найден base-parent pull request. Для verify checkout требуется fetch-depth >= 2."
    );
  }

  const changed = git(["diff", "--name-only", `${baseCommit}..HEAD`])
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  const productChanges = changed.filter(isProductChange);
  if (productChanges.length === 0) {
    process.stdout.write("Version policy: продуктовый runtime не изменён, bump не обязателен.\n");
    return;
  }

  const previousVersion = parseIdentity(
    git(["show", `${baseCommit}:RELEASE_IDENTITY.json`]),
    "base RELEASE_IDENTITY.json"
  );
  const currentVersion = parseIdentity(
    await fs.readFile(path.join(repositoryRoot, "RELEASE_IDENTITY.json"), "utf8"),
    "RELEASE_IDENTITY.json"
  );

  if (previousVersion === currentVersion) {
    throw new Error(
      `Version policy: изменён продуктовый код, но версия осталась ${currentVersion}. ` +
        "Выполните «npm run version:bump -- patch» для исправления или «-- minor» для новой возможности. " +
        `Затронуто: ${productChanges.slice(0, 8).join(", ")}${productChanges.length > 8 ? " …" : ""}`
    );
  }

  process.stdout.write(
    `Version policy: продукт изменён, версия обновлена ${previousVersion} → ${currentVersion}.\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  checkVersionPolicy().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
