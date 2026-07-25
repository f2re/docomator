from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, value: str) -> None:
    (ROOT / path).write_text(value, encoding="utf-8")
    print(f"updated {path}")


def replace_once(path: str, old: str, new: str) -> None:
    value = read(path)
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one occurrence, found {count}: {old[:100]!r}")
    write(path, value.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, minimum: int = 1) -> None:
    value = read(path)
    count = value.count(old)
    if count < minimum:
        raise RuntimeError(f"{path}: expected at least {minimum} occurrences, found {count}: {old[:100]!r}")
    write(path, value.replace(old, new))


def regex_once(path: str, pattern: str, replacement: str, flags: int = 0) -> None:
    value = read(path)
    updated, count = re.subn(pattern, replacement, value, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{path}: regex expected one match, found {count}: {pattern}")
    write(path, updated)


# Storage exports and assisted import registry surface.
replace_once(
    "packages/storage/src/index.ts",
    'export * from "./data-import-access.js";\n',
    'export * from "./data-import-access.js";\nexport * from "./data-import-assist-access.js";\nexport * from "./data-import-assist.js";\n',
)
replace_once(
    "packages/storage/src/data-import-assist.ts",
    '    this.operator = options.operator ?? new OperatorAssistRegistry(store);\n  }\n\n  plan(',
    '    this.operator = options.operator ?? new OperatorAssistRegistry(store);\n  }\n\n  list(spaceIdentity: string, limitValue = 50): DataImportRunRecord[] {\n    return this.imports.list(spaceIdentity, limitValue);\n  }\n\n  plan(',
)

# API routes use the transactional assisted registry while preserving the public endpoints.
replace_once(
    "apps/api/src/data-import-routes.ts",
    '''import {
  DataImportConflictError,
  DataImportRegistry,
  DataImportValidationError,
  SpaceConflictError,
  SpaceRegistry,
  SpaceValidationError,
  dataImportRegistryFromSpaceRegistry,
  validateExistingImportIdentityProperty,
  type DataImportPropertyMapping
} from "@docomator/storage";''',
    '''import {
  AssistedDataImportRegistry,
  DataImportConflictError,
  DataImportValidationError,
  SpaceConflictError,
  SpaceRegistry,
  SpaceValidationError,
  assistedDataImportRegistryFromSpaceRegistry,
  validateExistingImportIdentityProperty,
  type AssistedDataImportPropertyMapping
} from "@docomator/storage";''',
)
replace_once(
    "apps/api/src/data-import-routes.ts",
    "  mappings: DataImportPropertyMapping[];",
    "  mappings: AssistedDataImportPropertyMapping[];",
)
replace_once(
    "apps/api/src/data-import-routes.ts",
    '''          valueType: {
            type: "string",
            enum: [
              "string",
              "text",
              "number",
              "integer",
              "boolean",
              "date",
              "date-time",
              "enum"
            ]
          }
''',
    '''          valueType: {
            type: "string",
            enum: [
              "string",
              "text",
              "number",
              "integer",
              "boolean",
              "date",
              "date-time",
              "enum"
            ]
          },
          sensitivity: {
            type: "string",
            enum: ["public", "internal", "personal", "restricted"]
          },
          aliases: {
            type: "array",
            maxItems: 100,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 160 }
          },
          enumValues: {
            type: "array",
            maxItems: 500,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 160 }
          },
          allowCustom: { type: "boolean" }
''',
)
replace_once(
    "apps/api/src/data-import-routes.ts",
    "  registry: DataImportRegistry = dataImportRegistryFromSpaceRegistry(spaces)",
    "  registry: AssistedDataImportRegistry = assistedDataImportRegistryFromSpaceRegistry(spaces)",
)

# Serve and syntax-check the two UI extensions in the same combined modules used by browsers.
replace_once(
    "apps/api/src/ui-routes.ts",
    '      "template-field.css",\n      "template-trial.css",',
    '      "template-field.css",\n      "template-repeat-assistant.css",\n      "template-trial.css",',
)
replace_once(
    "apps/api/src/ui-routes.ts",
    '      "bulk-data-import.css",\n      "operation-center.css",',
    '      "bulk-data-import.css",\n      "bulk-data-import-v2.css",\n      "operation-center.css",',
)
replace_once(
    "apps/api/src/ui-routes.ts",
    '      "document-structure.js",\n      "template-trial.js",',
    '      "document-structure.js",\n      "template-repeat-assistant.js",\n      "template-trial.js",',
)
replace_once(
    "apps/api/src/ui-routes.ts",
    '      "bulk-data-import.js",\n      "operation-center.js",',
    '      "bulk-data-import.js",\n      "bulk-data-import-v2.js",\n      "operation-center.js",',
)
replace_once(
    "scripts/ci/check-ui-bundles.mjs",
    '    "document-structure.js",\n    "template-trial.js",',
    '    "document-structure.js",\n    "template-repeat-assistant.js",\n    "template-trial.js",',
)
replace_once(
    "scripts/ci/check-ui-bundles.mjs",
    '    "bulk-data-import.js",\n    "operation-center.js",',
    '    "bulk-data-import.js",\n    "bulk-data-import-v2.js",\n    "operation-center.js",',
)

package_path = ROOT / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))
check_ui = package["scripts"]["check:ui"]
check_ui = check_ui.replace(
    "node --check apps/api/ui/document-structure.js &&",
    "node --check apps/api/ui/document-structure.js && node --check apps/api/ui/template-repeat-assistant.js &&",
)
check_ui = check_ui.replace(
    "node --check apps/api/ui/bulk-data-import.js &&",
    "node --check apps/api/ui/bulk-data-import.js && node --check apps/api/ui/bulk-data-import-v2.js &&",
)
package["scripts"]["check:ui"] = check_ui
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("updated package.json")

