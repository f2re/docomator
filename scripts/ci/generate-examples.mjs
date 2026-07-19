#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EXAMPLE_ASSETS, exampleManifest } from "./example-assets.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
  "examples"
);

for (const asset of EXAMPLE_ASSETS) {
  const target = path.join(root, asset.path);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, asset.content, { mode: 0o644 });
}
await writeFile(
  path.join(root, "manifest.sha256"),
  exampleManifest(EXAMPLE_ASSETS),
  { encoding: "utf8", mode: 0o644 }
);

process.stdout.write(`Созданы проверяемые примеры: ${EXAMPLE_ASSETS.length}.\n`);
