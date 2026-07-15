import { randomUUID } from "node:crypto";

import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import type { DocumentGenerationMode } from "./document-generation.js";
import { parseJson, stringifyJson, toJsonValue, type JsonValue } from "./json.js";
import { generateOpaqueStableKey, type MutationContext } from "./knowledge.js";
import { DomainEventOutbox } from "./outbox.js";
import {
  followingScheduleRunAt,
  initialScheduleRunAt,
  normalizeLocalDate,
  normalizeLocalTime,
  normalizeTimeZone,
  schedulePeriodKey,
  type DocumentScheduleRecurrence
} from "./schedule-time.js";

export type DocumentScheduleStatus = "active" | "inactive";
export type DocumentScheduleDelivery = "none" | "email";
export type DocumentScheduleRunState =
  | "pending"
  | "generation_requested"
  | "delivery_requested"
  | "completed"
  | "skipped"
  | "failed";

export interface CreateDocumentScheduleInput {
  id?: string;
  key?: string;
  name: string;
  description?: string | null;
  activeReleaseId: string;
  groupId: string;
  targetMode: DocumentGenerationMode;
  recurrenceKind: DocumentScheduleRecurrence;
  timezone: string;
  localTime: string;
  startDate: string;
  dayOfMonth?: number | null;
  deliveryChannel: DocumentScheduleDelivery;
  emailRecipientId?: string | null;
  emailSubject?: string | null;
  emailMessageText?: string | null;
}

export interface DocumentScheduleRecord {
  id: string;
  spaceId: string;
  key: string;
  name: string;
  description: string | null;
  activeReleaseId: string;
  templateTitle: string;
  groupId: string;
  groupName: string;
  groupMemberCount: number;
  targetMode: DocumentGenerationMode;
  recurrenceKind: DocumentScheduleRecurrence;
  timezone: string;
  localTime: string;
  startDate: string;
  dayOfMonth: number | null;
  deliveryChannel: DocumentScheduleDelivery;
  emailRecipientId: string | null;
  emailRecipientName: string | null;
  emailRecipientEmail: string | null;
  emailSubject: string | null;
  emailMessageText: string | null;
  status: DocumentScheduleStatus;
  nextRunAt: string | null;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentScheduleRunRecord {
  id: string;
  scheduleId: string;
  spaceId: string;
  periodKey: string;
  dueAt: string;
  state: DocumentScheduleRunState;
  scheduleVersion: number;
  snapshotId: string | null;
  documentJobId: string | null;
  emailDeliveryId: string | null;
  result: JsonValue | null;
  error: JsonValue | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface DocumentScheduleRunWork {
  schedule: DocumentScheduleRecord;
  run: DocumentScheduleRunRecord;
}

interface ScheduleRow {
  id: string;
  space_id: string;
  key: string;
  name: string;
  description: string | null;
  active_release_id: string;
  template_title: string;
  group_id: string;
  group_name: string;
  group_member_count: number;
  target_mode: string;
  recurrence_kind: string;
  timezone: string;
  local_time: string;
  start_date: string;
  day_of_month: number | null;
  delivery_channel: string;
  email_recipient_id: string | null;
  email_recipient_name: string | null;
  email_recipient_email: string | null;
  email_subject: string | null;
  email_message_text: string | null;
  status: string;
  next_run_at: string | null;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  correlation_id: string;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  schedule_id: string;
  space_id: string;
  period_key: string;
  due_at: string;
  state: string;
  schedule_version: number;
  snapshot_id: string | null;
  document_job_id: string | null;
  email_delivery_id: string | null;
  result_json: string | null;
  error_json: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export class DocumentScheduleValidationError extends Error {
  override readonly name = "DocumentScheduleValidationError";
}

export class DocumentScheduleNotFoundError extends Error {
  override readonly name = "DocumentScheduleNotFoundError";
}

export class DocumentScheduleConflictError extends Error {
  override readonly name = "DocumentScheduleConflictError";
}

function requiredText(value: string, name: string, maximum: number): string {
  if (typeof value !== "string") {
    throw new DocumentScheduleValidationError(`${name} must be a string`);
  }
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new DocumentScheduleValidationError(`${name} is invalid`);
  }
  return normalized;
}

function optionalText(
  value: string | null | undefined,
  name: string,
  maximum: number
): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maximum || /\u0000/u.test(normalized)) {
    throw new DocumentScheduleValidationError(`${name} is invalid`);
  }
  return normalized;
}

