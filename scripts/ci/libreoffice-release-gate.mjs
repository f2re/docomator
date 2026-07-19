import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { convertOfficeToPdf } from "../../apps/worker/dist/libreoffice-preview.js";

export const LIBREOFFICE_EXAMPLE_CASES = [
  { relativePath: "expected/personal-card-filled.docx", format: "docx" },
  { relativePath: "fixtures/header-field.docx", format: "docx" },
  { relativePath: "expected/team-register-filled.docx", format: "docx" },
  { relativePath: "fixtures/scalar-fields.xlsx", format: "xlsx" },
  { relativePath: "expected/team-register-filled.xlsx", format: "xlsx" }
];
const examplesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../examples"
);

function parseManifest(value) {
  const hashes = new Map();
  const lines = value.endsWith("\n") ? value.slice(0, -1).split("\n") : [];
  assert.ok(lines.length > 0, "Example manifest must end with a newline.");
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._/-]+)$/u.exec(line);
    assert.ok(match, "Example manifest contains an invalid entry.");
    const [, sha256, relativePath] = match;
    assert.ok(relativePath);
    assert.equal(path.posix.normalize(relativePath), relativePath);
    assert.ok(
      relativePath !== "." &&
        relativePath !== ".." &&
        !relativePath.startsWith("/") &&
        !relativePath.startsWith("../")
    );
    assert.ok(!hashes.has(relativePath), "Example manifest contains a duplicate path.");
    hashes.set(relativePath, sha256);
  }
  return hashes;
}

async function readRegularExample(root, relativePath) {
  let current = root;
  const rootInfo = await lstat(current);
  assert.ok(rootInfo.isDirectory() && !rootInfo.isSymbolicLink());
  const segments = relativePath.split("/");
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const info = await lstat(current);
    assert.ok(!info.isSymbolicLink(), `Example path is symbolic: ${relativePath}`);
    const final = index === segments.length - 1;
    assert.ok(
      final ? info.isFile() : info.isDirectory(),
      `Example path has an invalid type: ${relativePath}`
    );
  }
  return readFile(current);
}

export async function loadLibreOfficeExampleCases(root = examplesRoot) {
  const manifest = parseManifest(
    (await readRegularExample(root, "manifest.sha256")).toString("utf8")
  );
  return Promise.all(
    LIBREOFFICE_EXAMPLE_CASES.map(async (item) => {
      const input = await readRegularExample(root, item.relativePath);
      const expectedHash = manifest.get(item.relativePath);
      assert.ok(expectedHash, `Example is absent from manifest: ${item.relativePath}`);
      assert.equal(
        createHash("sha256").update(input).digest("hex"),
        expectedHash,
        `Example checksum changed: ${item.relativePath}`
      );
      return { ...item, input };
    })
  );
}

async function executable(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue through the bounded local candidate list.
    }
  }
  return null;
}

async function main() {
  const required = process.env.DOCOMATOR_REQUIRE_LIBREOFFICE === "1";
  const configured = process.env.DOCOMATOR_LIBREOFFICE_BIN?.trim();
  const binary = await executable([
    ...(configured ? [configured] : []),
    "/usr/bin/libreoffice",
    "/usr/bin/soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice"
  ]);

  if (binary === null) {
    if (required) {
      throw new Error(
        "LibreOffice release gate is required, but no local executable was found."
      );
    }
    process.stdout.write(
      "LibreOffice release gate: SKIPPED (local executable is unavailable).\n"
    );
    return;
  }

  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "docomator-libreoffice-gate-")
  );
  try {
    const results = [];
    for (const item of await loadLibreOfficeExampleCases()) {
      const result = await convertOfficeToPdf({
        binary,
        input: item.input,
        format: item.format,
        temporaryRoot,
        timeoutMs: 120_000,
        maxOutputBytes: 16 * 1024 * 1024,
        signal: new AbortController().signal
      });
      assert.equal(result.pdf.subarray(0, 5).toString(), "%PDF-");
      assert.equal(result.metadata.converter, "LibreOffice");
      assert.equal(result.metadata.outputBytes, result.pdf.byteLength);
      results.push(`${item.relativePath} ${result.pdf.byteLength} bytes`);
    }
    assert.deepEqual(await readdir(temporaryRoot), []);
    process.stdout.write(
      `LibreOffice release gate passed: ${path.basename(binary)}, ${results.join(", ")}.\n`
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
