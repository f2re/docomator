import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const legacyBrand = "Doco" + "mator";
const expectedBrand = "Оформлятор";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

async function inspectText(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const buffer = await fs.readFile(absolutePath);
  if (buffer.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

export async function checkBranding() {
  const findings = [];
  for (const relativePath of trackedFiles()) {
    const text = await inspectText(relativePath);
    if (text?.includes(legacyBrand)) findings.push(relativePath);
  }

  const required = [
    "README.md",
    "docs/BRANDING.md",
    "apps/api/ui/index.html",
    "apps/api/ui/help-center.js",
    "apps/api/src/password-gate.ts"
  ];
  for (const relativePath of required) {
    const text = await inspectText(relativePath);
    if (!text?.includes(expectedBrand)) {
      findings.push(`${relativePath}: отсутствует пользовательское имя ${expectedBrand}`);
    }
  }

  if (findings.length > 0) {
    throw new Error(`Проверка бренда не пройдена:\n- ${findings.join("\n- ")}`);
  }
}

const invokedPath = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  checkBranding().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
