import {
  DataImportRegistry,
  DataImportValidationError,
  type DataImportPlanRecord,
  type DataImportPropertyMapping,
  type DataImportRunRecord,
  type ExecuteDataImportInput
} from "./data-import.js";
import { SqliteStore } from "./database.js";
import { toJsonValue, type JsonValue } from "./json.js";
import {
  KnowledgeConflictError,
  KnowledgeRegistry,
  type MutationContext,
  type PropertyDefinitionRecord,
  type PropertySensitivity
} from "./knowledge.js";
import { OperatorAssistRegistry } from "./operator-assist.js";
import { SpaceRegistry } from "./spaces.js";

export interface AssistedDataImportPropertyMapping
  extends DataImportPropertyMapping {
  sensitivity?: PropertySensitivity;
  aliases?: readonly string[];
  enumValues?: readonly string[];
  allowCustom?: boolean;
}

export interface AssistedExecuteDataImportInput
  extends Omit<ExecuteDataImportInput, "mappings"> {
  mappings: readonly AssistedDataImportPropertyMapping[];
}

export interface AssistedDataImportMappingResolution {
  column: string;
  propertyKey: string;
  propertyLabel: string;
  valueType: string;
  sensitivity: PropertySensitivity;
  created: boolean;
  matchedBy: "key" | "label" | "created";
  aliasesAdded: string[];
  optionCount: number | null;
  allowCustom: boolean | null;
}

export interface AssistedDataImportPlanRecord extends DataImportPlanRecord {
  mappingResolutions: AssistedDataImportMappingResolution[];
}

export interface AssistedDataImportRunRecord extends DataImportRunRecord {
  mappingResolutions: AssistedDataImportMappingResolution[];
}

interface PreparedAssistedImport {
  input: ExecuteDataImportInput;
  mappingResolutions: AssistedDataImportMappingResolution[];
}

class AssistedDataImportPlanRollback extends Error {
  override readonly name = "AssistedDataImportPlanRollback";

  constructor(readonly result: AssistedDataImportRunRecord) {
    super("assisted data import plan rollback");
  }
}

function normalizedText(value: string, label: string, maximum = 500): string {
  if (typeof value !== "string") {
    throw new DataImportValidationError(`Поле «${label}» должно содержать текст.`);
  }
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new DataImportValidationError(`Поле «${label}» заполнено некорректно.`);
  }
  return normalized;
}

function normalizeIdentity(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function normalizeList(
  values: readonly string[] | undefined,
  label: string,
  maximumItems = 500
): string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > maximumItems) {
    throw new DataImportValidationError(`Список «${label}» имеет недопустимый размер.`);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizedText(value, label, 160);
    const identity = normalizeIdentity(normalized);
    if (!seen.has(identity)) {
      seen.add(identity);
      result.push(normalized);
    }
  }
  return result;
}

function validationObject(value: JsonValue): Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : {};
}

function configuredEnumValues(definition: PropertyDefinitionRecord): string[] {
  if (definition.valueType !== "enum") return [];
  const raw = validationObject(definition.validation).enum;
  return Array.isArray(raw) && raw.every((item) => typeof item === "string")
    ? normalizeList(raw as string[], "варианты списка")
    : [];
}

function configuredAllowCustom(definition: PropertyDefinitionRecord): boolean {
  if (definition.valueType !== "enum") return false;
  const raw = validationObject(definition.validation).allowCustom;
  return typeof raw === "boolean" ? raw : true;
}

function importedColumnValues(
  rows: readonly Record<string, string>[],
  column: string
): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const raw = String(row[column] ?? "").normalize("NFKC").trim();
    if (raw.length === 0) continue;
    if (raw.length > 160) {
      throw new DataImportValidationError(
        `В колонке «${column}» найден вариант списка длиннее 160 знаков.`
      );
    }
    const identity = normalizeIdentity(raw);
    if (!seen.has(identity)) {
      seen.add(identity);
      values.push(raw);
    }
    if (values.length > 500) {
      throw new DataImportValidationError(
        `В колонке «${column}» больше 500 разных вариантов. Используйте текстовое поле.`
      );
    }
  }
  return values;
}

function mergeTextLists(...lists: readonly string[][]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const value of list) {
      const identity = normalizeIdentity(value);
      if (!seen.has(identity)) {
        seen.add(identity);
        result.push(value);
      }
    }
  }
  return result;
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function planFromRun(result: AssistedDataImportRunRecord): AssistedDataImportPlanRecord {
  return {
    rowCount: result.rowCount,
    createdCount: result.createdCount,
    updatedCount: result.updatedCount,
    unchangedCount: result.unchangedCount,
    skippedCount: result.skippedCount,
    failedCount: result.failedCount,
    propertyValueCount: result.propertyValueCount,
    state: result.state,
    errors: result.errors,
    mappingResolutions: result.mappingResolutions
  };
}