# A stored enum is text at rendering time. Support it through draft, trial, release and generation layers.
replace_once(
    "packages/template-compiler/src/scalar-formatter.ts",
    '  | "text"\n  | "number"',
    '  | "text"\n  | "enum"\n  | "number"',
)
replace_once(
    "packages/template-compiler/src/scalar-formatter.ts",
    '  if (valueType === "string" || valueType === "text") {',
    '  if (valueType === "string" || valueType === "text" || valueType === "enum") {',
)
replace_once(
    "packages/template-compiler/src/scalar-formatter.ts",
    '    if (valueType !== "string" && valueType !== "text") {\n      return formatterError("Текстовый формат не соответствует типу поля.");',
    '    if (valueType !== "string" && valueType !== "text" && valueType !== "enum") {\n      return formatterError("Текстовый формат не соответствует типу поля.");',
)
replace_once(
    "packages/template-compiler/src/scalar-render.ts",
    '  if (valueType === "string") {',
    '  if (valueType === "string" || valueType === "enum") {',
)
replace_once(
    "packages/storage/src/template-drafts.ts",
    '  | "text"\n  | "number"',
    '  | "text"\n  | "enum"\n  | "number"',
)
replace_once(
    "packages/storage/src/template-drafts.ts",
    '    value === "text" ||\n    value === "number" ||',
    '    value === "text" ||\n    value === "enum" ||\n    value === "number" ||',
)
replace_once(
    "packages/storage/src/document-generation.ts",
    '  | "text"\n  | "number"',
    '  | "text"\n  | "enum"\n  | "number"',
)
replace_once(
    "packages/storage/src/document-generation.ts",
    '    value === "text" ||\n    value === "number" ||',
    '    value === "text" ||\n    value === "enum" ||\n    value === "number" ||',
)
replace_once(
    "packages/storage/src/document-preflight.ts",
    '    value === "text" ||\n    value === "number" ||',
    '    value === "text" ||\n    value === "enum" ||\n    value === "number" ||',
)
replace_once(
    "packages/storage/src/multi-field-test-versions.ts",
    '  | "text"\n  | "number"',
    '  | "text"\n  | "enum"\n  | "number"',
)
replace_once(
    "packages/storage/src/multi-field-test-versions.ts",
    '    value === "text" ||\n    value === "number" ||',
    '    value === "text" ||\n    value === "enum" ||\n    value === "number" ||',
)
replace_once(
    "apps/api/src/template-draft-routes.ts",
    '    | "text"\n    | "number"',
    '    | "text"\n    | "enum"\n    | "number"',
)
replace_once(
    "apps/api/src/template-draft-routes.ts",
    '              enum: ["string", "text", "number", "integer", "boolean", "date", "date-time"]',
    '              enum: ["string", "text", "enum", "number", "integer", "boolean", "date", "date-time"]',
)
replace_once(
    "apps/api/ui/document-structure.js",
    '    ["text", "Длинный текст"],\n    ["number", "Число"],',
    '    ["text", "Длинный текст"],\n    ["enum", "Список вариантов"],\n    ["number", "Число"],',
)
replace_once(
    "apps/api/ui/document-structure.js",
    '      text: "Длинный текст",\n      number: "Число",',
    '      text: "Длинный текст",\n      enum: "Список вариантов",\n      number: "Число",',
)
replace_once(
    "apps/api/ui/template-trial.js",
    '    text: "Длинный текст",\n    number: "Число",',
    '    text: "Длинный текст",\n    enum: "Список вариантов",\n    number: "Число",',
)
replace_once(
    "apps/api/ui/template-multi-trial.js",
    '      text: "Длинный текст",\n      number: "Число",',
    '      text: "Длинный текст",\n      enum: "Список вариантов",\n      number: "Число",',
)
replace_once(
    "apps/api/ui/template-multi-trial.js",
    '  return `<input id="${multiTrialEscape(identifier)}" data-field-id="${multiTrialEscape(field.id)}" data-value-type="string" type="text" maxlength="4000" ${field.required ? "required" : ""} placeholder="Введите значение" />`;',
    '  return `<input id="${multiTrialEscape(identifier)}" data-field-id="${multiTrialEscape(field.id)}" data-value-type="${multiTrialEscape(field.valueType)}" type="text" maxlength="4000" ${field.required ? "required" : ""} placeholder="Введите значение" />`;',
)

