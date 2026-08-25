import { randomUUID } from "node:crypto";

import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import {
  parseJson,
  stringifyJson,
  toJsonValue,
  type JsonValue
} from "./json.js";
import {
  generateOpaqueStableKey,
  type MutationContext
} from "./knowledge.js";
import { DomainEventOutbox } from "./outbox.js";
import {
  PropertyValueCodecRegistry,
  type PropertyValueType
} from "./property-codec.js";

export const ENTITY_COLLECTION_VALUE_TYPES = [
  "string",
  "text",
  "number",
  "integer",
  "boolean",
  "date",
  "date-time",
  "enum"
] as const;

export type EntityCollectionValueType =
  (typeof ENTITY_COLLECTION_VALUE_TYPES)[number];
export type EntityCollectionStatus = "active" | "archived";

export interface CreateEntityCollectionFieldInput {
  id?: string;
  key?: string;
  label: string;
  description?: string | null;
  valueType: string;
  unit?: string | null;
  required?: boolean;
  validation?: JsonValue;
}

export interface CreateEntityCollectionDefinitionInput {
  id?: string;
  key?: string;
  label: string;
  description?: string | null;
  ownerEntityTypeKey: string;
  minItems?: number;
  maxItems?: number;
  fields: readonly CreateEntityCollectionFieldInput[];
}

export interface EntityCollectionFieldRecord {
  id: string;
  collectionDefinitionId: string;
  key: string;
  label: string;
  description: string | null;
  valueType: EntityCollectionValueType;
  unit: string | null;
  required: boolean;
  validation: JsonValue;
  position: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface EntityCollectionDefinitionRecord {
  id: string;
  spaceId: string;
  key: string;
  label: string;
  description: string | null;
  ownerEntityTypeKey: string;
  status: EntityCollectionStatus;
  minItems: number;
  maxItems: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  fields: EntityCollectionFieldRecord[];
}

export interface ReplaceEntityCollectionItemInput {
  id?: string;
  values: Readonly<Record<string, unknown>>;
}

export interface EntityCollectionItemRecord {
  id: string;
  collectionDefinitionId: string;
  ownerEntityId: string;
  position: number;
  rowNumber: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  values: Readonly<Record<string, JsonValue>>;
}

export interface EntityCollectionRecord {
  definition: EntityCollectionDefinitionRecord;
  ownerEntityId: string;
  items: EntityCollectionItemRecord[];
}

interface DefinitionRow {
  id: string;
  space_id: string;
  key: string;
  label: string;
  description: string | null;
  owner_entity_type_key: string;
  status: string;
  min_items: number;
  max_items: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface FieldRow {
  id: string;
  collection_definition_id: string;
  key: string;
  label: string;
  description: string | null;
  value_type: string;
  unit: string | null;
  required: number;
  validation_json: string;
  position: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface ItemRow {
  id: string;
  collection_definition_id: string;
  owner_entity_id: string;
  position: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface ItemValueRow {
  item_id: string;
  field_id: string;
  field_key: string;
  value_type: string;
  value_json: string;
}

interface OwnerRow {
  entity_id: string;
  space_id: string;
  entity_type_key: string;
}

export class EntityCollectionValidationError extends Error {
  override name = "EntityCollectionValidationError";
}

export class EntityCollectionConflictError extends Error {
  override name = "EntityCollectionConflictError";
}

export class EntityCollectionNotFoundError extends Error {
  override name = "EntityCollectionNotFoundError";
}

function requiredText(value: string, name: string, maximum = 500): string {
  if (typeof value !== "string") {
    throw new EntityCollectionValidationError(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new EntityCollectionValidationError(`${name} must not be empty`);
  }
  if (normalized.length > maximum) {
    throw new EntityCollectionValidationError(
      `${name} must not exceed ${maximum} characters`
    );
  }
  return normalized;
}

function optionalText(
  value: string | null | undefined,
  name: string,
  maximum = 2_000
): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maximum) {
    throw new EntityCollectionValidationError(
      `${name} must not exceed ${maximum} characters`
    );
  }
  return normalized;
}

function stableKey(value: string, name: string): string {
  const normalized = requiredText(value, name, 160).toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(normalized)) {
    throw new EntityCollectionValidationError(
      `${name} must start with a letter and contain lowercase letters, digits, dots, underscores or hyphens`
    );
  }
  return normalized;
}

function timestamp(value: Date | string | undefined): string {
  const date =
    value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new EntityCollectionValidationError("Invalid mutation timestamp");
  }
  return date.toISOString();
}

function context(value: MutationContext): {
  correlationId: string;
  actorType: string;
  actorId: string | null;
  now: string;
} {
  return {
    correlationId: requiredText(value.correlationId, "correlationId", 160),
    actorType: requiredText(value.actorType, "actorType", 80),
    actorId: optionalText(value.actorId, "actorId", 160),
    now: timestamp(value.now)
  };
}

function integerRange(
  value: number | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number
): number {
  const normalized = value ?? fallback;
  if (
    !Number.isInteger(normalized) ||
    normalized < minimum ||
    normalized > maximum
  ) {
    throw new EntityCollectionValidationError(
      `${name} must be an integer in range ${minimum}..${maximum}`
    );
  }
  return normalized;
}

function valueType(value: string): EntityCollectionValueType {
  if (
    ENTITY_COLLECTION_VALUE_TYPES.includes(value as EntityCollectionValueType)
  ) {
    return value as EntityCollectionValueType;
  }
  throw new EntityCollectionValidationError(
    `Unsupported entity collection value type: ${value}`
  );
}

function status(value: string): EntityCollectionStatus {
  if (value === "active" || value === "archived") return value;
  throw new Error(`Stored entity collection status is invalid: ${value}`);
}

function jsonObject(value: JsonValue | undefined, name: string): JsonValue {
  const normalized = toJsonValue(value ?? {});
  if (
    normalized === null ||
    Array.isArray(normalized) ||
    typeof normalized !== "object"
  ) {
    throw new EntityCollectionValidationError(`${name} must be a JSON object`);
  }
  return normalized;
}

function enumValues(validation: JsonValue): readonly string[] | undefined {
  if (
    validation === null ||
    Array.isArray(validation) ||
    typeof validation !== "object"
  ) {
    return undefined;
  }
  const raw = validation["enum"];
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== "string")) {
    throw new EntityCollectionValidationError(
      "validation.enum must be an array of strings"
    );
  }
  const values = (raw as string[]).map((entry) => entry.trim());
  if (values.some((entry) => entry.length === 0)) {
    throw new EntityCollectionValidationError(
      "validation.enum must not contain empty values"
    );
  }
  return [...new Set(values)];
}

