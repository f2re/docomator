import { createHash, randomUUID } from "node:crypto";

import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import {
  generateOpaqueStableKey,
  KnowledgeConflictError,
  KnowledgeNotFoundError,
  KnowledgeRegistry,
  KnowledgeValidationError,
  type MutationContext,
  type PropertyDefinitionRecord
} from "./knowledge.js";
import { parseJson, stringifyJson, toJsonValue, type JsonValue } from "./json.js";
import { DomainEventOutbox } from "./outbox.js";
import {
  PROPERTY_VALUE_TYPES,
  type PropertyValueType
} from "./property-codec.js";
import { SpaceNotFoundError, SpaceRegistry } from "./spaces.js";

export const STANDARD_PERSON_TYPE_KEY = "person";

export type EmployeeStatus = "active" | "inactive" | "archived";

export interface NewEmployeeFieldDefinitionInput {
  label: string;
  valueType: string;
  unit?: string | null;
}

export interface CreateEmployeeFieldInput {
  propertyKey?: string;
  definition?: NewEmployeeFieldDefinitionInput;
  value: unknown;
}

export interface CreateEmployeeInput {
  displayName: string;
  status?: EmployeeStatus;
  fields?: readonly CreateEmployeeFieldInput[];
  idempotencyKey?: string;
}

export interface UpdateEmployeeFieldInput {
  propertyKey?: string;
  definition?: NewEmployeeFieldDefinitionInput;
  value: unknown;
}

export interface UpdateEmployeeInput {
  displayName?: string;
  status?: EmployeeStatus;
  fields?: readonly UpdateEmployeeFieldInput[];
  idempotencyKey?: string;
}

export interface EmployeeFieldRecord {
  definition: PropertyDefinitionRecord;
  value: JsonValue;
  valueVersion: number;
  valueUpdatedAt: string;
}

export interface EmployeeProfileRecord {
  id: string;
  spaceId: string;
  displayName: string;
  status: EmployeeStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  fields: EmployeeFieldRecord[];
}

export interface EmployeeSummaryRecord {
  id: string;
  spaceId: string;
  displayName: string;
  status: EmployeeStatus;
  version: number;
  fieldCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListEmployeesOptions {
  status?: EmployeeStatus;
  limit?: number;
}

export interface CreateEmployeeResult {
  profile: EmployeeProfileRecord;
  created: boolean;
}

interface NormalizedContext {
  correlationId: string;
  actorType: string;
  actorId: string | null;
  now: string;
}

interface EmployeeRow {
  id: string;
  space_id: string;
  display_name: string;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface EmployeeFieldRow {
  property_key: string;
  property_id: string;
  property_label: string;
  property_description: string | null;
  value_type: string;
  unit: string | null;
  cardinality: string;
  sensitivity: string;
  applies_to_json: string;
  validation_json: string;
  aliases_json: string;
  property_version: number;
  property_created_at: string;
  property_updated_at: string;
  value_json: string;
  value_version: number;
  value_updated_at: string;
}

interface EmployeeCreateRequestRow {
  request_hash: string;
  employee_id: string;
}

interface EmployeeUpdateRequestRow {
  request_hash: string;
}

interface EmployeePropertyMatchRow {
  key: string;
  label: string;
  value_type: string;
  applies_to_json: string;
}

interface EmployeeSummaryRow extends EmployeeRow {
  field_count: number;
}

type NormalizedCreateField =
  | {
      kind: "existing";
      propertyKey: string;
      value: JsonValue;
    }
  | {
      kind: "new";
      definition: {
        label: string;
        valueType: PropertyValueType;
        unit: string | null;
      };
      value: JsonValue;
    };

interface NormalizedCreateInput {
  displayName: string;
  status: EmployeeStatus;
  fields: NormalizedCreateField[];
  idempotencyKey: string | null;
}

interface NormalizedUpdateInput {
  displayName: string | undefined;
  status: EmployeeStatus | undefined;
  fields: NormalizedCreateField[];
  idempotencyKey: string | null;
}

const MAX_FIELDS = 200;
const MAX_GENERATED_KEY_ATTEMPTS = 10;

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
  maximum: number
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

function normalizedLabel(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("ru-RU");
}

function status(value: string): EmployeeStatus {
  if (value === "active" || value === "inactive" || value === "archived") {
    return value;
  }
  throw new KnowledgeValidationError(`Unsupported employee status: ${value}`);
}

function valueType(value: string): PropertyValueType {
  if (PROPERTY_VALUE_TYPES.includes(value as PropertyValueType)) {
    return value as PropertyValueType;
  }
  throw new KnowledgeValidationError(`Unsupported property value type: ${value}`);
}

function jsonValue(value: unknown, name: string): JsonValue {
  try {
    return toJsonValue(value);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new KnowledgeValidationError(`${name} must be a JSON value`);
    }
    throw error;
  }
}

function timestamp(value: Date | string | undefined): string {
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new KnowledgeValidationError("Invalid mutation timestamp");
  }
  return date.toISOString();
}

