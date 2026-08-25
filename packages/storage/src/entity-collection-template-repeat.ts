import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import {
  EntityCollectionConflictError,
  EntityCollectionNotFoundError,
  EntityCollectionRegistry,
  EntityCollectionValidationError,
  type EntityCollectionRecord
} from "./entity-collections.js";
import { parseJson, toJsonValue, type JsonValue } from "./json.js";
import type { MutationContext } from "./knowledge.js";
import { DomainEventOutbox } from "./outbox.js";

export const ENTITY_COLLECTION_ROW_NUMBER_KEY = "system.row_number";

export interface ConfigureEntityCollectionTemplateRepeatInput {
  collectionId: string;
  anchorElementId: string;
  part: string;
  tableIndex: number;
  rowIndex: number;
  numberingStart?: number;
  numberingStep?: number;
}

export interface EntityCollectionTemplateRepeatRecord {
  draftId: string;
  spaceId: string;
  sourceKind: "entity_collection";
  collectionDefinitionId: string;
  collectionKey: string;
  collectionVersion: number;
  anchorElementId: string;
  part: string;
  tableIndex: number;
  rowIndex: number;
  numbering: {
    start: number;
    step: number;
  };
  emptyBehavior: "error";
  createdBy: string | null;
  correlationId: string;
  createdAt: string;
}

interface RepeatRow {
  draft_id: string;
  space_id: string;
  collection_definition_id: string;
  collection_key_snapshot: string;
  collection_version_snapshot: number;
  anchor_element_id: string;
  part: string;
  table_index: number;
  row_index: number;
  numbering_start: number;
  numbering_step: number;
  empty_behavior: string;
  created_by: string | null;
  correlation_id: string;
  created_at: string;
}

interface DraftRow {
  id: string;
  space_id: string;
  format: string;
}

interface DraftFieldRow {
  id: string;
  field_key: string;
  label: string;
  value_type: string;
  required: number;
  binding_json: string;
}

interface DefinitionRow {
  id: string;
  space_id: string;
  key: string;
  owner_entity_type_key: string;
  status: string;
  version: number;
}

interface CollectionFieldRow {
  key: string;
  value_type: string;
  required: number;
}

export class EntityCollectionTemplateRepeatValidationError extends EntityCollectionValidationError {
  override name = "EntityCollectionTemplateRepeatValidationError";
}

export class EntityCollectionTemplateRepeatNotFoundError extends EntityCollectionNotFoundError {
  override name = "EntityCollectionTemplateRepeatNotFoundError";
}

export class EntityCollectionTemplateRepeatConflictError extends EntityCollectionConflictError {
  override name = "EntityCollectionTemplateRepeatConflictError";
}

function requiredText(value: string, name: string, maximum = 500): string {
  if (typeof value !== "string") {
    throw new EntityCollectionTemplateRepeatValidationError(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum || /\u0000/u.test(normalized)) {
    throw new EntityCollectionTemplateRepeatValidationError(
      `${name} must contain between 1 and ${maximum} safe characters`
    );
  }
  return normalized;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number
): number {
  const normalized = value ?? fallback;
  if (!Number.isInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw new EntityCollectionTemplateRepeatValidationError(
      `${name} must be an integer in range ${minimum}..${maximum}`
    );
  }
  return normalized;
}

function timestamp(value: Date | string | undefined): string {
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new EntityCollectionTemplateRepeatValidationError("Invalid mutation timestamp");
  }
  return date.toISOString();
}

function contextValue(context: MutationContext) {
  return {
    correlationId: requiredText(context.correlationId, "correlationId", 160),
    actorType: requiredText(context.actorType, "actorType", 80),
    actorId:
      context.actorId === undefined || context.actorId === null
        ? null
        : requiredText(context.actorId, "actorId", 160),
    now: timestamp(context.now)
  };
}

function mapRepeat(row: RepeatRow): EntityCollectionTemplateRepeatRecord {
  if (row.empty_behavior !== "error") {
    throw new Error(`Stored entity collection empty behavior is invalid: ${row.empty_behavior}`);
  }
  return {
    draftId: row.draft_id,
    spaceId: row.space_id,
    sourceKind: "entity_collection",
    collectionDefinitionId: row.collection_definition_id,
    collectionKey: row.collection_key_snapshot,
    collectionVersion: Number(row.collection_version_snapshot),
    anchorElementId: row.anchor_element_id,
    part: row.part,
    tableIndex: Number(row.table_index),
    rowIndex: Number(row.row_index),
    numbering: {
      start: Number(row.numbering_start),
      step: Number(row.numbering_step)
    },
    emptyBehavior: "error",
    createdBy: row.created_by,
    correlationId: row.correlation_id,
    createdAt: row.created_at
  };
}

