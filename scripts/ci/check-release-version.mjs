#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(modulePath), "../..");
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

export async function collectReleaseVersionFindings(rootDirectory = defaultRoot) {
  const root = path.resolve(rootDirectory);
  const findings = [];
  const version = (await fs.readFile(path.join(root, "VERSION"), "utf8")).trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    findings.push(`VERSION: недопустимая версия «${version}»`);
  }

  for (const relativePath of packageFiles) {
    const data = JSON.parse(await fs.readFile(path.join(root, relativePath), "utf8"));
    if (data.version !== version) {
      findings.push(`${relativePath}: version=${data.version ?? "не указана"}, ожидалась ${version}`);
    }
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [name, dependencyVersion] of Object.entries(data[section] ?? {})) {
        if (name.startsWith("@docomator/") && dependencyVersion !== version) {
          findings.push(`${relativePath}: ${section}.${name}=${dependencyVersion}, ожидалась ${version}`);
        }
      }
    }
  }

  const lock = JSON.parse(await fs.readFile(path.join(root, "package-lock.json"), "utf8"));
  if (lock.version !== version) findings.push(`package-lock.json: version=${lock.version}, ожидалась ${version}`);
  for (const [packagePath, record] of Object.entries(lock.packages ?? {})) {
    if ((packagePath === "" || packagePath.startsWith("apps/") || packagePath.startsWith("packages/")) && record?.version !== version) {
      findings.push(`package-lock.json#packages/${packagePath || "root"}: version=${record?.version ?? "не указана"}, ожидалась ${version}`);
    }
    for (const [name, dependencyVersion] of Object.entries(record?.dependencies ?? {})) {
      if (name.startsWith("@docomator/") && dependencyVersion !== version) {
        findings.push(`package-lock.json#packages/${packagePath || "root"}: ${name}=${dependencyVersion}, ожидалась ${version}`);
      }
    }
  }

  const env = await fs.readFile(path.join(root, "config/docomator.env.example"), "utf8");
  if (!env.includes(`DOCOMATOR_VERSION=${version}`)) {
    findings.push("config/docomator.env.example: DOCOMATOR_VERSION не совпадает с VERSION");
  }
  const config = await fs.readFile(path.join(root, "packages/config/src/index.ts"), "utf8");
  if (!config.includes(`env.DOCOMATOR_VERSION ?? \"${version}\"`)) {
    findings.push("packages/config/src/index.ts: версия по умолчанию не совпадает с VERSION");
  }
  const notes = await fs.readFile(path.join(root, "docs/RELEASE_NOTES.md"), "utf8");
  if (!notes.includes(version)) findings.push("docs/RELEASE_NOTES.md: текущая версия не указана");

  return findings;
}

export async function checkReleaseVersion(rootDirectory = defaultRoot) {
  const findings = await collectReleaseVersionFindings(rootDirectory);
  if (findings.length > 0) {
    throw new Error(`Версия выпуска рассогласована:\n- ${findings.join("\n- ")}`);
  }
  process.stdout.write(`Версия выпуска согласована: ${(await fs.readFile(path.join(path.resolve(rootDirectory), "VERSION"), "utf8")).trim()}.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  checkReleaseVersion().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
