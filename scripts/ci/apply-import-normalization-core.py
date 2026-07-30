from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(relative: str, old: str, new: str) -> None:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{relative}: ожидалось одно вхождение, найдено {count}: {old[:140]!r}")
    path.write_text(value.replace(old, new, 1), encoding="utf-8")
    print(f"updated {relative}")


# ---------------------------------------------------------------------------
# Storage import contract and deterministic normalization.
# ---------------------------------------------------------------------------
replace_once(
    "packages/storage/src/data-import.ts",
    'import { generateOpaqueStableKey } from "./knowledge.js";\n',
    '''import { generateOpaqueStableKey } from "./knowledge.js";
import {
  canonicalEnumImportValue,
  caseInsensitiveImportKey,
  equalImportValues,
  normalizeImportPersonDisplayName,
  transformedPersonNameValue,
  type DataImportPersonNameOptions,
  type DataImportValueTransform
} from "./data-import-normalization.js";
'''
)
replace_once(
    "packages/storage/src/data-import.ts",
    '''  label?: string;
  valueType?: string;
}''',
    '''  label?: string;
  valueType?: string;
  caseInsensitive?: boolean;
  transform?: DataImportValueTransform;
}'''
)
replace_once(
    "packages/storage/src/data-import.ts",
    '''  headers: readonly string[];
  rows: readonly Record<string, string>[];
  mappings: readonly DataImportPropertyMapping[];''',
    '''  headers: readonly string[];
  rows: readonly Record<string, string>[];
  sourceRowNumbers?: readonly number[];
  identityCaseInsensitive?: boolean;
  personName?: DataImportPersonNameOptions;
  mappings: readonly DataImportPropertyMapping[];'''
)
replace_once(
    "packages/storage/src/data-import.ts",
    '''interface PreparedMapping {
  column: string;
  property: PropertyDefinitionRecord;
}''',
    '''interface PreparedMapping {
  column: string;
  property: PropertyDefinitionRecord;
  caseInsensitive: boolean;
  transform?: DataImportValueTransform;
}'''
)
replace_once(
    "packages/storage/src/data-import.ts",
    '''  rowNumber: number;
  externalKey: string;
  displayName: string;
  values: Array<{ property: PropertyDefinitionRecord; value: unknown }>;
}''',
    '''  rowNumber: number;
  externalKey: string;
  lookupKey: string;
  displayName: string;
  values: Array<{
    property: PropertyDefinitionRecord;
    value: unknown;
    caseInsensitive: boolean;
  }>;
}'''
)
replace_once(
    "packages/storage/src/data-import.ts",
    '''interface ImportKeyRow {
  entity_id: string;
}''',
    '''interface ImportKeyRow {
  entity_id: string;
  external_key?: string;
  value_text?: string | null;
}'''
)
replace_once(
    "packages/storage/src/data-import.ts",
    '''function convertValue(property: PropertyDefinitionRecord, raw: string): unknown {
  switch (property.valueType) {
    case "string":
    case "text":
    case "enum":
      return raw;''',
    '''function propertyEnumValues(property: PropertyDefinitionRecord): string[] {
  if (
    property.validation === null ||
    Array.isArray(property.validation) ||
    typeof property.validation !== "object"
  ) {
    return [];
  }
  const values = property.validation["enum"];
  return Array.isArray(values) && values.every((value) => typeof value === "string")
    ? values
    : [];
}

function convertValue(
  property: PropertyDefinitionRecord,
  raw: string,
  caseInsensitive: boolean
): unknown {
  switch (property.valueType) {
    case "string":
    case "text":
      return raw;
    case "enum":
      return canonicalEnumImportValue(
        raw,
        propertyEnumValues(property),
        caseInsensitive
      );'''
)
replace_once(
    "packages/storage/src/data-import.ts",
    '''function currentPropertyValue(
  store: SqliteStore,
  entityId: string,
  propertyId: string
): string | null {''',
    '''function currentPropertyValue(
  store: SqliteStore,
  entityId: string,
  propertyId: string
): unknown | undefined {'''
)
replace_once(
    "packages/storage/src/data-import.ts",
    '''    return row?.value_json ?? null;
  });
}''',
    '''    return row === undefined ? undefined : JSON.parse(row.value_json);
  });
}

function normalizeSourceRowNumbers(
  values: readonly number[] | undefined,
  rowCount: number
): number[] {
  if (values === undefined) {
    return Array.from({ length: rowCount }, (_item, index) => index + 2);
  }
  if (!Array.isArray(values) || values.length !== rowCount) {
    throw new DataImportValidationError(
      "Номера исходных строк не соответствуют строкам предварительного просмотра."
    );
  }
  return values.map((value, index) => {
    if (!Number.isInteger(value) || value < 1 || value > 1_048_576) {
      throw new DataImportValidationError(
        `Номер исходной строки ${index + 1} заполнен некорректно.`
      );
    }
    return value;
  });
}'''
)
replace_once(
    "packages/storage/src/data-import.ts",
    '''    const rows = normalizeRows(input.rows, headers);
    const identityColumn = requiredText(input.identityColumn, "identityColumn", 300);''',
    '''    const rows = normalizeRows(input.rows, headers);
    const sourceRowNumbers = normalizeSourceRowNumbers(
      input.sourceRowNumbers,
      rows.length
    );
    const identityCaseInsensitive = input.identityCaseInsensitive === true;
    if (input.personName !== undefined && entityTypeKey !== "person") {
      throw new DataImportValidationError(
        "Нормализация и разделение ФИО доступны только для типа «Человек»."
      );
    }
    const identityColumn = requiredText(input.identityColumn, "identityColumn", 300);'''
)
replace_once(
    "packages/storage/src/data-import.ts",
    '''      preparedMappings.push({ column, property });''',
    '''      preparedMappings.push({
        column,
        property,
        caseInsensitive: mappingInput.caseInsensitive === true,
        ...(mappingInput.transform === undefined
          ? {}
          : { transform: mappingInput.transform })
      });'''
)
replace_once(
    "packages/storage/src/data-import.ts",
    '''      preparedMappings.unshift({
        column: identityColumn,
        property: identityProperty
      });''',
    '''      preparedMappings.unshift({
        column: identityColumn,
        property: identityProperty,
        caseInsensitive: identityCaseInsensitive
      });'''
)
old_rows = '''    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const externalKey = (row[identityColumn] ?? "").trim();
      const displayName = (row[displayNameColumn] ?? "").trim();
      if (Object.values(row).every((value) => value.length === 0)) {
        skippedCount += 1;
        return;
      }
      if (externalKey.length === 0 || displayName.length === 0) {
        errors.push({
          rowNumber,
          externalKey: externalKey || null,
          message:
            externalKey.length === 0
              ? `Не заполнена колонка «${identityColumn}», выбранная для поиска объекта.`
              : `Не заполнена колонка «${displayNameColumn}» с отображаемым названием объекта.`
        });
        return;
      }
      if (seenExternalKeys.has(externalKey)) {
        errors.push({
          rowNumber,
          externalKey,
          message: `Значение «${externalKey}» в колонке «${identityColumn}» повторяется внутри файла.`
        });
        return;
      }
      seenExternalKeys.add(externalKey);
      try {
        const values = preparedMappings.flatMap(({ column, property }) => {
          const raw = (row[column] ?? "").trim();
          if (raw.length === 0) return [];
          return [{ property, value: convertValue(property, raw) }];
        });
        preparedRows.push({ rowNumber, externalKey, displayName, values });
      } catch (error) {
        errors.push({
          rowNumber,
          externalKey,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });'''