export class AssistedDataImportRegistry {
  private readonly imports: DataImportRegistry;
  private readonly knowledge: KnowledgeRegistry;
  private readonly operator: OperatorAssistRegistry;

  constructor(
    private readonly store: SqliteStore,
    options: {
      spaces?: SpaceRegistry;
      knowledge?: KnowledgeRegistry;
      imports?: DataImportRegistry;
      operator?: OperatorAssistRegistry;
    } = {}
  ) {
    const spaces = options.spaces ?? new SpaceRegistry(store);
    this.knowledge = options.knowledge ?? new KnowledgeRegistry(store);
    this.imports =
      options.imports ??
      new DataImportRegistry(store, { spaces, knowledge: this.knowledge });
    this.operator = options.operator ?? new OperatorAssistRegistry(store);
  }

  list(spaceIdentity: string, limitValue = 50): DataImportRunRecord[] {
    return this.imports.list(spaceIdentity, limitValue);
  }

  plan(
    spaceIdentity: string,
    input: AssistedExecuteDataImportInput,
    context: MutationContext
  ): AssistedDataImportPlanRecord {
    try {
      this.store.transaction(() => {
        const prepared = this.prepare(input, context);
        const result = this.imports.execute(spaceIdentity, prepared.input, context);
        throw new AssistedDataImportPlanRollback({
          ...result,
          mappingResolutions: prepared.mappingResolutions
        });
      });
    } catch (error) {
      if (error instanceof AssistedDataImportPlanRollback) {
        return planFromRun(error.result);
      }
      throw error;
    }
    throw new Error("Предварительный расчёт расширенного импорта не завершён.");
  }

  execute(
    spaceIdentity: string,
    input: AssistedExecuteDataImportInput,
    context: MutationContext
  ): AssistedDataImportRunRecord {
    return this.store.transaction(() => {
      const prepared = this.prepare(input, context);
      const result = this.imports.execute(spaceIdentity, prepared.input, context);
      return { ...result, mappingResolutions: prepared.mappingResolutions };
    });
  }

