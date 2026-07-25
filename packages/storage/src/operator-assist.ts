import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import type {
  DocumentGenerationMode
} from "./document-generation.js";
import {
  DocumentScheduleConflictError,
  DocumentScheduleNotFoundError,
  DocumentScheduleRegistry,
  DocumentScheduleValidationError,
  type DocumentScheduleDelivery,
  type DocumentScheduleRecord,
  type DocumentScheduleRecurrence
} from "./document-schedules.js";
import { parseJson, stringifyJson, toJsonValue, type JsonValue } from "./json.js";
import {
  KnowledgeConflictError,
  KnowledgeNotFoundError,
  KnowledgeRegistry,
  KnowledgeValidationError,
  type MutationContext,
  type PropertyDefinitionRecord,
  type PropertySensitivity
} from "./knowledge.js";
import { DomainEventOutbox } from "./outbox.js";
import {
  initialScheduleRunAt,
  normalizeLocalDate,
  normalizeLocalTime,
  normalizeTimeZone
} from "./schedule-time.js";
import {
  SpaceNotFoundError,
  SpaceRegistry,
  SpaceValidationError,
  type AudienceGroupRecord,
  type SpaceStatus
} from "./spaces.js";

export interface PropertySuggestionValue {
  value: string;
  usageCount: number;
  lastUsedAt: string | null;
  configured: boolean;
}

export interface PropertySuggestionRecord {
  propertyKey: string;
  label: string;
  valueType: "string" | "text" | "enum";
  allowCustom: boolean;
  values: PropertySuggestionValue[];
}

export interface UpdatePropertyDefinitionInput {
  label?: string;
  description?: string | null;
  unit?: string | null;
  sensitivity?: PropertySensitivity;
  validation?: JsonValue;
  aliases?: readonly string[];
}

export interface UpdateAudienceGroupInput {
  name?: string;
  description?: string | null;
  status?: SpaceStatus;
}

export interface UpdateDocumentScheduleInput {
  name?: string;
  description?: string | null;
  activeReleaseId?: string;
  groupId?: string;
  targetMode?: DocumentGenerationMode;
  recurrenceKind?: DocumentScheduleRecurrence;
  timezone?: string;
  localTime?: string;
  startDate?: string;
  dayOfMonth?: number | null;
  deliveryChannel?: DocumentScheduleDelivery;
  emailRecipientId?: string | null;
  emailSubject?: string | null;
  emailMessageText?: string | null;
}

interface PropertyRow {
  key: string;
  label: string;
  value_type: string;
  validation_json: string;
}

interface SuggestionRow {
  property_key: string;
  value_text: string;
  usage_count: number;
  last_used_at: string | null;
}

function requiredText(value: string, name: string, maximum: number): string {
  if (typeof value !== "string") {
    throw new KnowledgeValidationError(`${name} must be a string`);
  }
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new KnowledgeValidationError(`${name} is invalid`);
  }
  return normalized;
}

function optionalText(
  value: string | null | undefined,
  name: string,
  maximum: number,
  multiline = false
): string | null {
  if (value === undefined || value === null) return null;
  const normalized = multiline
    ? value.normalize("NFKC").replace(/\r\n?/gu, "\n").trim()
    : value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maximum || /\u0000/u.test(normalized)) {
    throw new KnowledgeValidationError(`${name} is invalid`);
  }
  return normalized;
}

function stableKey(value: string, name: string): string {
  const normalized = requiredText(value, name, 160).toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(normalized)) {
    throw new KnowledgeValidationError(`${name} is invalid`);
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

function contextValue(context: MutationContext): {
  correlationId: string;
  actorType: string;
  actorId: string | null;
  now: string;
} {
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

function jsonObject(value: JsonValue, name: string): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new KnowledgeValidationError(`${name} must be an object`);
  }
  return { ...value };
}

function normalizedStringList(
  values: readonly string[] | undefined,
  name: string,
  maximumItems = 500
): string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > maximumItems) {
    throw new KnowledgeValidationError(`${name} is invalid`);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = requiredText(value, name, 160);
    const identity = normalized.toLocaleLowerCase("ru-RU");
    if (!seen.has(identity)) {
      seen.add(identity);
      result.push(normalized);
    }
  }
  return result;
}

