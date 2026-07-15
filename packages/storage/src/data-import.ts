import { randomUUID } from "node:crypto";

import { AuditRepository } from "./audit.js";
import { SqliteStore } from "./database.js";
import {
  KnowledgeConflictError,
  KnowledgeRegistry,
  stringifyJson,
  toJsonValue,
  type MutationContext,
  type PropertyDefinitionRecord
} from "./index-internal.js";
import { SpaceRegistry, type AudienceGroupRecord } from "./spaces.js";

export type DataImportFormat = "csv" | "xlsx";

export interface DataImportPropertyMapping {
  column: string;
  propertyKey: string;
  createIfMissing?: boolean;
  label?: string;
  valueType?: string;
}

export interface DataImportGroupInput {
  key: string;
  name: string;
  description?: string | null;
}

export interface ExecuteDataImportInput {
  fileName: string;
  fileFormat: DataImportFormat;
  sourceSha256: string;
  entityTypeKey: string;
  identityColumn: string;
  displayNameColumn: string;
  identityPropertyKey: string;
  headers: readonly string[];
  rows: readonly Record<string, string>[];
  mappings: readonly DataImportPropertyMapping[];
  group?: DataImportGroupInput | null;
}

export interface DataImportRowError {
  rowNumber: number;
  externalKey: string | null;
  message: string;
}

export interface DataImportRunRecord {
  id: string;
  spaceId: string;
  entityTypeKey: string;
  fileName: string;
  fileFormat: DataImportFormat;
  sourceSha256: string;
  identityPropertyKey: string;
  rowCount: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedCount: number;
  failedCount: number;
  propertyValueCount: number;
  groupId: string | null;
  groupName: string | null;
  state: "completed" | "partial" | "failed";
  errors: DataImportRowError[];
  createdAt: string;
}

interface PreparedMapping {
  column: string;
  property: PropertyDefinitionRecord;
}

interface PreparedRow {
  rowNumber: number;
  externalKey: string;
  displayName: string;
  values: Array<{ property: PropertyDefinitionRecord; value: unknown }>;
}

interface ImportKeyRow {
  entity_id: string;
}

interface PropertyValueRow {
  value_json: string;
}

interface ImportRunRow {
  id: string;
  space_id: string;
  entity_type_key: string;
  file_name: string;
  file_format: string;
  source_sha256: string;
  identity_property_key: string;
  row_count: number;
  created_count: number;
  updated_count: number;
  unchanged_count: number;
  skipped_count: number;
  failed_count: number;
  property_value_count: number;
  group_id: string | null;
  group_name: string | null;
  state: string;
  details_json: string;
  created_at: string;
}

export class DataImportValidationError extends Error {
  override readonly name = "DataImportValidationError";
}

export class DataImportConflictError extends Error {
  override readonly name = "DataImportConflictError";
}

function requiredText(value: string, name: string, maximum = 500): string {
  if (typeof value !== "string") {
    throw new DataImportValidationError(`${name} must be a string`);
  }
  const normalized = value.normalize("NFKC").trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new DataImportValidationError(`${name} is invalid`);
  }
  return normalized;
}

function stableKey(value: string, name: string): string {
  const normalized = requiredText(value, name, 160).toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(normalized)) {
    throw new DataImportValidationError(
      `${name} must start with a letter and contain letters, digits, dots, dashes or underscores`
    );
  }
  return normalized;
}

function sha256(value: string): string {
  const normalized = requiredText(value, "sourceSha256", 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new DataImportValidationError(
      "sourceSha256 must contain 64 hexadecimal characters"
    );
  }
  return normalized;
}

function timestamp(value: Date | string | undefined): string {
  const date =
    value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DataImportValidationError("Invalid mutation timestamp");
  }
  return date.toISOString();
}

function normalizedFormat(value: string): DataImportFormat {
  if (value === "csv" || value === "xlsx") return value;
  throw new DataImportValidationError("Поддерживаются только CSV и XLSX.");
}