function repeatForDraft(
  connection: SqliteExecutor,
  spaceId: string,
  draftId: string
): RepeatRow | undefined {
  return connection
    .prepare(`
      SELECT *
      FROM entity_collection_template_repeats
      WHERE space_id = ? AND draft_id = ?
    `)
    .get(spaceId, draftId) as RepeatRow | undefined;
}

function tableLocation(binding: JsonValue): {
  part: string;
  tableIndex: number;
  rowIndex: number;
} | null {
  if (binding === null || Array.isArray(binding) || typeof binding !== "object") return null;
  const part = binding["part"];
  const location = binding["tableLocation"];
  if (
    typeof part !== "string" ||
    location === null ||
    Array.isArray(location) ||
    typeof location !== "object"
  ) {
    return null;
  }
  const tableIndex = location["tableIndex"];
  const rowIndex = location["rowIndex"];
  if (
    typeof tableIndex !== "number" ||
    !Number.isInteger(tableIndex) ||
    tableIndex < 0 ||
    typeof rowIndex !== "number" ||
    !Number.isInteger(rowIndex) ||
    rowIndex < 0
  ) {
    return null;
  }
  return { part, tableIndex, rowIndex };
}

function sameRow(
  binding: JsonValue,
  repeat: { part: string; tableIndex: number; rowIndex: number }
): boolean {
  const location = tableLocation(binding);
  return Boolean(
    location &&
      location.part === repeat.part &&
      location.tableIndex === repeat.tableIndex &&
      location.rowIndex === repeat.rowIndex
  );
}

function validateDraftFields(
  connection: SqliteExecutor,
  draftId: string,
  definitionId: string,
  repeat: { part: string; tableIndex: number; rowIndex: number }
): { rowFieldKeys: string[]; scalarFieldKeys: string[] } {
  const fields = connection
    .prepare(`
      SELECT id, field_key, label, value_type, required, binding_json
      FROM template_draft_fields
      WHERE draft_id = ?
      ORDER BY created_at ASC, id ASC
    `)
    .all(draftId) as unknown as DraftFieldRow[];
  const collectionFields = connection
    .prepare(`
      SELECT key, value_type, required
      FROM entity_collection_fields
      WHERE collection_definition_id = ?
      ORDER BY position ASC, id ASC
    `)
    .all(definitionId) as unknown as CollectionFieldRow[];
  const collectionByKey = new Map(collectionFields.map((field) => [field.key, field]));
  const collectionKeys = new Set(collectionByKey.keys());
  const rowFields = fields.filter((field) => sameRow(parseJson(field.binding_json), repeat));
  const scalarFields = fields.filter((field) => !sameRow(parseJson(field.binding_json), repeat));

  if (rowFields.length === 0) {
    throw new EntityCollectionTemplateRepeatValidationError(
      "В выбранной строке нет сохранённых полей. Сначала сопоставьте ячейки таблицы."
    );
  }
  if (rowFields.length > 100) {
    throw new EntityCollectionTemplateRepeatValidationError(
      "В повторяемой строке не может быть больше 100 полей."
    );
  }

  let dataFields = 0;
  for (const field of rowFields) {
    if (field.field_key === ENTITY_COLLECTION_ROW_NUMBER_KEY) {
      if (field.value_type !== "integer") {
        throw new EntityCollectionTemplateRepeatValidationError(
          "Автонумерация повторяемой строки должна иметь тип «Целое число»."
        );
      }
      continue;
    }
    const definition = collectionByKey.get(field.field_key);
    if (definition === undefined) {
      throw new EntityCollectionTemplateRepeatValidationError(
        `Поле «${field.label}» в повторяемой строке не относится к выбранной таблице данных.`
      );
    }
    if (definition.value_type !== field.value_type) {
      throw new EntityCollectionTemplateRepeatValidationError(
        `Тип поля «${field.label}» не совпадает со схемой таблицы данных.`
      );
    }
    if (definition.required === 1 && field.required !== 1) {
      throw new EntityCollectionTemplateRepeatValidationError(
        `Обязательное поле «${field.label}» нельзя сделать необязательным в повторяемой строке.`
      );
    }
    dataFields += 1;
  }
  if (dataFields === 0) {
    throw new EntityCollectionTemplateRepeatValidationError(
      "Повторяемая строка должна содержать хотя бы одно поле выбранной таблицы данных."
    );
  }

  for (const field of scalarFields) {
    if (field.field_key === ENTITY_COLLECTION_ROW_NUMBER_KEY || collectionKeys.has(field.field_key)) {
      throw new EntityCollectionTemplateRepeatValidationError(
        `Поле «${field.label}» из таблицы данных должно находиться внутри выбранной повторяемой строки.`
      );
    }
  }

  return {
    rowFieldKeys: rowFields.map((field) => field.field_key),
    scalarFieldKeys: scalarFields.map((field) => field.field_key)
  };
}