function enumOptions(validation: JsonValue): string[] {
  const object = jsonObject(validation, "validation");
  const raw = object.enum;
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
    throw new KnowledgeValidationError("validation.enum must be an array of strings");
  }
  return normalizedStringList(raw as string[], "validation.enum");
}

function enumAllowsCustom(validation: JsonValue): boolean {
  const object = jsonObject(validation, "validation");
  const value = object.allowCustom;
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new KnowledgeValidationError("validation.allowCustom must be boolean");
  }
  return value;
}

function normalizedValidation(
  valueType: string,
  value: JsonValue
): JsonValue {
  const object = jsonObject(toJsonValue(value), "validation");
  if (valueType !== "enum") {
    if (object.enum !== undefined || object.allowCustom !== undefined) {
      throw new KnowledgeValidationError(
        "Список вариантов можно задавать только для поля типа «Список вариантов»."
      );
    }
    return object;
  }
  const options = enumOptions(object);
  const allowCustom =
    object.allowCustom === undefined ? true : enumAllowsCustom(object);
  return toJsonValue({ ...object, enum: options, allowCustom });
}

function propertySensitivity(value: string): PropertySensitivity {
  if (
    value === "public" ||
    value === "internal" ||
    value === "personal" ||
    value === "restricted"
  ) {
    return value;
  }
  throw new KnowledgeValidationError("Unsupported property sensitivity");
}

function groupStatus(value: string): SpaceStatus {
  if (value === "active" || value === "archived") return value;
  throw new SpaceValidationError("Unsupported group status");
}

function scheduleMode(value: string): DocumentGenerationMode {
  if (value === "one_per_member" || value === "aggregate") return value;
  throw new DocumentScheduleValidationError("Unsupported schedule target mode");
}

function scheduleRecurrence(value: string): DocumentScheduleRecurrence {
  if (value === "once" || value === "daily" || value === "monthly") return value;
  throw new DocumentScheduleValidationError("Unsupported schedule recurrence");
}

function scheduleDelivery(value: string): DocumentScheduleDelivery {
  if (value === "none" || value === "email") return value;
  throw new DocumentScheduleValidationError("Unsupported schedule delivery channel");
}

function scheduleOptionalText(
  value: string | null | undefined,
  name: string,
  maximum: number,
  multiline = false
): string | null {
  try {
    return optionalText(value, name, maximum, multiline);
  } catch (error) {
    if (error instanceof KnowledgeValidationError) {
      throw new DocumentScheduleValidationError(error.message);
    }
    throw error;
  }
}

function scheduleRequiredText(value: string, name: string, maximum: number): string {
  try {
    return requiredText(value, name, maximum);
  } catch (error) {
    if (error instanceof KnowledgeValidationError) {
      throw new DocumentScheduleValidationError(error.message);
    }
    throw error;
  }
}

function requireSpace(connection: SqliteExecutor, identityValue: string): { id: string } {
  const identity = scheduleRequiredText(identityValue, "spaceId", 160);
  const row = connection
    .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
    .get(identity, identity.toLowerCase()) as { id: string } | undefined;
  if (row === undefined) {
    throw new SpaceNotFoundError(`Space was not found: ${identity}`);
  }
  return row;
}

export class OperatorAssistRegistry {
  private readonly audit: AuditRepository;
  private readonly outbox: DomainEventOutbox;
  private readonly knowledge: KnowledgeRegistry;
  private readonly spaces: SpaceRegistry;
  private readonly schedules: DocumentScheduleRegistry;

  constructor(
    private readonly store: SqliteStore,
    options: { audit?: AuditRepository; outbox?: DomainEventOutbox } = {}
  ) {
    this.audit = options.audit ?? new AuditRepository(store);
    this.outbox = options.outbox ?? new DomainEventOutbox(store);
    this.knowledge = new KnowledgeRegistry(store);
    this.spaces = new SpaceRegistry(store);
    this.schedules = new DocumentScheduleRegistry(store);
  }