function missingRequired(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0)
  );
}

function definitionByIdentity(
  connection: SqliteExecutor,
  spaceId: string,
  identityValue: string
): DefinitionRow | undefined {
  const identity = requiredText(identityValue, "collectionId", 160);
  return connection
    .prepare(`
      SELECT *
      FROM entity_collection_definitions
      WHERE space_id = ?
        AND (id = ? OR key = ?)
    `)
    .get(spaceId, identity, identity.toLowerCase()) as DefinitionRow | undefined;
}

function fieldsForDefinition(
  connection: SqliteExecutor,
  definitionId: string
): FieldRow[] {
  return connection
    .prepare(`
      SELECT *
      FROM entity_collection_fields
      WHERE collection_definition_id = ?
      ORDER BY position ASC, id ASC
    `)
    .all(definitionId) as unknown as FieldRow[];
}

function ownerRow(
  connection: SqliteExecutor,
  ownerEntityIdValue: string
): OwnerRow | undefined {
  const ownerEntityId = requiredText(ownerEntityIdValue, "ownerEntityId", 160);
  return connection
    .prepare(`
      SELECT e.id AS entity_id,
             seo.space_id,
             et.key AS entity_type_key
      FROM entities e
      JOIN entity_types et ON et.id = e.entity_type_id
      JOIN space_entity_ownership seo ON seo.entity_id = e.id
      WHERE e.id = ?
    `)
    .get(ownerEntityId) as OwnerRow | undefined;
}