export class EntityCollectionTemplateRepeatRegistry {
  private readonly audit: AuditRepository;
  private readonly outbox: DomainEventOutbox;
  private readonly collections: EntityCollectionRegistry;

  constructor(private readonly store: SqliteStore) {
    this.audit = new AuditRepository(store);
    this.outbox = new DomainEventOutbox(store);
    this.collections = new EntityCollectionRegistry(store);
  }

  configure(
    spaceIdValue: string,
    draftIdValue: string,
    input: ConfigureEntityCollectionTemplateRepeatInput,
    contextInput: MutationContext
  ): EntityCollectionTemplateRepeatRecord {
    const spaceId = requiredText(spaceIdValue, "spaceId", 160);
    const draftId = requiredText(draftIdValue, "draftId", 160);
    const collectionId = requiredText(input.collectionId, "collectionId", 160);
    const anchorElementId = requiredText(input.anchorElementId, "anchorElementId", 300);
    const part = requiredText(input.part, "part", 500);
    const tableIndex = boundedInteger(input.tableIndex, 0, "tableIndex", 0, 100_000);
    const rowIndex = boundedInteger(input.rowIndex, 0, "rowIndex", 0, 1_000_000);
    const numberingStart = boundedInteger(
      input.numberingStart,
      1,
      "numberingStart",
      0,
      1_000_000
    );
    const numberingStep = boundedInteger(
      input.numberingStep,
      1,
      "numberingStep",
      1,
      1_000_000
    );
    const context = contextValue(contextInput);

    return this.store.transaction((connection) => {
      const draft = connection
        .prepare("SELECT id, space_id, format FROM template_drafts WHERE id = ? AND space_id = ?")
        .get(draftId, spaceId) as DraftRow | undefined;
      if (draft === undefined) {
        throw new EntityCollectionTemplateRepeatNotFoundError(
          "Черновик шаблона не найден в выбранном пространстве."
        );
      }
      if (draft.format !== "docx") {
        throw new EntityCollectionTemplateRepeatValidationError(
          "Повторяемые списки владельца в первой версии поддерживаются только для DOCX."
        );
      }
      const definition = connection
        .prepare(`
          SELECT id, space_id, key, owner_entity_type_key, status, version
          FROM entity_collection_definitions
          WHERE space_id = ? AND (id = ? OR key = ?)
        `)
        .get(spaceId, collectionId, collectionId.toLowerCase()) as DefinitionRow | undefined;
      if (definition === undefined || definition.status !== "active") {
        throw new EntityCollectionTemplateRepeatNotFoundError(
          "Таблица данных не найдена в выбранном пространстве."
        );
      }
      if (definition.owner_entity_type_key !== "person") {
        throw new EntityCollectionTemplateRepeatValidationError(
          "Выбранная таблица данных не относится к сотрудникам."
        );
      }

      const fieldSummary = validateDraftFields(connection, draftId, definition.id, {
        part,
        tableIndex,
        rowIndex
      });
      const existing = repeatForDraft(connection, spaceId, draftId);
      if (existing !== undefined) {
        const current = mapRepeat(existing);
        if (
          current.collectionDefinitionId === definition.id &&
          current.anchorElementId === anchorElementId &&
          current.part === part &&
          current.tableIndex === tableIndex &&
          current.rowIndex === rowIndex &&
          current.numbering.start === numberingStart &&
          current.numbering.step === numberingStep
        ) {
          return current;
        }
        throw new EntityCollectionTemplateRepeatConflictError(
          "В этом шаблоне уже настроена другая повторяемая таблица. Создайте новый черновик, чтобы изменить источник."
        );
      }

      connection
        .prepare(`
          INSERT INTO entity_collection_template_repeats(
            draft_id, space_id, collection_definition_id,
            collection_key_snapshot, collection_version_snapshot,
            anchor_element_id, part, table_index, row_index,
            numbering_start, numbering_step, empty_behavior,
            created_by, correlation_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'error', ?, ?, ?)
        `)
        .run(
          draftId,
          spaceId,
          definition.id,
          definition.key,
          definition.version,
          anchorElementId,
          part,
          tableIndex,
          rowIndex,
          numberingStart,
          numberingStep,
          context.actorId,
          context.correlationId,
          context.now
        );

      this.outbox.append(
        {
          eventType: "template.entity_collection_repeat.configured",
          schemaVersion: 1,
          source: "entity-collection-template-repeat-registry",
          occurredAt: context.now,
          payload: toJsonValue({
            draftId,
            spaceId,
            collectionDefinitionId: definition.id,
            collectionVersion: definition.version,
            rowFieldKeys: fieldSummary.rowFieldKeys,
            scalarFieldCount: fieldSummary.scalarFieldKeys.length,
            numberingStart,
            numberingStep
          }),
          dedupeKey: `template.entity_collection_repeat.configured:${draftId}:v1`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "configure_entity_collection_repeat",
          objectType: "template_draft",
          objectId: draftId,
          correlationId: context.correlationId,
          details: toJsonValue({
            collectionDefinitionId: definition.id,
            collectionVersion: definition.version,
            rowFieldCount: fieldSummary.rowFieldKeys.length,
            scalarFieldCount: fieldSummary.scalarFieldKeys.length,
            numberingStart,
            numberingStep
          })
        },
        connection
      );

      const created = repeatForDraft(connection, spaceId, draftId);
      if (created === undefined) {
        throw new Error("Configured entity collection repeat was not found after insert");
      }
      return mapRepeat(created);
    });
  }

