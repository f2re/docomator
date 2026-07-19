import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeOoxmlBuffer,
  type XlsxCellElement
} from "@docomator/document-intake";
import {
  buildZipFixture,
  type ZipFixtureEntry
} from "@docomator/document-intake/testing";

import { TemplateCompilerError } from "./compiler.js";
import { compileScalarFields } from "./multi-field.js";
import {
  packageEntry,
  readOoxmlPackage,
  writeOoxmlPackage
} from "./ooxml-package.js";
import {
  compileXlsxRepeatRow,
  renderXlsxRepeatRows,
  type XlsxRepeatRowBinding
} from "./xlsx-repeat.js";
import {
  XLSX_METADATA_PART,
  verifyXlsxMetadata
} from "./xlsx-metadata.js";

interface XlsxRepeatFixtureOptions {
  duplicateCell?: boolean;
  duplicateRow?: boolean;
  externalRelationship?: boolean;
  formulaKind?: "array" | "shared";
  hiddenRow?: boolean;
  invalidNamespace?: boolean;
  nestedNamespaceSpoof?: boolean;
  invalidSharedString?: boolean;
  invalidStyle?: boolean;
  outsideFormula?: boolean;
  rowNumber?: number;
  signature?: boolean;
  simpleSheetName?: boolean;
  unsafeFormula?: boolean;
  userDefinedName?: "bare" | "local" | "quoted";
  wrongContentType?: boolean;
}

function xlsxRepeatFixture(options: XlsxRepeatFixtureOptions = {}): Buffer {
  const rowNumber = options.rowNumber ?? 2;
  const sheetName = options.simpleSheetName ? "Sheet1" : "Сотрудники'25";
  const sheetNameXml = sheetName.replaceAll("'", "&apos;");
  const formula = options.unsafeFormula
    ? `WEBSERVICE(B${rowNumber})`
    : `ROUND(C${rowNumber}*$B$1,2)`;
  const formulaAttributes =
    options.formulaKind === "shared"
      ? ' t="shared" si="0"'
      : options.formulaKind === "array"
        ? ` t="array" ref="D${rowNumber}:D${rowNumber}"`
        : "";
  const workbookDefinedNames =
    options.userDefinedName === "quoted"
      ? `<definedNames><definedName name="ПользовательскаяОбласть">'${sheetName.replaceAll("'", "''")}'!$B$${rowNumber}</definedName></definedNames>`
      : options.userDefinedName === "bare"
        ? `<definedNames><definedName name="ПользовательскаяОбласть">${sheetName}!$B$${rowNumber}</definedName></definedNames>`
        : options.userDefinedName === "local"
          ? `<definedNames><definedName name="ЛокальнаяОбласть" localSheetId="0">$B$${rowNumber}</definedName></definedNames>`
          : "";
  const firstCell = options.outsideFormula
    ? `<c r="B1" s="2"><f>$B$${rowNumber}</f><v>0</v></c>`
    : '<c r="B1" s="2"><v>1.5</v></c>';
  const externalRelationship = options.externalRelationship
    ? '<Relationship Id="rExt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/" TargetMode="External"/>'
    : "";
  const worksheetNamespace = options.invalidNamespace
    ? "urn:docomator:test:wrong-spreadsheet-namespace"
    : "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rowNamespace = options.nestedNamespaceSpoof
    ? ' xmlns="urn:docomator:test:nested-spoof"'
    : "";
  const rowAttributes = options.hiddenRow
    ? `r="${rowNumber}" hidden="true" s="1" customFormat="1" ht="22" customHeight="1"${rowNamespace}`
    : `r="${rowNumber}" s="1" customFormat="1" ht="22" customHeight="1"${rowNamespace}`;
  const duplicateCell = options.duplicateCell
    ? `<c r="B${rowNumber}" s="1"/>`
    : "";
  const duplicateRow = options.duplicateRow
    ? `<row r="${rowNumber}"><c r="B${rowNumber}"/></row>`
    : "";
  const footer =
    rowNumber < 1_048_576
      ? `<row r="${rowNumber + 1}"><c r="B${rowNumber + 1}" t="s"><v>${options.invalidSharedString ? 2 : 1}</v></c></row>`
      : "";
  const dimensionEndRow = rowNumber < 1_048_576 ? rowNumber + 1 : rowNumber;
  const entries: ZipFixtureEntry[] = [
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${options.wrongContentType ? "application/xml" : "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"}"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>`
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>${externalRelationship}</Relationships>`
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetNameXml}" sheetId="1" r:id="rId1"/></sheets>${workbookDefinedNames}<calcPr calcMode="manual"/></workbook>`
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content:
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>'
    },
    {
      name: "xl/styles.xml",
      content:
        '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>'
    },
    {
      name: "xl/sharedStrings.xml",
      content:
        '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2"><si><t>Коэффициент</t></si><si><t>Итог</t></si></sst>'
    },
    {
      name: "xl/calcChain.xml",
      content: `<?xml version="1.0"?><calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="D${rowNumber}" i="1"/></calcChain>`
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: `<?xml version="1.0"?><worksheet xmlns="${worksheetNamespace}"><sheetPr/><dimension ref="B1:F${dimensionEndRow}"/><sheetData><row r="1">${firstCell}<c r="C1" t="s"><v>0</v></c></row><row ${rowAttributes}><c r="B${rowNumber}" s="${options.invalidStyle ? 3 : 1}" t="inlineStr"><is><t>ФИО</t></is></c>${duplicateCell}<c r="C${rowNumber}" s="2"><v>10</v></c><c r="D${rowNumber}" s="2"><f${formulaAttributes}>${formula}</f><v>15</v></c><c r="E${rowNumber}" s="1" t="inlineStr"><is><t>Примечание</t></is></c><c r="F${rowNumber}" s="1"/></row>${duplicateRow}${footer}</sheetData><mergeCells count="1"><mergeCell ref="E${rowNumber}:F${rowNumber}"/></mergeCells></worksheet>`
    }
  ];
  if (options.signature) {
    entries.push({
      name: "_xmlsignatures/sig1.xml",
      content: "<Signature/>"
    });
  }
  return buildZipFixture(entries);
}