function normalizeContext(context: MutationContext): NormalizedContext {
  return {
    correlationId: requiredText(context.correlationId, "correlationId", 160),
    actorType: requiredText(context.actorType, "actorType", 80),
    actorId: optionalText(context.actorId, "actorId", 160),
    now: timestamp(context.now)
  };
}

function normalizeFieldsCount(fields: readonly unknown[]): void {
  if (!Array.isArray(fields)) {
    throw new KnowledgeValidationError("fields must be an array");
  }
  if (fields.length > MAX_FIELDS) {
    throw new KnowledgeValidationError(`fields must not contain more than ${MAX_FIELDS} items`);
  }
}

function normalizeLimit(value: number | undefined): number {
  const limit = value ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new KnowledgeValidationError("limit must be an integer in range 1..1000");
  }
  return limit;
}

function normalizeCreateInput(input: CreateEmployeeInput): NormalizedCreateInput {
  const fields = input.fields ?? [];
  normalizeFieldsCount(fields);
  const normalizedFields: NormalizedCreateField[] = fields.map((field, index) => {
    const hasPropertyKey = field.propertyKey !== undefined;
    const hasDefinition = field.definition !== undefined;
    if (hasPropertyKey === hasDefinition) {
      throw new KnowledgeValidationError(
        `fields[${index}] must contain either propertyKey or definition`
      );
    }
    const value = jsonValue(field.value, `fields[${index}].value`);
    if (field.propertyKey !== undefined) {
      return {
        kind: "existing",
        propertyKey: stableKey(field.propertyKey, `fields[${index}].propertyKey`),
        value
      };
    }
    const definition = field.definition;
    if (definition === undefined) {
      throw new KnowledgeValidationError(`fields[${index}].definition is required`);
    }
    return {
      kind: "new",
      definition: {
        label: requiredText(definition.label, `fields[${index}].definition.label`),
        valueType: valueType(definition.valueType),
        unit: optionalText(definition.unit, `fields[${index}].definition.unit`, 80)
      },
      value
    };
  });
  const existingKeys = normalizedFields
    .filter((field): field is Extract<NormalizedCreateField, { kind: "existing" }> =>
      field.kind === "existing"
    )
    .map((field) => field.propertyKey);
  if (new Set(existingKeys).size !== existingKeys.length) {
    throw new KnowledgeValidationError("fields must not contain duplicate propertyKey values");
  }
  return {
    displayName: requiredText(input.displayName, "displayName"),
    status: status(input.status ?? "active"),
    fields: normalizedFields,
    idempotencyKey: optionalText(input.idempotencyKey, "idempotencyKey", 160)
  };
}

