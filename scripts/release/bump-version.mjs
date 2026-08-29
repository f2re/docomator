#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(modulePath), "../..");

const packageFiles = [
  "package.json",
  "apps/api/package.json",
  "apps/worker/package.json",
  "packages/config/package.json",
  "packages/contracts/package.json",
  "packages/document-intake/package.json",
  "packages/storage/package.json",
  "packages/template-compiler/package.json"
];
const currentReleaseDocuments = [
  "docs/RELEASE_NOTES.md",
  "SECURITY.md",
  "docs/SUPPORT_MATRIX.md",
  "docs/FINALIZATION.md"
];

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u.exec(String(version).trim());
  if (!match) throw new Error(`Недопустимая SemVer-версия: ${version}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function incrementVersion(current, change) {
  const parsed = parseVersion(current);
  if (change === "major") return `${parsed.major + 1}.0.0`;
  if (change === "minor") return `${parsed.major}.${parsed.minor + 1}.0`;
  if (change === "patch") return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  parseVersion(change);
  return change;
}

function replaceRequired(content, pattern, replacement, label) {
  if (typeof pattern === "string") {
    if (!content.includes(pattern)) throw new Error(`Не найден маркер версии: ${label}`);
    return content.replace(pattern, replacement);
  }
  if (!pattern.test(content)) throw new Error(`Не найден маркер версии: ${label}`);
  pattern.lastIndex = 0;
  return content.replace(pattern, replacement);
}

export function updatePlanningDocumentVersion(content, oldVersion, nextVersion, label = "planning document") {
  let updated = replaceRequired(
    content,
    /^Текущая версия:\s*`[^`]+`\.?$/mu,
    `Текущая версия: \`${nextVersion}\`.`,
    `${label}: Текущая версия`
  );
  updated = updated.replaceAll(`exact \`${oldVersion}\``, `exact \`${nextVersion}\``);
  return updated;
}

async function writeJson(relativePath, value) {
  await fs.writeFile(path.join(repositoryRoot, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

async function syncPackage(relativePath, nextVersion) {
  const target = path.join(repositoryRoot, relativePath);
  const data = JSON.parse(await fs.readFile(target, "utf8"));
  data.version = nextVersion;
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const name of Object.keys(data[section] || {})) {
      if (name.startsWith("@docomator/")) data[section][name] = nextVersion;
    }
  }
  await fs.writeFile(target, `${JSON.stringify(data, null, 2)}\n`);
}

export function updateLockVersion(content, oldVersion, nextVersion) {
  const lock = JSON.parse(content);
  if (lock.version !== oldVersion) {
    throw new Error(`package-lock.json: ожидалась версия ${oldVersion}, получена ${lock.version}`);
  }
  let expectedOccurrences = 1;
  for (const [packagePath, record] of Object.entries(lock.packages || {})) {
    if (packagePath !== "" && !packagePath.startsWith("apps/") && !packagePath.startsWith("packages/")) continue;
    if (record.version !== oldVersion) {
      throw new Error(`package-lock.json: ${packagePath || "root"} имеет неожиданную версию ${record.version}`);
    }
    expectedOccurrences += 1;
    for (const [name, version] of Object.entries(record.dependencies || {})) {
      if (!name.startsWith("@docomator/")) continue;
      if (version !== oldVersion) {
        throw new Error(`package-lock.json: ${packagePath || "root"} -> ${name} имеет неожиданную версию ${version}`);
      }
      expectedOccurrences += 1;
    }
  }
  const actualOccurrences = content.split(oldVersion).length - 1;
  if (actualOccurrences !== expectedOccurrences) {
    throw new Error(`package-lock.json: найдено ${actualOccurrences} ссылок ${oldVersion}, ожидалось ${expectedOccurrences}`);
  }
  return content.replaceAll(oldVersion, nextVersion);
}

async function syncLock(oldVersion, nextVersion) {
  const target = path.join(repositoryRoot, "package-lock.json");
  const content = await fs.readFile(target, "utf8");
  await fs.writeFile(target, updateLockVersion(content, oldVersion, nextVersion));
}

async function syncRuntimeDefaults(oldVersion, nextVersion) {
  const envPath = path.join(repositoryRoot, "config/docomator.env.example");
  const env = await fs.readFile(envPath, "utf8");
  await fs.writeFile(envPath, replaceRequired(env, /^DOCOMATOR_VERSION=.*$/mu, `DOCOMATOR_VERSION=${nextVersion}`, "config/docomator.env.example"));

  const configPath = path.join(repositoryRoot, "packages/config/src/index.ts");
  const config = await fs.readFile(configPath, "utf8");
  await fs.writeFile(configPath, replaceRequired(config, `env.DOCOMATOR_VERSION ?? "${oldVersion}"`, `env.DOCOMATOR_VERSION ?? "${nextVersion}"`, "packages/config/src/index.ts"));
}

async function syncReleaseDocuments(oldVersion, nextVersion) {
  for (const relativePath of currentReleaseDocuments) {
    const target = path.join(repositoryRoot, relativePath);
    let content = await fs.readFile(target, "utf8");
    content = replaceRequired(content, /^Текущая версия:\s*`[^`]+`\.?$/mu, `Текущая версия: \`${nextVersion}\`.`, `${relativePath}: Текущая версия`);
    if (relativePath === "docs/RELEASE_NOTES.md") {
      content = replaceRequired(content, /^# Оформлятор\s+\S+$/mu, `# Оформлятор ${nextVersion}`, "docs/RELEASE_NOTES.md: заголовок");
    } else if (relativePath === "docs/FINALIZATION.md") {
      content = content.replaceAll(oldVersion, nextVersion);
    }
    await fs.writeFile(target, content);
  }
  for (const relativePath of ["docs/ROADMAP.md", "docs/NEXT_ITERATIONS.md"]) {
    const target = path.join(repositoryRoot, relativePath);
    const content = await fs.readFile(target, "utf8");
    await fs.writeFile(
      target,
      updatePlanningDocumentVersion(content, oldVersion, nextVersion, relativePath)
    );
  }
}

export async function syncVersion(change) {
  const identityPath = path.join(repositoryRoot, "RELEASE_IDENTITY.json");
  const identity = JSON.parse(await fs.readFile(identityPath, "utf8"));
  const oldVersion = String(identity.version || "").trim();
  parseVersion(oldVersion);
  const nextVersion = incrementVersion(oldVersion, change);
  if (nextVersion === oldVersion) throw new Error(`Версия уже равна ${nextVersion}`);

  identity.version = nextVersion;
  await writeJson("RELEASE_IDENTITY.json", identity);
  await fs.writeFile(path.join(repositoryRoot, "VERSION"), `${nextVersion}\n`);
  for (const relativePath of packageFiles) await syncPackage(relativePath, nextVersion);
  await syncLock(oldVersion, nextVersion);
  await syncRuntimeDefaults(oldVersion, nextVersion);
  await syncReleaseDocuments(oldVersion, nextVersion);
  process.stdout.write(`Оформлятор: ${oldVersion} → ${nextVersion}. Статус выпуска сохранён: ${identity.status}/${identity.channel}.\n`);
  return { oldVersion, nextVersion };
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const change = process.argv[2];
  if (!change) {
    console.error("Использование: npm run version:bump -- patch|minor|major|X.Y.Z");
    process.exitCode = 2;
  } else {
    syncVersion(change).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