# Add enum-aware quick correction inputs using the property definition already loaded by this screen.
replace_once(
    "apps/api/ui/document-data-correction.js",
    '''function generationCorrectionInput(type, identifier) {
  const escaped = generationEscape(identifier);
  if (type === "boolean") {''',
    '''function generationCorrectionInput(type, identifier, definition = null) {
  const escaped = generationEscape(identifier);
  if (type === "enum") {
    const validation = definition?.validation && typeof definition.validation === "object" && !Array.isArray(definition.validation)
      ? definition.validation
      : {};
    const options = Array.isArray(validation.enum)
      ? validation.enum.filter((value) => typeof value === "string")
      : [];
    if (validation.allowCustom === false) {
      return `<select id="${escaped}" data-correction-value><option value="">Выберите</option>${options.map((value) => `<option value="${generationEscape(value)}">${generationEscape(value)}</option>`).join("")}</select>`;
    }
    const listId = `${escaped}_options`;
    return `<input id="${escaped}" data-correction-value type="text" maxlength="4000" list="${listId}" placeholder="Введите или выберите значение" /><datalist id="${listId}">${options.map((value) => `<option value="${generationEscape(value)}"></option>`).join("")}</datalist>`;
  }
  if (type === "boolean") {''',
)
replace_once(
    "apps/api/ui/document-data-correction.js",
    '                  ${generationCorrectionInput(row.valueType, identifier)}',
    '                  ${generationCorrectionInput(row.valueType, identifier, generationPropertyDefinition(row.fieldKey))}',
)