function normalizeUpdateInput(input: UpdateEmployeeInput): NormalizedUpdateInput {
  const fields = input.fields ?? [];
  normalizeFieldsCount(fields);
  const normalizedFields: NormalizedCreateField[] = fields.map((field, index) => {
    const hasPropertyKey = field.propertyKey !== undefined;
    const hasDefinition = field.definition !== undefined;
    if (hasPropertyKey === hasDefinition) {
      throw new KnowledgeValidationError(
        `fields[${index}] must contain either propertyKey or definition`
      );
    }
    const value = jsonValue(field.value, `fields[${index}].value`);
    if (field.propertyKey !== undefined) {
      return {
        kind: "existing",
        propertyKey: stableKey(field.propertyKey, `fields[${index}].propertyKey`),
        value
      };
    }
    const definition = field.definition;
    if (definition === undefined) {
      throw new KnowledgeValidationError(`fields[${index}].definition is required`);
    }
    return {
      kind: "new",
      definition: {
        label: requiredText(definition.label, `fields[${index}].definition.label`),
        valueType: valueType(definition.valueType),
        unit: optionalText(definition.unit, `fields[${index}].definition.unit`, 80)
      },
      value
    };
  });
  const propertyKeys = normalizedFields
    .filter((field): field is Extract<NormalizedCreateField, { kind: "existing" }> =>
      field.kind === "existing"
    )
    .map((field) => field.propertyKey);
  if (new Set(propertyKeys).size !== propertyKeys.length) {
    throw new KnowledgeValidationError("fields must not contain duplicate propertyKey values");
  }
  const displayName =
    input.displayName === undefined
      ? undefined
      : requiredText(input.displayName, "displayName");
  const employeeStatus = input.status === undefined ? undefined : status(input.status);
  if (displayName === undefined && employeeStatus === undefined && normalizedFields.length === 0) {
    throw new KnowledgeValidationError("Employee update must contain at least one change");
  }
  return {
    displayName,
    status: employeeStatus,
    fields: normalizedFields,
    idempotencyKey: optionalText(input.idempotencyKey, "idempotencyKey", 160)
  };
}