function stableKey(value: string): string {
  const normalized = requiredText(value, "key", 160).toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(normalized)) {
    throw new DocumentScheduleValidationError(
      "key must start with a letter and contain letters, digits, dots, dashes or underscores"
    );
  }
  return normalized;
}

function headerText(value: string | null | undefined, name: string): string | null {
  const normalized = optionalText(value, name, 300);
  if (normalized !== null && /[\r\n]/u.test(normalized)) {
    throw new DocumentScheduleValidationError(`${name} contains a line break`);
  }
  return normalized;
}

function timestamp(value: Date | string | undefined): string {
  const date =
    value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DocumentScheduleValidationError("Invalid mutation timestamp");
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

function mode(value: string): DocumentGenerationMode {
  if (value === "one_per_member" || value === "aggregate") return value;
  throw new Error(`Stored schedule target mode is invalid: ${value}`);
}

function recurrence(value: string): DocumentScheduleRecurrence {
  if (value === "once" || value === "daily" || value === "monthly") return value;
  throw new Error(`Stored schedule recurrence is invalid: ${value}`);
}

function delivery(value: string): DocumentScheduleDelivery {
  if (value === "none" || value === "email") return value;
  throw new Error(`Stored schedule delivery channel is invalid: ${value}`);
}

function scheduleStatus(value: string): DocumentScheduleStatus {
  if (value === "active" || value === "inactive") return value;
  throw new Error(`Stored schedule status is invalid: ${value}`);
}

function runState(value: string): DocumentScheduleRunState {
  if (
    value === "pending" ||
    value === "generation_requested" ||
    value === "delivery_requested" ||
    value === "completed" ||
    value === "skipped" ||
    value === "failed"
  ) {
    return value;
  }
  throw new Error(`Stored schedule run state is invalid: ${value}`);
}

function scheduleSelect(): string {
  return `
    SELECT
      s.*,
      r.title AS template_title,
      g.name AS group_name,
      (SELECT COUNT(*) FROM audience_group_members gm WHERE gm.group_id = g.id) AS group_member_count,
      e.name AS email_recipient_name,
      e.email AS email_recipient_email
    FROM document_schedules s
    JOIN template_releases r ON r.id = s.active_release_id
    JOIN audience_groups g ON g.id = s.group_id
    LEFT JOIN space_email_recipients e ON e.id = s.email_recipient_id
  `;
}

function mapSchedule(row: ScheduleRow): DocumentScheduleRecord {
  return {
    id: row.id,
    spaceId: row.space_id,
    key: row.key,
    name: row.name,
    description: row.description,
    activeReleaseId: row.active_release_id,
    templateTitle: row.template_title,
    groupId: row.group_id,
    groupName: row.group_name,
    groupMemberCount: Number(row.group_member_count),
    targetMode: mode(row.target_mode),
    recurrenceKind: recurrence(row.recurrence_kind),
    timezone: row.timezone,
    localTime: row.local_time,
    startDate: row.start_date,
    dayOfMonth: row.day_of_month === null ? null : Number(row.day_of_month),
    deliveryChannel: delivery(row.delivery_channel),
    emailRecipientId: row.email_recipient_id,
    emailRecipientName: row.email_recipient_name,
    emailRecipientEmail: row.email_recipient_email,
    emailSubject: row.email_subject,
    emailMessageText: row.email_message_text,
    status: scheduleStatus(row.status),
    nextRunAt: row.next_run_at,
    version: Number(row.version),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRun(row: RunRow): DocumentScheduleRunRecord {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    spaceId: row.space_id,
    periodKey: row.period_key,
    dueAt: row.due_at,
    state: runState(row.state),
    scheduleVersion: Number(row.schedule_version),
    snapshotId: row.snapshot_id,
    documentJobId: row.document_job_id,
    emailDeliveryId: row.email_delivery_id,
    result: row.result_json === null ? null : parseJson(row.result_json),
    error: row.error_json === null ? null : parseJson(row.error_json),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at
  };
}

function requireSpace(connection: SqliteExecutor, identity: string): { id: string } {
  const row = connection
    .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
    .get(identity, identity.toLowerCase()) as { id: string } | undefined;
  if (row === undefined) {
    throw new DocumentScheduleNotFoundError(`Space was not found: ${identity}`);
  }
  return row;
}

function scheduleRow(
  connection: SqliteExecutor,
  scheduleId: string,
  spaceId?: string
): ScheduleRow | undefined {
  return connection
    .prepare(
      `${scheduleSelect()} WHERE s.id = ?${spaceId === undefined ? "" : " AND s.space_id = ?"}`
    )
    .get(...(spaceId === undefined ? [scheduleId] : [scheduleId, spaceId])) as
    | ScheduleRow
    | undefined;
}

function runRow(connection: SqliteExecutor, runId: string): RunRow | undefined {
  return connection
    .prepare("SELECT * FROM document_schedule_runs WHERE id = ?")
    .get(runId) as RunRow | undefined;
}

function isUniqueError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed: document_schedules/u.test(error.message)
  );
}