new_rows = '''    rows.forEach((row, index) => {
      const rowNumber = sourceRowNumbers[index] ?? index + 2;
      const externalKey = (row[identityColumn] ?? "").trim();
      const sourceDisplayName = (row[displayNameColumn] ?? "").trim();
      if (Object.values(row).every((value) => value.length === 0)) {
        skippedCount += 1;
        return;
      }
      if (externalKey.length === 0 || sourceDisplayName.length === 0) {
        errors.push({
          rowNumber,
          externalKey: externalKey || null,
          message:
            externalKey.length === 0
              ? `Не заполнена колонка «${identityColumn}», выбранная для поиска объекта.`
              : `Не заполнена колонка «${displayNameColumn}» с отображаемым названием объекта.`
        });
        return;
      }
      const lookupKey = identityCaseInsensitive
        ? caseInsensitiveImportKey(externalKey)
        : externalKey;
      if (seenExternalKeys.has(lookupKey)) {
        errors.push({
          rowNumber,
          externalKey,
          message: `Значение «${externalKey}» в колонке «${identityColumn}» повторяется внутри файла с учётом выбранной нормализации.`
        });
        return;
      }
      seenExternalKeys.add(lookupKey);
      try {
        const displayName = entityTypeKey === "person"
          ? normalizeImportPersonDisplayName(sourceDisplayName, input.personName)
          : sourceDisplayName;
        const values = preparedMappings.flatMap((mapping) => {
          let raw = (row[mapping.column] ?? "").trim();
          if (mapping.transform !== undefined) {
            raw = transformedPersonNameValue(
              raw,
              mapping.transform,
              input.personName
            );
          }
          if (raw.length === 0) return [];
          return [{
            property: mapping.property,
            value: convertValue(
              mapping.property,
              raw,
              mapping.caseInsensitive
            ),
            caseInsensitive: mapping.caseInsensitive
          }];
        });
        preparedRows.push({
          rowNumber,
          externalKey,
          lookupKey,
          displayName,
          values
        });
      } catch (error) {
        errors.push({
          rowNumber,
          externalKey,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });'''
