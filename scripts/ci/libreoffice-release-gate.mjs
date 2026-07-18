import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writeOoxmlPackage } from "@docomator/template-compiler";

import { convertOfficeToPdf } from "../../apps/worker/dist/libreoffice-preview.js";

function fixture() {
  return writeOoxmlPackage([
    {
      name: "[Content_Types].xml",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      )
    },
    {
      name: "_rels/.rels",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
      )
    },
    {
      name: "word/document.xml",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Проверка LibreOffice</w:t></w:r></w:p></w:body></w:document>'
      )
    }
  ]);
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
} else {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "docomator-libreoffice-gate-")
  );
  try {
    const result = await convertOfficeToPdf({
      binary,
      input: fixture(),
      format: "docx",
      temporaryRoot,
      timeoutMs: 120_000,
      maxOutputBytes: 16 * 1024 * 1024,
      signal: new AbortController().signal
    });
    assert.equal(result.pdf.subarray(0, 5).toString(), "%PDF-");
    assert.equal(result.metadata.converter, "LibreOffice");
    assert.equal(result.metadata.outputBytes, result.pdf.byteLength);
    assert.deepEqual(await readdir(temporaryRoot), []);
    process.stdout.write(
      `LibreOffice release gate passed: ${path.basename(binary)}, ${result.pdf.byteLength} bytes.\n`
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
