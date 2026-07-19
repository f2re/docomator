#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  analyzeOoxmlBuffer
} from "@docomator/document-intake";
import {
  compileScalarFields,
  renderDocxRepeatRows,
  renderScalarValues,
  renderXlsxRepeatRows
} from "@docomator/template-compiler";

import { parseDataImportBuffer } from "../../apps/api/dist/data-import-parser.js";
import {
  createExampleAssets,
  EXAMPLE_ASSETS,
  exampleManifest
} from "./example-assets.mjs";
import { validateSafeExampleAssets } from "./example-validation.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
  "examples"
);

function cells(structure) {
  return structure.elements.filter((element) => element.kind === "cell");
}

function paragraphs(structure) {
  return structure.elements.filter((element) => element.kind === "paragraph");
}

async function inventory(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`В каталоге примеров запрещена ссылка: ${relative}`);
    }
    if (entry.isDirectory()) {
      result.push(...(await inventory(path.join(directory, entry.name), relative)));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`В каталоге примеров найден не обычный файл: ${relative}`);
    }
    result.push(relative);
  }
  return result.sort((left, right) => left.localeCompare(right, "en"));
}

const firstGeneration = createExampleAssets();
const secondGeneration = createExampleAssets();
assert.deepEqual(
  firstGeneration.map((asset) => [asset.path, asset.kind]),
  secondGeneration.map((asset) => [asset.path, asset.kind])
);
for (const [index, asset] of firstGeneration.entries()) {
  assert.deepEqual(
    asset.content,
    secondGeneration[index]?.content,
    `Повторная генерация ${asset.path} должна давать те же байты.`
  );
}

const expectedInventory = [
  "README.md",
  "manifest.sha256",
  ...EXAMPLE_ASSETS.map((asset) => asset.path)
].sort((left, right) => left.localeCompare(right, "en"));
assert.deepEqual(await inventory(root), expectedInventory);
assert.equal(
  await readFile(path.join(root, "manifest.sha256"), "utf8"),
  exampleManifest(EXAMPLE_ASSETS)
);

for (const asset of EXAMPLE_ASSETS) {
  const actual = await readFile(path.join(root, asset.path));
  assert.deepEqual(
    actual,
    asset.content,
    `Пример ${asset.path} должен совпадать с детерминированным генератором.`
  );
}

const csvAsset = EXAMPLE_ASSETS.find((asset) => asset.kind === "csv");
assert.ok(csvAsset);
const table = await parseDataImportBuffer({
  buffer: csvAsset.content,
  fileName: "employees.csv"
});
assert.deepEqual(table.headers, [
  "Табельный номер",
  "ФИО",
  "Должность",
  "Подразделение",
  "Дата приёма"
]);
assert.equal(table.rowCount, 3);
assert.equal(table.rows[0]?.["Табельный номер"], "0001");
assert.equal(table.rows[2]?.ФИО, "Сидоров Максим Олегович");
assert.equal(
  table.rows.some((row) =>
    Object.values(row).some((value) => /^\s*[=+@-]/u.test(value))
  ),
  false,
  "CSV-пример не должен содержать значения, похожие на формулы."
);

await validateSafeExampleAssets(EXAMPLE_ASSETS);

const personalTemplate = EXAMPLE_ASSETS.find(
  (asset) => asset.kind === "docx-template"
);
const personalFilled = EXAMPLE_ASSETS.find(
  (asset) => asset.kind === "docx-filled"
);
const registerTemplate = EXAMPLE_ASSETS.find(
  (asset) => asset.kind === "xlsx-template"
);
const registerFilled = EXAMPLE_ASSETS.find(
  (asset) => asset.kind === "xlsx-filled"
);
const docxRegisterTemplate = EXAMPLE_ASSETS.find(
  (asset) => asset.kind === "docx-repeat-template"
);
const docxRegisterFilled = EXAMPLE_ASSETS.find(
  (asset) => asset.kind === "docx-repeat-filled"
);
assert.ok(
  personalTemplate &&
  personalFilled &&
  registerTemplate &&
  registerFilled &&
  docxRegisterTemplate &&
  docxRegisterFilled
);

const personalTemplateStructure = await analyzeOoxmlBuffer({
  buffer: personalTemplate.content,
  fileName: path.basename(personalTemplate.path)
});
const personalTemplateText = paragraphs(personalTemplateStructure).map(
  (paragraph) => paragraph.text
);
for (const placeholder of [
  "ФИО сотрудника",
  "Должность сотрудника",
  "Подразделение сотрудника",
  "Дата приёма сотрудника"
]) {
  assert.equal(personalTemplateText.includes(placeholder), true);
}