function stringArray(value: JsonValue, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Stored ${name} is invalid`);
  }
  return value as string[];
}

function propertyDefinitionFromRow(row: EmployeeFieldRow): PropertyDefinitionRecord {
  return {
    id: row.property_id,
    key: row.property_key,
    label: row.property_label,
    description: row.property_description,
    valueType: valueType(row.value_type),
    unit: row.unit,
    cardinality: row.cardinality === "multiple" ? "multiple" : "single",
    sensitivity:
      row.sensitivity === "public" ||
      row.sensitivity === "personal" ||
      row.sensitivity === "restricted"
        ? row.sensitivity
        : "internal",
    appliesTo: stringArray(parseJson(row.applies_to_json), "appliesTo"),
    validation: parseJson(row.validation_json),
    aliases: stringArray(parseJson(row.aliases_json), "aliases"),
    version: row.property_version,
    createdAt: row.property_created_at,
    updatedAt: row.property_updated_at
  };
}

function employeeRow(
  connection: SqliteExecutor,
  spaceId: string,
  employeeId: string
): EmployeeRow | undefined {
  return connection
    .prepare(`
      SELECT e.id,
             seo.space_id,
             e.display_name,
             e.status,
             e.version,
             e.created_at,
             e.updated_at
      FROM entities e
      JOIN entity_types et ON et.id = e.entity_type_id AND et.key = 'person'
      JOIN space_entity_ownership seo ON seo.entity_id = e.id
      WHERE e.id = ?
        AND seo.space_id = ?
        AND e.status IN ('active', 'inactive', 'archived')
    `)
    .get(employeeId, spaceId) as EmployeeRow | undefined;
}

function employeeProfile(
  connection: SqliteExecutor,
  spaceId: string,
  employeeId: string
): EmployeeProfileRecord {
  const employee = employeeRow(connection, spaceId, employeeId);
  if (employee === undefined) {
    throw new SpaceNotFoundError(`Employee was not found in this space: ${employeeId}`);
  }
  const rows = connection
    .prepare(`
      SELECT p.key AS property_key,
             p.id AS property_id,
             p.label AS property_label,
             p.description AS property_description,
             p.value_type,
             p.unit,
             p.cardinality,
             p.sensitivity,
             p.applies_to_json,
             p.validation_json,
             p.aliases_json,
             p.version AS property_version,
             p.created_at AS property_created_at,
             p.updated_at AS property_updated_at,
             v.value_json,
             v.version AS value_version,
             v.updated_at AS value_updated_at
      FROM entity_property_values v
      JOIN property_definitions p ON p.id = v.property_definition_id
      WHERE v.entity_id = ?
        AND v.version = (
          SELECT MAX(latest.version)
          FROM entity_property_values latest
          WHERE latest.entity_id = v.entity_id
            AND latest.property_definition_id = v.property_definition_id
        )
      ORDER BY p.label ASC, p.key ASC
    `)
    .all(employeeId) as unknown as EmployeeFieldRow[];
  return {
    id: employee.id,
    spaceId: employee.space_id,
    displayName: employee.display_name,
    status: status(employee.status),
    version: employee.version,
    createdAt: employee.created_at,
    updatedAt: employee.updated_at,
    fields: rows.map((row) => ({
      definition: propertyDefinitionFromRow(row),
      value: parseJson(row.value_json),
      valueVersion: row.value_version,
      valueUpdatedAt: row.value_updated_at
    }))
  };
}

function requestHash(input: NormalizedCreateInput): string {
  return createHash("sha256")
    .update(
      stringifyJson({
        displayName: input.displayName,
        status: input.status,
        fields: input.fields
      })
    )
    .digest("hex");
}

function updateRequestHash(input: NormalizedUpdateInput): string {
  return createHash("sha256")
    .update(
      stringifyJson({
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
        ...(input.status === undefined ? {} : { status: input.status }),
        fields: input.fields
      })
    )
    .digest("hex");
}

export class EmployeeRegistry {
  private readonly knowledge: KnowledgeRegistry;
  private readonly spaces: SpaceRegistry;
  private readonly outbox: DomainEventOutbox;
  private readonly audit: AuditRepository;
  private readonly fieldKeyFactory: () => string;

  constructor(
    private readonly store: SqliteStore,
    options: {
      knowledge?: KnowledgeRegistry;
      spaces?: SpaceRegistry;
      outbox?: DomainEventOutbox;
      audit?: AuditRepository;
      fieldKeyFactory?: () => string;
    } = {}
  ) {
    this.knowledge = options.knowledge ?? new KnowledgeRegistry(store);
    this.spaces = options.spaces ?? new SpaceRegistry(store);
    this.outbox = options.outbox ?? new DomainEventOutbox(store);
    this.audit = options.audit ?? new AuditRepository(store);
    this.fieldKeyFactory =
      options.fieldKeyFactory ?? (() => generateOpaqueStableKey("employee_field"));
  }

  create(
    spaceIdentity: string,
    input: CreateEmployeeInput,
    contextInput: MutationContext
  ): CreateEmployeeResult {
    const normalized = normalizeCreateInput(input);
    const context = normalizeContext(contextInput);
    const hash = requestHash(normalized);

    return this.store.transaction((connection) => {
      const space = this.spaces.getSpace(spaceIdentity);
      if (normalized.idempotencyKey !== null) {
        const existing = connection
          .prepare(`
            SELECT request_hash, employee_id
            FROM employee_create_requests
            WHERE space_id = ? AND idempotency_key = ?
          `)
          .get(space.id, normalized.idempotencyKey) as
          | EmployeeCreateRequestRow
          | undefined;
        if (existing !== undefined) {
          if (existing.request_hash !== hash) {
            throw new KnowledgeConflictError(
              `Employee idempotency key was reused with different input: ${normalized.idempotencyKey}`
            );
          }
          return {
            profile: employeeProfile(connection, space.id, existing.employee_id),
            created: false
          };
        }
      }

      const fields = normalized.fields.map((field) => {
        if (field.kind === "existing") {
          const definition = this.requireEmployeeProperty(field.propertyKey);
          this.validateEmployeeFieldReference(
            connection,
            space.id,
            definition,
            field.value
          );
          return {
            propertyKey: definition.key,
            value: field.value
          };
        }
        const definition = this.resolveOrCreateDefinition(field.definition, context);
        this.validateEmployeeFieldReference(
          connection,
          space.id,
          definition,
          field.value
        );
        return { propertyKey: definition.key, value: field.value };
      });
      const entity = this.spaces.createEntity(
        space.id,
        {
          entityTypeKey: STANDARD_PERSON_TYPE_KEY,
          displayName: normalized.displayName,
          status: normalized.status
        },
        context
      );
      for (const field of fields) {
        this.knowledge.appendPropertyValue(
          {
            entityId: entity.entityId,
            propertyKey: field.propertyKey,
            value: field.value,
            sourceType: "employee_profile",
            sourceId: normalized.idempotencyKey,
            confirmedBy: context.actorId
          },
          context
        );
      }
      this.outbox.append(
        {
          eventType: "employee.profile.created",
          schemaVersion: 1,
          source: "employee-registry",
          occurredAt: context.now,
          entityId: entity.entityId,
          payload: {
            employeeId: entity.entityId,
            spaceId: space.id,
            fieldKeys: fields.map((field) => field.propertyKey)
          },
          dedupeKey: `employee.profile.created:${entity.entityId}:v1`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "create_profile",
          objectType: "employee",
          objectId: entity.entityId,
          correlationId: context.correlationId,
          details: { spaceId: space.id, fieldKeys: fields.map((field) => field.propertyKey) }
        },
        connection
      );
      if (normalized.idempotencyKey !== null) {
        connection
          .prepare(`
            INSERT INTO employee_create_requests(
              space_id, idempotency_key, request_hash, employee_id,
              correlation_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
          `)
          .run(
            space.id,
            normalized.idempotencyKey,
            hash,
            entity.entityId,
            context.correlationId,
            context.now
          );
      }
      return {
        profile: employeeProfile(connection, space.id, entity.entityId),
        created: true
      };
    });
  }

  get(spaceIdentity: string, employeeIdValue: string): EmployeeProfileRecord {
    const employeeId = requiredText(employeeIdValue, "employeeId", 160);
    return this.store.execute((connection) => {
      const space = this.spaces.getSpace(spaceIdentity);
      return employeeProfile(connection, space.id, employeeId);
    });
  }

  list(
    spaceIdentity: string,
    options: ListEmployeesOptions = {}
  ): EmployeeSummaryRecord[] {
    const employeeStatus = options.status === undefined ? null : status(options.status);
    const limit = normalizeLimit(options.limit);
    return this.store.execute((connection) => {
      const space = this.spaces.getSpace(spaceIdentity);
      const rows = connection
        .prepare(`
          SELECT e.id,
                 seo.space_id,
                 e.display_name,
                 e.status,
                 e.version,
                 e.created_at,
                 e.updated_at,
                 COUNT(DISTINCT v.property_definition_id) AS field_count
          FROM entities e
          JOIN entity_types et ON et.id = e.entity_type_id AND et.key = 'person'
          JOIN space_entity_ownership seo ON seo.entity_id = e.id
          LEFT JOIN entity_property_values v ON v.entity_id = e.id
          WHERE seo.space_id = ?
            AND e.status IN ('active', 'inactive', 'archived')
            AND (? IS NULL OR e.status = ?)
          GROUP BY e.id, seo.space_id
          ORDER BY e.display_name ASC, e.id ASC
          LIMIT ?
        `)
        .all(space.id, employeeStatus, employeeStatus, limit) as unknown as EmployeeSummaryRow[];
      return rows.map((row) => ({
        id: row.id,
        spaceId: row.space_id,
        displayName: row.display_name,
        status: status(row.status),
        version: row.version,
        fieldCount: Number(row.field_count),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    });
  }

  update(
    spaceIdentity: string,
    employeeIdValue: string,
    input: UpdateEmployeeInput,
    contextInput: MutationContext
  ): EmployeeProfileRecord {
    const employeeId = requiredText(employeeIdValue, "employeeId", 160);
    const normalized = normalizeUpdateInput(input);
    const context = normalizeContext(contextInput);
    const hash = updateRequestHash(normalized);

    return this.store.transaction((connection) => {
      const space = this.spaces.getSpace(spaceIdentity);
      const current = employeeRow(connection, space.id, employeeId);
      if (current === undefined) {
        throw new SpaceNotFoundError(`Employee was not found in this space: ${employeeId}`);
      }
      if (normalized.idempotencyKey !== null) {
        const existing = connection
          .prepare(`
            SELECT request_hash
            FROM employee_update_requests
            WHERE space_id = ? AND employee_id = ? AND idempotency_key = ?
          `)
          .get(space.id, employeeId, normalized.idempotencyKey) as
          | EmployeeUpdateRequestRow
          | undefined;
        if (existing !== undefined) {
          if (existing.request_hash !== hash) {
            throw new KnowledgeConflictError(
              `Employee update idempotency key was reused with different input: ${normalized.idempotencyKey}`
            );
          }
          return employeeProfile(connection, space.id, employeeId);
        }
      }
      const fields = normalized.fields.map((field) => {
        if (field.kind === "existing") {
          const definition = this.requireEmployeeProperty(field.propertyKey);
          this.validateEmployeeFieldReference(
            connection,
            space.id,
            definition,
            field.value
          );
          return {
            propertyKey: definition.key,
            value: field.value
          };
        }
        const definition = this.resolveOrCreateDefinition(field.definition, context);
        this.validateEmployeeFieldReference(
          connection,
          space.id,
          definition,
          field.value
        );
        return { propertyKey: definition.key, value: field.value };
      });
      for (const field of fields) {
        this.knowledge.appendPropertyValue(
          {
            entityId: employeeId,
            propertyKey: field.propertyKey,
            value: field.value,
            sourceType: "employee_profile",
            sourceId: normalized.idempotencyKey,
            confirmedBy: context.actorId
          },
          context
        );
      }
      const nextDisplayName = normalized.displayName ?? current.display_name;
      const nextStatus = normalized.status ?? status(current.status);
      const entityChanged =
        nextDisplayName !== current.display_name || nextStatus !== current.status;
      const nextVersion = entityChanged ? current.version + 1 : current.version;
      if (entityChanged) {
        connection
          .prepare(`
            UPDATE entities
            SET display_name = ?, status = ?, version = ?, updated_at = ?
            WHERE id = ?
          `)
          .run(nextDisplayName, nextStatus, nextVersion, context.now, employeeId);
      }
      const operationId = randomUUID();
      this.outbox.append(
        {
          eventType: "employee.profile.updated",
          schemaVersion: 1,
          source: "employee-registry",
          occurredAt: context.now,
          entityId: employeeId,
          payload: {
            employeeId,
            spaceId: space.id,
            entityVersion: nextVersion,
            fieldKeys: fields.map((field) => field.propertyKey)
          },
          dedupeKey: `employee.profile.updated:${employeeId}:${operationId}`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "update_profile",
          objectType: "employee",
          objectId: employeeId,
          correlationId: context.correlationId,
          details: {
            spaceId: space.id,
            entityVersion: nextVersion,
            fieldKeys: fields.map((field) => field.propertyKey)
          }
        },
        connection
      );
      if (normalized.idempotencyKey !== null) {
        connection
          .prepare(`
            INSERT INTO employee_update_requests(
              space_id, employee_id, idempotency_key, request_hash,
              correlation_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
          `)
          .run(
            space.id,
            employeeId,
            normalized.idempotencyKey,
            hash,
            context.correlationId,
            context.now
          );
      }
      return employeeProfile(connection, space.id, employeeId);
    });
  }

  private requireEmployeeProperty(propertyKey: string): PropertyDefinitionRecord {
    const definition = this.knowledge.getPropertyDefinition(propertyKey);
    if (
      definition.appliesTo.length > 0 &&
      !definition.appliesTo.includes(STANDARD_PERSON_TYPE_KEY)
    ) {
      throw new KnowledgeValidationError(
        `Property ${propertyKey} does not apply to entity type ${STANDARD_PERSON_TYPE_KEY}`
      );
    }
    this.ensureEmployeeValueTypeSupported(definition.valueType);
    return definition;
  }

  private ensureEmployeeValueTypeSupported(valueType: PropertyValueType): void {
    if (valueType === "file" || valueType === "image") {
      throw new KnowledgeValidationError(
        "Поля типа «Файл» и «Изображение» пока нельзя сохранять в карточке сотрудника: файл не привязан к выбранному пространству."
      );
    }
  }

  private validateEmployeeFieldReference(
    connection: SqliteExecutor,
    spaceId: string,
    definition: PropertyDefinitionRecord,
    value: JsonValue
  ): void {
    if (definition.valueType !== "entity-reference") {
      return;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new KnowledgeValidationError(
        "Поле-ссылка должно указывать на объект выбранного пространства."
      );
    }
    const target = connection
      .prepare(`
        SELECT 1
        FROM entities e
        JOIN space_entity_ownership seo ON seo.entity_id = e.id
        WHERE e.id = ? AND seo.space_id = ?
      `)
      .get(value.trim(), spaceId);
    if (target === undefined) {
      throw new KnowledgeValidationError(
        "Связанный объект не найден в выбранном пространстве."
      );
    }
  }

  private resolveOrCreateDefinition(
    input: {
      label: string;
      valueType: PropertyValueType;
      unit: string | null;
    },
    context: NormalizedContext
  ): PropertyDefinitionRecord {
    this.ensureEmployeeValueTypeSupported(input.valueType);
    const matches = this.store.execute((connection) => {
      const rows = connection
        .prepare(`
          SELECT key, label, value_type, applies_to_json
          FROM property_definitions
          ORDER BY key ASC
        `)
        .all() as unknown as EmployeePropertyMatchRow[];
      const targetLabel = normalizedLabel(input.label);
      return rows.filter((row) => {
        const appliesTo = stringArray(parseJson(row.applies_to_json), "appliesTo");
        return (
          appliesTo.includes(STANDARD_PERSON_TYPE_KEY) &&
          normalizedLabel(row.label) === targetLabel
        );
      });
    });
    if (matches.length > 1) {
      throw new KnowledgeConflictError(
        `Employee property label is ambiguous: ${input.label}`
      );
    }
    const existing = matches[0];
    if (existing !== undefined) {
      if (existing.value_type !== input.valueType) {
        throw new KnowledgeConflictError(
          `Employee property label already uses another value type: ${input.label}`
        );
      }
      const definition = this.knowledge.getPropertyDefinition(existing.key);
      this.ensureEmployeeValueTypeSupported(definition.valueType);
      return definition;
    }
    for (let attempt = 0; attempt < MAX_GENERATED_KEY_ATTEMPTS; attempt += 1) {
      const key = stableKey(this.fieldKeyFactory(), "generatedPropertyKey");
      try {
        return this.knowledge.createPropertyDefinition(
          {
            key,
            label: input.label,
            valueType: input.valueType,
            unit: input.unit,
            cardinality: "single",
            sensitivity: "personal",
            appliesTo: [STANDARD_PERSON_TYPE_KEY]
          },
          context
        );
      } catch (error) {
        if (!(error instanceof KnowledgeConflictError)) {
          throw error;
        }
      }
    }
    throw new KnowledgeConflictError(
      "Could not allocate a unique employee property key"
    );
  }
}