  listPropertySuggestions(
    spaceIdentityValue: string,
    limitPerPropertyValue = 20
  ): PropertySuggestionRecord[] {
    const identity = scheduleRequiredText(spaceIdentityValue, "spaceId", 160);
    if (
      !Number.isInteger(limitPerPropertyValue) ||
      limitPerPropertyValue < 1 ||
      limitPerPropertyValue > 100
    ) {
      throw new KnowledgeValidationError("limit must be an integer in range 1..100");
    }
    const limitPerProperty = Number(limitPerPropertyValue);
    const space = this.store.execute((connection) => requireSpace(connection, identity));
    const definitions = this.knowledge
      .listPropertyDefinitions(500)
      .filter(
        (definition): definition is PropertyDefinitionRecord & {
          valueType: "string" | "text" | "enum";
        } =>
          definition.valueType === "string" ||
          definition.valueType === "text" ||
          definition.valueType === "enum"
      )
      .filter(
        (definition) =>
          definition.appliesTo.length === 0 || definition.appliesTo.includes("person")
      );
    const rows = this.store.execute((connection) =>
      connection
        .prepare(`
          WITH latest AS (
            SELECT v.entity_id, v.property_definition_id, MAX(v.version) AS max_version
            FROM entity_property_values v
            JOIN space_entity_ownership seo ON seo.entity_id = v.entity_id
            WHERE seo.space_id = ?
            GROUP BY v.entity_id, v.property_definition_id
          )
          SELECT
            p.key AS property_key,
            v.value_text,
            COUNT(*) AS usage_count,
            MAX(v.updated_at) AS last_used_at
          FROM latest l
          JOIN entity_property_values v
            ON v.entity_id = l.entity_id
           AND v.property_definition_id = l.property_definition_id
           AND v.version = l.max_version
          JOIN property_definitions p ON p.id = v.property_definition_id
          WHERE p.value_type IN ('string', 'text', 'enum')
            AND v.value_text IS NOT NULL
            AND TRIM(v.value_text) <> ''
          GROUP BY p.key, v.value_text
          ORDER BY p.key, usage_count DESC, last_used_at DESC, v.value_text COLLATE NOCASE
        `)
        .all(space.id) as unknown as SuggestionRow[]
    );
    const byKey = new Map<string, SuggestionRow[]>();
    for (const row of rows) {
      const list = byKey.get(row.property_key) ?? [];
      list.push(row);
      byKey.set(row.property_key, list);
    }
    return definitions.map((definition) => {
      const configured =
        definition.valueType === "enum" ? enumOptions(definition.validation) : [];
      const values = new Map<string, PropertySuggestionValue>();
      for (const option of configured) {
        values.set(option.toLocaleLowerCase("ru-RU"), {
          value: option,
          usageCount: 0,
          lastUsedAt: null,
          configured: true
        });
      }
      for (const row of byKey.get(definition.key) ?? []) {
        const identityKey = row.value_text.toLocaleLowerCase("ru-RU");
        const existing = values.get(identityKey);
        values.set(identityKey, {
          value: existing?.value ?? row.value_text,
          usageCount: Number(row.usage_count),
          lastUsedAt: row.last_used_at,
          configured: existing?.configured ?? false
        });
      }
      return {
        propertyKey: definition.key,
        label: definition.label,
        valueType: definition.valueType,
        allowCustom:
          definition.valueType === "enum"
            ? enumAllowsCustom(definition.validation)
            : true,
        values: [...values.values()]
          .sort(
            (left, right) =>
              Number(right.configured) - Number(left.configured) ||
              right.usageCount - left.usageCount ||
              (right.lastUsedAt ?? "").localeCompare(left.lastUsedAt ?? "") ||
              left.value.localeCompare(right.value, "ru-RU")
          )
          .slice(0, limitPerProperty)
      };
    });
  }