replace_once("packages/storage/src/data-import.ts", old_rows, new_rows)
old_lookup = '''          let entityId = this.store.execute((connection) => {
            const keyRow = connection
              .prepare(`
                SELECT entity_id
                FROM entity_import_keys
                WHERE space_id = ? AND entity_type_id = ? AND external_key = ?
              `)
              .get(space.id, entityType.id, row.externalKey) as
              | ImportKeyRow
              | undefined;
            if (keyRow !== undefined) return keyRow.entity_id;
            if (!hasExplicitIdentityProperty) return null;

            const matches = connection
              .prepare(`
                SELECT DISTINCT e.id AS entity_id
                FROM entities e
                JOIN space_entity_ownership seo ON seo.entity_id = e.id
                JOIN entity_property_values v ON v.entity_id = e.id
                JOIN property_definitions p ON p.id = v.property_definition_id
                JOIN (
                  SELECT entity_id, property_definition_id, MAX(version) AS max_version
                  FROM entity_property_values
                  GROUP BY entity_id, property_definition_id
                ) latest
                  ON latest.entity_id = v.entity_id
                 AND latest.property_definition_id = v.property_definition_id
                 AND latest.max_version = v.version
                WHERE seo.space_id = ?
                  AND e.entity_type_id = ?
                  AND p.key = ?
                  AND v.value_text = ?
                LIMIT 2
              `)
              .all(
                space.id,
                entityType.id,
                identityPropertyKey,
                row.externalKey
              ) as unknown as ImportKeyRow[];
            if (matches.length > 1) {
              throw new DataImportConflictError(
                "Найдено несколько объектов с одинаковым значением выбранной колонки."
              );
            }
            return matches[0]?.entity_id ?? null;
          });'''