async function compiledRepeat(options: XlsxRepeatFixtureOptions = {}) {
  const rowNumber = options.rowNumber ?? 2;
  const source = xlsxRepeatFixture(options);
  const structure = await analyzeOoxmlBuffer({
    buffer: source,
    fileName: "Сотрудники.xlsx",
    maxElements: 2_000
  });
  const cell = (address: string): XlsxCellElement => {
    const found = structure.elements.find(
      (element): element is XlsxCellElement =>
        element.kind === "cell" && element.address === address
    );
    assert.ok(found);
    return found;
  };
  const name = cell(`B${rowNumber}`);
  const experience = cell(`C${rowNumber}`);
  const end = cell(`F${rowNumber}`);
  const fields = [
    {
      id: "field-name",
      key: "person.full_name",
      label: "ФИО",
      elementId: name.id,
      binding: {
        version: 1 as const,
        kind: "xlsx.cell" as const,
        elementId: name.id,
        sheetName: name.sheetName,
        sheetPath: name.sheetPath,
        address: name.address
      }
    },
    {
      id: "field-experience",
      key: "person.experience_years",
      label: "Стаж",
      elementId: experience.id,
      binding: {
        version: 1 as const,
        kind: "xlsx.cell" as const,
        elementId: experience.id,
        sheetName: experience.sheetName,
        sheetPath: experience.sheetPath,
        address: experience.address
      }
    }
  ];
  const scalar = await compileScalarFields({
    source,
    fileName: "Сотрудники.xlsx",
    expectedSourceSha256: structure.sourceSha256,
    expectedStructureSha256: structure.structureSha256,
    fields
  });
  const binding: XlsxRepeatRowBinding = {
    version: 1,
    kind: "xlsx.repeat-row",
    source: "audience.members",
    selection: "used-row",
    sheetName: name.sheetName,
    sheetPath: name.sheetPath,
    rowNumber,
    startAddress: name.address,
    endAddress: end.address,
    startElementId: name.id,
    endElementId: end.id
  };
  const repeatFields = fields.map((field) => {
    const compiled = scalar.fields.find((candidate) => candidate.fieldId === field.id);
    assert.ok(compiled);
    return {
      fieldId: field.id,
      technicalBinding: compiled.technicalBinding,
      fieldBinding: field.binding
    };
  });
  const repeat = await compileXlsxRepeatRow({
    compiled: scalar.output,
    binding,
    fields: repeatFields
  });
  return { scalar, fields, binding, repeat, repeatFields };
}