const personalFilledStructure = await analyzeOoxmlBuffer({
  buffer: personalFilled.content,
  fileName: path.basename(personalFilled.path)
});
const personalFilledText = paragraphs(personalFilledStructure).map(
  (paragraph) => paragraph.text
);
assert.equal(personalFilledText.includes("Иванов Алексей Сергеевич"), true);
assert.equal(personalFilledText.includes("ФИО сотрудника"), false);

const personalDefinitions = [
  ["field-full-name", "person.full_name", "ФИО", "ФИО сотрудника"],
  ["field-position", "person.position", "Должность", "Должность сотрудника"],
  [
    "field-department",
    "person.department",
    "Подразделение",
    "Подразделение сотрудника"
  ],
  ["field-hired-at", "person.hired_at", "Дата приёма", "Дата приёма сотрудника"]
].map(([id, key, label, text]) => {
  const element = personalTemplateStructure.elements.find(
    (candidate) => candidate.kind === "paragraph" && candidate.text === text
  );
  assert.ok(element && element.kind === "paragraph");
  return {
    id,
    key,
    label,
    elementId: element.id,
    binding: {
      version: 1,
      kind: "docx.paragraph",
      elementId: element.id,
      part: element.part,
      index: element.index,
      tableLocation: element.tableLocation
    }
  };
});
const compiledPersonal = await compileScalarFields({
  source: personalTemplate.content,
  fileName: path.basename(personalTemplate.path),
  expectedSourceSha256: personalTemplateStructure.sourceSha256,
  expectedStructureSha256: personalTemplateStructure.structureSha256,
  fields: personalDefinitions
});
const personalValues = [
  "Иванов Алексей Сергеевич",
  "Инженер",
  "Производственный отдел",
  "15.03.2024"
];
const renderedPersonal = await renderScalarValues({
  compiled: compiledPersonal.output,
  fields: personalDefinitions.map((field, index) => {
    const compiled = compiledPersonal.fields.find(
      (candidate) => candidate.fieldId === field.id
    );
    assert.ok(compiled);
    return {
      fieldId: field.id,
      fieldKey: field.key,
      technicalBinding: compiled.technicalBinding,
      fieldBinding: field.binding,
      valueType: "string",
      value: personalValues[index]
    };
  })
});
assert.deepEqual(
  renderedPersonal.fields.map((field) => field.readBackValue).sort(),
  [...personalValues].sort()
);

const registerMembers = [
  ["1", "Иванов Алексей Сергеевич", "Инженер", "Производственный отдел"],
  ["2", "Петрова Анна Викторовна", "Бухгалтер", "Финансовый отдел"],
  ["3", "Сидоров Максим Олегович", "Специалист", "Отдел снабжения"]
];