new_lookup = '''          const keyMatch = this.store.execute((connection) => {
            const exact = connection
              .prepare(`
                SELECT entity_id, external_key
                FROM entity_import_keys
                WHERE space_id = ? AND entity_type_id = ? AND external_key = ?
              `)
              .get(space.id, entityType.id, row.lookupKey) as
              | ImportKeyRow
              | undefined;
            if (exact !== undefined) {
              return { entityId: exact.entity_id, externalKey: exact.external_key ?? row.lookupKey };
            }
            if (identityCaseInsensitive) {
              const compatible = (connection
                .prepare(`
                  SELECT entity_id, external_key
                  FROM entity_import_keys
                  WHERE space_id = ? AND entity_type_id = ?
                `)
                .all(space.id, entityType.id) as unknown as ImportKeyRow[])
                .filter((candidate) =>
                  caseInsensitiveImportKey(candidate.external_key ?? "") === row.lookupKey
                );
              const entityIds = [...new Set(compatible.map((candidate) => candidate.entity_id))];
              if (entityIds.length > 1) {
                throw new DataImportConflictError(
                  "Найдено несколько объектов с одинаковым ключом после нормализации регистра."
                );
              }
              if (compatible[0] !== undefined) {
                return {
                  entityId: compatible[0].entity_id,
                  externalKey: compatible[0].external_key ?? row.lookupKey
                };
              }
            }
            if (!hasExplicitIdentityProperty) {
              return { entityId: null, externalKey: row.lookupKey };
            }

            const candidates = connection
              .prepare(`
                SELECT DISTINCT e.id AS entity_id, v.value_text
                FROM entities e
                JOIN space_entity_ownership seo ON seo.entity_id = e.id
                JOIN entity_property_values v ON v.entity_id = e.id
                JOIN property_definitions p ON p.id = v.property_definition_id
                JOIN (
                  SELECT entity_id, property_definition_id, MAX(version) AS max_version
                  FROM entity_property_values
                  GROUP BY entity_id, property_definition_id
                ) latest
                  ON latest.entity_id = v.entity_id
                 AND latest.property_definition_id = v.property_definition_id
                 AND latest.max_version = v.version
                WHERE seo.space_id = ?
                  AND e.entity_type_id = ?
                  AND p.key = ?
              `)
              .all(space.id, entityType.id, identityPropertyKey) as unknown as ImportKeyRow[];
            const matches = candidates.filter((candidate) => {
              const value = candidate.value_text ?? "";
              return identityCaseInsensitive
                ? caseInsensitiveImportKey(value) === row.lookupKey
                : value === row.externalKey;
            });
            if (new Set(matches.map((candidate) => candidate.entity_id)).size > 1) {
              throw new DataImportConflictError(
                "Найдено несколько объектов с одинаковым значением выбранной колонки."
              );
            }
            return {
              entityId: matches[0]?.entity_id ?? null,
              externalKey: row.lookupKey
            };
          });
          let entityId = keyMatch.entityId;'''
replace_once("packages/storage/src/data-import.ts", old_lookup, new_lookup)
replace_once(
    "packages/storage/src/data-import.ts",
    '''                row.externalKey,
                entityId,''',
    '''                keyMatch.externalKey,
                entityId,'''
)
replace_once(
    "packages/storage/src/data-import.ts",
    '''                  "Сотрудник, найденный по выбранной колонке, больше не существует."''',
    '''                  "Объект, найденный по выбранной колонке, больше не существует."'''
)
replace_once(
    "packages/storage/src/data-import.ts",
    '''          for (const item of row.values) {
            const encodedJson = stringifyJson(toJsonValue(item.value));
            if (
              currentPropertyValue(this.store, entityId, item.property.id) ===
              encodedJson
            ) {
              continue;
            }''',
    '''          for (const item of row.values) {
            const current = currentPropertyValue(
              this.store,
              entityId,
              item.property.id
            );
            if (
              current !== undefined &&
              equalImportValues(
                current,
                item.value,
                item.caseInsensitive
              )
            ) {
              continue;
            }'''
)
# Remove imports no longer used after decoded comparison.
replace_once(
    "packages/storage/src/data-import.ts",
    '''  KnowledgeRegistry,
  stringifyJson,
  toJsonValue,
  type MutationContext,''',
    '''  KnowledgeRegistry,
  type MutationContext,'''
)

