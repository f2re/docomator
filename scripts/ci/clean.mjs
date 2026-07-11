#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

for (const root of ["apps", "packages"]) {
  if (!fs.existsSync(root)) {
    continue;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const target = path.join(root, entry.name, "dist");
    fs.rmSync(target, { recursive: true, force: true });
  }
}
