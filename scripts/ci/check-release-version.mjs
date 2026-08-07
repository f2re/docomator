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
const statusDocuments = [
  "docs/RELEASE_NOTES.md",
  "SECURITY.md",
  "docs/SUPPORT_MATRIX.md",
  "docs/FINALIZATION.md"
];

function releaseIdentity(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("RELEASE_IDENTITY.json: ожидался JSON-объект");
  }
  const version = String(value.version ?? "").trim();
  const status = String(value.status ?? "").trim();
  const channel = String(value.channel ?? "").trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`RELEASE_IDENTITY.json: недопустимая версия «${version}»`);
  }
  if (!new Set(["candidate", "stable"]).has(status)) {
    throw new Error(`RELEASE_IDENTITY.json: недопустимый статус «${status}»`);
  }
  if (!new Set(["pilot", "production"]).has(channel)) {
    throw new Error(`RELEASE_IDENTITY.json: недопустимый канал «${channel}»`);
  }
  if (status === "candidate" && channel !== "pilot") {
    throw new Error("RELEASE_IDENTITY.json: candidate допускается только в pilot-канале");
  }
  if (status === "stable" && channel !== "production") {
    throw new Error("RELEASE_IDENTITY.json: stable допускается только в production-канале");
  }
  return { version, status, channel };
}

export async function collectReleaseVersionFindings(rootDirectory = defaultRoot) {
  const root = path.resolve(rootDirectory);
  const findings = [];
  let identity;
  try {
    identity = releaseIdentity(
      JSON.parse(await fs.readFile(path.join(root, "RELEASE_IDENTITY.json"), "utf8"))
    );
  } catch (error) {
    findings.push(error instanceof Error ? error.message : String(error));
    return findings;
  }
  const { version, status, channel } = identity;
  const versionFile = (await fs.readFile(path.join(root, "VERSION"), "utf8")).trim();
  if (versionFile !== version) {
    findings.push(`VERSION=${versionFile}, ожидалась ${version} из RELEASE_IDENTITY.json`);
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
    findings.push("config/docomator.env.example: DOCOMATOR_VERSION не совпадает с RELEASE_IDENTITY.json");
  }
  const config = await fs.readFile(path.join(root, "packages/config/src/index.ts"), "utf8");
  if (!config.includes(`env.DOCOMATOR_VERSION ?? \"${version}\"`)) {
    findings.push("packages/config/src/index.ts: версия по умолчанию не совпадает с RELEASE_IDENTITY.json");
  }

  const statusMarker = `Статус выпуска: \`${status}\``;
  const channelMarker = `Канал выпуска: \`${channel}\``;
  for (const relativePath of statusDocuments) {
    const content = await fs.readFile(path.join(root, relativePath), "utf8");
    if (!content.includes(version)) {
      findings.push(`${relativePath}: текущая версия ${version} не указана`);
    }
    if (!content.includes(statusMarker)) {
      findings.push(`${relativePath}: отсутствует машинно-сверяемый маркер «${statusMarker}»`);
    }
    if (!content.includes(channelMarker)) {
      findings.push(`${relativePath}: отсутствует машинно-сверяемый маркер «${channelMarker}»`);
    }
    if (status !== "stable" && /Статус:\s*\*\*стабильный выпуск\*\*/iu.test(content)) {
      findings.push(`${relativePath}: candidate не может одновременно называться стабильным выпуском`);
    }
  }

  return findings;
}

export async function checkReleaseVersion(rootDirectory = defaultRoot) {
  const root = path.resolve(rootDirectory);
  const findings = await collectReleaseVersionFindings(root);
  if (findings.length > 0) {
    throw new Error(`Идентичность выпуска рассогласована:\n- ${findings.join("\n- ")}`);
  }
  const identity = releaseIdentity(
    JSON.parse(await fs.readFile(path.join(root, "RELEASE_IDENTITY.json"), "utf8"))
  );
  process.stdout.write(
    `Идентичность выпуска согласована: ${identity.version}, ${identity.status}, ${identity.channel}.\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  checkReleaseVersion().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
