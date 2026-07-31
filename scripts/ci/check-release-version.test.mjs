import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectReleaseVersionFindings } from "./check-release-version.mjs";

const packages = [
  "package.json",
  "apps/api/package.json",
  "apps/worker/package.json",
  "packages/config/package.json",
  "packages/contracts/package.json",
  "packages/document-intake/package.json",
  "packages/storage/package.json",
  "packages/template-compiler/package.json"
];

async function fixture(version = "0.1.0-rc.1") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-release-version-"));
  await fs.writeFile(path.join(root, "VERSION"), `${version}\n`);
  for (const relativePath of packages) {
    const target = path.join(root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify({ version, dependencies: { "@docomator/config": version } }));
  }
  await fs.writeFile(path.join(root, "package-lock.json"), JSON.stringify({ version, packages: { "": { version, dependencies: { "@docomator/config": version } } } }));
  await fs.mkdir(path.join(root, "config"), { recursive: true });
  await fs.writeFile(path.join(root, "config/docomator.env.example"), `DOCOMATOR_VERSION=${version}\n`);
  await fs.mkdir(path.join(root, "packages/config/src"), { recursive: true });
  await fs.writeFile(path.join(root, "packages/config/src/index.ts"), `const version = env.DOCOMATOR_VERSION ?? \"${version}\";\n`);
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  await fs.writeFile(path.join(root, "docs/RELEASE_NOTES.md"), `# ${version}\n`);
  return root;
}

test("принимает согласованную версию", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.deepEqual(await collectReleaseVersionFindings(root), []);
});

test("находит дрейф внутренней зависимости", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, "apps/api/package.json");
  const data = JSON.parse(await fs.readFile(target, "utf8"));
  data.dependencies["@docomator/config"] = "0.1.0-alpha.0";
  await fs.writeFile(target, JSON.stringify(data));
  assert.ok((await collectReleaseVersionFindings(root)).some((finding) => finding.includes("@docomator/config")));
});