export class DocumentScheduleRegistry {
  private readonly outbox: DomainEventOutbox;
  private readonly audit: AuditRepository;
  private readonly keyFactory: () => string;

  constructor(
    private readonly store: SqliteStore,
    options: {
      outbox?: DomainEventOutbox;
      audit?: AuditRepository;
      keyFactory?: () => string;
    } = {}
  ) {
    this.outbox = options.outbox ?? new DomainEventOutbox(store);
    this.audit = options.audit ?? new AuditRepository(store);
    this.keyFactory =
      options.keyFactory ?? (() => generateOpaqueStableKey("document_schedule"));
  }

  create(
    spaceIdentityValue: string,
    input: CreateDocumentScheduleInput,
    contextInput: MutationContext
  ): DocumentScheduleRecord {
    const identity = requiredText(spaceIdentityValue, "spaceId", 160);
    const id = input.id ?? randomUUID();
    const explicitKey = input.key === undefined ? null : stableKey(input.key);
    const name = requiredText(input.name, "name", 300);
    const description = optionalText(input.description, "description", 2_000);
    const activeReleaseId = requiredText(
      input.activeReleaseId,
      "activeReleaseId",
      160
    );
    const groupId = requiredText(input.groupId, "groupId", 160);
    const targetMode = mode(input.targetMode);
    const recurrenceKind = recurrence(input.recurrenceKind);
    const timezone = normalizeTimeZone(input.timezone);
    const localTime = normalizeLocalTime(input.localTime);
    const startDate = normalizeLocalDate(input.startDate);
    const dayOfMonth =
      recurrenceKind === "monthly" ? input.dayOfMonth ?? null : null;
    const deliveryChannel = delivery(input.deliveryChannel);
    const emailRecipientId =
      deliveryChannel === "email"
        ? requiredText(input.emailRecipientId ?? "", "emailRecipientId", 160)
        : null;
    const emailSubject =
      deliveryChannel === "email"
        ? headerText(input.emailSubject, "emailSubject")
        : null;
    const emailMessageText =
      deliveryChannel === "email"
        ? optionalText(input.emailMessageText, "emailMessageText", 20_000)
        : null;
    if (
      deliveryChannel === "email" &&
      (emailSubject === null || emailMessageText === null)
    ) {
      throw new DocumentScheduleValidationError(
        "Для почтовой доставки укажите тему и текст письма."
      );
    }
    const context = contextValue(contextInput);
    const nextRunAt = initialScheduleRunAt(
      {
        recurrenceKind,
        timezone,
        localTime,
        startDate,
        dayOfMonth
      },
      context.now
    );

    return this.store.transaction((connection) => {
      const space = requireSpace(connection, identity);
      const key = explicitKey ?? this.allocateKey(connection, space.id);
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
      try {
        connection
          .prepare(`
            INSERT INTO document_schedules(
              id, space_id, key, name, description, active_release_id,
              group_id, target_mode, recurrence_kind, timezone, local_time,
              start_date, day_of_month, delivery_channel, email_recipient_id,
              email_subject, email_message_text, status, next_run_at, version,
              created_by, updated_by, correlation_id, created_at, updated_at
            ) VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              'active', ?, 1, ?, ?, ?, ?, ?
            )
          `)
          .run(
            id,
            space.id,
            key,
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
            context.actorId,
            context.actorId,
            context.correlationId,
            context.now,
            context.now
          );
      } catch (error) {
        if (isUniqueError(error)) {
          throw new DocumentScheduleConflictError(
            "Расписание с таким ключом уже существует в пространстве."
          );
        }
        throw error;
      }
      this.outbox.append(
        {
          eventType: "document.schedule.created",
          schemaVersion: 1,
          source: "document-schedule-registry",
          occurredAt: context.now,
          payload: {
            id,
            spaceId: space.id,
            key,
            recurrenceKind,
            nextRunAt,
            deliveryChannel
          },
          dedupeKey: `document.schedule.created:${id}:v1`,
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
          objectType: "document_schedule",
          objectId: id,
          correlationId: context.correlationId,
          details: {
            spaceId: space.id,
            key,
            recurrenceKind,
            nextRunAt,
            deliveryChannel
          }
        },
        connection
      );
      const row = scheduleRow(connection, id, space.id);
      if (row === undefined) {
        throw new Error(`Created document schedule was not found: ${id}`);
      }
      return mapSchedule(row);
    });
  }

