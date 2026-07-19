import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeOoxmlBuffer,
  type DocxParagraphElement,
  type XlsxCellElement
} from "@docomator/document-intake";
import {
  buildZipFixture,
  minimalDocxEntries,
  type ZipFixtureEntry
} from "@docomator/document-intake/testing";

import {
  TemplateCompilerError,
  type CompiledRepeatTechnicalBinding,
  type DocxRepeatRowBinding
} from "./compiler.js";
import {
  compileScalarFields,
  renderScalarValues,
  type CompileScalarFieldsResult
} from "./multi-field.js";
import { packageEntry, readOoxmlPackage } from "./ooxml-package.js";
import { renderDocxRepeatRows } from "./scalar-render.js";

function requireDocxRepeat(result: CompileScalarFieldsResult): {
  binding: DocxRepeatRowBinding;
  technicalBinding: CompiledRepeatTechnicalBinding;
} {
  const repeat = result.repeat;
  assert.ok(repeat);
  assert.equal(repeat.binding.kind, "docx.repeat-row");
  assert.equal(repeat.technicalBinding.kind, "docx.repeat-sdt");
  return repeat as {
    binding: DocxRepeatRowBinding;
    technicalBinding: CompiledRepeatTechnicalBinding;
  };
}

function docxFixture(): Buffer {
  return buildZipFixture(
    minimalDocxEntries().map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            content:
              '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>ФИО получателя</w:t></w:r></w:p><w:p><w:r><w:t>Должность получателя</w:t></w:r></w:p><w:p><w:r><w:t>Неизменяемый текст</w:t></w:r></w:p></w:body></w:document>'
          }
        : entry
    )
  );
}

function xlsxFixture(): Buffer {
  const entries: ZipFixtureEntry[] = [
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    },
    {
      name: "xl/workbook.xml",
      content:
        '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Сотрудники" sheetId="1" r:id="rId1"/></sheets></workbook>'
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content:
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content:
        '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="2"><c r="B2" s="1" t="inlineStr"><is><t>ФИО</t></is></c><c r="C2" s="2" t="inlineStr"><is><t>Стаж</t></is></c><c r="D2"><v>7</v></c></row></sheetData></worksheet>'
    }
  ];
  return buildZipFixture(entries);
}

async function docxDefinitions() {
  const source = docxFixture();
  const structure = await analyzeOoxmlBuffer({
    buffer: source,
    fileName: "Письмо.docx",
    maxElements: 2_000
  });
  const name = structure.elements.find(
    (element): element is DocxParagraphElement =>
      element.kind === "paragraph" && element.text === "ФИО получателя"
  );
  const position = structure.elements.find(
    (element): element is DocxParagraphElement =>
      element.kind === "paragraph" && element.text === "Должность получателя"
  );
  assert.ok(name);
  assert.ok(position);
  const fields = [
    {
      id: "field-position",
      key: "recipient.position",
      label: "Должность получателя",
      elementId: position.id,
      binding: {
        version: 1,
        kind: "docx.paragraph",
        elementId: position.id,
        part: position.part,
        index: position.index
      }
    },
    {
      id: "field-name",
      key: "recipient.full_name",
      label: "ФИО получателя",
      elementId: name.id,
      binding: {
        version: 1,
        kind: "docx.paragraph",
        elementId: name.id,
        part: name.part,
        index: name.index
      }
    }
  ] as const;
  return { source, structure, fields };
}

