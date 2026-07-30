import assert from "node:assert/strict";
import test from "node:test";

import {
  DocumentIntakeError,
  inspectOoxmlBuffer
} from "./intake.js";
import {
  buildZipFixture,
  minimalDocxEntries,
  minimalXlsxEntries
} from "./zip-fixture.js";

test("accepts a minimal DOCX package and inventories its parts", async () => {
  const buffer = buildZipFixture(minimalDocxEntries());
  const report = await inspectOoxmlBuffer({
    buffer,
    fileName: "Шаблон.docx",
    mediaType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });

  assert.equal(report.format, "docx");
  assert.equal(report.decision, "accepted");
  assert.equal(report.summary.fileCount, 3);
  assert.equal(
    report.summary.uncompressedBytes,
    minimalDocxEntries().reduce((total, entry) => {
      const content = Buffer.isBuffer(entry.content)
        ? entry.content
        : Buffer.from(entry.content ?? "", "utf8");
      return total + content.length;
    }, 0)
  );
  assert.equal(report.summary.externalRelationships, 0);
  assert.equal(report.issues.length, 0);
  assert.equal(report.sha256.length, 64);
  assert.deepEqual(report.requiredParts, [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml"
  ]);
});

test("reports external relationships without loading them", async () => {
  const entries = minimalXlsxEntries();
  entries.push({
    name: "xl/_rels/workbook.xml.rels",
    content:
      '<?xml version="1.0"?><Relationships><Relationship Id="rId9" TargetMode="External" Target="file:///tmp/source.xlsx"/></Relationships>'
  });
  const report = await inspectOoxmlBuffer({
    buffer: buildZipFixture(entries),
    fileName: "Отчёт.xlsx"
  });

  assert.equal(report.decision, "accepted_with_warnings");
  assert.equal(report.summary.externalRelationships, 1);
  assert.equal(report.summary.hasExternalLinks, true);
  assert.equal(report.issues[0]?.code, "external_relationship");
  assert.match(report.issues[0]?.message ?? "", /не будет обращаться/u);
});

test("rejects macro-enabled package content", async () => {
  const entries = minimalDocxEntries();
  entries.push({ name: "word/vbaProject.bin", content: Buffer.from([1, 2, 3]) });
  entries[0] = {
    name: "[Content_Types].xml",
    content:
      '<?xml version="1.0"?><Types><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>'
  };
  const report = await inspectOoxmlBuffer({
    buffer: buildZipFixture(entries),
    fileName: "Опасный.docx"
  });

  assert.equal(report.decision, "rejected");
  assert.equal(report.summary.hasMacros, true);
  assert.ok(report.issues.some((issue) => issue.code === "macro_content"));
  assert.ok(report.issues.some((issue) => issue.code === "macro_content_type"));
});

test("returns a compatibility rejection when a required OOXML part is missing", async () => {
  const entries = minimalDocxEntries().filter(
    (entry) => entry.name !== "word/document.xml"
  );
  const report = await inspectOoxmlBuffer({
    buffer: buildZipFixture(entries),
    fileName: "Неполный.docx"
  });

  assert.equal(report.decision, "rejected");
  assert.deepEqual(
    report.issues
      .filter((issue) => issue.code === "required_part_missing")
      .map((issue) => issue.partName),
    ["word/document.xml"]
  );
});

test("rejects path traversal and duplicate package parts", async () => {
  await assert.rejects(
    inspectOoxmlBuffer({
      buffer: buildZipFixture([
        ...minimalDocxEntries(),
        { name: "../outside.xml", content: "bad" }
      ]),
      fileName: "Путь.docx"
    }),
    (error: unknown) =>
      error instanceof DocumentIntakeError &&
      error.code === "invalid_zip_package" &&
      /небезопасное имя/u.test(error.userMessage)
  );

  await assert.rejects(
    inspectOoxmlBuffer({
      buffer: buildZipFixture([
        ...minimalDocxEntries(),
        { name: "word/document.xml", content: "duplicate" }
      ]),
      fileName: "Дубликат.docx"
    }),
    (error: unknown) =>
      error instanceof DocumentIntakeError &&
      error.code === "duplicate_package_part"
  );
});

