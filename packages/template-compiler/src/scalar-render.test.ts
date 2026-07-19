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
  compileScalarField,
  TemplateCompilerError
} from "./compiler.js";
import {
  packageEntry,
  readOoxmlPackage,
  writeOoxmlPackage
} from "./ooxml-package.js";
import { readScalarValue, renderScalarValue } from "./scalar-render.js";
import { XLSX_METADATA_PART } from "./xlsx-metadata.js";

function docxFixture(): Buffer {
  return buildZipFixture(
    minimalDocxEntries().map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            content:
              '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>ФИО получателя</w:t></w:r></w:p><w:p><w:r><w:t>Неизменяемый текст</w:t></w:r></w:p></w:body></w:document>'
          }
        : entry
    )
  );
}

function xlsxFixture(formula = false): Buffer {
  const cell = formula
    ? '<c r="B7"><f>1+1</f><v>2</v></c>'
    : '<c r="B7" s="2" t="inlineStr"><is><t>Исходное значение</t></is></c>';
  const entries: ZipFixtureEntry[] = [
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    },
    {
      name: "xl/workbook.xml",
      content:
        '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Сотрудники" sheetId="1" r:id="rId1"/><sheet name="Архив" sheetId="2" r:id="rId2"/></sheets></workbook>'
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content:
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="7">${cell}</row></sheetData></worksheet>`
    },
    {
      name: "xl/worksheets/sheet2.xml",
      content:
        '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="7"><c r="B7" t="inlineStr"><is><t>Архивное значение</t></is></c></row></sheetData></worksheet>'
    }
  ];
  return buildZipFixture(entries);
}

async function compiledDocx() {
  const source = docxFixture();
  const structure = await analyzeOoxmlBuffer({
    buffer: source,
    fileName: "Письмо.docx",
    maxElements: 2_000
  });
  const element = structure.elements.find(
    (candidate): candidate is DocxParagraphElement =>
      candidate.kind === "paragraph" && candidate.text === "ФИО получателя"
  );
  assert.ok(element);
  const fieldBinding = {
    version: 1 as const,
    kind: "docx.paragraph" as const,
    elementId: element.id,
    part: element.part,
    index: element.index,
    tableLocation: element.tableLocation
  };
  const compiled = await compileScalarField({
    source,
    fileName: "Письмо.docx",
    expectedSourceSha256: structure.sourceSha256,
    expectedStructureSha256: structure.structureSha256,
    field: {
      id: "field-recipient-name",
      key: "recipient.full_name",
      label: "ФИО получателя",
      elementId: element.id,
      binding: fieldBinding
    }
  });
  return { source, structure, element, fieldBinding, compiled };
}

async function compiledDocxTextRange() {
  const source = buildZipFixture(
    minimalDocxEntries().map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            content:
              '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Должность: </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>____</w:t></w:r><w:r><w:t xml:space="preserve"> / штатная</w:t></w:r></w:p></w:body></w:document>'
          }
        : entry
    )
  );
  const structure = await analyzeOoxmlBuffer({
    buffer: source,
    fileName: "Карточка.docx",
    maxElements: 2_000
  });
  const element = structure.elements.find(
    (candidate): candidate is DocxParagraphElement =>
      candidate.kind === "paragraph" && candidate.text.includes("Должность:")
  );
  assert.ok(element);
  const selectedText = "____";
  const startOffset = element.text.indexOf(selectedText);
  const fieldBinding = {
    version: 1 as const,
    kind: "docx.text-range" as const,
    elementId: element.id,
    part: element.part,
    index: element.index,
    startOffset,
    endOffset: startOffset + selectedText.length,
    selectedText,
    tableLocation: element.tableLocation
  };
  const compiled = await compileScalarField({
    source,
    fileName: "Карточка.docx",
    expectedSourceSha256: structure.sourceSha256,
    expectedStructureSha256: structure.structureSha256,
    field: {
      id: "field-position",
      key: "person.position",
      label: "Должность",
      elementId: element.id,
      binding: fieldBinding
    }
  });
  return { source, structure, element, fieldBinding, compiled };
}

async function compiledXlsx(formula = false) {
  const source = xlsxFixture(formula);
  const structure = await analyzeOoxmlBuffer({
    buffer: source,
    fileName: "Сотрудники.xlsx",
    maxElements: 2_000
  });
  const element = structure.elements.find(
    (candidate): candidate is XlsxCellElement =>
      candidate.kind === "cell" && candidate.address === "B7"
  );
  assert.ok(element);
  const fieldBinding = {
    version: 1 as const,
    kind: "xlsx.cell" as const,
    elementId: element.id,
    sheetName: element.sheetName,
    sheetPath: element.sheetPath,
    address: element.address
  };
  const compiled = await compileScalarField({
    source,
    fileName: "Сотрудники.xlsx",
    expectedSourceSha256: structure.sourceSha256,
    expectedStructureSha256: structure.structureSha256,
    field: {
      id: "field-recipient-name",
      key: "recipient.full_name",
      label: "ФИО получателя",
      elementId: element.id,
      binding: fieldBinding
    }
  });
  return { source, structure, element, fieldBinding, compiled };
}

test("DOCX trial render writes and reads back text while preserving other content", async () => {
  const input = await compiledDocx();
  const compiledSnapshot = Buffer.from(input.compiled.output);
  const result = await renderScalarValue({
    compiled: input.compiled.output,
    technicalBinding: input.compiled.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: "string",
    value: "Иванов Иван Иванович"
  });

  assert.deepEqual(input.compiled.output, compiledSnapshot);
  assert.equal(result.renderedValue, "Иванов Иван Иванович");
  assert.equal(result.readBackValue, "Иванов Иван Иванович");
  assert.equal(result.verification.matched, true);
  assert.notEqual(result.outputSha256, result.inputSha256);

  const entries = await readOoxmlPackage(result.output);
  const xml = packageEntry(entries, "word/document.xml").content.toString("utf8");
  assert.match(xml, /<w:pPr><w:jc w:val="center"\/><\/w:pPr>/u);
  assert.match(xml, /<w:rPr><w:b\/><\/w:rPr>/u);
  assert.match(xml, /<w:t xml:space="preserve">Иванов Иван Иванович<\/w:t>/u);
  assert.match(xml, /<w:t>Неизменяемый текст<\/w:t>/u);

  const readBack = await readScalarValue({
    document: result.output,
    technicalBinding: input.compiled.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: "string"
  });
  assert.equal(readBack.value, "Иванов Иван Иванович");
});

test("DOCX text-range render preserves the label and suffix", async () => {
  const input = await compiledDocxTextRange();
  const result = await renderScalarValue({
    compiled: input.compiled.output,
    technicalBinding: input.compiled.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: "string",
    value: "Ведущий инженер"
  });

  assert.equal(result.readBackValue, "Ведущий инженер");
  const entries = await readOoxmlPackage(result.output);
  const xml = packageEntry(entries, "word/document.xml").content.toString("utf8");
  assert.match(xml, /Должность: /u);
  assert.match(xml, /<w:sdt>.*<w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">Ведущий инженер<\/w:t><\/w:r>.*<\/w:sdt>/u);
  assert.match(xml, / \/ штатная/u);
  assert.doesNotMatch(xml, /____/u);

  const readBack = await readScalarValue({
    document: result.output,
    technicalBinding: input.compiled.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: "string"
  });
  assert.equal(readBack.value, "Ведущий инженер");
});

test("XLSX trial render supports text, numbers and booleans and preserves cell style", async () => {
  const input = await compiledXlsx();
  const text = await renderScalarValue({
    compiled: input.compiled.output,
    technicalBinding: input.compiled.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: "string",
    value: "Петров Пётр"
  });
  assert.equal(text.readBackValue, "Петров Пётр");
  let entries = await readOoxmlPackage(text.output);
  let xml = packageEntry(entries, "xl/worksheets/sheet1.xml").content.toString("utf8");
  assert.match(xml, /<c r="B7" s="2" t="inlineStr">/u);

  const number = await renderScalarValue({
    compiled: input.compiled.output,
    technicalBinding: input.compiled.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: "number",
    value: "12,5"
  });
  assert.equal(number.renderedValue, "12,5");
  assert.equal(number.readBackValue, "12,5");
  entries = await readOoxmlPackage(number.output);
  xml = packageEntry(entries, "xl/worksheets/sheet1.xml").content.toString("utf8");
  assert.match(xml, /<c r="B7" s="2"><v>12\.5<\/v><\/c>/u);

  const fixedNumber = await renderScalarValue({
    compiled: input.compiled.output,
    technicalBinding: input.compiled.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: "number",
    value: "12,5",
    formatter: { version: 1, kind: "number.ru", fractionDigits: 2 }
  });
  assert.equal(fixedNumber.renderedValue, "12,50");
  assert.equal(fixedNumber.readBackValue, "12,50");
  entries = await readOoxmlPackage(fixedNumber.output);
  xml = packageEntry(entries, "xl/worksheets/sheet1.xml").content.toString("utf8");
  assert.match(xml, /<c r="B7" s="2"><v>12\.5<\/v><\/c>/u);

  const boolean = await renderScalarValue({
    compiled: input.compiled.output,
    technicalBinding: input.compiled.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: "boolean",
    value: true
  });
  assert.equal(boolean.readBackValue, "Да");
});

test("XLSX renderer rejects changed _AI_META and keeps legacy templates working", async () => {
  const input = await compiledXlsx();
  const compiledEntries = await readOoxmlPackage(input.compiled.output);
  const tampered = writeOoxmlPackage(
    compiledEntries.map((entry) =>
      entry.name === "xl/workbook.xml"
        ? {
            ...entry,
            content: Buffer.from(
              entry.content
                .toString("utf8")
                .replace('state="veryHidden"', 'state="hidden"'),
              "utf8"
            )
          }
        : entry
    )
  );
  await assert.rejects(
    renderScalarValue({
      compiled: tampered,
      technicalBinding: input.compiled.technicalBinding,
      fieldBinding: input.fieldBinding,
      valueType: "string",
      value: "Петров Пётр"
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "invalid_xlsx_metadata"
  );

  const namespaceSpoof = writeOoxmlPackage(
    compiledEntries.map((entry) =>
      entry.name === "xl/workbook.xml"
        ? {
            ...entry,
            content: Buffer.from(
              entry.content.toString("utf8").replace(
                '<sheet name="_AI_META"',
                '<evil:sheet xmlns:evil="urn:docomator:spoof" name="_AI_META"'
              ),
              "utf8"
            )
          }
        : entry
    )
  );
  await assert.rejects(
    renderScalarValue({
      compiled: namespaceSpoof,
      technicalBinding: input.compiled.technicalBinding,
      fieldBinding: input.fieldBinding,
      valueType: "string",
      value: "Подмена пространства имён"
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "invalid_xlsx_metadata"
  );

  const legacyEntries = await readOoxmlPackage(input.source);
  const legacyWorkbook = packageEntry(
    legacyEntries,
    "xl/workbook.xml"
  ).content.toString("utf8");
  const legacy = writeOoxmlPackage(
    legacyEntries.map((entry) =>
      entry.name === "xl/workbook.xml"
        ? {
            ...entry,
            content: Buffer.from(
              legacyWorkbook.replace(
                "</sheets>",
                `</sheets><definedNames><definedName name="${input.compiled.technicalBinding.identifier}">${input.compiled.technicalBinding.target}</definedName></definedNames>`
              ),
              "utf8"
            )
          }
        : entry
    )
  );
  await assert.rejects(
    renderScalarValue({
      compiled: legacy,
      technicalBinding: {
        ...input.compiled.technicalBinding,
        metadataVersion: 1
      },
      fieldBinding: input.fieldBinding,
      valueType: "string",
      value: "Новая версия без метаданных"
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "xlsx_metadata_missing"
  );
  const legacyResult = await renderScalarValue({
    compiled: legacy,
    technicalBinding: {
      kind: "xlsx.defined-name",
      identifier: input.compiled.technicalBinding.identifier,
      part: input.compiled.technicalBinding.part,
      target: input.compiled.technicalBinding.target
    },
    fieldBinding: input.fieldBinding,
    valueType: "string",
    value: "Старый шаблон"
  });
  assert.equal(legacyResult.readBackValue, "Старый шаблон");
});

test("XLSX renderer rejects partial or inconsistent _AI_META artifacts", async () => {
  const input = await compiledXlsx();
  const entries = await readOoxmlPackage(input.compiled.output);
  const replacePart = (
    name: string,
    transform: (xml: string) => string
  ) =>
    entries.map((entry) =>
      entry.name === name
        ? {
            ...entry,
            content: Buffer.from(transform(entry.content.toString("utf8")), "utf8")
          }
        : entry
    );
  const variants = [
    {
      label: "неполный набор частей",
      code: "xlsx_metadata_conflict",
      entries: entries.filter((entry) => entry.name !== XLSX_METADATA_PART)
    },
    {
      label: "идентификатор связи",
      code: "invalid_xlsx_metadata",
      entries: replacePart("xl/_rels/workbook.xml.rels", (xml) =>
        xml.replace('Id="rIdDocomatorMeta"', 'Id="rIdChangedMeta"')
      )
    },
    {
      label: "повтор атрибута видимости",
      code: "invalid_xlsx_metadata",
      entries: replacePart("xl/workbook.xml", (xml) =>
        xml.replace('state="veryHidden"', 'state="veryHidden" state="hidden"')
      )
    },
    {
      label: "переопределение пространства имён связи",
      code: "invalid_xlsx_metadata",
      entries: replacePart("xl/workbook.xml", (xml) =>
        xml.replace(
          '<sheet name="_AI_META"',
          '<sheet xmlns:r="urn:docomator:spoof" name="_AI_META"'
        )
      )
    },
    {
      label: "тип связи",
      code: "invalid_xlsx_metadata",
      entries: replacePart("xl/_rels/workbook.xml.rels", (xml) =>
        xml.replace(
          'Id="rIdDocomatorMeta" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"',
          'Id="rIdDocomatorMeta" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"'
        )
      )
    },
    {
      label: "цель связи",
      code: "invalid_xlsx_metadata",
      entries: replacePart("xl/_rels/workbook.xml.rels", (xml) =>
        xml.replace(
          'Target="worksheets/_ai_meta.xml"',
          'Target="worksheets/changed.xml"'
        )
      )
    },
    {
      label: "тип содержимого",
      code: "invalid_xlsx_metadata",
      entries: replacePart("[Content_Types].xml", (xml) =>
        xml.replace(
          'PartName="/xl/worksheets/_ai_meta.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"',
          'PartName="/xl/worksheets/_ai_meta.xml" ContentType="application/xml"'
        )
      )
    },
    {
      label: "маркер таблицы",
      code: "invalid_xlsx_metadata",
      entries: replacePart(XLSX_METADATA_PART, (xml) =>
        xml.replace("DOCOMATOR_XLSX_METADATA", "CHANGED_XLSX_METADATA")
      )
    },
    {
      label: "версия таблицы",
      code: "invalid_xlsx_metadata",
      entries: replacePart(XLSX_METADATA_PART, (xml) =>
        xml.replace(
          '<c r="B1" t="inlineStr"><is><t xml:space="preserve">1</t>',
          '<c r="B1" t="inlineStr"><is><t xml:space="preserve">2</t>'
        )
      )
    },
    {
      label: "цель записи",
      code: "invalid_xlsx_metadata",
      entries: replacePart(XLSX_METADATA_PART, (xml) =>
        xml.replace("$B$7", "$C$7")
      )
    },
    {
      label: "именованная привязка",
      code: "invalid_xlsx_metadata",
      entries: replacePart("xl/workbook.xml", (xml) =>
        xml.replace("$B$7</definedName>", "$C$7</definedName>")
      )
    },
    {
      label: "собственные связи служебного листа",
      code: "xlsx_metadata_conflict",
      entries: [
        ...entries,
        {
          name: "xl/worksheets/_rels/_ai_meta.xml.rels",
          isDirectory: false,
          content: Buffer.from(
            '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
            "utf8"
          )
        }
      ]
    },
    {
      label: "данные после корневого элемента",
      code: "invalid_xlsx_metadata",
      entries: replacePart("xl/_rels/workbook.xml.rels", (xml) => `${xml}junk`)
    },
    ...[
      ["entity в неверном регистре", "&AMP;"],
      ["hex entity с неверным X", "&#X41;"],
      ["неэкранированный знак меньше", "<"],
      ["запрещённый управляющий символ", "\u0001"]
    ].map(([label, value]) => ({
      label: label ?? "недопустимый XML-атрибут",
      code: "invalid_xlsx_metadata",
      entries: replacePart("xl/workbook.xml", (xml) =>
        xml.replace("<workbook ", `<workbook probe="${value ?? ""}" `)
      )
    }))
  ];

  for (const variant of variants) {
    await assert.rejects(
      renderScalarValue({
        compiled: writeOoxmlPackage(variant.entries),
        technicalBinding: input.compiled.technicalBinding,
        fieldBinding: input.fieldBinding,
        valueType: "string",
        value: variant.label
      }),
      (error: unknown) =>
        error instanceof TemplateCompilerError && error.code === variant.code,
      variant.label
    );
  }
});

test("trial render refuses to overwrite an XLSX formula", async () => {
  const input = await compiledXlsx(true);
  await assert.rejects(
    renderScalarValue({
      compiled: input.compiled.output,
      technicalBinding: input.compiled.technicalBinding,
      fieldBinding: input.fieldBinding,
      valueType: "number",
      value: 7
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "formula_cell_not_supported" &&
      /формул/u.test(error.userMessage)
  );
});

test("trial render validates dates, integers and binding pairs", async () => {
  const input = await compiledDocx();
  await assert.rejects(
    renderScalarValue({
      compiled: input.compiled.output,
      technicalBinding: input.compiled.technicalBinding,
      fieldBinding: input.fieldBinding,
      valueType: "date",
      value: "2026-02-30"
    }),
    /несуществующая календарная дата/u
  );
  await assert.rejects(
    renderScalarValue({
      compiled: input.compiled.output,
      technicalBinding: input.compiled.technicalBinding,
      fieldBinding: input.fieldBinding,
      valueType: "integer",
      value: 1.5
    }),
    /целым числом/u
  );
  await assert.rejects(
    renderScalarValue({
      compiled: input.compiled.output,
      technicalBinding: { ...input.compiled.technicalBinding, kind: "xlsx.defined-name" },
      fieldBinding: input.fieldBinding,
      valueType: "string",
      value: "Иванов"
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "technical_binding_mismatch"
  );
});

test("XLSX render rejects unknown, redirected and downgraded technical bindings", async () => {
  const input = await compiledXlsx();
  const variants = [
    {
      ...input.compiled.technicalBinding,
      kind: "xlsx.unknown"
    },
    {
      ...input.compiled.technicalBinding,
      target: "'Отдел ''А'''!$C$7"
    },
    {
      ...input.compiled.technicalBinding,
      part: "xl/worksheets/sheet1.xml"
    },
    {
      ...input.compiled.technicalBinding,
      metadataVersion: 2
    }
  ];
  for (const technicalBinding of variants) {
    await assert.rejects(
      renderScalarValue({
        compiled: input.compiled.output,
        technicalBinding:
          technicalBinding as unknown as typeof input.compiled.technicalBinding,
        fieldBinding: input.fieldBinding,
        valueType: "string",
        value: "Недопустимая привязка"
      }),
      (error: unknown) =>
        error instanceof TemplateCompilerError &&
        error.code === "technical_binding_mismatch"
    );
  }
  await assert.rejects(
    renderScalarValue({
      compiled: input.compiled.output,
      technicalBinding: input.compiled.technicalBinding,
      fieldBinding: {
        ...input.fieldBinding,
        sheetPath: "xl/worksheets/sheet2.xml"
      },
      valueType: "string",
      value: "Перенаправленный лист"
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "invalid_xlsx_metadata"
  );
});

test("production fallback renders a missing optional value as an empty string", async () => {
  const input = await compiledDocx();
  const result = await renderScalarValue({
    compiled: input.compiled.output,
    technicalBinding: input.compiled.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: "string",
    value: ""
  });
  assert.equal(result.renderedValue, "");
  assert.equal(result.readBackValue, "");
});
