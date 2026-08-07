#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(modulePath), "../..");
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

const version = (await fs.readFile(path.join(root, "VERSION"), "utf8")).trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
  throw new Error(`VERSION содержит недопустимое значение: ${version}`);
}

async function writeJson(relativePath, value) {
  await fs.writeFile(
    path.join(root, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8"
  );
}

for (const relativePath of packageFiles) {
  const file = path.join(root, relativePath);
  const data = JSON.parse(await fs.readFile(file, "utf8"));
  data.version = version;
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const name of Object.keys(data[section] ?? {})) {
      if (name.startsWith("@docomator/")) data[section][name] = version;
    }
  }
  await writeJson(relativePath, data);
}

const lockPath = path.join(root, "package-lock.json");
const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
lock.version = version;
for (const [packagePath, record] of Object.entries(lock.packages ?? {})) {
  if (
    packagePath === "" ||
    packagePath.startsWith("apps/") ||
    packagePath.startsWith("packages/")
  ) {
    record.version = version;
  }
  for (const name of Object.keys(record.dependencies ?? {})) {
    if (name.startsWith("@docomator/")) record.dependencies[name] = version;
  }
}
await writeJson("package-lock.json", lock);

const envPath = path.join(root, "config/docomator.env.example");
let env = await fs.readFile(envPath, "utf8");
if (/^DOCOMATOR_VERSION=.*$/mu.test(env)) {
  env = env.replace(/^DOCOMATOR_VERSION=.*$/mu, `DOCOMATOR_VERSION=${version}`);
} else {
  env = `DOCOMATOR_VERSION=${version}\n${env}`;
}
await fs.writeFile(envPath, env, "utf8");

const configPath = path.join(root, "packages/config/src/index.ts");
let config = await fs.readFile(configPath, "utf8");
const versionFallback = /env\.DOCOMATOR_VERSION \?\? "[^"]+"/u;
if (!versionFallback.test(config)) {
  throw new Error("Не найден DOCOMATOR_VERSION fallback в packages/config/src/index.ts");
}
config = config.replace(
  versionFallback,
  `env.DOCOMATOR_VERSION ?? "${version}"`
);
await fs.writeFile(configPath, config, "utf8");

process.stdout.write(
  `Производные значения версии синхронизированы из VERSION: ${version}.\n`
);