  getOptionalForDraft(
    spaceIdValue: string,
    draftIdValue: string
  ): EntityCollectionTemplateRepeatRecord | null {
    const spaceId = requiredText(spaceIdValue, "spaceId", 160);
    const draftId = requiredText(draftIdValue, "draftId", 160);
    return this.store.execute((connection) => {
      const row = repeatForDraft(connection, spaceId, draftId);
      return row === undefined ? null : mapRepeat(row);
    });
  }

  getForActiveRelease(
    spaceIdValue: string,
    releaseIdValue: string
  ): EntityCollectionTemplateRepeatRecord | null {
    const spaceId = requiredText(spaceIdValue, "spaceId", 160);
    const releaseId = requiredText(releaseIdValue, "releaseId", 160);
    return this.store.execute((connection) => {
      const row = connection
        .prepare(`
          SELECT repeat.*
          FROM template_releases release
          JOIN entity_collection_template_repeats repeat
            ON repeat.draft_id = release.draft_id
           AND repeat.space_id = release.space_id
          WHERE release.id = ? AND release.space_id = ?
        `)
        .get(releaseId, spaceId) as RepeatRow | undefined;
      return row === undefined ? null : mapRepeat(row);
    });
  }

  getOwnerCollectionForActiveRelease(
    spaceIdValue: string,
    releaseIdValue: string,
    ownerEntityIdValue: string
  ): {
    repeat: EntityCollectionTemplateRepeatRecord;
    collection: EntityCollectionRecord;
  } | null {
    const repeat = this.getForActiveRelease(spaceIdValue, releaseIdValue);
    if (repeat === null) return null;
    const collection = this.collections.getCollection(
      repeat.spaceId,
      requiredText(ownerEntityIdValue, "ownerEntityId", 160),
      repeat.collectionDefinitionId
    );
    if (
      collection.definition.key !== repeat.collectionKey ||
      collection.definition.version !== repeat.collectionVersion
    ) {
      throw new EntityCollectionTemplateRepeatConflictError(
        "Схема таблицы данных изменилась после настройки шаблона. Перепроверьте и активируйте новую версию шаблона."
      );
    }
    return { repeat, collection };
  }

  lowLevelDocxRepeatBinding(
    repeat: EntityCollectionTemplateRepeatRecord
  ): JsonValue {
    return toJsonValue({
      version: 1,
      kind: "docx.repeat-row",
      source: "audience.members",
      anchorElementId: repeat.anchorElementId,
      part: repeat.part,
      tableIndex: repeat.tableIndex,
      rowIndex: repeat.rowIndex
    });
  }
}