function normalizeHeaders(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 100) {
    throw new DataImportValidationError(
      "Импорт должен содержать от 1 до 100 колонок."
    );
  }
  const headers = values.map((value, index) =>
    requiredText(value, `headers[${index}]`, 300)
  );
  if (new Set(headers).size !== headers.length) {
    throw new DataImportValidationError(
      "Названия колонок должны быть уникальными."
    );
  }
  return headers;
}

function normalizeRows(
  values: readonly Record<string, string>[],
  headers: readonly string[]
): Record<string, string>[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 1_000) {
    throw new DataImportValidationError(
      "Один импорт должен содержать от 1 до 1000 строк."
    );
  }
  return values.map((row, rowIndex) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw new DataImportValidationError(`rows[${rowIndex}] is invalid`);
    }
    const result: Record<string, string> = {};
    for (const header of headers) {
      const raw = row[header] ?? "";
      const value = String(raw).normalize("NFKC").trim();
      if (value.length > 20_000 || /\u0000/u.test(value)) {
        throw new DataImportValidationError(
          `Значение в строке ${rowIndex + 2}, колонке «${header}» слишком велико или недопустимо.`
        );
      }
      result[header] = value;
    }
    return result;
  });
}

function parseNumber(raw: string): number {
  const normalized = raw.replace(/[\s\u00a0]/gu, "").replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    throw new DataImportValidationError(`«${raw}» не является числом.`);
  }
  return value;
}

function parseBoolean(raw: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "да", "д", "+"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "нет", "н", "-"].includes(normalized)) {
    return false;
  }
  throw new DataImportValidationError(
    `«${raw}» не распознано как значение «да/нет».`
  );
}

