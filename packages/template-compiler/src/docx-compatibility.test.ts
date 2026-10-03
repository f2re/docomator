import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { analyzeOoxmlBuffer, type DocxParagraphElement } from "@docomator/document-intake";
import { buildZipFixture, minimalDocxEntries } from "@docomator/document-intake/testing";
import { compileScalarField, TemplateCompilerError } from "./compiler.js";
import { compileScalarFields } from "./multi-field.js";
import { readOoxmlPackage, packageEntry } from "./ooxml-package.js";
import { renderScalarValue, renderDocxRepeatRows } from "./scalar-render.js";
import { validateRepeatContent, createRepeatContentRewriter } from "./docx-repeat-content.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAE0lEQVR4nGNQcGj4//8/AxADWQA1ZAe7B8aSXQAAAABJRU5ErkJggg==", "base64");
const drawing = '<w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Logo"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Logo"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="logo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
function fixture(body: string): Buffer {
  const entries = minimalDocxEntries().map((entry) => entry.name === "word/document.xml" ? { ...entry,
    content: '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>'
  } : entry.name === "[Content_Types].xml" ? { ...entry, content: String(entry.content).replace('</Types>', '<Default Extension="png" ContentType="image/png"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>') }
    : entry.name === "_rels/.rels" ? { ...entry, content: String(entry.content).replace('Type="officeDocument"', 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"') } : entry);
  return buildZipFixture([...entries,
    { name: "word/media/logo.png", content: png },
    { name: "word/_rels/document.xml.rels", content: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="logo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/></Relationships>' },
    { name: "customXml/item1.xml", content: '<retained>unchanged</retained>' }
  ]);
}
async function definition(source: Buffer, selectedText: string) {
  const structure = await analyzeOoxmlBuffer({ buffer: source, fileName: "Обычный Word.docx", maxElements: 2000 });
  const element = structure.elements.find((item): item is DocxParagraphElement => item.kind === "paragraph" && item.text.includes(selectedText));
  assert.ok(element);
  const start = element.text.indexOf(selectedText);
  const field = { id: "name", key: "person.name", label: "ФИО", elementId: element.id,
    binding: { version: 1 as const, kind: "docx.text-range" as const, elementId: element.id,
      part: element.part, index: element.index, startOffset: start, endOffset: start + selectedText.length,
      selectedText, tableLocation: element.tableLocation } };
  return { structure, field, element };
}
async function assertUntouched(source: Buffer, output: Buffer) {
  const before = await readOoxmlPackage(source), after = await readOoxmlPackage(output);
  for (const entry of before) if (entry.name !== "word/document.xml") {
    assert.deepEqual(packageEntry(after, entry.name).content, entry.content, entry.name);
  }
}

for (const [label, content, selected] of [
  ["mixed style and proofing/bookmark markers", '<w:r><w:rPr><w:b/></w:rPr><w:t>До __</w:t></w:r><w:bookmarkStart w:id="9" w:name="mark"/><w:proofErr w:type="spellStart"/><w:r><w:rPr><w:i/></w:rPr><w:t>__ после</w:t></w:r><w:proofErr w:type="spellEnd"/><w:bookmarkEnd w:id="9"/>', "____"],
  ["one hyperlink", '<w:r><w:t>До </w:t></w:r><w:hyperlink w:anchor="target"><w:r><w:rPr><w:b/></w:rPr><w:t>__</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>__</w:t></w:r></w:hyperlink><w:r><w:t> после</w:t></w:r>', "____"],
  ["tab and inline image in the same run", '<w:r><w:tab/>' + drawing + '<w:t>До ____ после</w:t></w:r>', "____"],
  ["selected line break", '<w:r><w:t>До __</w:t><w:br/><w:t>__ после</w:t></w:r>', "__\n__"]
] as const) {
  test(`DOCX compiles and renders ${label} without dropping static content`, async () => {
    const source = fixture(`<w:p>${content}</w:p><w:p><w:r><w:t>Неизменяемая подпись</w:t></w:r></w:p>`);
    const { structure, field } = await definition(source, selected);
    const input = { source, fileName: "Обычный Word.docx", expectedSourceSha256: structure.sourceSha256,
      expectedStructureSha256: structure.structureSha256, field };
    const compiled = await compileScalarField(input);
    assert.deepEqual((await compileScalarField(input)).output, compiled.output);
    const filled = await renderScalarValue({ compiled: compiled.output, fieldBinding: field.binding,
      technicalBinding: compiled.technicalBinding, valueType: "string", value: "Иванов Иван" });
    assert.equal(filled.readBackValue, "Иванов Иван");
    await assertUntouched(source, filled.output);
    const xml = packageEntry(await readOoxmlPackage(filled.output), "word/document.xml").content.toString();
    assert.match(xml, /До /u); assert.match(xml, / после/u); assert.match(xml, /Неизменяемая подпись/u);
    if (content.includes("drawing")) assert.ok(xml.includes(drawing));
    if (content.includes("hyperlink")) assert.match(xml, /<w:hyperlink w:anchor="target">/u);
    if (content.includes("bookmarkStart")) {
      assert.equal((xml.match(/<w:bookmarkStart\b/gu) ?? []).length, 1);
      assert.equal((xml.match(/<w:bookmarkEnd\b/gu) ?? []).length, 1);
    }
  });
}

test("DOCX repeat preserves static links, bookmarks, fields and pictures and allocates unique IDs", async () => {
  const staticContent = '<w:p><w:bookmarkStart w:id="3" w:name="rowNote"/><w:hyperlink w:anchor="rowNote"><w:r><w:t>Справка</w:t></w:r></w:hyperlink><w:bookmarkEnd w:id="3"/></w:p><w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p><w:p><w:r>' + drawing + '</w:r></w:p>';
  const source = fixture('<w:p><w:r><w:t>Список</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/><w:bottom w:val="single"/><w:left w:val="single"/><w:right w:val="single"/><w:insideH w:val="single"/><w:insideV w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>____</w:t></w:r></w:p></w:tc><w:tc>' + staticContent + '</w:tc></w:tr></w:tbl><w:p><w:r><w:t>Подпись</w:t></w:r></w:p>');
  const { structure, field, element } = await definition(source, "____");
  assert.ok(element.tableLocation);
  const repeatBinding = { version: 1 as const, kind: "docx.repeat-row" as const, source: "audience.members" as const,
    anchorElementId: element.id, part: element.part, tableIndex: element.tableLocation.tableIndex, rowIndex: element.tableLocation.rowIndex };
  const compiled = await compileScalarFields({ source, fileName: "Обычный Word.docx",
    expectedSourceSha256: structure.sourceSha256, expectedStructureSha256: structure.structureSha256,
    fields: [field], repeatBinding });
  assert.ok(compiled.repeat && compiled.repeat.technicalBinding.kind === "docx.repeat-sdt");
  const compiledField = compiled.fields[0]; assert.ok(compiledField);
  const input = { compiled: compiled.output, binding: repeatBinding, technicalBinding: compiled.repeat.technicalBinding,
    fields: [{ fieldId: field.id, fieldKey: field.key, fieldBinding: field.binding,
      technicalBinding: compiledField.technicalBinding, required: true, valueType: "string" as const }],
    members: [{ memberId: "a", values: ["Иванов Иван"] }, { memberId: "b", values: ["Петров Пётр"] }] };
  const filled = await renderDocxRepeatRows(input);
  assert.deepEqual((await renderDocxRepeatRows(input)).output, filled.output);
  assert.equal(filled.verification.checkedValues, 2);
  await assertUntouched(source, filled.output);
  const xml = packageEntry(await readOoxmlPackage(filled.output), "word/document.xml").content.toString();
  assert.match(xml, /Иванов Иван/u); assert.match(xml, /Петров Пётр/u);
  assert.equal((xml.match(/<w:drawing>/gu) ?? []).length, 2);
  assert.equal((xml.match(/w:instr="PAGE"/gu) ?? []).length, 2);
  const drawingIds = [...xml.matchAll(/<(?:wp:docPr|pic:cNvPr) id="([^"]+)"/gu)].map((match) => match[1]);
  assert.equal(drawingIds.length, 4); assert.equal(new Set(drawingIds).size, 4);
  const ids = [...xml.matchAll(/<w:bookmarkStart w:id="([^"]+)"/gu)].map((match) => match[1]);
  const ends = [...xml.matchAll(/<w:bookmarkEnd w:id="([^"]+)"/gu)].map((match) => match[1]);
  assert.equal(ids.length, 2); assert.equal(new Set(ids).size, 2); assert.deepEqual(ids, ends);
  if (process.env.DOCOMATOR_COMPAT_FIXTURE_DIR) {
    await fs.mkdir(process.env.DOCOMATOR_COMPAT_FIXTURE_DIR, { recursive: true });
    await fs.writeFile(path.join(process.env.DOCOMATOR_COMPAT_FIXTURE_DIR, "complex-static.docx"), source);
    await fs.writeFile(path.join(process.env.DOCOMATOR_COMPAT_FIXTURE_DIR, "complex-filled.docx"), filled.output);
  }
});

test("DOCX still rejects stale selection and direct mutation inside a computed Word field", async () => {
  const source = fixture('<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>____</w:t></w:r></w:fldSimple></w:p>');
  const { structure, field } = await definition(source, "____");
  const input = { source, fileName: "Обычный Word.docx", expectedSourceSha256: structure.sourceSha256,
    expectedStructureSha256: structure.structureSha256, field };
  await assert.rejects(compileScalarField(input), (error: unknown) => error instanceof TemplateCompilerError && error.code === "unsupported_text_range");
  await assert.rejects(compileScalarField({ ...input, expectedSourceSha256: "f".repeat(64) }));
});

test("repeat metadata cannot clone a cross-row bookmark or external Word instruction", () => {
  for (const xml of ['<w:bookmarkStart w:id="1" w:name="outside"/>',
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>',
    '<w:fldSimple w:instr="DDEAUTO remote command"/>',
    '<w:fldSimple w:instr="&#x44;DEAUTO remote command"/>',
    '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>DDE</w:instrText><w:instrText>AUTO remote command</w:instrText><w:fldChar w:fldCharType="end"/></w:r>']) {
    assert.throws(() => validateRepeatContent(xml), TemplateCompilerError);
  }
});


test("repeat images reject external or broken relationships without losing the source", async () => {
  const source = fixture('<w:p><w:r>' + drawing + '</w:r></w:p>');
  const entries = await readOoxmlPackage(source);
  for (const suffix of ['TargetMode="External"', 'Type="invalid"']) {
    const changed = entries.map((entry) => entry.name === "word/_rels/document.xml.rels"
      ? { ...entry, content: Buffer.from('<Relationships><Relationship Id="logo" Target="https://external.invalid/image" ' + suffix + '/></Relationships>') }
      : entry);
    assert.throws(() => validateRepeatContent('<w:p><w:r>' + drawing + '</w:r></w:p>', changed), TemplateCompilerError);
  }
});


test("whole paragraph replacement retains static images and bookmark boundaries", async () => {
  const source = fixture('<w:p><w:bookmarkStart w:id="8" w:name="name"/><w:r>' + drawing + '<w:t>____</w:t></w:r><w:bookmarkEnd w:id="8"/></w:p>');
  const { structure, field } = await definition(source, "____");
  const binding = { version: 1 as const, kind: "docx.paragraph" as const,
    elementId: field.elementId, part: field.binding.part, index: field.binding.index };
  const compiled = await compileScalarField({ source, fileName: "Обычный Word.docx",
    expectedSourceSha256: structure.sourceSha256, expectedStructureSha256: structure.structureSha256,
    field: { ...field, binding } });
  const rendered = await renderScalarValue({ compiled: compiled.output,
    technicalBinding: compiled.technicalBinding, fieldBinding: binding,
    valueType: "string", value: "Иванов Иван" });
  assert.equal(rendered.readBackValue, "Иванов Иван");
  const xml = packageEntry(await readOoxmlPackage(rendered.output), "word/document.xml").content.toString();
  assert.ok(xml.includes(drawing));
  assert.match(xml, /<w:bookmarkStart w:id="8"/u);
  assert.match(xml, /<w:bookmarkEnd w:id="8"/u);
  await assertUntouched(source, rendered.output);
});

test("repeat remaps local REF instructions together with their cloned bookmarks", () => {
  const row = '<w:bookmarkStart w:id="4" w:name="local"/><w:bookmarkEnd w:id="4"/>' +
    '<w:fldSimple w:instr="REF local"/>' +
    '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText><w:instrText>REF local</w:instrText><w:fldChar w:fldCharType="end"/></w:r>';
  const rewrite = createRepeatContentRewriter([row]);
  const cloned = rewrite(row, 1);
  const name = /w:name="([^"]+)"/u.exec(cloned)?.[1];
  assert.ok(name && name !== "local");
  assert.ok(cloned.includes('w:instr="REF ' + name + '"'));
  assert.ok(cloned.includes('PAGEREF ' + name));
});

test("computed field display text cannot silently become a dynamic template binding", async () => {
  for (const body of [
    '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>____</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>TOC</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p><w:p><w:r><w:t>____</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
  ]) {
    const source = fixture(body);
    const { structure, field } = await definition(source, "____");
    await assert.rejects(compileScalarField({ source, fileName: "Поле Word.docx",
      expectedSourceSha256: structure.sourceSha256, expectedStructureSha256: structure.structureSha256, field }),
      (error: unknown) => error instanceof TemplateCompilerError && error.code === "unsupported_text_range");
  }
});

test("a computed field before the selected value does not block ordinary text", async () => {
  const pageField = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const source = fixture('<w:p>' + pageField + '<w:r><w:t> ФИО: ____</w:t></w:r></w:p>');
  const { structure, field } = await definition(source, "____");
  const compiled = await compileScalarField({ source, fileName: "Обычный Word.docx",
    expectedSourceSha256: structure.sourceSha256, expectedStructureSha256: structure.structureSha256, field });
  const filled = await renderScalarValue({ compiled: compiled.output, fieldBinding: field.binding,
    technicalBinding: compiled.technicalBinding, valueType: "string", value: "Иванов Иван" });
  assert.equal(filled.readBackValue, "Иванов Иван");
  const xml = packageEntry(await readOoxmlPackage(filled.output), "word/document.xml").content.toString();
  assert.ok(xml.includes(pageField));
  await assertUntouched(source, filled.output);
});