const docxRegisterStructure = await analyzeOoxmlBuffer({
  buffer: docxRegisterTemplate.content,
  fileName: path.basename(docxRegisterTemplate.path)
});
const docxRegisterSpecs = [
  ["docx-register-number", "subject.position", "Номер", "Номер сотрудника"],
  ["docx-register-name", "person.full_name", "ФИО", "ФИО сотрудника"],
  [
    "docx-register-position",
    "person.position",
    "Должность",
    "Должность сотрудника"
  ],
  [
    "docx-register-department",
    "person.department",
    "Подразделение",
    "Подразделение сотрудника"
  ]
];
const docxRegisterDefinitions = docxRegisterSpecs.map(
  ([id, key, label, selectedText]) => {
    const element = docxRegisterStructure.elements.find(
      (candidate) =>
        candidate.kind === "paragraph" &&
        candidate.text === selectedText &&
        candidate.tableLocation?.tableIndex === 0 &&
        candidate.tableLocation.rowIndex === 1
    );
    assert.ok(element && element.kind === "paragraph" && element.tableLocation);
    return {
      id,
      key,
      label,
      elementId: element.id,
      binding: {
        version: 1,
        kind: "docx.text-range",
        elementId: element.id,
        part: element.part,
        index: element.index,
        startOffset: 0,
        endOffset: selectedText.length,
        selectedText,
        tableLocation: element.tableLocation
      }
    };
  }
);
const docxRegisterAnchor = docxRegisterStructure.elements.find(
  (candidate) =>
    candidate.kind === "paragraph" &&
    candidate.text === "Номер сотрудника" &&
    candidate.tableLocation?.tableIndex === 0 &&
    candidate.tableLocation.rowIndex === 1
);
assert.ok(
  docxRegisterAnchor &&
  docxRegisterAnchor.kind === "paragraph" &&
  docxRegisterAnchor.tableLocation
);
const docxRegisterRepeatBinding = {
  version: 1,
  kind: "docx.repeat-row",
  source: "audience.members",
  anchorElementId: docxRegisterAnchor.id,
  part: docxRegisterAnchor.part,
  tableIndex: docxRegisterAnchor.tableLocation.tableIndex,
  rowIndex: docxRegisterAnchor.tableLocation.rowIndex
};
const compiledDocxRegister = await compileScalarFields({
  source: docxRegisterTemplate.content,
  fileName: path.basename(docxRegisterTemplate.path),
  expectedSourceSha256: docxRegisterStructure.sourceSha256,
  expectedStructureSha256: docxRegisterStructure.structureSha256,
  fields: docxRegisterDefinitions,
  repeatBinding: docxRegisterRepeatBinding
});
assert.ok(compiledDocxRegister.repeat?.binding.kind === "docx.repeat-row");
const renderedDocxRegister = await renderDocxRepeatRows({
  compiled: compiledDocxRegister.output,
  binding: compiledDocxRegister.repeat.binding,
  technicalBinding: compiledDocxRegister.repeat.technicalBinding,
  fields: docxRegisterDefinitions.map((field) => {
    const compiled = compiledDocxRegister.fields.find(
      (candidate) => candidate.fieldId === field.id
    );
    assert.ok(compiled);
    return {
      fieldId: field.id,
      fieldKey: field.key,
      required: true,
      technicalBinding: compiled.technicalBinding,
      fieldBinding: field.binding,
      valueType: "string"
    };
  }),
  members: registerMembers.map((values, index) => ({
    memberId: `member-${index + 1}`,
    values
  }))
});
assert.equal(renderedDocxRegister.rowCount, 3);
assert.equal(renderedDocxRegister.verification.checkedValues, 12);
const renderedDocxRegisterStructure = await analyzeOoxmlBuffer({
  buffer: renderedDocxRegister.output,
  fileName: "rendered-team-register.docx"
});
const renderedDocxText = paragraphs(renderedDocxRegisterStructure).map(
  (paragraph) => paragraph.text
);
for (const value of registerMembers.flat()) {
  assert.equal(renderedDocxText.includes(value), true);
}
for (const heading of ["№", "ФИО", "Должность", "Подразделение"]) {
  assert.equal(renderedDocxText.includes(heading), true);
}
for (const placeholder of docxRegisterSpecs.map((spec) => spec[3])) {
  assert.equal(renderedDocxText.includes(placeholder), false);
}
assert.equal(renderedDocxText.includes("Реестр сотрудников"), true);
assert.equal(
  renderedDocxText.includes("Все имена и сведения в примере вымышлены."),
  true
);
assert.deepEqual(
  [...new Set(
    paragraphs(renderedDocxRegisterStructure)
      .filter((paragraph) => paragraph.tableLocation?.tableIndex === 0)
      .map((paragraph) => paragraph.tableLocation.rowIndex)
  )].sort((left, right) => left - right),
  [0, 1, 2, 3]
);

const docxRegisterFilledStructure = await analyzeOoxmlBuffer({
  buffer: docxRegisterFilled.content,
  fileName: path.basename(docxRegisterFilled.path)
});
const docxRegisterFilledText = paragraphs(docxRegisterFilledStructure).map(
  (paragraph) => paragraph.text
);
for (const value of registerMembers.flat()) {
  assert.equal(docxRegisterFilledText.includes(value), true);
}
for (const heading of ["№", "ФИО", "Должность", "Подразделение"]) {
  assert.equal(docxRegisterFilledText.includes(heading), true);
}
for (const placeholder of docxRegisterSpecs.map((spec) => spec[3])) {
  assert.equal(docxRegisterFilledText.includes(placeholder), false);
}
assert.equal(docxRegisterFilledText.includes("Реестр сотрудников"), true);
assert.equal(
  docxRegisterFilledText.includes("Все имена и сведения в примере вымышлены."),
  true
);
assert.deepEqual(
  [...new Set(
    paragraphs(docxRegisterFilledStructure)
      .filter((paragraph) => paragraph.tableLocation?.tableIndex === 0)
      .map((paragraph) => paragraph.tableLocation.rowIndex)
  )].sort((left, right) => left - right),
  [0, 1, 2, 3]
);