  updatePropertyDefinition(
    keyValue: string,
    input: UpdatePropertyDefinitionInput,
    contextInput: MutationContext
  ): PropertyDefinitionRecord {
    const key = stableKey(keyValue, "key");
    const context = contextValue(contextInput);
    const current = this.knowledge.getPropertyDefinition(key);
    if (
      input.label === undefined &&
      input.description === undefined &&
      input.unit === undefined &&
      input.sensitivity === undefined &&
      input.validation === undefined &&
      input.aliases === undefined
    ) {
      throw new KnowledgeValidationError("Property update must contain at least one change");
    }
    const label =
      input.label === undefined
        ? current.label
        : requiredText(input.label, "label", 500);
    const description =
      input.description === undefined
        ? current.description
        : optionalText(input.description, "description", 2_000, true);
    const unit =
      input.unit === undefined ? current.unit : optionalText(input.unit, "unit", 80);
    const sensitivity =
      input.sensitivity === undefined
        ? current.sensitivity
        : propertySensitivity(input.sensitivity);
    const aliases =
      input.aliases === undefined
        ? current.aliases
        : normalizedStringList(input.aliases, "aliases", 100);
    const validation =
      input.validation === undefined
        ? current.validation
        : normalizedValidation(current.valueType, input.validation);
    const version = current.version + 1;

    this.store.transaction((connection) => {
      const row = connection
        .prepare("SELECT id FROM property_definitions WHERE key = ?")
        .get(key) as { id: string } | undefined;
      if (row === undefined) {
        throw new KnowledgeNotFoundError(`Property definition was not found: ${key}`);
      }
      connection
        .prepare(`
          UPDATE property_definitions
          SET label = ?, description = ?, unit = ?, sensitivity = ?,
              validation_json = ?, aliases_json = ?, version = ?, updated_at = ?
          WHERE key = ?
        `)
        .run(
          label,
          description,
          unit,
          sensitivity,
          stringifyJson(validation),
          stringifyJson(aliases),
          version,
          context.now,
          key
        );
      this.outbox.append(
        {
          eventType: "property_definition.updated",
          schemaVersion: 1,
          source: "operator-assist-registry",
          occurredAt: context.now,
          payload: { key, version },
          dedupeKey: `property_definition.updated:${row.id}:v${version}`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "update",
          objectType: "property_definition",
          objectId: row.id,
          correlationId: context.correlationId,
          details: { key, version }
        },
        connection
      );
    });
    return this.knowledge.getPropertyDefinition(key);
  }

  extendEnumOptions(
    keyValue: string,
    values: readonly string[],
    contextInput: MutationContext
  ): PropertyDefinitionRecord {
    const key = stableKey(keyValue, "key");
    const current = this.knowledge.getPropertyDefinition(key);
    if (current.valueType !== "enum") {
      throw new KnowledgeConflictError(
        "Новые варианты можно добавлять только в поле типа «Список вариантов»."
      );
    }
    const additions = normalizedStringList(values, "values", 100);
    if (additions.length === 0) return current;
    const existing = enumOptions(current.validation);
    const merged = normalizedStringList([...existing, ...additions], "validation.enum");
    const object = jsonObject(current.validation, "validation");
    return this.updatePropertyDefinition(
      key,
      {
        validation: toJsonValue({
          ...object,
          enum: merged,
          allowCustom:
            object.allowCustom === undefined ? true : enumAllowsCustom(object)
        })
      },
      contextInput
    );
  }