function mapField(row: FieldRow): EntityCollectionFieldRecord {
  return {
    id: row.id,
    collectionDefinitionId: row.collection_definition_id,
    key: row.key,
    label: row.label,
    description: row.description,
    valueType: valueType(row.value_type),
    unit: row.unit,
    required: row.required === 1,
    validation: parseJson(row.validation_json),
    position: row.position,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapDefinition(
  connection: SqliteExecutor,
  row: DefinitionRow
): EntityCollectionDefinitionRecord {
  return {
    id: row.id,
    spaceId: row.space_id,
    key: row.key,
    label: row.label,
    description: row.description,
    ownerEntityTypeKey: row.owner_entity_type_key,
    status: status(row.status),
    minItems: row.min_items,
    maxItems: row.max_items,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fields: fieldsForDefinition(connection, row.id).map(mapField)
  };
}

function readCollection(
  connection: SqliteExecutor,
  definition: DefinitionRow,
  ownerEntityId: string
): EntityCollectionRecord {
  const definitionRecord = mapDefinition(connection, definition);
  const itemRows = connection
    .prepare(`
      SELECT *
      FROM entity_collection_items
      WHERE collection_definition_id = ?
        AND owner_entity_id = ?
      ORDER BY position ASC, id ASC
    `)
    .all(definition.id, ownerEntityId) as unknown as ItemRow[];

  const valueRows = connection
    .prepare(`
      SELECT v.item_id,
             v.field_id,
             f.key AS field_key,
             f.value_type,
             v.value_json
      FROM entity_collection_item_values v
      JOIN entity_collection_fields f ON f.id = v.field_id
      JOIN entity_collection_items item ON item.id = v.item_id
      WHERE item.collection_definition_id = ?
        AND item.owner_entity_id = ?
      ORDER BY item.position ASC, f.position ASC
    `)
    .all(definition.id, ownerEntityId) as unknown as ItemValueRow[];

  const valuesByItem = new Map<string, Record<string, JsonValue>>();
  for (const row of valueRows) {
    const values = valuesByItem.get(row.item_id) ?? {};
    values[row.field_key] = parseJson(row.value_json);
    valuesByItem.set(row.item_id, values);
  }

  return {
    definition: definitionRecord,
    ownerEntityId,
    items: itemRows.map((item) => ({
      id: item.id,
      collectionDefinitionId: item.collection_definition_id,
      ownerEntityId: item.owner_entity_id,
      position: item.position,
      rowNumber: item.position + 1,
      version: item.version,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      values: valuesByItem.get(item.id) ?? {}
    }))
  };
}

export class EntityCollectionRegistry {
  private readonly audit: AuditRepository;
  private readonly outbox: DomainEventOutbox;
  private readonly codecs = new PropertyValueCodecRegistry();

  constructor(private readonly store: SqliteStore) {
    this.audit = new AuditRepository(store);
    this.outbox = new DomainEventOutbox(store);
  }

  createDefinition(
    spaceIdValue: string,
    input: CreateEntityCollectionDefinitionInput,
    contextInput: MutationContext
  ): EntityCollectionDefinitionRecord {
    const spaceId = requiredText(spaceIdValue, "spaceId", 160);
    const explicitKey = input.key === undefined ? null : stableKey(input.key, "key");
    const label = requiredText(input.label, "label");
    const description = optionalText(input.description, "description");
    const ownerEntityTypeKey = stableKey(
      input.ownerEntityTypeKey,
      "ownerEntityTypeKey"
    );
    const minItems = integerRange(input.minItems, 0, "minItems", 0, 1_000);
    const maxItems = integerRange(input.maxItems, 1_000, "maxItems", 1, 1_000);
    if (maxItems < minItems) {
      throw new EntityCollectionValidationError(
        "maxItems must not be less than minItems"
      );
    }
    if (!Array.isArray(input.fields) || input.fields.length < 1 || input.fields.length > 100) {
      throw new EntityCollectionValidationError(
        "fields must contain between 1 and 100 definitions"
      );
    }

    const fieldInputs = input.fields.map((field, position) => {
      const fieldValidation = jsonObject(field.validation, "field.validation");
      const type = valueType(field.valueType);
      enumValues(fieldValidation);
      return {
        id: field.id ?? randomUUID(),
        key:
          field.key === undefined
            ? generateOpaqueStableKey("field")
            : stableKey(field.key, "field.key"),
        label: requiredText(field.label, "field.label"),
        description: optionalText(field.description, "field.description"),
        valueType: type,
        unit: optionalText(field.unit, "field.unit", 80),
        required: field.required === true,
        validation: fieldValidation,
        position
      };
    });

    const fieldKeys = new Set(fieldInputs.map((field) => field.key));
    if (fieldKeys.size !== fieldInputs.length) {
      throw new EntityCollectionValidationError(
        "field keys must be unique inside one collection"
      );
    }
    const fieldLabels = new Set(
      fieldInputs.map((field) =>
        field.label.normalize("NFKC").toLocaleLowerCase("ru-RU")
      )
    );
    if (fieldLabels.size !== fieldInputs.length) {
      throw new EntityCollectionValidationError(
        "field labels must be unique inside one collection"
      );
    }

    const mutation = context(contextInput);
    const id = input.id ?? randomUUID();

    return this.store.transaction((connection) => {
      if (
        connection.prepare("SELECT 1 AS found FROM spaces WHERE id = ?").get(spaceId) ===
        undefined
      ) {
        throw new EntityCollectionNotFoundError(`Space was not found: ${spaceId}`);
      }
      if (
        connection.prepare("SELECT 1 AS found FROM entity_types WHERE key = ?").get(
          ownerEntityTypeKey
        ) === undefined
      ) {
        throw new EntityCollectionNotFoundError(
          `Owner entity type was not found: ${ownerEntityTypeKey}`
        );
      }
      const key = explicitKey ?? generateOpaqueStableKey("collection");
      if (
        connection
          .prepare(
            "SELECT 1 AS found FROM entity_collection_definitions WHERE space_id = ? AND key = ?"
          )
          .get(spaceId, key) !== undefined
      ) {
        throw new EntityCollectionConflictError(
          `Entity collection definition already exists: ${key}`
        );
      }
      if (
        connection
          .prepare("SELECT 1 AS found FROM entity_collection_definitions WHERE id = ?")
          .get(id) !== undefined
      ) {
        throw new EntityCollectionConflictError(
          `Entity collection definition already exists: ${id}`
        );
      }

      connection
        .prepare(`
          INSERT INTO entity_collection_definitions(
            id, space_id, key, label, description, owner_entity_type_key,
            status, min_items, max_items, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, ?, ?)
        `)
        .run(
          id,
          spaceId,
          key,
          label,
          description,
          ownerEntityTypeKey,
          minItems,
          maxItems,
          mutation.now,
          mutation.now
        );

      for (const field of fieldInputs) {
        connection
          .prepare(`
            INSERT INTO entity_collection_fields(
              id, collection_definition_id, key, label, description,
              value_type, unit, required, validation_json, position,
              version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          `)
          .run(
            field.id,
            id,
            field.key,
            field.label,
            field.description,
            field.valueType,
            field.unit,
            field.required ? 1 : 0,
            stringifyJson(field.validation),
            field.position,
            mutation.now,
            mutation.now
          );
      }

      this.outbox.append(
        {
          eventType: "entity_collection.definition_created",
          schemaVersion: 1,
          source: "entity-collections",
          occurredAt: mutation.now,
          payload: {
            definitionId: id,
            spaceId,
            key,
            ownerEntityTypeKey,
            fieldCount: fieldInputs.length,
            version: 1
          },
          dedupeKey: `entity_collection.definition_created:${id}:v1`,
          now: mutation.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: mutation.now,
          actorType: mutation.actorType,
          actorId: mutation.actorId,
          action: "create",
          objectType: "entity_collection_definition",
          objectId: id,
          correlationId: mutation.correlationId,
          details: {
            spaceId,
            key,
            ownerEntityTypeKey,
            fieldCount: fieldInputs.length,
            version: 1
          }
        },
        connection
      );

      const row = definitionByIdentity(connection, spaceId, id);
      if (row === undefined) {
        throw new Error(`Created entity collection definition was not found: ${id}`);
      }
      return mapDefinition(connection, row);
    });
  }

  listDefinitions(
    spaceIdValue: string,
    ownerEntityTypeKeyValue?: string
  ): EntityCollectionDefinitionRecord[] {
    const spaceId = requiredText(spaceIdValue, "spaceId", 160);
    const ownerEntityTypeKey =
      ownerEntityTypeKeyValue === undefined
        ? null
        : stableKey(ownerEntityTypeKeyValue, "ownerEntityTypeKey");
    return this.store.execute((connection) => {
      const rows = connection
        .prepare(`
          SELECT *
          FROM entity_collection_definitions
          WHERE space_id = ?
            AND (? IS NULL OR owner_entity_type_key = ?)
          ORDER BY label ASC, key ASC
        `)
        .all(
          spaceId,
          ownerEntityTypeKey,
          ownerEntityTypeKey
        ) as unknown as DefinitionRow[];
      return rows.map((row) => mapDefinition(connection, row));
    });
  }

  getDefinition(
    spaceIdValue: string,
    collectionIdentityValue: string
  ): EntityCollectionDefinitionRecord {
    const spaceId = requiredText(spaceIdValue, "spaceId", 160);
    return this.store.execute((connection) => {
      const row = definitionByIdentity(
        connection,
        spaceId,
        collectionIdentityValue
      );
      if (row === undefined) {
        throw new EntityCollectionNotFoundError(
          `Entity collection definition was not found in this space: ${collectionIdentityValue}`
        );
      }
      return mapDefinition(connection, row);
    });
  }

  getCollection(
    spaceIdValue: string,
    ownerEntityIdValue: string,
    collectionIdentityValue: string
  ): EntityCollectionRecord {
    const spaceId = requiredText(spaceIdValue, "spaceId", 160);
    const ownerEntityId = requiredText(ownerEntityIdValue, "ownerEntityId", 160);
    return this.store.execute((connection) => {
      const definition = definitionByIdentity(
        connection,
        spaceId,
        collectionIdentityValue
      );
      if (definition === undefined) {
        throw new EntityCollectionNotFoundError(
          `Entity collection definition was not found in this space: ${collectionIdentityValue}`
        );
      }
      this.requireOwner(connection, definition, ownerEntityId);
      return readCollection(connection, definition, ownerEntityId);
    });
  }

  replaceItems(
    spaceIdValue: string,
    ownerEntityIdValue: string,
    collectionIdentityValue: string,
    itemsInput: readonly ReplaceEntityCollectionItemInput[],
    contextInput: MutationContext
  ): EntityCollectionRecord {
    const spaceId = requiredText(spaceIdValue, "spaceId", 160);
    const ownerEntityId = requiredText(ownerEntityIdValue, "ownerEntityId", 160);
    if (!Array.isArray(itemsInput)) {
      throw new EntityCollectionValidationError("items must be an array");
    }
    const mutation = context(contextInput);

    return this.store.transaction((connection) => {
      const definition = definitionByIdentity(
        connection,
        spaceId,
        collectionIdentityValue
      );
      if (definition === undefined) {
        throw new EntityCollectionNotFoundError(
          `Entity collection definition was not found in this space: ${collectionIdentityValue}`
        );
      }
      this.requireOwner(connection, definition, ownerEntityId);
      if (
        itemsInput.length < definition.min_items ||
        itemsInput.length > definition.max_items
      ) {
        throw new EntityCollectionValidationError(
          `items count must be in range ${definition.min_items}..${definition.max_items}`
        );
      }

      const fields = fieldsForDefinition(connection, definition.id);
      const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
      const normalizedItems = itemsInput.map((item, position) => {
        if (
          item === null ||
          typeof item !== "object" ||
          Array.isArray(item) ||
          item.values === null ||
          typeof item.values !== "object" ||
          Array.isArray(item.values)
        ) {
          throw new EntityCollectionValidationError(
            `item ${position + 1} must contain a values object`
          );
        }
        const id =
          item.id === undefined
            ? randomUUID()
            : requiredText(item.id, `items[${position}].id`, 160);
        const entries: Array<{
          field: FieldRow;
          value: unknown;
          encoded: ReturnType<PropertyValueCodecRegistry["encode"]>;
        }> = [];
        for (const key of Object.keys(item.values)) {
          if (!fieldsByKey.has(key)) {
            throw new EntityCollectionValidationError(
              `Unknown collection field in row ${position + 1}: ${key}`
            );
          }
        }
        for (const field of fields) {
          const value = item.values[field.key];
          if (field.required === 1 && missingRequired(value)) {
            throw new EntityCollectionValidationError(
              `Required collection field is empty in row ${position + 1}: ${field.label}`
            );
          }
          if (value === undefined || value === null) continue;
          const validation = parseJson(field.validation_json);
          entries.push({
            field,
            value,
            encoded: this.codecs.encode(
              valueType(field.value_type) as PropertyValueType,
              value,
              { allowedValues: enumValues(validation) }
            )
          });
        }
        return { id, position, entries };
      });

      const ids = normalizedItems.map((item) => item.id);
      if (new Set(ids).size !== ids.length) {
        throw new EntityCollectionValidationError(
          "item identifiers must be unique inside one collection"
        );
      }
      if (ids.length > 0) {
        const placeholders = ids.map(() => "?").join(", ");
        const foreign = connection
          .prepare(`
            SELECT id
            FROM entity_collection_items
            WHERE id IN (${placeholders})
              AND NOT (
                collection_definition_id = ?
                AND owner_entity_id = ?
              )
            LIMIT 1
          `)
          .get(...ids, definition.id, ownerEntityId) as { id: string } | undefined;
        if (foreign !== undefined) {
          throw new EntityCollectionConflictError(
            `Entity collection item identifier belongs to another collection: ${foreign.id}`
          );
        }
      }

      connection
        .prepare(`
          DELETE FROM entity_collection_items
          WHERE collection_definition_id = ?
            AND owner_entity_id = ?
        `)
        .run(definition.id, ownerEntityId);

      for (const item of normalizedItems) {
        connection
          .prepare(`
            INSERT INTO entity_collection_items(
              id, collection_definition_id, owner_entity_id, position,
              version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 1, ?, ?)
          `)
          .run(
            item.id,
            definition.id,
            ownerEntityId,
            item.position,
            mutation.now,
            mutation.now
          );
        for (const entry of item.entries) {
          const encoded = entry.encoded;
          connection
            .prepare(`
              INSERT INTO entity_collection_item_values(
                item_id, field_id, value_json, value_text, value_number,
                value_integer, value_boolean, value_date, value_datetime,
                version, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            `)
            .run(
              item.id,
              entry.field.id,
              encoded.valueJson,
              encoded.valueText,
              encoded.valueNumber,
              encoded.valueInteger,
              encoded.valueBoolean,
              encoded.valueDate,
              encoded.valueDatetime,
              mutation.now,
              mutation.now
            );
        }
      }

      this.outbox.append(
        {
          eventType: "entity_collection.items_replaced",
          schemaVersion: 1,
          source: "entity-collections",
          occurredAt: mutation.now,
          entityId: ownerEntityId,
          payload: {
            definitionId: definition.id,
            collectionKey: definition.key,
            ownerEntityId,
            itemCount: normalizedItems.length,
            schemaVersion: definition.version
          },
          dedupeKey: `entity_collection.items_replaced:${definition.id}:${ownerEntityId}:${mutation.correlationId}`,
          now: mutation.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: mutation.now,
          actorType: mutation.actorType,
          actorId: mutation.actorId,
          action: "replace_items",
          objectType: "entity_collection",
          objectId: definition.id,
          correlationId: mutation.correlationId,
          details: {
            spaceId,
            collectionKey: definition.key,
            ownerEntityId,
            itemCount: normalizedItems.length,
            schemaVersion: definition.version
          }
        },
        connection
      );

      return readCollection(connection, definition, ownerEntityId);
    });
  }

  private requireOwner(
    connection: SqliteExecutor,
    definition: DefinitionRow,
    ownerEntityId: string
  ): OwnerRow {
    const owner = ownerRow(connection, ownerEntityId);
    if (
      owner === undefined ||
      owner.space_id !== definition.space_id ||
      owner.entity_type_key !== definition.owner_entity_type_key
    ) {
      throw new EntityCollectionNotFoundError(
        `Collection owner was not found in the definition space and type: ${ownerEntityId}`
      );
    }
    return owner;
  }
}