test("XLSX repeat clones a styled row, formulas and merges deterministically", async () => {
  const input = await compiledRepeat();
  const compiledEntries = await readOoxmlPackage(input.repeat.output);
  const metadataRecords = verifyXlsxMetadata(compiledEntries, {
    expectedRecords: [
      ...input.repeatFields.map((field) => ({
        kind: "field" as const,
        identifier: field.technicalBinding.identifier,
        part: field.technicalBinding.part,
        target: field.technicalBinding.target
      })),
      {
        kind: "repeat" as const,
        identifier: input.repeat.technicalBinding.identifier,
        part: input.repeat.technicalBinding.part,
        target: input.repeat.technicalBinding.target
      }
    ],
    exactExpectedRecords: true,
    definedNames: "present"
  });
  assert.equal(metadataRecords.length, 3);
  const renderInput = {
    compiled: input.repeat.output,
    binding: input.binding,
    technicalBinding: input.repeat.technicalBinding,
    fields: input.repeatFields.map((field, index) => ({
      ...field,
      fieldKey: input.fields[index]?.key ?? "",
      required: true,
      valueType: index === 0 ? ("string" as const) : ("integer" as const)
    })),
    members: [
      { memberId: "member-1", values: ["Иванов И.И.", 10] },
      { memberId: "member-2", values: ["Петров П.П.", 7] },
      { memberId: "member-3", values: ["Сидорова А.А.", 12] }
    ]
  };
  const first = await renderXlsxRepeatRows(renderInput);
  const second = await renderXlsxRepeatRows(renderInput);

  assert.deepEqual(first.output, second.output);
  assert.equal(first.rowCount, 3);
  assert.equal(first.fieldCount, 2);
  assert.equal(first.verification.checkedValues, 6);
  assert.equal(first.verification.checkedFormulas, 3);

  const entries = await readOoxmlPackage(first.output);
  assert.equal(entries.some((entry) => entry.name === "xl/calcChain.xml"), false);
  const worksheet = packageEntry(entries, "xl/worksheets/sheet1.xml").content.toString("utf8");
  assert.match(worksheet, /<dimension ref="B1:F5"\/>/u);
  assert.match(worksheet, /<row [^>]*r="2"[^>]*s="1"|<row [^>]*s="1"[^>]*r="2"/u);
  assert.match(worksheet, /<row [^>]*r="4"[^>]*s="1"|<row [^>]*s="1"[^>]*r="4"/u);
  assert.match(worksheet, /<c [^>]*r="D2"[^>]*><f>ROUND\(C2\*\$B\$1,2\)<\/f><\/c>/u);
  assert.match(worksheet, /<c [^>]*r="D3"[^>]*><f>ROUND\(C3\*\$B\$1,2\)<\/f><\/c>/u);
  assert.match(worksheet, /<c [^>]*r="D4"[^>]*><f>ROUND\(C4\*\$B\$1,2\)<\/f><\/c>/u);
  assert.match(worksheet, /<row r="5"><c [^>]*r="B5"[^>]*><v>1<\/v><\/c><\/row>/u);
  assert.match(worksheet, /<mergeCells count="3"><mergeCell ref="E2:F2"\/><mergeCell ref="E3:F3"\/><mergeCell ref="E4:F4"\/><\/mergeCells>/u);

  const workbook = packageEntry(entries, "xl/workbook.xml").content.toString("utf8");
  assert.doesNotMatch(workbook, /_DOCOMATOR_/u);
  assert.match(workbook, /calcMode="auto"/u);
  assert.match(workbook, /fullCalcOnLoad="1"/u);
  assert.match(workbook, /forceFullCalc="1"/u);
  assert.deepEqual(
    packageEntry(entries, XLSX_METADATA_PART).content,
    packageEntry(compiledEntries, XLSX_METADATA_PART).content
  );
  verifyXlsxMetadata(entries, {
    expectedRecords: metadataRecords,
    exactExpectedRecords: true,
    definedNames: "absent"
  });
});