async function docxTextRangeDefinitions() {
  const source = buildZipFixture(
    minimalDocxEntries().map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            content:
              '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">ФИО: ____</w:t></w:r></w:p><w:p><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">Должность: ____</w:t></w:r></w:p></w:body></w:document>'
          }
        : entry
    )
  );
  const structure = await analyzeOoxmlBuffer({
    buffer: source,
    fileName: "Карточка.docx",
    maxElements: 2_000
  });
  const paragraphs = structure.elements.filter(
    (element): element is DocxParagraphElement => element.kind === "paragraph"
  );
  assert.equal(paragraphs.length, 2);
  const definitions = [
    [paragraphs[0], "field-name", "person.full_name", "ФИО"],
    [paragraphs[1], "field-position", "person.position", "Должность"]
  ] as const;
  const fields = definitions.map(([element, id, key, label]) => {
    assert.ok(element);
    const selectedText = "____";
    const startOffset = element.text.indexOf(selectedText);
    assert.notEqual(startOffset, -1);
    return {
      id,
      key,
      label,
      elementId: element.id,
      binding: {
        version: 1 as const,
        kind: "docx.text-range" as const,
        elementId: element.id,
        part: element.part,
        index: element.index,
        startOffset,
        endOffset: startOffset + selectedText.length,
        selectedText,
        tableLocation: element.tableLocation
      }
    };
  });
  return { source, structure, fields };
}

async function docxRepeatRowDefinitions(
  options: { unsafe?: "vMerge" | "nested" | "complex" | "unique-id" } = {}
) {
  const unsafeXml =
    options.unsafe === "vMerge"
      ? "<w:tcPr><w:vMerge/></w:tcPr>"
      : options.unsafe === "nested"
        ? "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Вложено</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"
        : options.unsafe === "complex"
          ? '<w:p><w:hyperlink r:id="rIdExternal" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:r><w:t>Ссылка</w:t></w:r></w:hyperlink></w:p>'
          : options.unsafe === "unique-id"
            ? '<w:p xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" w14:paraId="12345678"><w:r><w:t>Уникальный абзац</w:t></w:r></w:p>'
        : "";
  const source = buildZipFixture(
    minimalDocxEntries().map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            content: `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Список сотрудников</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tr><w:tc><w:p><w:r><w:t>ФИО</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Должность</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc>${unsafeXml}<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>____</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>____</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Подпись после таблицы</w:t></w:r></w:p></w:body></w:document>`
          }
        : entry
    )
  );
  const structure = await analyzeOoxmlBuffer({
    buffer: source,
    fileName: "Список.docx",
    maxElements: 2_000
  });
  const rowParagraphs = structure.elements.filter(
    (element): element is DocxParagraphElement =>
      element.kind === "paragraph" &&
      element.text === "____" &&
      element.tableLocation?.tableIndex === 0 &&
      element.tableLocation.rowIndex === 1
  );
  assert.equal(rowParagraphs.length, 2);
  const fields = rowParagraphs.map((element, index) => ({
    id: index === 0 ? "field-name" : "field-position",
    key: index === 0 ? "person.full_name" : "person.position",
    label: index === 0 ? "ФИО" : "Должность",
    elementId: element.id,
    binding: {
      version: 1 as const,
      kind: "docx.text-range" as const,
      elementId: element.id,
      part: element.part,
      index: element.index,
      startOffset: 0,
      endOffset: 4,
      selectedText: "____",
      tableLocation: element.tableLocation
    }
  }));
  const anchor = rowParagraphs[0];
  assert.ok(anchor?.tableLocation);
  const repeatBinding = {
    version: 1 as const,
    kind: "docx.repeat-row" as const,
    source: "audience.members" as const,
    anchorElementId: anchor.id,
    part: anchor.part,
    tableIndex: anchor.tableLocation.tableIndex,
    rowIndex: anchor.tableLocation.rowIndex
  };
  return { source, structure, fields, repeatBinding };
}