  private allocateKey(connection: SqliteExecutor, spaceId: string): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const key = stableKey(this.keyFactory());
      const existing = connection
        .prepare("SELECT 1 FROM document_schedules WHERE space_id = ? AND key = ?")
        .get(spaceId, key);
      if (existing === undefined) {
        return key;
      }
    }
    throw new DocumentScheduleConflictError(
      "Не удалось создать внутренний ключ расписания. Повторите действие."
    );
  }

  list(spaceIdentityValue: string): DocumentScheduleRecord[] {
    const identity = requiredText(spaceIdentityValue, "spaceId", 160);
    return this.store.execute((connection) => {
      const space = requireSpace(connection, identity);
      const rows = connection
        .prepare(`
          ${scheduleSelect()}
          WHERE s.space_id = ?
          ORDER BY CASE s.status WHEN 'active' THEN 0 ELSE 1 END,
                   s.next_run_at IS NULL, s.next_run_at, s.name COLLATE NOCASE, s.id
          LIMIT 500
        `)
        .all(space.id) as unknown as ScheduleRow[];
      return rows.map(mapSchedule);
    });
  }

  get(
    spaceIdentityValue: string,
    scheduleIdValue: string
  ): DocumentScheduleRecord {
    const identity = requiredText(spaceIdentityValue, "spaceId", 160);
    const scheduleId = requiredText(scheduleIdValue, "scheduleId", 160);
    return this.store.execute((connection) => {
      const space = requireSpace(connection, identity);
      const row = scheduleRow(connection, scheduleId, space.id);
      if (row === undefined) {
        throw new DocumentScheduleNotFoundError(
          `Расписание не найдено в пространстве: ${scheduleId}`
        );
      }
      return mapSchedule(row);
    });
  }

  setStatus(
    spaceIdentityValue: string,
    scheduleIdValue: string,
    statusValue: DocumentScheduleStatus,
    contextInput: MutationContext
  ): DocumentScheduleRecord {
    const identity = requiredText(spaceIdentityValue, "spaceId", 160);
    const scheduleId = requiredText(scheduleIdValue, "scheduleId", 160);
    const status = scheduleStatus(statusValue);
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const space = requireSpace(connection, identity);
      const current = scheduleRow(connection, scheduleId, space.id);
      if (current === undefined) {
        throw new DocumentScheduleNotFoundError(
          `Расписание не найдено в пространстве: ${scheduleId}`
        );
      }
      let nextRunAt = current.next_run_at;
      if (status === "active" && nextRunAt === null) {
        nextRunAt = initialScheduleRunAt(
          {
            recurrenceKind: recurrence(current.recurrence_kind),
            timezone: current.timezone,
            localTime: current.local_time,
            startDate:
              recurrence(current.recurrence_kind) === "once"
                ? normalizeLocalDate(
                    new Date(Date.parse(context.now) + 60_000).toISOString().slice(0, 10)
                  )
                : current.start_date,
            dayOfMonth: current.day_of_month
          },
          context.now
        );
      }
      const version = Number(current.version) + 1;
      connection
        .prepare(`
          UPDATE document_schedules
          SET status = ?, next_run_at = ?, version = ?, updated_by = ?,
              correlation_id = ?, updated_at = ?
          WHERE id = ? AND space_id = ?
        `)
        .run(
          status,
          status === "inactive" ? null : nextRunAt,
          version,
          context.actorId,
          context.correlationId,
          context.now,
          scheduleId,
          space.id
        );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: status === "active" ? "enable" : "disable",
          objectType: "document_schedule",
          objectId: scheduleId,
          correlationId: context.correlationId,
          details: { spaceId: space.id, status, nextRunAt, version }
        },
        connection
      );
      const row = scheduleRow(connection, scheduleId, space.id);
      if (row === undefined) {
        throw new Error(`Updated document schedule was not found: ${scheduleId}`);
      }
      return mapSchedule(row);
    });
  }

  requestRunNow(
    spaceIdentityValue: string,
    scheduleIdValue: string,
    contextInput: MutationContext
  ): DocumentScheduleRunRecord {
    const identity = requiredText(spaceIdentityValue, "spaceId", 160);
    const scheduleId = requiredText(scheduleIdValue, "scheduleId", 160);
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const space = requireSpace(connection, identity);
      const schedule = scheduleRow(connection, scheduleId, space.id);
      if (schedule === undefined) {
        throw new DocumentScheduleNotFoundError(
          `Расписание не найдено в пространстве: ${scheduleId}`
        );
      }
      const id = randomUUID();
      const periodKey = `manual-${context.now}-${id.slice(0, 8)}`;
      connection
        .prepare(`
          INSERT INTO document_schedule_runs(
            id, schedule_id, space_id, period_key, due_at, state,
            schedule_version, snapshot_id, document_job_id,
            email_delivery_id, result_json, error_json,
            started_at, completed_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?)
        `)
        .run(
          id,
          scheduleId,
          space.id,
          periodKey,
          context.now,
          schedule.version,
          context.now
        );
      const row = runRow(connection, id);
      if (row === undefined) {
        throw new Error(`Manual schedule run was not found: ${id}`);
      }
      return mapRun(row);
    });
  }

  claimDue(nowValue: Date | string = new Date(), limitValue = 20): number {
    const now = timestamp(nowValue);
    if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100) {
      throw new DocumentScheduleValidationError("limit must be in range 1..100");
    }
    return this.store.transaction((connection) => {
      const rows = connection
        .prepare(`
          ${scheduleSelect()}
          WHERE s.status = 'active'
            AND s.next_run_at IS NOT NULL
            AND s.next_run_at <= ?
          ORDER BY s.next_run_at ASC, s.id ASC
          LIMIT ?
        `)
        .all(now, limitValue) as unknown as ScheduleRow[];
      let created = 0;
      for (const row of rows) {
        if (row.next_run_at === null) continue;
        const recurrenceKind = recurrence(row.recurrence_kind);
        const periodKey = schedulePeriodKey(
          recurrenceKind,
          row.next_run_at,
          row.timezone
        );
        const id = randomUUID();
        const result = connection
          .prepare(`
            INSERT OR IGNORE INTO document_schedule_runs(
              id, schedule_id, space_id, period_key, due_at, state,
              schedule_version, snapshot_id, document_job_id,
              email_delivery_id, result_json, error_json,
              started_at, completed_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?)
          `)
          .run(
            id,
            row.id,
            row.space_id,
            periodKey,
            row.next_run_at,
            row.version,
            now
          );
        if (Number(result.changes) > 0) created += 1;
        const nextRunAt = followingScheduleRunAt(
          {
            recurrenceKind,
            timezone: row.timezone,
            localTime: row.local_time,
            startDate: row.start_date,
            dayOfMonth: row.day_of_month
          },
          row.next_run_at
        );
        connection
          .prepare(`
            UPDATE document_schedules
            SET status = ?, next_run_at = ?, updated_at = ?
            WHERE id = ? AND next_run_at = ?
          `)
          .run(
            nextRunAt === null ? "inactive" : "active",
            nextRunAt,
            now,
            row.id,
            row.next_run_at
          );
      }
      return created;
    });
  }

  listRunnable(limitValue = 20): DocumentScheduleRunRecord[] {
    if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100) {
      throw new DocumentScheduleValidationError("limit must be in range 1..100");
    }
    return this.store.execute((connection) => {
      const rows = connection
        .prepare(`
          SELECT *
          FROM document_schedule_runs
          WHERE state IN ('pending', 'generation_requested', 'delivery_requested')
          ORDER BY due_at ASC, id ASC
          LIMIT ?
        `)
        .all(limitValue) as unknown as RunRow[];
      return rows.map(mapRun);
    });
  }

  getRunWork(runIdValue: string): DocumentScheduleRunWork {
    const runId = requiredText(runIdValue, "runId", 160);
    return this.store.execute((connection) => {
      const run = runRow(connection, runId);
      if (run === undefined) {
        throw new DocumentScheduleNotFoundError(`Schedule run was not found: ${runId}`);
      }
      const schedule = scheduleRow(connection, run.schedule_id, run.space_id);
      if (schedule === undefined) {
        throw new DocumentScheduleNotFoundError(
          `Schedule for run was not found: ${run.schedule_id}`
        );
      }
      return { schedule: mapSchedule(schedule), run: mapRun(run) };
    });
  }

  listRuns(
    spaceIdentityValue: string,
    scheduleIdValue: string,
    limitValue = 50
  ): DocumentScheduleRunRecord[] {
    const identity = requiredText(spaceIdentityValue, "spaceId", 160);
    const scheduleId = requiredText(scheduleIdValue, "scheduleId", 160);
    if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 200) {
      throw new DocumentScheduleValidationError("limit must be in range 1..200");
    }
    return this.store.execute((connection) => {
      const space = requireSpace(connection, identity);
      if (scheduleRow(connection, scheduleId, space.id) === undefined) {
        throw new DocumentScheduleNotFoundError(
          `Расписание не найдено в пространстве: ${scheduleId}`
        );
      }
      const rows = connection
        .prepare(`
          SELECT * FROM document_schedule_runs
          WHERE schedule_id = ? AND space_id = ?
          ORDER BY due_at DESC, id DESC
          LIMIT ?
        `)
        .all(scheduleId, space.id, limitValue) as unknown as RunRow[];
      return rows.map(mapRun);
    });
  }

  markGenerationRequested(
    runIdValue: string,
    snapshotIdValue: string,
    documentJobIdValue: string,
    contextInput: MutationContext
  ): DocumentScheduleRunRecord {
    return this.updateRun(
      runIdValue,
      "generation_requested",
      {
        snapshotId: requiredText(snapshotIdValue, "snapshotId", 160),
        documentJobId: requiredText(documentJobIdValue, "documentJobId", 160),
        result: null,
        error: null,
        completed: false
      },
      contextInput
    );
  }

  markDeliveryRequested(
    runIdValue: string,
    emailDeliveryIdValue: string,
    contextInput: MutationContext
  ): DocumentScheduleRunRecord {
    return this.updateRun(
      runIdValue,
      "delivery_requested",
      {
        emailDeliveryId: requiredText(
          emailDeliveryIdValue,
          "emailDeliveryId",
          160
        ),
        result: null,
        error: null,
        completed: false
      },
      contextInput
    );
  }

  complete(
    runIdValue: string,
    resultValue: JsonValue,
    contextInput: MutationContext
  ): DocumentScheduleRunRecord {
    return this.updateRun(
      runIdValue,
      "completed",
      { result: toJsonValue(resultValue), error: null, completed: true },
      contextInput
    );
  }

  skip(
    runIdValue: string,
    resultValue: JsonValue,
    contextInput: MutationContext
  ): DocumentScheduleRunRecord {
    return this.updateRun(
      runIdValue,
      "skipped",
      { result: toJsonValue(resultValue), error: null, completed: true },
      contextInput
    );
  }

  fail(
    runIdValue: string,
    errorValue: JsonValue,
    contextInput: MutationContext
  ): DocumentScheduleRunRecord {
    return this.updateRun(
      runIdValue,
      "failed",
      { result: null, error: toJsonValue(errorValue), completed: true },
      contextInput
    );
  }

  private updateRun(
    runIdValue: string,
    state: DocumentScheduleRunState,
    values: {
      snapshotId?: string;
      documentJobId?: string;
      emailDeliveryId?: string;
      result: JsonValue | null;
      error: JsonValue | null;
      completed: boolean;
    },
    contextInput: MutationContext
  ): DocumentScheduleRunRecord {
    const runId = requiredText(runIdValue, "runId", 160);
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const current = runRow(connection, runId);
      if (current === undefined) {
        throw new DocumentScheduleNotFoundError(`Schedule run was not found: ${runId}`);
      }
      if (["completed", "skipped", "failed"].includes(current.state)) {
        return mapRun(current);
      }
      connection
        .prepare(`
          UPDATE document_schedule_runs
          SET state = ?,
              snapshot_id = COALESCE(?, snapshot_id),
              document_job_id = COALESCE(?, document_job_id),
              email_delivery_id = COALESCE(?, email_delivery_id),
              result_json = ?, error_json = ?,
              started_at = COALESCE(started_at, ?),
              completed_at = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          state,
          values.snapshotId ?? null,
          values.documentJobId ?? null,
          values.emailDeliveryId ?? null,
          values.result === null ? null : stringifyJson(values.result),
          values.error === null ? null : stringifyJson(values.error),
          context.now,
          values.completed ? context.now : null,
          context.now,
          runId
        );
      const row = runRow(connection, runId);
      if (row === undefined) {
        throw new Error(`Updated schedule run was not found: ${runId}`);
      }
      return mapRun(row);
    });
  }
}