const registerTemplateStructure = await analyzeOoxmlBuffer({
  buffer: registerTemplate.content,
  fileName: path.basename(registerTemplate.path)
});
const templateCells = cells(registerTemplateStructure);
assert.equal(registerTemplateStructure.summary.sheets, 1);
assert.equal(registerTemplateStructure.summary.formulas, 0);
assert.equal(
  templateCells.find((cell) => cell.address === "B4")?.value,
  "ФИО сотрудника"
);
assert.equal(
  templateCells.find((cell) => cell.address === "D4")?.value,
  "Подразделение сотрудника"
);

const registerFieldSpecs = [
  ["field-number", "subject.position", "Номер", "A4"],
  ["field-name", "person.full_name", "ФИО", "B4"],
  ["field-position", "person.position", "Должность", "C4"],
  ["field-department", "person.department", "Подразделение", "D4"]
];
const registerDefinitions = registerFieldSpecs.map(
  ([id, key, label, address]) => {
    const element = templateCells.find((cell) => cell.address === address);
    assert.ok(element && element.kind === "cell");
    return {
      id,
      key,
      label,
      elementId: element.id,
      binding: {
        version: 1,
        kind: "xlsx.cell",
        elementId: element.id,
        sheetName: element.sheetName,
        sheetPath: element.sheetPath,
        address: element.address
      }
    };
  }
);
const firstRegisterCell = templateCells.find((cell) => cell.address === "A4");
const lastRegisterCell = templateCells.find((cell) => cell.address === "D4");
assert.ok(firstRegisterCell && lastRegisterCell);
const registerRepeatBinding = {
  version: 1,
  kind: "xlsx.repeat-row",
  source: "audience.members",
  selection: "used-row",
  sheetName: firstRegisterCell.sheetName,
  sheetPath: firstRegisterCell.sheetPath,
  rowNumber: 4,
  startAddress: "A4",
  endAddress: "D4",
  startElementId: firstRegisterCell.id,
  endElementId: lastRegisterCell.id
};
const compiledRegister = await compileScalarFields({
  source: registerTemplate.content,
  fileName: path.basename(registerTemplate.path),
  expectedSourceSha256: registerTemplateStructure.sourceSha256,
  expectedStructureSha256: registerTemplateStructure.structureSha256,
  fields: registerDefinitions,
  repeatBinding: registerRepeatBinding
});
assert.ok(compiledRegister.repeat?.binding.kind === "xlsx.repeat-row");
const renderedRegister = await renderXlsxRepeatRows({
  compiled: compiledRegister.output,
  binding: compiledRegister.repeat.binding,
  technicalBinding: compiledRegister.repeat.technicalBinding,
  fields: registerDefinitions.map((field) => {
    const compiled = compiledRegister.fields.find(
      (candidate) => candidate.fieldId === field.id
    );
    assert.ok(compiled);
    return {
      fieldId: field.id,
      fieldKey: field.key,
      required: true,
      technicalBinding: compiled.technicalBinding,
      fieldBinding: field.binding,
      valueType: "string"
    };
  }),
  members: registerMembers.map((values, index) => ({
    memberId: `member-${index + 1}`,
    values
  }))
});
assert.equal(renderedRegister.verification.checkedValues, 12);
const renderedRegisterStructure = await analyzeOoxmlBuffer({
  buffer: renderedRegister.output,
  fileName: "rendered-team-register.xlsx"
});
const renderedCells = cells(renderedRegisterStructure).filter(
  (cell) => cell.sheetName === "Реестр"
);
assert.equal(
  renderedCells.find((cell) => cell.address === "B6")?.value,
  "Сидоров Максим Олегович"
);

const registerFilledStructure = await analyzeOoxmlBuffer({
  buffer: registerFilled.content,
  fileName: path.basename(registerFilled.path)
});
const filledCells = cells(registerFilledStructure);
assert.equal(registerFilledStructure.summary.sheets, 1);
assert.equal(registerFilledStructure.summary.formulas, 0);
assert.equal(
  filledCells.find((cell) => cell.address === "B4")?.value,
  "Иванов Алексей Сергеевич"
);
assert.equal(
  filledCells.find((cell) => cell.address === "B6")?.value,
  "Сидоров Максим Олегович"
);

process.stdout.write(
  `Проверены детерминированные примеры CSV/DOCX/XLSX: ${EXAMPLE_ASSETS.length}.\n`
);
