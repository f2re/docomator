import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writeOoxmlPackage } from "@docomator/template-compiler";

import { convertOfficeToPdf } from "../../apps/worker/dist/libreoffice-preview.js";

function docxFixture() {
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

function xlsxFixture() {
  return writeOoxmlPackage([
    {
      name: "[Content_Types].xml",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
      )
    },
    {
      name: "_rels/.rels",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
      )
    },
    {
      name: "xl/workbook.xml",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Сотрудники" sheetId="1" r:id="rId1"/></sheets><calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>'
      )
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
      )
    },
    {
      name: "xl/worksheets/sheet1.xml",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="B2:C3"/><sheetData><row r="2"><c r="B2" t="inlineStr"><is><t>Анна Алексеева</t></is></c><c r="C2"><f>1+1</f></c></row><row r="3"><c r="B3" t="inlineStr"><is><t>Борис Борисов</t></is></c><c r="C3"><f>1+1</f></c></row></sheetData></worksheet>'
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
    const results = [];
    for (const item of [
      { format: "docx", input: docxFixture() },
      { format: "xlsx", input: xlsxFixture() }
    ]) {
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
      results.push(`${item.format.toUpperCase()} ${result.pdf.byteLength} bytes`);
    }
    assert.deepEqual(await readdir(temporaryRoot), []);
    process.stdout.write(
      `LibreOffice release gate passed: ${path.basename(binary)}, ${results.join(", ")}.\n`
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