  private prepare(
    input: AssistedExecuteDataImportInput,
    context: MutationContext
  ): PreparedAssistedImport {
    const definitions = this.knowledge.listPropertyDefinitions(500);
    const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
    const byLabel = new Map<string, PropertyDefinitionRecord[]>();
    for (const definition of definitions) {
      const key = normalizeIdentity(definition.label);
      const list = byLabel.get(key) ?? [];
      list.push(definition);
      byLabel.set(key, list);
    }

    const preparedMappings: DataImportPropertyMapping[] = [];
    const resolutions: AssistedDataImportMappingResolution[] = [];

    for (const source of input.mappings) {
      const column = normalizedText(source.column, "колонка", 300);
      const requestedLabel = source.label?.trim() || column;
      let definition: PropertyDefinitionRecord | undefined;
      let matchedBy: AssistedDataImportMappingResolution["matchedBy"] = "created";
      let created = false;

      if (source.propertyKey !== undefined) {
        definition = byKey.get(source.propertyKey.trim().toLowerCase());
        matchedBy = "key";
      } else {
        const matches = byLabel.get(normalizeIdentity(requestedLabel)) ?? [];
        if (matches.length > 1) {
          throw new KnowledgeConflictError(
            `Найдено несколько полей с названием «${requestedLabel}». Выберите конкретное поле.`
          );
        }
        definition = matches[0];
        if (definition !== undefined) matchedBy = "label";
      }

      if (definition === undefined) {
        if (!source.createIfMissing) {
          preparedMappings.push({
            column,
            ...(source.propertyKey === undefined
              ? {}
              : { propertyKey: source.propertyKey }),
            createIfMissing: false,
            ...(source.label === undefined ? {} : { label: source.label }),
            ...(source.valueType === undefined
              ? {}
              : { valueType: source.valueType })
          });
          continue;
        }
        const valueType = source.valueType?.trim() || "string";
        const aliases = mergeTextLists(
          normalizeList(source.aliases, "другие названия", 100),
          normalizeIdentity(column) === normalizeIdentity(requestedLabel) ? [] : [column]
        );
        const enumValues =
          valueType === "enum"
            ? mergeTextLists(
                normalizeList(source.enumValues, "варианты списка"),
                importedColumnValues(input.rows, column)
              )
            : [];
        const allowCustom = valueType === "enum" ? source.allowCustom !== false : null;
        definition = this.knowledge.createPropertyDefinition(
          {
            label: requestedLabel,
            valueType,
            sensitivity: source.sensitivity ?? "personal",
            appliesTo: [input.entityTypeKey ?? "person"],
            aliases,
            validation:
              valueType === "enum"
                ? toJsonValue({ enum: enumValues, allowCustom })
                : toJsonValue({})
          },
          context
        );
        definitions.push(definition);
        byKey.set(definition.key, definition);
        byLabel.set(normalizeIdentity(definition.label), [definition]);
        created = true;
        matchedBy = "created";
      } else {
        if (
          source.valueType !== undefined &&
          source.valueType.trim().length > 0 &&
          source.valueType !== definition.valueType
        ) {
          throw new DataImportValidationError(
            `Колонка «${column}» сопоставлена с полем «${definition.label}» другого типа.`
          );
        }
        definition = this.enrichExistingDefinition(
          definition,
          source,
          column,
          input.rows,
          context
        );
        byKey.set(definition.key, definition);
      }

      preparedMappings.push({ column, propertyKey: definition.key });
      const aliasesAdded = definition.aliases.filter(
        (alias) =>
          !definitions
            .find((candidate) => candidate.key === definition?.key)
            ?.aliases.includes(alias)
      );
      resolutions.push({
        column,
        propertyKey: definition.key,
        propertyLabel: definition.label,
        valueType: definition.valueType,
        sensitivity: definition.sensitivity,
        created,
        matchedBy,
        aliasesAdded,
        optionCount:
          definition.valueType === "enum"
            ? configuredEnumValues(definition).length
            : null,
        allowCustom:
          definition.valueType === "enum"
            ? configuredAllowCustom(definition)
            : null
      });
    }

    const preparedInput: ExecuteDataImportInput = {
      fileName: input.fileName,
      fileFormat: input.fileFormat,
      sourceSha256: input.sourceSha256,
      identityColumn: input.identityColumn,
      displayNameColumn: input.displayNameColumn,
      headers: input.headers,
      rows: input.rows,
      mappings: preparedMappings,
      ...(input.entityTypeKey === undefined
        ? {}
        : { entityTypeKey: input.entityTypeKey }),
      ...(input.identityPropertyKey === undefined
        ? {}
        : { identityPropertyKey: input.identityPropertyKey }),
      ...(input.group === undefined ? {} : { group: input.group })
    };
    return { input: preparedInput, mappingResolutions: resolutions };
  }

  private enrichExistingDefinition(
    current: PropertyDefinitionRecord,
    mapping: AssistedDataImportPropertyMapping,
    column: string,
    rows: readonly Record<string, string>[],
    context: MutationContext
  ): PropertyDefinitionRecord {
    const requestedAliases = mergeTextLists(
      current.aliases,
      normalizeList(mapping.aliases, "другие названия", 100),
      normalizeIdentity(column) === normalizeIdentity(current.label) ? [] : [column]
    );
    const update: {
      sensitivity?: PropertySensitivity;
      aliases?: string[];
      validation?: JsonValue;
    } = {};
    if (mapping.sensitivity !== undefined && mapping.sensitivity !== current.sensitivity) {
      update.sensitivity = mapping.sensitivity;
    }
    if (!sameStringList(requestedAliases, current.aliases)) {
      update.aliases = requestedAliases;
    }

    if (current.valueType === "enum") {
      const currentValidation = validationObject(current.validation);
      const currentOptions = configuredEnumValues(current);
      const allowCustom =
        mapping.allowCustom ?? configuredAllowCustom(current);
      const requested = normalizeList(mapping.enumValues, "варианты списка");
      const discovered = allowCustom ? importedColumnValues(rows, column) : [];
      const merged = mergeTextLists(currentOptions, requested, discovered);
      if (
        !sameStringList(merged, currentOptions) ||
        currentValidation.allowCustom !== allowCustom
      ) {
        update.validation = toJsonValue({
          ...currentValidation,
          enum: merged,
          allowCustom
        });
      }
    } else if (
      mapping.enumValues !== undefined ||
      mapping.allowCustom !== undefined
    ) {
      throw new DataImportValidationError(
        `Настройки списка вариантов нельзя применить к полю «${current.label}».`
      );
    }

    return Object.keys(update).length === 0
      ? current
      : this.operator.updatePropertyDefinition(current.key, update, context);
  }
}