async function xlsxDefinitions() {
  const source = xlsxFixture();
  const structure = await analyzeOoxmlBuffer({
    buffer: source,
    fileName: "Сотрудники.xlsx",
    maxElements: 2_000
  });
  const name = structure.elements.find(
    (element): element is XlsxCellElement =>
      element.kind === "cell" && element.address === "B2"
  );
  const years = structure.elements.find(
    (element): element is XlsxCellElement =>
      element.kind === "cell" && element.address === "C2"
  );
  assert.ok(name);
  assert.ok(years);
  const fields = [
    {
      id: "field-years",
      key: "person.experience_years",
      label: "Стаж",
      elementId: years.id,
      binding: {
        version: 1,
        kind: "xlsx.cell",
        elementId: years.id,
        sheetName: years.sheetName,
        sheetPath: years.sheetPath,
        address: years.address
      }
    },
    {
      id: "field-name",
      key: "person.full_name",
      label: "ФИО",
      elementId: name.id,
      binding: {
        version: 1,
        kind: "xlsx.cell",
        elementId: name.id,
        sheetName: name.sheetName,
        sheetPath: name.sheetPath,
        address: name.address
      }
    }
  ] as const;
  return { source, structure, fields };
}

test("DOCX compilation is deterministic for multiple fields regardless of input order", async () => {
  const input = await docxDefinitions();
  const first = await compileScalarFields({
    source: input.source,
    fileName: "Письмо.docx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    fields: input.fields
  });
  const second = await compileScalarFields({
    source: input.source,
    fileName: "Письмо.docx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    fields: [...input.fields].reverse()
  });

  assert.equal(first.outputSha256, second.outputSha256);
  assert.deepEqual(first.output, second.output);
  assert.equal(first.fields.length, 2);
  assert.equal(first.verification.checkedFields, 2);
  assert.deepEqual(
    first.fields.map((field) => field.fieldKey),
    ["recipient.full_name", "recipient.position"]
  );

  const entries = await readOoxmlPackage(first.output);
  const xml = packageEntry(entries, "word/document.xml").content.toString("utf8");
  assert.match(xml, /aifield:field-name/u);
  assert.match(xml, /aifield:field-position/u);
  assert.match(xml, /Неизменяемый текст/u);
});

test("DOCX renders and finally reads back every field", async () => {
  const input = await docxDefinitions();
  const compiled = await compileScalarFields({
    source: input.source,
    fileName: "Письмо.docx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    fields: input.fields
  });
  const byId = new Map(compiled.fields.map((field) => [field.fieldId, field]));
  const rendered = await renderScalarValues({
    compiled: compiled.output,
    fields: input.fields.map((field) => ({
      fieldId: field.id,
      fieldKey: field.key,
      technicalBinding: byId.get(field.id)?.technicalBinding!,
      fieldBinding: field.binding,
      valueType: "string" as const,
      value:
        field.id === "field-name"
          ? "Иванов Иван Иванович"
          : "Ведущий инженер"
    }))
  });

  assert.equal(rendered.verification.checkedFields, 2);
  assert.deepEqual(
    rendered.fields.map((field) => [field.fieldKey, field.readBackValue]),
    [
      ["recipient.full_name", "Иванов Иван Иванович"],
      ["recipient.position", "Ведущий инженер"]
    ]
  );
  const entries = await readOoxmlPackage(rendered.output);
  const xml = packageEntry(entries, "word/document.xml").content.toString("utf8");
  assert.match(xml, /Иванов Иван Иванович/u);
  assert.match(xml, /Ведущий инженер/u);
  assert.match(xml, /Неизменяемый текст/u);
});

