import assert from "node:assert/strict";
import test from "node:test";

import { readOoxmlPackage, writeOoxmlPackage } from "./ooxml-package.js";
import {
  analyzeDocumentFormatting,
  documentFormattingProfile,
  formatDocumentToProfile
} from "./gost-formatting.js";

function fixture(): Buffer {
  return writeOoxmlPackage([
    { name: "[Content_Types].xml", isDirectory: false, content: Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>') },
    { name: "_rels/.rels", isDirectory: false, content: Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
    { name: "word/_rels/document.xml.rels", isDirectory: false, content: Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>') },
    { name: "word/styles.xml", isDirectory: false, content: Buffer.from('<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>') },
    { name: "word/document.xml", isDirectory: false, content: Buffer.from('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><w:p><w:r><w:t>Текст</w:t></w:r></w:p><w:tbl/><m:oMath/><w:sectPr><w:pgMar w:top="567" w:right="567" w:bottom="567" w:left="567" w:header="708" w:footer="708" w:gutter="42"/></w:sectPr></w:body></w:document>') },
    { name: "word/header1.xml", isDirectory: false, content: Buffer.from('<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>НЕ МЕНЯТЬ</w:t></w:r></w:p></w:hdr>') }
  ]);
}

test("анализ ГОСТ показывает расхождения, не меняя документ", async () => {
  const source = fixture();
  const analysis = await analyzeDocumentFormatting(source, documentFormattingProfile("gost-r-7.0.97-2025"));
  assert.equal(analysis.profile, "gost-r-7.0.97-2025");
  assert.ok(analysis.findings.some((item) => item.code === "font_family_differs"));
  assert.equal(analysis.metrics.tables, 1);
  assert.equal(analysis.metrics.equations, 1);
});

test("форматирование меняет только styles/document и сохраняет неизвестные части и атрибуты раздела", async () => {
  const source = fixture();
  const result = await formatDocumentToProfile(source, documentFormattingProfile("gost-r-7.0.97-2025"));
  assert.deepEqual(result.changedParts.sort(), ["word/document.xml", "word/styles.xml"]);
  assert.ok(result.untouchedParts.includes("word/header1.xml"));
  const entries = await readOoxmlPackage(result.buffer);
  const read = (name: string) => entries.find((entry) => entry.name === name)?.content.toString("utf8") ?? "";
  assert.equal(read("word/header1.xml"), '<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>НЕ МЕНЯТЬ</w:t></w:r></w:p></w:hdr>');
  assert.match(read("word/styles.xml"), /w:ascii="Times New Roman"/u);
  assert.match(read("word/styles.xml"), /<w:lang w:val="ru-RU"\/>/u);
  assert.match(read("word/document.xml"), /w:header="708"/u);
  assert.match(read("word/document.xml"), /w:footer="708"/u);
  assert.match(read("word/document.xml"), /w:gutter="42"/u);
});