# Build a deterministic six-cell Word table fixture for the browser wizard test.
replace_once(
    "tests/e2e/fixtures/docomator-api.mjs",
    "function structureReport(fileName, repeatTemplate = false) {",
    "function structureReport(fileName, repeatTemplate = false, studentRosterTemplate = false) {",
)
replace_once(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''  if (format === "xlsx") {
    return {''',
    '''  if (format === "docx" && studentRosterTemplate) {
    const labels = ["ФИО студента", "Тема научной работы", "Научный руководитель"];
    const elements = [
      ...labels.map((text, columnIndex) => ({
        id: `word/document.xml#paragraph:header-${columnIndex + 1}`,
        kind: "paragraph",
        part: "word/document.xml",
        index: columnIndex,
        text,
        runsTruncated: false,
        tableLocation: { tableIndex: 0, rowIndex: 0, columnIndex }
      })),
      ...labels.map((_text, columnIndex) => ({
        id: `word/document.xml#paragraph:data-${columnIndex + 1}`,
        kind: "paragraph",
        part: "word/document.xml",
        index: labels.length + columnIndex,
        text: "",
        runsTruncated: false,
        tableLocation: { tableIndex: 0, rowIndex: 1, columnIndex }
      }))
    ];
    return {
      ...common,
      summary: {
        paragraphs: elements.length,
        runs: elements.length,
        partsRead: 1,
        shownElements: elements.length,
        totalElements: elements.length
      },
      elements
    };
  }
  if (format === "xlsx") {
    return {''',
)
value = read("tests/e2e/fixtures/docomator-api.mjs")
updated, count = re.subn(
    r"(structureReport\(\n\s*url\.searchParams\.get\(\"fileName\"\) \|\| state\.inspectedFileName,\n\s*state\.repeatTemplate)(\n\s*\))",
    r"\1,\n        state.studentRosterTemplate\2",
    value,
)
if count != 1:
    raise RuntimeError(f"fixture direct analyze structure call: expected 1, found {count}")
updated, count = re.subn(
    r"(structureReport\(\n\s*source\?\.fileName \|\| state\.inspectedFileName,\n\s*state\.repeatTemplate)(\n\s*\))",
    r"\1,\n        state.studentRosterTemplate\2",
    updated,
)
if count != 1:
    raise RuntimeError(f"fixture draft structure call: expected 1, found {count}")
write("tests/e2e/fixtures/docomator-api.mjs", updated)
replace_once(
    "tests/e2e/fixtures/docomator-api.mjs",
    "    repeatTemplate: Boolean(options.repeatTemplate)\n",
    "    repeatTemplate: Boolean(options.repeatTemplate),\n    studentRosterTemplate: Boolean(options.studentRosterTemplate)\n",
)

# Fix the exact UI regression assertions and an inference regexp.
replace_once(
    "tests/e2e/assisted-import.spec.mjs",
    '''  await expect(positionRow.locator("[data-bulk-enum-values]")).toContainText(
    /Инженер|Аналитик/u
  );''',
    '''  await expect(positionRow.locator("[data-bulk-enum-values]")).toHaveValue(
    /Инженер|Аналитик/u
  );''',
)
replace_once(
    "apps/api/ui/bulk-data-import-v2.js",
    '!/[номер|паспорт|телефон|снилс|инн]/u.test(normalized)',
    '!/номер|паспорт|телефон|снилс|инн/u.test(normalized)',
)

# Register the new guide in the documentation index.
replace_once(
    "docs/README.md",
    '| [ARCHITECTURE.md](ARCHITECTURE.md) | компоненты, потоки, границы и модель данных |\n',
    '| [ARCHITECTURE.md](ARCHITECTURE.md) | компоненты, потоки, границы и модель данных |\n| [IMPORT_AND_WORD_ROSTERS.md](IMPORT_AND_WORD_ROSTERS.md) | импорт людей и полей, вставка таблиц, группы и повторяемые строки Word |\n',
)

print("assisted import and Word roster integration applied")