function parseDate(raw: string): string {
  const normalized = raw.trim();
  const russian = /^(\d{2})[.\/-](\d{2})[.\/-](\d{4})$/u.exec(normalized);
  const candidate = russian
    ? `${russian[3]}-${russian[2]}-${russian[1]}`
    : normalized;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(candidate)) {
    throw new DataImportValidationError(
      `«${raw}» не распознано как дата. Используйте ГГГГ-ММ-ДД или ДД.ММ.ГГГГ.`
    );
  }
  const date = new Date(`${candidate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== candidate) {
    throw new DataImportValidationError(`«${raw}» содержит недопустимую дату.`);
  }
  return candidate;
}

function convertValue(property: PropertyDefinitionRecord, raw: string): unknown {
  switch (property.valueType) {
    case "string":
    case "text":
    case "enum":
      return raw;
    case "number":
      return parseNumber(raw);
    case "integer": {
      const value = parseNumber(raw);
      if (!Number.isInteger(value)) {
        throw new DataImportValidationError(`«${raw}» не является целым числом.`);
      }
      return value;
    }
    case "boolean":
      return parseBoolean(raw);
    case "date":
      return parseDate(raw);
    case "date-time": {
      const value = new Date(raw);
      if (Number.isNaN(value.getTime())) {
        throw new DataImportValidationError(
          `«${raw}» не распознано как дата и время.`
        );
      }
      return value.toISOString();
    }
    default:
      throw new DataImportValidationError(
        `Свойство «${property.label}» имеет тип, который пока нельзя массово импортировать.`
      );
  }
}

function currentPropertyValue(
  store: SqliteStore,
  entityId: string,
  propertyId: string
): string | null {
  return store.execute((connection) => {
    const row = connection
      .prepare(`
        SELECT value_json
        FROM entity_property_values
        WHERE entity_id = ? AND property_definition_id = ?
        ORDER BY version DESC, created_at DESC, id DESC
        LIMIT 1
      `)
      .get(entityId, propertyId) as PropertyValueRow | undefined;
    return row?.value_json ?? null;
  });
}

function mapRun(row: ImportRunRow): DataImportRunRecord {
  const details = JSON.parse(row.details_json) as {
    errors?: DataImportRowError[];
  };
  return {
    id: row.id,
    spaceId: row.space_id,
    entityTypeKey: row.entity_type_key,
    fileName: row.file_name,
    fileFormat: normalizedFormat(row.file_format),
    sourceSha256: row.source_sha256,
    identityPropertyKey: row.identity_property_key,
    rowCount: Number(row.row_count),
    createdCount: Number(row.created_count),
    updatedCount: Number(row.updated_count),
    unchangedCount: Number(row.unchanged_count),
    skippedCount: Number(row.skipped_count),
    failedCount: Number(row.failed_count),
    propertyValueCount: Number(row.property_value_count),
    groupId: row.group_id,
    groupName: row.group_name,
    state:
      row.state === "completed" || row.state === "partial" || row.state === "failed"
        ? row.state
        : "failed",
    errors: Array.isArray(details.errors) ? details.errors : [],
    createdAt: row.created_at
  };
}

export class DataImportRegistry {
  private readonly spaces: SpaceRegistry;
  private readonly knowledge: KnowledgeRegistry;
  private readonly audit: AuditRepository;

  constructor(
    private readonly store: SqliteStore,
    options: {
      spaces?: SpaceRegistry;
      knowledge?: KnowledgeRegistry;
      audit?: AuditRepository;
    } = {}
  ) {
    this.spaces = options.spaces ?? new SpaceRegistry(store);
    this.knowledge = options.knowledge ?? new KnowledgeRegistry(store);
    this.audit = options.audit ?? new AuditRepository(store);
  }

  list(spaceIdentity: string, limitValue = 50): DataImportRunRecord[] {
    if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 200) {
      throw new DataImportValidationError("limit must be in range 1..200");
    }
    const space = this.spaces.getSpace(spaceIdentity);
    return this.store.execute((connection) => {
      const rows = connection
        .prepare(`
          SELECT r.*, et.key AS entity_type_key, g.name AS group_name
          FROM data_import_runs r
          JOIN entity_types et ON et.id = r.entity_type_id
          LEFT JOIN audience_groups g ON g.id = r.group_id
          WHERE r.space_id = ?
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT ?
        `)
        .all(space.id, limitValue) as unknown as ImportRunRow[];
      return rows.map(mapRun);
    });
  }

  execute(
    spaceIdentity: string,
    input: ExecuteDataImportInput,
    contextInput: MutationContext
  ): DataImportRunRecord {
    const space = this.spaces.getSpace(spaceIdentity);
    const fileName = requiredText(input.fileName, "fileName", 255);
    const fileFormat = normalizedFormat(input.fileFormat);
    const sourceSha256 = sha256(input.sourceSha256);
    const entityTypeKey = stableKey(input.entityTypeKey, "entityTypeKey");
    const identityPropertyKey = stableKey(
      input.identityPropertyKey,
      "identityPropertyKey"
    );
    const headers = normalizeHeaders(input.headers);
    const rows = normalizeRows(input.rows, headers);
    const identityColumn = requiredText(input.identityColumn, "identityColumn", 300);
    const displayNameColumn = requiredText(
      input.displayNameColumn,
      "displayNameColumn",
      300
    );
    if (!headers.includes(identityColumn) || !headers.includes(displayNameColumn)) {
      throw new DataImportValidationError(
        "Колонки устойчивого ключа и отображаемого имени должны присутствовать в файле."
      );
    }
    const entityType = this.knowledge.getEntityType(entityTypeKey);
    const context = {
      correlationId: requiredText(contextInput.correlationId, "correlationId", 160),
      actorType: requiredText(contextInput.actorType, "actorType", 80),
      actorId: contextInput.actorId ?? null,
      now: timestamp(contextInput.now)
    };
    const runId = randomUUID();

    const definitions = new Map(
      this.knowledge
        .listPropertyDefinitions(500)
        .map((property) => [property.key, property])
    );
    if (!definitions.has(identityPropertyKey)) {
      const identityMapping = input.mappings.find(
        (mapping) => stableKey(mapping.propertyKey, "propertyKey") === identityPropertyKey
      );
      if (!identityMapping?.createIfMissing) {
        throw new DataImportValidationError(
          "Свойство устойчивого ключа не существует. Разрешите его создание в сопоставлении колонок."
        );
      }
      const created = this.knowledge.createPropertyDefinition(
        {
          key: identityPropertyKey,
          label: identityMapping.label ?? "Устойчивый ключ импорта",
          valueType: "string",
          sensitivity: "internal",
          appliesTo: [entityTypeKey]
        },
        context
      );
      definitions.set(created.key, created);
    }

    const mappingKeys = new Set<string>();
    const preparedMappings: PreparedMapping[] = [];
    for (const mappingInput of input.mappings) {
      const column = requiredText(mappingInput.column, "mapping.column", 300);
      if (!headers.includes(column)) {
        throw new DataImportValidationError(
          `Колонка «${column}» отсутствует в файле.`
        );
      }
      const propertyKey = stableKey(mappingInput.propertyKey, "mapping.propertyKey");
      if (mappingKeys.has(propertyKey)) {
        throw new DataImportValidationError(
          `Свойство «${propertyKey}» сопоставлено более одного раза.`
        );
      }
      mappingKeys.add(propertyKey);
      let property = definitions.get(propertyKey);
      if (property === undefined) {
        if (!mappingInput.createIfMissing) {
          throw new DataImportValidationError(
            `Свойство «${propertyKey}» не существует.`
          );
        }
        try {
          property = this.knowledge.createPropertyDefinition(
            {
              key: propertyKey,
              label: mappingInput.label ?? column,
              valueType: mappingInput.valueType ?? "string",
              sensitivity: "internal",
              appliesTo: [entityTypeKey]
            },
            context
          );
        } catch (error) {
          if (!(error instanceof KnowledgeConflictError)) throw error;
          property = this.knowledge.getPropertyDefinition(propertyKey);
        }
        definitions.set(property.key, property);
      }
      if (
        property.appliesTo.length > 0 &&
        !property.appliesTo.includes(entityTypeKey)
      ) {
        throw new DataImportValidationError(
          `Свойство «${property.label}» не применяется к типу «${entityType.label}».`
        );
      }
      preparedMappings.push({ column, property });
    }

    const identityProperty = definitions.get(identityPropertyKey);
    if (identityProperty === undefined) {
      throw new DataImportValidationError(
        "Свойство устойчивого ключа не подготовлено."
      );
    }
    if (!preparedMappings.some((mapping) => mapping.property.key === identityPropertyKey)) {
      preparedMappings.unshift({
        column: identityColumn,
        property: identityProperty
      });
    }

    const seenExternalKeys = new Set<string>();
    const preparedRows: PreparedRow[] = [];
    const errors: DataImportRowError[] = [];
    let skippedCount = 0;
    rows.forEach((row, index) => {
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
              ? "Не заполнен устойчивый ключ."
              : "Не заполнено отображаемое имя."
        });
        return;
      }
      if (seenExternalKeys.has(externalKey)) {
        errors.push({
          rowNumber,
          externalKey,
          message: "Устойчивый ключ повторяется внутри файла."
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
    });

    let createdCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    let propertyValueCount = 0;
    const importedEntityIds: string[] = [];

    for (const row of preparedRows) {
      try {
        let entityId = this.store.execute((connection) => {
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
              "В системе найдено несколько участников с одинаковым устойчивым ключом."
            );
          }
          return matches[0]?.entity_id ?? null;
        });

        let created = false;
        let changed = false;
        if (entityId === null) {
          const entity = this.spaces.createEntity(
            space.id,
            {
              entityTypeKey,
              displayName: row.displayName,
              status: "active"
            },
            context
          );
          entityId = entity.entityId;
          created = true;
          createdCount += 1;
        } else {
          changed = this.store.transaction((connection) => {
            const current = connection
              .prepare("SELECT display_name, status FROM entities WHERE id = ?")
              .get(entityId) as
              | { display_name: string; status: string }
              | undefined;
            if (current === undefined) {
              throw new DataImportConflictError(
                "Участник устойчивого ключа больше не существует."
              );
            }
            if (
              current.display_name === row.displayName &&
              current.status === "active"
            ) {
              return false;
            }
            connection
              .prepare(`
                UPDATE entities
                SET display_name = ?, status = 'active',
                    version = version + 1, updated_at = ?
                WHERE id = ?
              `)
              .run(row.displayName, context.now, entityId);
            return true;
          });
        }

        this.store.transaction((connection) => {
          connection
            .prepare(`
              INSERT INTO entity_import_keys(
                space_id, entity_type_id, external_key, entity_id,
                created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(space_id, entity_type_id, external_key) DO UPDATE SET
                entity_id = excluded.entity_id,
                updated_at = excluded.updated_at
            `)
            .run(
              space.id,
              entityType.id,
              row.externalKey,
              entityId,
              context.now,
              context.now
            );
        });

        for (const item of row.values) {
          const encodedJson = stringifyJson(toJsonValue(item.value));
          if (currentPropertyValue(this.store, entityId, item.property.id) === encodedJson) {
            continue;
          }
          this.knowledge.appendPropertyValue(
            {
              entityId,
              propertyKey: item.property.key,
              value: item.value,
              sourceType: "bulk_import",
              sourceId: runId,
              confidence: 1
            },
            context
          );
          propertyValueCount += 1;
          changed = true;
        }

        if (!created) {
          if (changed) updatedCount += 1;
          else unchangedCount += 1;
        }
        importedEntityIds.push(entityId);
      } catch (error) {
        errors.push({
          rowNumber: row.rowNumber,
          externalKey: row.externalKey,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    let group: AudienceGroupRecord | null = null;
    if (input.group !== undefined && input.group !== null && importedEntityIds.length > 0) {
      const groupKey = stableKey(input.group.key, "group.key");
      group = this.spaces
        .listGroups(space.id, 500)
        .find((candidate) => candidate.key === groupKey) ?? null;
      if (group === null) {
        group = this.spaces.createGroup(
          space.id,
          {
            key: groupKey,
            name: requiredText(input.group.name, "group.name", 300),
            description: input.group.description ?? "Создано массовым импортом"
          },
          context
        );
      }
      const existing = this.spaces
        .listGroupMembers(space.id, group.id)
        .map((member) => member.entityId);
      this.spaces.replaceGroupMembers(
        space.id,
        group.id,
        [...new Set([...existing, ...importedEntityIds])],
        context
      );
    }

    const failedCount = errors.length;
    const state =
      createdCount + updatedCount + unchangedCount === 0
        ? "failed"
        : failedCount > 0
          ? "partial"
          : "completed";

    this.store.transaction((connection) => {
      connection
        .prepare(`
          INSERT INTO data_import_runs(
            id, space_id, entity_type_id, file_name, file_format,
            source_sha256, identity_property_key, row_count,
            created_count, updated_count, unchanged_count, skipped_count,
            failed_count, property_value_count, group_id, state,
            details_json, created_by, correlation_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          runId,
          space.id,
          entityType.id,
          fileName,
          fileFormat,
          sourceSha256,
          identityPropertyKey,
          rows.length,
          createdCount,
          updatedCount,
          unchangedCount,
          skippedCount,
          failedCount,
          propertyValueCount,
          group?.id ?? null,
          state,
          JSON.stringify({ errors: errors.slice(0, 200) }),
          context.actorId,
          context.correlationId,
          context.now
        );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "bulk_import",
          objectType: "space",
          objectId: space.id,
          correlationId: context.correlationId,
          details: {
            runId,
            fileName,
            fileFormat,
            rowCount: rows.length,
            createdCount,
            updatedCount,
            unchangedCount,
            skippedCount,
            failedCount,
            propertyValueCount,
            groupId: group?.id ?? null
          }
        },
        connection
      );
    });

    return this.list(space.id, 200).find((run) => run.id === runId) ?? (() => {
      throw new Error(`Created import run was not found: ${runId}`);
    })();
  }
}