  updateGroup(
    spaceIdentityValue: string,
    groupIdValue: string,
    input: UpdateAudienceGroupInput,
    contextInput: MutationContext
  ): AudienceGroupRecord {
    const identity = scheduleRequiredText(spaceIdentityValue, "spaceId", 160);
    const groupId = scheduleRequiredText(groupIdValue, "groupId", 160);
    if (
      input.name === undefined &&
      input.description === undefined &&
      input.status === undefined
    ) {
      throw new SpaceValidationError("Group update must contain at least one change");
    }
    const context = contextValue(contextInput);
    this.store.transaction((connection) => {
      const space = requireSpace(connection, identity);
      const current = connection
        .prepare(
          "SELECT id, name, description, status, version FROM audience_groups WHERE id = ? AND space_id = ?"
        )
        .get(groupId, space.id) as
        | {
            id: string;
            name: string;
            description: string | null;
            status: string;
            version: number;
          }
        | undefined;
      if (current === undefined) {
        throw new SpaceNotFoundError(`Group was not found in this space: ${groupId}`);
      }
      const name =
        input.name === undefined
          ? current.name
          : scheduleRequiredText(input.name, "name", 500);
      const description =
        input.description === undefined
          ? current.description
          : scheduleOptionalText(input.description, "description", 2_000, true);
      const status =
        input.status === undefined ? groupStatus(current.status) : groupStatus(input.status);
      const version = Number(current.version) + 1;
      connection
        .prepare(`
          UPDATE audience_groups
          SET name = ?, description = ?, status = ?, version = ?, updated_at = ?
          WHERE id = ? AND space_id = ?
        `)
        .run(name, description, status, version, context.now, groupId, space.id);
      this.outbox.append(
        {
          eventType: "audience.group.updated",
          schemaVersion: 1,
          source: "operator-assist-registry",
          occurredAt: context.now,
          payload: { id: groupId, spaceId: space.id, version, status },
          dedupeKey: `audience.group.updated:${groupId}:v${version}`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "update",
          objectType: "audience_group",
          objectId: groupId,
          correlationId: context.correlationId,
          details: { spaceId: space.id, version, status }
        },
        connection
      );
    });
    const group = this.spaces
      .listGroups(identity, 1_000)
      .find((candidate) => candidate.id === groupId);
    if (group === undefined) {
      throw new SpaceNotFoundError(`Group was not found in this space: ${groupId}`);
    }
    return group;
  }