test("rejects encrypted parts and symbolic links", async () => {
  await assert.rejects(
    inspectOoxmlBuffer({
      buffer: buildZipFixture([
        ...minimalDocxEntries(),
        { name: "word/secret.xml", content: "secret", encrypted: true }
      ]),
      fileName: "Шифрование.docx"
    }),
    (error: unknown) =>
      error instanceof DocumentIntakeError &&
      error.code === "encrypted_package_part"
  );

  await assert.rejects(
    inspectOoxmlBuffer({
      buffer: buildZipFixture([
        ...minimalDocxEntries(),
        {
          name: "word/link.xml",
          content: "target",
          externalFileAttributes: 0o120777 << 16
        }
      ]),
      fileName: "Ссылка.docx"
    }),
    (error: unknown) =>
      error instanceof DocumentIntakeError &&
      error.code === "symbolic_link_in_package"
  );
});

test("enforces part count and compression ratio limits", async () => {
  await assert.rejects(
    inspectOoxmlBuffer({
      buffer: buildZipFixture(minimalDocxEntries()),
      fileName: "Части.docx",
      limits: { maxEntries: 2 }
    }),
    (error: unknown) =>
      error instanceof DocumentIntakeError &&
      error.code === "too_many_package_parts"
  );

  await assert.rejects(
    inspectOoxmlBuffer({
      buffer: buildZipFixture([
        ...minimalDocxEntries(),
        { name: "word/large.xml", content: "A".repeat(100_000) }
      ]),
      fileName: "Сжатие.docx",
      limits: { maxCompressionRatio: 10 }
    }),
    (error: unknown) =>
      error instanceof DocumentIntakeError &&
      error.code === "suspicious_compression_ratio"
  );
});

test("rejects unsupported extensions and invalid ZIP signatures with Russian messages", async () => {
  await assert.rejects(
    inspectOoxmlBuffer({
      buffer: Buffer.from("not a zip"),
      fileName: "Файл.pdf"
    }),
    (error: unknown) =>
      error instanceof DocumentIntakeError &&
      error.statusCode === 415 &&
      /DOCX и XLSX/u.test(error.userMessage)
  );

  await assert.rejects(
    inspectOoxmlBuffer({
      buffer: Buffer.from("not a zip"),
      fileName: "Файл.docx"
    }),
    (error: unknown) =>
      error instanceof DocumentIntakeError &&
      error.code === "invalid_zip_signature" &&
      /не является корректным/u.test(error.userMessage)
  );
});

test("rejects a part whose actual stream exceeds an understated central size", async () => {
  await assert.rejects(
    inspectOoxmlBuffer({
      buffer: buildZipFixture([
        ...minimalDocxEntries(),
        {
          name: "word/understated.bin",
          content: Buffer.alloc(4_096, 0x41),
          centralUncompressedSize: 1
        }
      ]),
      fileName: "Заниженный-размер.docx",
      limits: {
        maxEntryUncompressedBytes: 1_024,
        maxCompressionRatio: 10_000
      }
    }),
    (error: unknown) =>
      error instanceof DocumentIntakeError &&
      error.code === "package_part_too_large" &&
      /фактически распакованный размер/u.test(error.userMessage)
  );
});


test("rejects a part when the actual stream differs from the declared ZIP size", async () => {
  await assert.rejects(
    inspectOoxmlBuffer({
      buffer: buildZipFixture([
        ...minimalDocxEntries(),
        {
          name: "word/mismatch.bin",
          content: Buffer.alloc(512, 0x44),
          centralUncompressedSize: 1
        }
      ]),
      fileName: "Несовпадающий-размер.docx",
      limits: {
        maxEntryUncompressedBytes: 1_024,
        maxCompressionRatio: 10_000
      }
    }),
    (error: unknown) =>
      error instanceof DocumentIntakeError &&
      error.code === "package_size_mismatch" &&
      /не совпадает с заявленным/u.test(error.userMessage)
  );
});


test("rejects an archive whose actual total exceeds understated central sizes", async () => {
  await assert.rejects(
    inspectOoxmlBuffer({
      buffer: buildZipFixture([
        ...minimalDocxEntries(),
        {
          name: "word/understated-a.bin",
          content: Buffer.alloc(700, 0x42),
          centralUncompressedSize: 1
        },
        {
          name: "word/understated-b.bin",
          content: Buffer.alloc(700, 0x43),
          centralUncompressedSize: 1
        }
      ]),
      fileName: "Заниженная-сумма.docx",
      limits: {
        maxEntryUncompressedBytes: 1_024,
        maxTotalUncompressedBytes: 1_200,
        maxCompressionRatio: 10_000
      }
    }),
    (error: unknown) =>
      error instanceof DocumentIntakeError &&
      error.code === "expanded_archive_too_large" &&
      /фактически распакованный размер/u.test(error.userMessage)
  );
});