# ---------------------------------------------------------------------------
# Assisted importer creates reusable surname/name/patronymic definitions.
# ---------------------------------------------------------------------------
replace_once(
    "packages/storage/src/data-import-assist.ts",
    '''import { SpaceRegistry } from "./spaces.js";
''',
    '''import { SpaceRegistry } from "./spaces.js";
import type { DataImportValueTransform } from "./data-import-normalization.js";
'''
)
replace_once(
    "packages/storage/src/data-import-assist.ts",
    '''            ...(source.valueType === undefined
              ? {}
              : { valueType: source.valueType })
          });''',
    '''            ...(source.valueType === undefined
              ? {}
              : { valueType: source.valueType }),
            ...(source.caseInsensitive === undefined
              ? {}
              : { caseInsensitive: source.caseInsensitive }),
            ...(source.transform === undefined
              ? {}
              : { transform: source.transform })
          });'''
)
replace_once(
    "packages/storage/src/data-import-assist.ts",
    '''      preparedMappings.push({ column, propertyKey: definition.key });''',
    '''      preparedMappings.push({
        column,
        propertyKey: definition.key,
        ...(source.caseInsensitive === undefined
          ? {}
          : { caseInsensitive: source.caseInsensitive }),
        ...(source.transform === undefined
          ? {}
          : { transform: source.transform })
      });'''
)
insert_marker = '''    const preparedInput: ExecuteDataImportInput = {
'''
insert_block = '''    if (input.personName?.split === true) {
      if (entityTypeKey !== "person") {
        throw new DataImportValidationError(
          "Разделение ФИО доступно только для типа «Человек»."
        );
      }
      const derived: Array<{
        label: string;
        transform: DataImportValueTransform;
      }> = [
        { label: "Фамилия", transform: "person-family" },
        { label: "Имя", transform: "person-given" },
        { label: "Отчество", transform: "person-patronymic" }
      ];
      for (const part of derived) {
        const matches = byLabel.get(normalizeIdentity(part.label)) ?? [];
        if (matches.length > 1) {
          throw new KnowledgeConflictError(
            `Найдено несколько полей «${part.label}». Оставьте одно поле или отключите разделение ФИО.`
          );
        }
        let definition = matches[0];
        let created = false;
        if (definition === undefined) {
          definition = this.knowledge.createPropertyDefinition(
            {
              label: part.label,
              valueType: "string",
              sensitivity: "personal",
              appliesTo: ["person"],
              aliases: [],
              validation: toJsonValue({ uiGroup: "common" })
            },
            context
          );
          definitions.push(definition);
          byKey.set(definition.key, definition);
          byLabel.set(normalizeIdentity(definition.label), [definition]);
          created = true;
        } else if (definition.valueType !== "string") {
          throw new DataImportValidationError(
            `Поле «${part.label}» должно иметь тип «Короткий текст».`
          );
        }
        if (
          preparedMappings.some(
            (mapping) => mapping.propertyKey === definition?.key
          )
        ) {
          throw new DataImportValidationError(
            `Поле «${part.label}» уже сопоставлено с другой колонкой. Отключите ручное сопоставление либо разделение ФИО.`
          );
        }
        preparedMappings.push({
          column: input.displayNameColumn,
          propertyKey: definition.key,
          caseInsensitive: true,
          transform: part.transform
        });
        resolutions.push({
          column: `${input.displayNameColumn} → ${part.label}`,
          propertyKey: definition.key,
          propertyLabel: definition.label,
          valueType: definition.valueType,
          sensitivity: definition.sensitivity,
          created,
          matchedBy: created ? "created" : "label",
          aliasesAdded: [],
          optionCount: null,
          allowCustom: null
        });
      }
    }

'''
path = ROOT / "packages/storage/src/data-import-assist.ts"
value = path.read_text(encoding="utf-8")
if value.count(insert_marker) != 1:
    raise RuntimeError("prepared input marker not found")