test("DOCX compiles and renders multiple text ranges without changing labels", async () => {
  const input = await docxTextRangeDefinitions();
  const compiled = await compileScalarFields({
    source: input.source,
    fileName: "Карточка.docx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    fields: input.fields
  });
  const byId = new Map(compiled.fields.map((field) => [field.fieldId, field]));
  const rendered = await renderScalarValues({
    compiled: compiled.output,
    fields: input.fields.map((field) => ({
      fieldId: field.id,
      fieldKey: field.key,
      technicalBinding: byId.get(field.id)?.technicalBinding!,
      fieldBinding: field.binding,
      valueType: "string" as const,
      value: field.id === "field-name" ? "Иванов Иван" : "Инженер"
    }))
  });

  assert.deepEqual(
    rendered.fields.map((field) => [field.fieldKey, field.readBackValue]),
    [
      ["person.full_name", "Иванов Иван"],
      ["person.position", "Инженер"]
    ]
  );
  const entries = await readOoxmlPackage(rendered.output);
  const xml = packageEntry(entries, "word/document.xml").content.toString("utf8");
  assert.match(xml, /ФИО: /u);
  assert.match(xml, /Должность: /u);
  assert.match(xml, /Иванов Иван/u);
  assert.match(xml, /Инженер/u);
  assert.match(xml, /<w:rPr><w:i\/><\/w:rPr>/u);
  assert.doesNotMatch(xml, /____/u);
});

test("DOCX compiler marks one safe table row as an audience repeat", async () => {
  const input = await docxRepeatRowDefinitions();
  const first = await compileScalarFields({
    source: input.source,
    fileName: "Список.docx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    fields: input.fields,
    repeatBinding: input.repeatBinding
  });
  const second = await compileScalarFields({
    source: input.source,
    fileName: "Список.docx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    fields: [...input.fields].reverse(),
    repeatBinding: input.repeatBinding
  });
  assert.deepEqual(first.output, second.output);
  assert.equal(first.repeat?.binding.source, "audience.members");
  assert.equal(first.repeat?.technicalBinding.kind, "docx.repeat-sdt");
  const xml = packageEntry(
    await readOoxmlPackage(first.output),
    "word/document.xml"
  ).content.toString("utf8");
  assert.equal((xml.match(/airepeat:/gu) ?? []).length, 1);
  assert.equal((xml.match(/aifield:/gu) ?? []).length, 2);
  assert.match(xml, /<w:sdtContent><w:tr><w:trPr><w:cantSplit\/><\/w:trPr>/u);
  assert.match(xml, /Список сотрудников/u);
  assert.match(xml, /Подпись после таблицы/u);

  const byId = new Map(first.fields.map((field) => [field.fieldId, field]));
  const trial = await renderScalarValues({
    compiled: first.output,
    fields: input.fields.map((field) => ({
      fieldId: field.id,
      fieldKey: field.key,
      technicalBinding: byId.get(field.id)?.technicalBinding!,
      fieldBinding: field.binding,
      valueType: "string" as const,
      value: field.id === "field-name" ? "Иванов Иван" : "Инженер"
    }))
  });
  assert.equal(trial.verification.checkedFields, 2);
});

