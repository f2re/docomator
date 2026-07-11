import { randomUUID } from "node:crypto";

import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import {
  parseJson,
  stringifyJson,
  toJsonValue,
  type JsonValue
} from "./json.js";
import { DomainEventOutbox } from "./outbox.js";
import {
  PROPERTY_VALUE_TYPES,
  PropertyValueCodecRegistry,
  type PropertyValueType
} from "./property-codec.js";

export type EntityStatus = "active" | "inactive" | "archived";
export type PropertyCardinality = "single" | "multiple";
export type PropertySensitivity = "public" | "internal" | "personal" | "restricted";

export interface MutationContext {
  correlationId: string;
  actorType: string;
  actorId?: string | null;
  now?: Date | string;
}

export interface EntityTypeRecord {
  id: string;
  key: string;
  label: string;
  description: string | null;
  schema: JsonValue;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEntityTypeInput {
  id?: string;
  key: string;
  label: string;
  description?: string | null;
  schema?: JsonValue;
}

export interface EntityRecord {
  id: string;
  entityTypeId: string;
  entityTypeKey: string;
  entityTypeLabel: string;
  displayName: string;
  status: EntityStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEntityInput {
  id?: string;
  entityTypeKey: string;
  displayName: string;
  status?: EntityStatus;
}

export interface ListEntitiesOptions {
  entityTypeKey?: string;
  status?: EntityStatus;
  limit?: number;
}

export interface PropertyDefinitionRecord {
  id: string;
  key: string;
  label: string;
  description: string | null;
  valueType: PropertyValueType;
  unit: string | null;
  cardinality: PropertyCardinality;
  sensitivity: PropertySensitivity;
  appliesTo: string[];
  validation: JsonValue;
  aliases: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePropertyDefinitionInput {
  id?: string;
  key: string;
  label: string;
  description?: string | null;
  valueType: string;
  unit?: string | null;
  cardinality?: PropertyCardinality;
  sensitivity?: PropertySensitivity;
  appliesTo?: readonly string[];
  validation?: JsonValue;
  aliases?: readonly string[];
}

export interface AppendPropertyValueInput {
  id?: string;
  entityId: string;
  propertyKey: string;
  value: unknown;
  sourceType: string;
  sourceId?: string | null;
  confidence?: number | null;
  confirmedBy?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
}

export interface PropertyValueRecord {
  id: string;
  entityId: string;
  propertyDefinitionId: string;
  propertyKey: string;
  propertyLabel: string;
  valueType: PropertyValueType;
  cardinality: PropertyCardinality;
  value: JsonValue;
  sourceType: string;
  sourceId: string | null;
  confidence: number | null;
  confirmedBy: string | null;
  validFrom: string | null;
  validTo: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListPropertyValueHistoryOptions {
  propertyKey?: string;
  limit?: number;
}

interface EntityTypeRow {
  id: string;
  key: string;
  label: string;
  description: string | null;
  schema_json: string;
  created_at: string;
  updated_at: string;
}

interface EntityRow {
  id: string;
  entity_type_id: string;
  entity_type_key: string;
  entity_type_label: string;
  display_name: string;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface PropertyDefinitionRow {
  id: string;
  key: string;
  label: string;
  description: string | null;
  value_type: string;
  unit: string | null;
  cardinality: string;
  sensitivity: string;
  applies_to_json: string;
  validation_json: string;
  aliases_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface PropertyValueRow {
  id: string;
  entity_id: string;
  property_definition_id: string;
  property_key: string;
  property_label: string;
  definition_value_type: string;
  cardinality: string;
  value_json: string;
  source_type: string;
  source_id: string | null;
  confidence: number | null;
  confirmed_by: string | null;
  valid_from: string | null;
  valid_to: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface EntityWithTypeRow {
  id: string;
  entity_type_id: string;
  entity_type_key: string;
}

export class KnowledgeValidationError extends Error {
  override name = "KnowledgeValidationError";
}

export class KnowledgeConflictError extends Error {
  override name = "KnowledgeConflictError";
}

export class KnowledgeNotFoundError extends Error {
  override name = "KnowledgeNotFoundError";
}

function requiredText(value: string, name: string, maximum = 500): string {
  if (typeof value !== "string") {
    throw new KnowledgeValidationError(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new KnowledgeValidationError(`${name} must not be empty`);
  }
  if (normalized.length > maximum) {
    throw new KnowledgeValidationError(`${name} must not exceed ${maximum} characters`);
  }
  return normalized;
}

function optionalText(
  value: string | null | undefined,
  name: string,
  maximum = 2_000
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.length > maximum) {
    throw new KnowledgeValidationError(`${name} must not exceed ${maximum} characters`);
  }
  return normalized;
}

function stableKey(value: string, name: string): string {
  const normalized = requiredText(value, name, 160).toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(normalized)) {
    throw new KnowledgeValidationError(
      `${name} must start with a letter and contain lowercase letters, digits, dots, underscores or hyphens`
    );
  }
  return normalized;
}

function timestamp(value: Date | string | undefined): string {
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new KnowledgeValidationError("Invalid mutation timestamp");
  }
  return date.toISOString();
}

function normalizeTemporal(
  value: string | null | undefined,
  name: string
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = requiredText(value, name, 64);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const date = new Date(`${normalized}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
      throw new KnowledgeValidationError(`${name} is not a valid calendar date`);
    }
    return normalized;
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new KnowledgeValidationError(`${name} must be an ISO date or date-time`);
  }
  return date.toISOString();
}

function temporalTime(value: string): number {
  return new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value).getTime();
}

function normalizeLimit(value: number | undefined, fallback = 100): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new KnowledgeValidationError("limit must be an integer in range 1..500");
  }
  return limit;
}

function entityStatus(value: string): EntityStatus {
  if (value === "active" || value === "inactive" || value === "archived") {
    return value;
  }
  throw new KnowledgeValidationError(`Unsupported entity status: ${value}`);
}

function cardinality(value: string): PropertyCardinality {
  if (value === "single" || value === "multiple") {
    return value;
  }
  throw new KnowledgeValidationError(`Unsupported property cardinality: ${value}`);
}

function sensitivity(value: string): PropertySensitivity {
  if (
    value === "public" ||
    value === "internal" ||
    value === "personal" ||
    value === "restricted"
  ) {
    return value;
  }
  throw new KnowledgeValidationError(`Unsupported property sensitivity: ${value}`);
}

function propertyValueType(value: string): PropertyValueType {
  if (PROPERTY_VALUE_TYPES.includes(value as PropertyValueType)) {
    return value as PropertyValueType;
  }
  throw new KnowledgeValidationError(`Unsupported property value type: ${value}`);
}

function stringArray(value: JsonValue, name: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Stored ${name} is not an array`);
  }
  return value.map((item) => {
    if (typeof item !== "string") {
      throw new Error(`Stored ${name} contains a non-string value`);
    }
    return item;
  });
}

function normalizeStringList(values: readonly string[] | undefined, name: string): string[] {
  if (values === undefined) {
    return [];
  }
  const normalized = values.map((value) => requiredText(value, name, 160));
  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
}

function jsonObject(value: JsonValue | undefined, name: string): JsonValue {
  const normalized = toJsonValue(value ?? {});
  if (normalized === null || Array.isArray(normalized) || typeof normalized !== "object") {
    throw new KnowledgeValidationError(`${name} must be a JSON object`);
  }
  return normalized;
}

function enumValues(validation: JsonValue): readonly string[] | undefined {
  if (validation === null || Array.isArray(validation) || typeof validation !== "object") {
    return undefined;
  }
  const values = validation["enum"];
  if (values === undefined) {
    return undefined;
  }
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
    throw new KnowledgeValidationError("validation.enum must be an array of strings");
  }
  return values as string[];
}

function mutationContext(context: MutationContext): {
  correlationId: string;
  actorType: string;
  actorId: string | null;
  now: string;
} {
  return {
    correlationId: requiredText(context.correlationId, "correlationId", 160),
    actorType: requiredText(context.actorType, "actorType", 80),
    actorId: optionalText(context.actorId, "actorId", 160),
    now: timestamp(context.now)
  };
}

function mapEntityType(row: EntityTypeRow): EntityTypeRecord {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    schema: parseJson(row.schema_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEntity(row: EntityRow): EntityRecord {
  return {
    id: row.id,
    entityTypeId: row.entity_type_id,
    entityTypeKey: row.entity_type_key,
    entityTypeLabel: row.entity_type_label,
    displayName: row.display_name,
    status: entityStatus(row.status),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapPropertyDefinition(row: PropertyDefinitionRow): PropertyDefinitionRecord {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    valueType: propertyValueType(row.value_type),
    unit: row.unit,
    cardinality: cardinality(row.cardinality),
    sensitivity: sensitivity(row.sensitivity),
    appliesTo: stringArray(parseJson(row.applies_to_json), "appliesTo"),
    validation: parseJson(row.validation_json),
    aliases: stringArray(parseJson(row.aliases_json), "aliases"),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapPropertyValue(row: PropertyValueRow): PropertyValueRecord {
  return {
    id: row.id,
    entityId: row.entity_id,
    propertyDefinitionId: row.property_definition_id,
    propertyKey: row.property_key,
    propertyLabel: row.property_label,
    valueType: propertyValueType(row.definition_value_type),
    cardinality: cardinality(row.cardinality),
    value: parseJson(row.value_json),
    sourceType: row.source_type,
    sourceId: row.source_id,
    confidence: row.confidence,
    confirmedBy: row.confirmed_by,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function entityTypeByKey(
  connection: SqliteExecutor,
  key: string
): EntityTypeRow | undefined {
  return connection.prepare("SELECT * FROM entity_types WHERE key = ?").get(key) as
    | EntityTypeRow
    | undefined;
}

function entityById(connection: SqliteExecutor, id: string): EntityRow | undefined {
  return connection
    .prepare(`
      SELECT e.*,
             et.key AS entity_type_key,
             et.label AS entity_type_label
      FROM entities e
      JOIN entity_types et ON et.id = e.entity_type_id
      WHERE e.id = ?
    `)
    .get(id) as EntityRow | undefined;
}

function propertyByKey(
  connection: SqliteExecutor,
  key: string
): PropertyDefinitionRow | undefined {
  return connection
    .prepare("SELECT * FROM property_definitions WHERE key = ?")
    .get(key) as PropertyDefinitionRow | undefined;
}

function propertyValueById(
  connection: SqliteExecutor,
  id: string
): PropertyValueRow | undefined {
  return connection
    .prepare(`
      SELECT v.*,
             p.key AS property_key,
             p.label AS property_label,
             p.value_type AS definition_value_type,
             p.cardinality AS cardinality
      FROM entity_property_values v
      JOIN property_definitions p ON p.id = v.property_definition_id
      WHERE v.id = ?
    `)
    .get(id) as PropertyValueRow | undefined;
}

export class KnowledgeRegistry {
  private readonly outbox: DomainEventOutbox;
  private readonly audit: AuditRepository;
  private readonly codecs: PropertyValueCodecRegistry;

  constructor(
    private readonly store: SqliteStore,
    options: {
      outbox?: DomainEventOutbox;
      audit?: AuditRepository;
      codecs?: PropertyValueCodecRegistry;
    } = {}
  ) {
    this.outbox = options.outbox ?? new DomainEventOutbox(store);
    this.audit = options.audit ?? new AuditRepository(store);
    this.codecs = options.codecs ?? new PropertyValueCodecRegistry();
  }

  createEntityType(
    input: CreateEntityTypeInput,
    contextInput: MutationContext
  ): EntityTypeRecord {
    const key = stableKey(input.key, "key");
    const label = requiredText(input.label, "label");
    const description = optionalText(input.description, "description");
    const schema = jsonObject(input.schema, "schema");
    const context = mutationContext(contextInput);
    const id = input.id ?? randomUUID();

    return this.store.transaction((connection) => {
      if (entityTypeByKey(connection, key) !== undefined) {
        throw new KnowledgeConflictError(`Entity type already exists: ${key}`);
      }
      connection
        .prepare(`
          INSERT INTO entity_types(
            id, key, label, description, schema_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(id, key, label, description, stringifyJson(schema), context.now, context.now);

      this.outbox.append(
        {
          eventType: "entity_type.created",
          schemaVersion: 1,
          source: "knowledge-registry",
          occurredAt: context.now,
          payload: { id, key, label },
          dedupeKey: `entity_type.created:${id}:v1`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "create",
          objectType: "entity_type",
          objectId: id,
          correlationId: context.correlationId,
          details: { key, version: 1 }
        },
        connection
      );

      const row = entityTypeByKey(connection, key);
      if (row === undefined) {
        throw new Error(`Created entity type was not found: ${id}`);
      }
      return mapEntityType(row);
    });
  }

  listEntityTypes(limitValue?: number): EntityTypeRecord[] {
    const limit = normalizeLimit(limitValue);
    return this.store.execute((connection) => {
      const rows = connection
        .prepare("SELECT * FROM entity_types ORDER BY key ASC LIMIT ?")
        .all(limit) as unknown as EntityTypeRow[];
      return rows.map(mapEntityType);
    });
  }

  getEntityType(keyValue: string): EntityTypeRecord {
    const key = stableKey(keyValue, "key");
    return this.store.execute((connection) => {
      const row = entityTypeByKey(connection, key);
      if (row === undefined) {
        throw new KnowledgeNotFoundError(`Entity type was not found: ${key}`);
      }
      return mapEntityType(row);
    });
  }

  createPropertyDefinition(
    input: CreatePropertyDefinitionInput,
    contextInput: MutationContext
  ): PropertyDefinitionRecord {
    const key = stableKey(input.key, "key");
    const label = requiredText(input.label, "label");
    const description = optionalText(input.description, "description");
    const valueType = propertyValueType(input.valueType);
    const unit = optionalText(input.unit, "unit", 80);
    const propertyCardinality = cardinality(input.cardinality ?? "single");
    const propertySensitivity = sensitivity(input.sensitivity ?? "internal");
    const appliesTo = normalizeStringList(input.appliesTo, "appliesTo").map((value) =>
      stableKey(value, "appliesTo")
    );
    const aliases = normalizeStringList(input.aliases, "aliases");
    const validation = jsonObject(input.validation, "validation");
    enumValues(validation);
    const context = mutationContext(contextInput);
    const id = input.id ?? randomUUID();

    return this.store.transaction((connection) => {
      if (propertyByKey(connection, key) !== undefined) {
        throw new KnowledgeConflictError(`Property definition already exists: ${key}`);
      }
      for (const entityTypeKey of appliesTo) {
        if (entityTypeByKey(connection, entityTypeKey) === undefined) {
          throw new KnowledgeNotFoundError(
            `Entity type referenced by appliesTo was not found: ${entityTypeKey}`
          );
        }
      }

      connection
        .prepare(`
          INSERT INTO property_definitions(
            id, key, label, description, value_type, unit,
            cardinality, sensitivity, applies_to_json,
            validation_json, aliases_json, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `)
        .run(
          id,
          key,
          label,
          description,
          valueType,
          unit,
          propertyCardinality,
          propertySensitivity,
          stringifyJson(appliesTo),
          stringifyJson(validation),
          stringifyJson(aliases),
          context.now,
          context.now
        );

      this.outbox.append(
        {
          eventType: "property_definition.created",
          schemaVersion: 1,
          source: "knowledge-registry",
          occurredAt: context.now,
          payload: { id, key, valueType, appliesTo },
          dedupeKey: `property_definition.created:${id}:v1`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "create",
          objectType: "property_definition",
          objectId: id,
          correlationId: context.correlationId,
          details: { key, valueType, version: 1 }
        },
        connection
      );

      const row = propertyByKey(connection, key);
      if (row === undefined) {
        throw new Error(`Created property definition was not found: ${id}`);
      }
      return mapPropertyDefinition(row);
    });
  }

  listPropertyDefinitions(limitValue?: number): PropertyDefinitionRecord[] {
    const limit = normalizeLimit(limitValue);
    return this.store.execute((connection) => {
      const rows = connection
        .prepare("SELECT * FROM property_definitions ORDER BY key ASC LIMIT ?")
        .all(limit) as unknown as PropertyDefinitionRow[];
      return rows.map(mapPropertyDefinition);
    });
  }

  getPropertyDefinition(keyValue: string): PropertyDefinitionRecord {
    const key = stableKey(keyValue, "key");
    return this.store.execute((connection) => {
      const row = propertyByKey(connection, key);
      if (row === undefined) {
        throw new KnowledgeNotFoundError(`Property definition was not found: ${key}`);
      }
      return mapPropertyDefinition(row);
    });
  }

  createEntity(
    input: CreateEntityInput,
    contextInput: MutationContext
  ): EntityRecord {
    const entityTypeKey = stableKey(input.entityTypeKey, "entityTypeKey");
    const displayName = requiredText(input.displayName, "displayName");
    const status = entityStatus(input.status ?? "active");
    const context = mutationContext(contextInput);
    const id = input.id ?? randomUUID();

    return this.store.transaction((connection) => {
      const type = entityTypeByKey(connection, entityTypeKey);
      if (type === undefined) {
        throw new KnowledgeNotFoundError(`Entity type was not found: ${entityTypeKey}`);
      }
      if (
        connection.prepare("SELECT 1 AS found FROM entities WHERE id = ?").get(id) !==
        undefined
      ) {
        throw new KnowledgeConflictError(`Entity already exists: ${id}`);
      }

      connection
        .prepare(`
          INSERT INTO entities(
            id, entity_type_id, display_name, status, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?)
        `)
        .run(id, type.id, displayName, status, context.now, context.now);

      this.outbox.append(
        {
          eventType: "entity.created",
          schemaVersion: 1,
          source: "knowledge-registry",
          occurredAt: context.now,
          entityId: id,
          payload: { id, entityTypeKey, displayName, status, version: 1 },
          dedupeKey: `entity.created:${id}:v1`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "create",
          objectType: "entity",
          objectId: id,
          correlationId: context.correlationId,
          details: { entityTypeKey, version: 1 }
        },
        connection
      );

      const row = entityById(connection, id);
      if (row === undefined) {
        throw new Error(`Created entity was not found: ${id}`);
      }
      return mapEntity(row);
    });
  }

  listEntities(options: ListEntitiesOptions = {}): EntityRecord[] {
    const entityTypeKey =
      options.entityTypeKey === undefined
        ? null
        : stableKey(options.entityTypeKey, "entityTypeKey");
    const status = options.status === undefined ? null : entityStatus(options.status);
    const limit = normalizeLimit(options.limit);

    return this.store.execute((connection) => {
      const rows = connection
        .prepare(`
          SELECT e.*,
                 et.key AS entity_type_key,
                 et.label AS entity_type_label
          FROM entities e
          JOIN entity_types et ON et.id = e.entity_type_id
          WHERE (? IS NULL OR et.key = ?)
            AND (? IS NULL OR e.status = ?)
          ORDER BY e.display_name ASC, e.id ASC
          LIMIT ?
        `)
        .all(entityTypeKey, entityTypeKey, status, status, limit) as unknown as EntityRow[];
      return rows.map(mapEntity);
    });
  }

  getEntity(idValue: string): EntityRecord {
    const id = requiredText(idValue, "entityId", 160);
    return this.store.execute((connection) => {
      const row = entityById(connection, id);
      if (row === undefined) {
        throw new KnowledgeNotFoundError(`Entity was not found: ${id}`);
      }
      return mapEntity(row);
    });
  }

  appendPropertyValue(
    input: AppendPropertyValueInput,
    contextInput: MutationContext
  ): PropertyValueRecord {
    const entityId = requiredText(input.entityId, "entityId", 160);
    const propertyKey = stableKey(input.propertyKey, "propertyKey");
    const sourceType = requiredText(input.sourceType, "sourceType", 80);
    const sourceId = optionalText(input.sourceId, "sourceId", 160);
    const confirmedBy = optionalText(input.confirmedBy, "confirmedBy", 160);
    const validFrom = normalizeTemporal(input.validFrom, "validFrom");
    const validTo = normalizeTemporal(input.validTo, "validTo");
    if (
      validFrom !== null &&
      validTo !== null &&
      temporalTime(validFrom) > temporalTime(validTo)
    ) {
      throw new KnowledgeValidationError("validFrom must not be after validTo");
    }
    let confidence: number | null = input.confidence ?? null;
    if (
      confidence !== null &&
      (typeof confidence !== "number" ||
        !Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1)
    ) {
      throw new KnowledgeValidationError("confidence must be a number in range 0..1");
    }
    const context = mutationContext(contextInput);
    const id = input.id ?? randomUUID();

    return this.store.transaction((connection) => {
      const entity = connection
        .prepare(`
          SELECT e.id, e.entity_type_id, et.key AS entity_type_key
          FROM entities e
          JOIN entity_types et ON et.id = e.entity_type_id
          WHERE e.id = ?
        `)
        .get(entityId) as EntityWithTypeRow | undefined;
      if (entity === undefined) {
        throw new KnowledgeNotFoundError(`Entity was not found: ${entityId}`);
      }
      const property = propertyByKey(connection, propertyKey);
      if (property === undefined) {
        throw new KnowledgeNotFoundError(
          `Property definition was not found: ${propertyKey}`
        );
      }

      const appliesTo = stringArray(parseJson(property.applies_to_json), "appliesTo");
      if (appliesTo.length > 0 && !appliesTo.includes(entity.entity_type_key)) {
        throw new KnowledgeValidationError(
          `Property ${propertyKey} does not apply to entity type ${entity.entity_type_key}`
        );
      }
      const validation = parseJson(property.validation_json);
      const encoded = this.codecs.encode(
        propertyValueType(property.value_type),
        input.value,
        { allowedValues: enumValues(validation) }
      );

      if (
        encoded.valueEntityId !== null &&
        connection.prepare("SELECT 1 AS found FROM entities WHERE id = ?").get(
          encoded.valueEntityId
        ) === undefined
      ) {
        throw new KnowledgeNotFoundError(
          `Referenced entity was not found: ${encoded.valueEntityId}`
        );
      }
      if (
        encoded.valueFileId !== null &&
        connection.prepare("SELECT 1 AS found FROM files WHERE id = ?").get(
          encoded.valueFileId
        ) === undefined
      ) {
        throw new KnowledgeNotFoundError(
          `Referenced file was not found: ${encoded.valueFileId}`
        );
      }

      const versionRow = connection
        .prepare(`
          SELECT COALESCE(MAX(version), 0) AS max_version
          FROM entity_property_values
          WHERE entity_id = ? AND property_definition_id = ?
        `)
        .get(entityId, property.id) as { max_version: number };
      const version = Number(versionRow.max_version) + 1;

      connection
        .prepare(`
          INSERT INTO entity_property_values(
            id, entity_id, property_definition_id, value_json,
            source_type, source_id, confidence, confirmed_by,
            valid_from, valid_to, version, created_at, updated_at,
            value_type, value_text, value_number, value_integer,
            value_boolean, value_date, value_datetime,
            value_entity_id, value_file_id
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?
          )
        `)
        .run(
          id,
          entityId,
          property.id,
          encoded.valueJson,
          sourceType,
          sourceId,
          confidence,
          confirmedBy,
          validFrom,
          validTo,
          version,
          context.now,
          context.now,
          encoded.valueType,
          encoded.valueText,
          encoded.valueNumber,
          encoded.valueInteger,
          encoded.valueBoolean,
          encoded.valueDate,
          encoded.valueDatetime,
          encoded.valueEntityId,
          encoded.valueFileId
        );

      this.outbox.append(
        {
          eventType: "entity.property_value.appended",
          schemaVersion: 1,
          source: "knowledge-registry",
          occurredAt: context.now,
          entityId,
          payload: {
            entityId,
            propertyKey,
            propertyValueId: id,
            valueType: encoded.valueType,
            version
          },
          dedupeKey: `entity.property_value.appended:${id}:v${version}`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "append_property_value",
          objectType: "entity",
          objectId: entityId,
          correlationId: context.correlationId,
          details: { propertyKey, propertyValueId: id, version }
        },
        connection
      );

      const row = propertyValueById(connection, id);
      if (row === undefined) {
        throw new Error(`Created property value was not found: ${id}`);
      }
      return mapPropertyValue(row);
    });
  }

  listPropertyValueHistory(
    entityIdValue: string,
    options: ListPropertyValueHistoryOptions = {}
  ): PropertyValueRecord[] {
    const entityId = requiredText(entityIdValue, "entityId", 160);
    const propertyKey =
      options.propertyKey === undefined
        ? null
        : stableKey(options.propertyKey, "propertyKey");
    const limit = normalizeLimit(options.limit, 200);

    return this.store.execute((connection) => {
      if (entityById(connection, entityId) === undefined) {
        throw new KnowledgeNotFoundError(`Entity was not found: ${entityId}`);
      }
      const rows = connection
        .prepare(`
          SELECT v.*,
                 p.key AS property_key,
                 p.label AS property_label,
                 p.value_type AS definition_value_type,
                 p.cardinality AS cardinality
          FROM entity_property_values v
          JOIN property_definitions p ON p.id = v.property_definition_id
          WHERE v.entity_id = ?
            AND (? IS NULL OR p.key = ?)
          ORDER BY p.key ASC, v.version DESC, v.created_at DESC
          LIMIT ?
        `)
        .all(entityId, propertyKey, propertyKey, limit) as unknown as PropertyValueRow[];
      return rows.map(mapPropertyValue);
    });
  }
}