value = value.replace(insert_marker, insert_block + insert_marker, 1)
path.write_text(value, encoding="utf-8")
replace_once(
    "packages/storage/src/data-import-assist.ts",
    '''      rows: input.rows,
      mappings: preparedMappings,''',
    '''      rows: input.rows,
      mappings: preparedMappings,
      ...(input.sourceRowNumbers === undefined
        ? {}
        : { sourceRowNumbers: input.sourceRowNumbers }),
      ...(input.identityCaseInsensitive === undefined
        ? {}
        : { identityCaseInsensitive: input.identityCaseInsensitive }),
      ...(input.personName === undefined
        ? {}
        : { personName: input.personName }),'''
)

# ---------------------------------------------------------------------------
# HTTP contract carries stable row coordinates and normalization controls.
# ---------------------------------------------------------------------------
replace_once(
    "apps/api/src/data-import-routes.ts",
    '''  rows: Array<Record<string, string>>;
  mappings: AssistedDataImportPropertyMapping[];''',
    '''  rows: Array<Record<string, string>>;
  sourceRowNumbers?: number[];
  identityCaseInsensitive?: boolean;
  personName?: {
    normalizeCase?: boolean;
    split?: boolean;
    sourceOrder?: "family-given-patronymic" | "given-patronymic-family";
  };
  mappings: AssistedDataImportPropertyMapping[];'''
)
replace_once(
    "apps/api/src/data-import-routes.ts",
    '''    rows: body.rows
  });''',
    '''    rows: body.rows,
    sourceRowNumbers: body.sourceRowNumbers
  });'''
)
replace_once(
    "apps/api/src/data-import-routes.ts",
    '''    rows: body.rows,
    mappings: body.mappings,''',
    '''    rows: body.rows,
    mappings: body.mappings,
    ...(body.sourceRowNumbers === undefined
      ? {}
      : { sourceRowNumbers: body.sourceRowNumbers }),
    ...(body.identityCaseInsensitive === undefined
      ? {}
      : { identityCaseInsensitive: body.identityCaseInsensitive }),
    ...(body.personName === undefined
      ? {}
      : { personName: body.personName }),'''
)
replace_once(
    "apps/api/src/data-import-routes.ts",
    '''    rows: {
      type: "array",
      minItems: 1,
      maxItems: 1_000,
      items: {
        type: "object",
        additionalProperties: { type: "string", maxLength: 20_000 }
      }
    },
    mappings: {''',
    '''    rows: {
      type: "array",
      minItems: 1,
      maxItems: 1_000,
      items: {
        type: "object",
        additionalProperties: { type: "string", maxLength: 20_000 }
      }
    },
    sourceRowNumbers: {
      type: "array",
      minItems: 1,
      maxItems: 1_000,
      items: { type: "integer", minimum: 1, maximum: 1_048_576 }
    },
    identityCaseInsensitive: { type: "boolean" },
    personName: {
      type: "object",
      additionalProperties: false,
      properties: {
        normalizeCase: { type: "boolean" },
        split: { type: "boolean" },
        sourceOrder: {
          type: "string",
          enum: ["family-given-patronymic", "given-patronymic-family"]
        }
      }
    },
    mappings: {'''
)
replace_once(
    "apps/api/src/data-import-routes.ts",
    '''          allowCustom: { type: "boolean" }
        }''',
    '''          allowCustom: { type: "boolean" },
          caseInsensitive: { type: "boolean" },
          transform: {
            type: "string",
            enum: ["person-family", "person-given", "person-patronymic"]
          }
        }'''
)

print("import normalization core applied")
