import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeOoxmlBuffer,
  type DocxParagraphElement
} from "@docomator/document-intake";
import {
  buildZipFixture,
  minimalDocxEntries
} from "@docomator/document-intake/testing";

import {
  type CompiledRepeatTechnicalBinding,
  type DocxRepeatRowBinding
} from "./compiler.js";
import { compileScalarFields } from "./multi-field.js";
import { packageEntry, readOoxmlPackage } from "./ooxml-package.js";
import { renderDocxRepeatRows } from "./scalar-render.js";

async function desktopWordEmptyRowFixture() {
  const source = buildZipFixture(
    minimalDocxEntries().map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            content:
              '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body><w:p w14:paraId="01000001" w14:textId="02000001"><w:r><w:t>Темы работ</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid><w:tr w14:paraId="11000001" w14:textId="12000001"><w:tc><w:p w14:paraId="11000002" w14:textId="12000002"><w:r><w:t>#</w:t></w:r></w:p></w:tc><w:tc><w:p w14:paraId="11000003" w14:textId="12000003"><w:r><w:t>ФИО</w:t></w:r></w:p></w:tc><w:tc><w:p w14:paraId="11000004" w14:textId="12000004"><w:r><w:t>Тема</w:t></w:r></w:p></w:tc><w:tc><w:p w14:paraId="11000005" w14:textId="12000005"><w:r><w:t>зачетка</w:t></w:r></w:p></w:tc></w:tr><w:tr w14:paraId="21000001" w14:textId="22000001"><w:tc><w:p w14:paraId="21000002" w14:textId="22000002"><w:proofErr w:type="spellStart"/><w:proofErr w:type="spellEnd"/></w:p></w:tc><w:tc><w:p w14:paraId="21000003" w14:textId="22000003"/></w:tc><w:tc><w:p w14:paraId="21000004" w14:textId="22000004"/></w:tc><w:tc><w:p w14:paraId="21000005" w14:textId="22000005"/></w:tc></w:tr></w:tbl><w:p w14:paraId="31000001" w14:textId="32000001"><w:r><w:t>Что еще</w:t></w:r></w:p></w:body></w:document>'
          }
        : entry
    )
  );
  const structure = await analyzeOoxmlBuffer({
    buffer: source,
    fileName: "ФИО.docx",
    maxElements: 2_000
  });
  const rowParagraphs = structure.elements
    .filter(
      (element): element is DocxParagraphElement =>
        element.kind === "paragraph" &&
        element.text === "" &&
        element.tableLocation?.tableIndex === 0 &&
        element.tableLocation.rowIndex === 1
    )
    .sort(
      (left, right) =>
        left.tableLocation!.columnIndex - right.tableLocation!.columnIndex
    );
  assert.equal(rowParagraphs.length, 4);

  const definitions = [
    ["field-number", "subject.position", "Номер строки"],
    ["field-name", "person.full_name", "ФИО"],
    ["field-topic", "person.topic", "Тема"],
    [
      "field-student-number",
      "person.student_number",
      "Номер зачётной книжки"
    ]
  ] as const;
  const fields = definitions.map(([id, key, label], index) => {
    const element = rowParagraphs[index];
    assert.ok(element);
    return {
      id,
      key,
      label,
      elementId: element.id,
      binding: {
        version: 1 as const,
        kind: "docx.paragraph" as const,
        elementId: element.id,
        part: element.part,
        index: element.index,
        tableLocation: element.tableLocation
      }
    };
  });
  const anchor = rowParagraphs[0];
  assert.ok(anchor?.tableLocation);
  const repeatBinding: DocxRepeatRowBinding = {
    version: 1,
    kind: "docx.repeat-row",
    source: "audience.members",
    anchorElementId: anchor.id,
    part: anchor.part,
    tableIndex: anchor.tableLocation.tableIndex,
    rowIndex: anchor.tableLocation.rowIndex
  };
  return { source, structure, fields, repeatBinding };
}

test("DOCX repeats an empty four-cell row created by desktop Word", async () => {
  const input = await desktopWordEmptyRowFixture();
  const compiled = await compileScalarFields({
    source: input.source,
    fileName: "ФИО.docx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    fields: input.fields,
    repeatBinding: input.repeatBinding
  });
  assert.ok(compiled.repeat);
  assert.equal(compiled.repeat.binding.kind, "docx.repeat-row");
  assert.equal(compiled.repeat.technicalBinding.kind, "docx.repeat-sdt");
  const repeat = compiled.repeat as {
    binding: DocxRepeatRowBinding;
    technicalBinding: CompiledRepeatTechnicalBinding;
  };
  const byId = new Map(compiled.fields.map((field) => [field.fieldId, field]));
  const rendered = await renderDocxRepeatRows({
    compiled: compiled.output,
    binding: repeat.binding,
    technicalBinding: repeat.technicalBinding,
    fields: input.fields.map((field, index) => {
      const compiledField = byId.get(field.id);
      assert.ok(compiledField);
      return {
        fieldId: field.id,
        fieldKey: field.key,
        required: index < 2,
        technicalBinding: compiledField.technicalBinding,
        fieldBinding: field.binding,
        valueType: index === 0 ? ("integer" as const) : ("string" as const)
      };
    }),
    members: [
      {
        memberId: "person-1",
        values: [1, "Иванов Иван", "Тема первая", "А-01"]
      },
      {
        memberId: "person-2",
        values: [2, "Петров Пётр", "Тема вторая", "Б-02"]
      }
    ]
  });

  assert.equal(rendered.rowCount, 2);
  assert.equal(rendered.verification.checkedValues, 8);
  const xml = packageEntry(
    await readOoxmlPackage(rendered.output),
    "word/document.xml"
  ).content.toString("utf8");
  assert.equal((xml.match(/<w:tr\b/gu) ?? []).length, 3);
  assert.match(xml, /Темы работ/u);
  assert.match(xml, /Что еще/u);
  assert.match(xml, /Иванов Иван/u);
  assert.match(xml, /Тема первая/u);
  assert.match(xml, /Б-02/u);
  assert.doesNotMatch(xml, /2100000[1-5]|2200000[1-5]/u);
  assert.doesNotMatch(xml, /<w:proofErr\b/u);
  const paragraphIds = [...xml.matchAll(/w14:paraId="([0-9A-F]{8})"/gu)].map(
    (match) => match[1]
  );
  assert.equal(new Set(paragraphIds).size, paragraphIds.length);
});