test("DOCX repeat renderer clones the sample row and reverse-reads every value", async () => {
  const input = await docxRepeatRowDefinitions();
  const compiled = await compileScalarFields({
    source: input.source,
    fileName: "Список.docx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    fields: input.fields,
    repeatBinding: input.repeatBinding
  });
  const repeat = requireDocxRepeat(compiled);
  const byId = new Map(compiled.fields.map((field) => [field.fieldId, field]));
  const fields = input.fields.map((field) => ({
    fieldId: field.id,
    fieldKey: field.key,
    required: field.id === "field-name",
    technicalBinding: byId.get(field.id)?.technicalBinding!,
    fieldBinding: field.binding,
    valueType: field.id === "field-name" ? ("string" as const) : ("number" as const),
    ...(field.id === "field-name"
      ? {}
      : {
          formatter: {
            version: 1,
            kind: "number.ru",
            fractionDigits: 2
          }
        })
  }));
  const members = [
    { memberId: "person-1", values: ["Иванов Иван", 12.5] },
    { memberId: "person-2", values: ["Петров Пётр", 7] },
    { memberId: "person-3", values: ["Сидоров Семён", null] }
  ];
  const first = await renderDocxRepeatRows({
    compiled: compiled.output,
    binding: repeat.binding,
    technicalBinding: repeat.technicalBinding,
    fields,
    members
  });
  const second = await renderDocxRepeatRows({
    compiled: compiled.output,
    binding: repeat.binding,
    technicalBinding: repeat.technicalBinding,
    fields,
    members
  });
  assert.deepEqual(first.output, second.output);
  assert.equal(first.rowCount, 3);
  assert.equal(first.verification.checkedValues, 6);
  const xml = packageEntry(
    await readOoxmlPackage(first.output),
    "word/document.xml"
  ).content.toString("utf8");
  assert.equal((xml.match(/<w:tr>/gu) ?? []).length, 4);
  assert.equal((xml.match(/<w:cantSplit\/>/gu) ?? []).length, 3);
  assert.equal((xml.match(/aifield:field-name/gu) ?? []).length, 3);
  assert.equal((xml.match(/aifield:field-position/gu) ?? []).length, 3);
  assert.match(xml, /Иванов Иван/u);
  assert.match(xml, /12,50/u);
  assert.match(xml, /Петров Пётр/u);
  assert.match(xml, /7,00/u);
  assert.match(xml, /Сидоров Семён/u);
  assert.doesNotMatch(xml, /____/u);
  assert.match(xml, /Список сотрудников/u);
  assert.match(xml, /Подпись после таблицы/u);
  const wordIds = [...xml.matchAll(/<w:id\s+w:val="(\d+)"\/>/gu)].map(
    (match) => match[1]
  );
  assert.equal(wordIds.length, 7);
  assert.equal(new Set(wordIds).size, 7);
});