test("XLSX repeat rejects mixed legacy and _AI_META field bindings", async () => {
  const input = await compiledRepeat();
  const fields = input.repeatFields.map((field, index) => ({
    ...field,
    fieldKey: input.fields[index]?.key ?? "",
    required: true,
    valueType: index === 0 ? ("string" as const) : ("integer" as const),
    technicalBinding:
      index === 0
        ? {
            kind: field.technicalBinding.kind,
            identifier: field.technicalBinding.identifier,
            part: field.technicalBinding.part,
            target: field.technicalBinding.target
          }
        : field.technicalBinding
  }));
  await assert.rejects(
    renderXlsxRepeatRows({
      compiled: input.repeat.output,
      binding: input.binding,
      technicalBinding: input.repeat.technicalBinding,
      fields,
      members: [{ memberId: "member-1", values: ["Иванов И.И.", 10] }]
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "mixed_xlsx_metadata_contract"
  );
  await assert.rejects(
    renderXlsxRepeatRows({
      compiled: input.repeat.output,
      binding: input.binding,
      technicalBinding: input.repeat.technicalBinding,
      fields: fields.map((field) => ({
        ...field,
        technicalBinding: {
          kind: field.technicalBinding.kind,
          identifier: field.technicalBinding.identifier,
          part: field.technicalBinding.part,
          target: field.technicalBinding.target
        }
      })),
      members: [{ memberId: "member-1", values: ["Иванов И.И.", 10] }]
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "xlsx_metadata_version_downgrade"
  );
});

test("XLSX repeat rejects an unsafe formula before compilation", async () => {
  await assert.rejects(
    compiledRepeat({ unsafeFormula: true }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "unsafe_repeat_formula"
  );
});

test("XLSX repeat rejects formulas outside the repeated row", async () => {
  await assert.rejects(
    compiledRepeat({ outsideFormula: true }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "formula_outside_repeat_not_supported"
  );
});

for (const [label, options] of [
  ["a quoted global defined name", { userDefinedName: "quoted" }],
  [
    "a bare-sheet global defined name",
    { simpleSheetName: true, userDefinedName: "bare" }
  ],
  ["a localSheetId defined name", { userDefinedName: "local" }]
] as const) {
  test(`XLSX repeat rejects ${label}`, async () => {
    await assert.rejects(
      compiledRepeat(options),
      (error: unknown) =>
        error instanceof TemplateCompilerError &&
        error.code === "affected_defined_name_not_supported"
    );
  });
}

for (const [label, options, code] of [
  [
    "an external relationship",
    { externalRelationship: true },
    "external_relationship_not_supported"
  ],
  ["a shared formula", { formulaKind: "shared" }, "unsafe_repeat_formula"],
  ["an array formula", { formulaKind: "array" }, "unsafe_repeat_formula"],
  ["a package signature", { signature: true }, "unsafe_xlsx_repeat_package"],
  [
    "a spoofed SpreadsheetML namespace",
    { invalidNamespace: true },
    "unsupported_xlsx_namespace"
  ],
  [
    "a nested default namespace spoof",
    { nestedNamespaceSpoof: true },
    "unsupported_xlsx_namespace"
  ],
  [
    "an invalid worksheet content type",
    { wrongContentType: true },
    "worksheet_content_type_mismatch"
  ],
  ["an out-of-range cell style", { invalidStyle: true }, "invalid_xlsx_structure"],
  [
    "an out-of-range shared string",
    { invalidSharedString: true },
    "invalid_shared_string"
  ],
  ["duplicate cells", { duplicateCell: true }, "duplicate_or_unsorted_cells"],
  ["duplicate rows", { duplicateRow: true }, "duplicate_or_unsorted_rows"],
  ["a hidden sample row", { hiddenRow: true }, "repeat_row_not_found"]
] as const) {
  test(`XLSX repeat rejects ${label}`, async () => {
    await assert.rejects(
      compiledRepeat(options),
      (error: unknown) =>
        error instanceof TemplateCompilerError && error.code === code
    );
  });
}

for (const unsafePart of [
  "xl/vbaProject.bin",
  "xl/activeX/activeX1.bin",
  "xl/embeddings/oleObject1.bin"
]) {
  test(`XLSX repeat rechecks unsafe compiled part ${unsafePart}`, async () => {
    const input = await compiledRepeat();
    const entries = await readOoxmlPackage(input.scalar.output);
    entries.push({
      name: unsafePart,
      isDirectory: false,
      content: Buffer.from("not executable test data")
    });
    await assert.rejects(
      compileXlsxRepeatRow({
        compiled: writeOoxmlPackage(entries),
        binding: input.binding,
        fields: input.repeatFields
      }),
      (error: unknown) =>
        error instanceof TemplateCompilerError &&
        error.code === "unsafe_xlsx_repeat_package"
    );
  });
}

for (const [label, replace] of [
  [
    "worksheet relationship type",
    (xml: string) =>
      xml.replace(
        "relationships/worksheet",
        "relationships/theme"
      )
  ],
  [
    "worksheet relationship target",
    (xml: string) =>
      xml.replace("worksheets/sheet1.xml", "worksheets/missing.xml")
  ]
] as const) {
  test(`XLSX repeat rejects an invalid ${label}`, async () => {
    const input = await compiledRepeat();
    const entries = await readOoxmlPackage(input.scalar.output);
    const tampered = entries.map((entry) =>
      entry.name === "xl/_rels/workbook.xml.rels"
        ? {
            ...entry,
            content: Buffer.from(replace(entry.content.toString("utf8")))
          }
        : entry
    );
    await assert.rejects(
      compileXlsxRepeatRow({
        compiled: writeOoxmlPackage(tampered),
        binding: input.binding,
        fields: input.repeatFields
      }),
      (error: unknown) =>
        error instanceof TemplateCompilerError &&
        error.code === "worksheet_relationship_mismatch"
    );
  });
}

test("XLSX repeat rejects a range that cuts through a merged cell", async () => {
  const input = await compiledRepeat();
  await assert.rejects(
    compileXlsxRepeatRow({
      compiled: input.scalar.output,
      binding: {
        ...input.binding,
        selection: "range",
        endAddress: "E2",
        endElementId: input.binding.endElementId
      },
      fields: input.repeatFields
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "merged_cells_cross_repeat_boundary"
  );
});

test("XLSX repeat enforces the audience size boundary", async () => {
  const input = await compiledRepeat();
  const renderFields = input.repeatFields.map((field, index) => ({
    ...field,
    fieldKey: input.fields[index]?.key ?? "",
    required: true,
    valueType: index === 0 ? ("string" as const) : ("integer" as const)
  }));
  for (const members of [
    [],
    Array.from({ length: 1_001 }, (_, index) => ({
      memberId: `member-${index + 1}`,
      values: ["Сотрудник", index]
    }))
  ]) {
    await assert.rejects(
      renderXlsxRepeatRows({
        compiled: input.repeat.output,
        binding: input.binding,
        technicalBinding: input.repeat.technicalBinding,
        fields: renderFields,
        members
      }),
      (error: unknown) =>
        error instanceof TemplateCompilerError &&
        error.code === "invalid_repeat_member_count"
    );
  }
});

test("XLSX repeat rejects invalid audience members", async () => {
  const input = await compiledRepeat();
  await assert.rejects(
    renderXlsxRepeatRows({
      compiled: input.repeat.output,
      binding: input.binding,
      technicalBinding: input.repeat.technicalBinding,
      fields: input.repeatFields.map((field, index) => ({
        ...field,
        fieldKey: input.fields[index]?.key ?? "",
        required: true,
        valueType: index === 0 ? ("string" as const) : ("integer" as const)
      })),
      members: [
        { memberId: "duplicate", values: ["Первый", 1] },
        { memberId: "duplicate", values: ["Второй", 2] }
      ]
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "invalid_repeat_members"
  );
});

test("XLSX repeat rejects rows beyond the worksheet boundary", async () => {
  const input = await compiledRepeat({ rowNumber: 1_048_576 });
  await assert.rejects(
    renderXlsxRepeatRows({
      compiled: input.repeat.output,
      binding: input.binding,
      technicalBinding: input.repeat.technicalBinding,
      fields: input.repeatFields.map((field, index) => ({
        ...field,
        fieldKey: input.fields[index]?.key ?? "",
        required: true,
        valueType: index === 0 ? ("string" as const) : ("integer" as const)
      })),
      members: [
        { memberId: "member-1", values: ["Первый", 1] },
        { memberId: "member-2", values: ["Второй", 2] }
      ]
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "repeat_row_overflow"
  );
});