  updateSchedule(
    spaceIdentityValue: string,
    scheduleIdValue: string,
    input: UpdateDocumentScheduleInput,
    contextInput: MutationContext
  ): DocumentScheduleRecord {
    const identity = scheduleRequiredText(spaceIdentityValue, "spaceId", 160);
    const scheduleId = scheduleRequiredText(scheduleIdValue, "scheduleId", 160);
    const current = this.schedules.get(identity, scheduleId);
    if (Object.keys(input).length === 0) {
      throw new DocumentScheduleValidationError(
        "Schedule update must contain at least one change"
      );
    }
    const context = contextValue(contextInput);
    const name =
      input.name === undefined
        ? current.name
        : scheduleRequiredText(input.name, "name", 300);
    const description =
      input.description === undefined
        ? current.description
        : scheduleOptionalText(input.description, "description", 2_000, true);
    const activeReleaseId =
      input.activeReleaseId === undefined
        ? current.activeReleaseId
        : scheduleRequiredText(input.activeReleaseId, "activeReleaseId", 160);
    const groupId =
      input.groupId === undefined
        ? current.groupId
        : scheduleRequiredText(input.groupId, "groupId", 160);
    const targetMode =
      input.targetMode === undefined
        ? current.targetMode
        : scheduleMode(input.targetMode);
    const recurrenceKind =
      input.recurrenceKind === undefined
        ? current.recurrenceKind
        : scheduleRecurrence(input.recurrenceKind);
    const timezone = normalizeTimeZone(input.timezone ?? current.timezone);
    const localTime = normalizeLocalTime(input.localTime ?? current.localTime);
    const startDate = normalizeLocalDate(input.startDate ?? current.startDate);
    const dayOfMonth =
      recurrenceKind === "monthly"
        ? input.dayOfMonth === undefined
          ? current.dayOfMonth
          : input.dayOfMonth
        : null;
    if (
      recurrenceKind === "monthly" &&
      (!Number.isInteger(dayOfMonth) || Number(dayOfMonth) < 1 || Number(dayOfMonth) > 28)
    ) {
      throw new DocumentScheduleValidationError(
        "Для ежемесячного расписания укажите день месяца от 1 до 28."
      );
    }
    const deliveryChannel =
      input.deliveryChannel === undefined
        ? current.deliveryChannel
        : scheduleDelivery(input.deliveryChannel);
    const emailRecipientId =
      deliveryChannel === "email"
        ? scheduleRequiredText(
            input.emailRecipientId ?? current.emailRecipientId ?? "",
            "emailRecipientId",
            160
          )
        : null;
    const emailSubject =
      deliveryChannel === "email"
        ? scheduleOptionalText(
            input.emailSubject ?? current.emailSubject,
            "emailSubject",
            300
          )
        : null;
    const emailMessageText =
      deliveryChannel === "email"
        ? scheduleOptionalText(
            input.emailMessageText ?? current.emailMessageText,
            "emailMessageText",
            20_000,
            true
          )
        : null;
    if (
      deliveryChannel === "email" &&
      (emailSubject === null || emailMessageText === null)
    ) {
      throw new DocumentScheduleValidationError(
        "Для почтовой доставки укажите получателя, тему и текст письма."
      );
    }
    const nextRunAt =
      current.status === "active"
        ? initialScheduleRunAt(
            {
              recurrenceKind,
              timezone,
              localTime,
              startDate,
              dayOfMonth
            },
            context.now
          )
        : null;
    const version = current.version + 1;

    this.store.transaction((connection) => {
      const space = requireSpace(connection, identity);
      const release = connection
        .prepare("SELECT id FROM template_releases WHERE id = ? AND space_id = ?")
        .get(activeReleaseId, space.id);
      if (release === undefined) {
        throw new DocumentScheduleNotFoundError(
          "Активная версия шаблона не найдена в пространстве."
        );
      }
      const group = connection
        .prepare(
          "SELECT id FROM audience_groups WHERE id = ? AND space_id = ? AND status = 'active'"
        )
        .get(groupId, space.id);
      if (group === undefined) {
        throw new DocumentScheduleNotFoundError(
          "Активная группа участников не найдена в пространстве."
        );
      }
      if (emailRecipientId !== null) {
        const recipient = connection
          .prepare(
            "SELECT id FROM space_email_recipients WHERE id = ? AND space_id = ? AND status = 'active'"
          )
          .get(emailRecipientId, space.id);
        if (recipient === undefined) {
          throw new DocumentScheduleNotFoundError(
            "Активный получатель не найден в пространстве."
          );
        }
      }
      const changed = connection
        .prepare(`
          UPDATE document_schedules
          SET name = ?, description = ?, active_release_id = ?, group_id = ?,
              target_mode = ?, recurrence_kind = ?, timezone = ?, local_time = ?,
              start_date = ?, day_of_month = ?, delivery_channel = ?,
              email_recipient_id = ?, email_subject = ?, email_message_text = ?,
              next_run_at = ?, version = ?, updated_by = ?, correlation_id = ?,
              updated_at = ?
          WHERE id = ? AND space_id = ?
        `)
        .run(
          name,
          description,
          activeReleaseId,
          groupId,
          targetMode,
          recurrenceKind,
          timezone,
          localTime,
          startDate,
          dayOfMonth,
          deliveryChannel,
          emailRecipientId,
          emailSubject,
          emailMessageText,
          nextRunAt,
          version,
          context.actorId,
          context.correlationId,
          context.now,
          scheduleId,
          space.id
        );
      if (Number(changed.changes) === 0) {
        throw new DocumentScheduleConflictError(
          "Расписание не найдено или было изменено другим процессом."
        );
      }
      this.outbox.append(
        {
          eventType: "document.schedule.updated",
          schemaVersion: 1,
          source: "operator-assist-registry",
          occurredAt: context.now,
          payload: {
            id: scheduleId,
            spaceId: space.id,
            version,
            recurrenceKind,
            nextRunAt,
            deliveryChannel
          },
          dedupeKey: `document.schedule.updated:${scheduleId}:v${version}`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "update",
          objectType: "document_schedule",
          objectId: scheduleId,
          correlationId: context.correlationId,
          details: {
            spaceId: space.id,
            version,
            recurrenceKind,
            nextRunAt,
            deliveryChannel
          }
        },
        connection
      );
    });
    return this.schedules.get(identity, scheduleId);
  }
}