test("DOCX repeat renderer enforces member limits and required values", async () => {
  const input = await docxRepeatRowDefinitions();
  const compiled = await compileScalarFields({
    source: input.source,
    fileName: "Список.docx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    fields: input.fields,
    repeatBinding: input.repeatBinding
  });
  const repeat = requireDocxRepeat(compiled);
  const byId = new Map(compiled.fields.map((field) => [field.fieldId, field]));
  const fields = input.fields.map((field) => ({
    fieldId: field.id,
    fieldKey: field.key,
    required: true,
    technicalBinding: byId.get(field.id)?.technicalBinding!,
    fieldBinding: field.binding,
    valueType: "string" as const
  }));
  const base = {
    compiled: compiled.output,
    binding: repeat.binding,
    technicalBinding: repeat.technicalBinding,
    fields
  };
  await assert.rejects(
    renderDocxRepeatRows({ ...base, members: [] }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "invalid_repeat_member_count"
  );
  await assert.rejects(
    renderDocxRepeatRows({
      ...base,
      members: Array.from({ length: 1_001 }, (_, index) => ({
        memberId: `person-${index}`,
        values: ["Имя", "Должность"]
      }))
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "invalid_repeat_member_count"
  );
  await assert.rejects(
    renderDocxRepeatRows({
      ...base,
      members: [{ memberId: "person-1", values: ["", "Должность"] }]
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "repeat_required_value_missing"
  );
});

test("DOCX repeat renderer resolves deterministic Word ID collisions", async () => {
  const input = await docxRepeatRowDefinitions();
  const compiled = await compileScalarFields({
    source: input.source,
    fileName: "Список.docx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    fields: input.fields,
    repeatBinding: input.repeatBinding
  });
  const repeat = requireDocxRepeat(compiled);
  const byId = new Map(compiled.fields.map((field) => [field.fieldId, field]));
  const fields = input.fields.map((field, index) => ({
    fieldId: index === 0 ? "field-49" : "field-67",
    fieldKey: field.key,
    required: true,
    technicalBinding: byId.get(field.id)?.technicalBinding!,
    fieldBinding: field.binding,
    valueType: "string" as const
  }));
  const rendered = await renderDocxRepeatRows({
    compiled: compiled.output,
    binding: repeat.binding,
    technicalBinding: repeat.technicalBinding,
    fields,
    members: Array.from({ length: 1_000 }, (_, memberIndex) => ({
      memberId: `person-${memberIndex}`,
      values: [`Имя ${memberIndex}`, `Должность ${memberIndex}`]
    }))
  });
  const xml = packageEntry(
    await readOoxmlPackage(rendered.output),
    "word/document.xml"
  ).content.toString("utf8");
  const wordIds = [...xml.matchAll(/<w:id\s+w:val="(\d+)"\/>/gu)].map(
    (match) => match[1]
  );
  assert.equal(wordIds.length, 1 + 1_000 * 2);
  assert.equal(new Set(wordIds).size, wordIds.length);
});

test("DOCX repeat compiler rejects unsafe row structures", async () => {
  for (const unsafe of [
    "vMerge",
    "nested",
    "complex",
    "unique-id"
  ] as const) {
    const input = await docxRepeatRowDefinitions({ unsafe });
    await assert.rejects(
      compileScalarFields({
        source: input.source,
        fileName: "Список.docx",
        expectedSourceSha256: input.structure.sourceSha256,
        expectedStructureSha256: input.structure.structureSha256,
        fields: input.fields,
        repeatBinding: input.repeatBinding
      }),
      (error: unknown) =>
        error instanceof TemplateCompilerError &&
        error.code === "unsupported_repeat_row"
    );
  }
});

test("XLSX compiles and renders two typed cells without changing a neighbour", async () => {
  const input = await xlsxDefinitions();
  const compiled = await compileScalarFields({
    source: input.source,
    fileName: "Сотрудники.xlsx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    fields: input.fields
  });
  const byId = new Map(compiled.fields.map((field) => [field.fieldId, field]));
  const rendered = await renderScalarValues({
    compiled: compiled.output,
    fields: input.fields.map((field) => ({
      fieldId: field.id,
      fieldKey: field.key,
      technicalBinding: byId.get(field.id)?.technicalBinding!,
      fieldBinding: field.binding,
      valueType: field.id === "field-years" ? "integer" : "string",
      value: field.id === "field-years" ? 12 : "Петров Пётр"
    }))
  });

  assert.deepEqual(
    rendered.fields.map((field) => [field.fieldKey, field.readBackValue]),
    [
      ["person.experience_years", "12"],
      ["person.full_name", "Петров Пётр"]
    ]
  );
  const entries = await readOoxmlPackage(rendered.output);
  const workbook = packageEntry(entries, "xl/workbook.xml").content.toString("utf8");
  const sheet = packageEntry(entries, "xl/worksheets/sheet1.xml").content.toString("utf8");
  assert.equal((workbook.match(/<definedName\b/gu) ?? []).length, 2);
  assert.match(sheet, /<c r="B2" s="1" t="inlineStr">/u);
  assert.match(sheet, /Петров Пётр/u);
  assert.match(sheet, /<c r="C2" s="2"><v>12<\/v><\/c>/u);
  assert.match(sheet, /<c r="D2"><v>7<\/v><\/c>/u);
});

test("multi-field compiler rejects duplicate coordinates and stale element identifiers", async () => {
  const input = await docxDefinitions();
  await assert.rejects(
    compileScalarFields({
      source: input.source,
      fileName: "Письмо.docx",
      expectedSourceSha256: input.structure.sourceSha256,
      expectedStructureSha256: input.structure.structureSha256,
      fields: [
  input.fields[0],
  {
    ...input.fields[1],
    elementId: input.fields[0].elementId,
    binding: input.fields[0].binding
  }
]
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "duplicate_field_coordinate"
  );

  await assert.rejects(
    compileScalarFields({
      source: input.source,
      fileName: "Письмо.docx",
      expectedSourceSha256: input.structure.sourceSha256,
      expectedStructureSha256: input.structure.structureSha256,
      fields: [{ ...input.fields[0], elementId: "paragraph-stale" }]
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "binding_element_mismatch"
  );
});
