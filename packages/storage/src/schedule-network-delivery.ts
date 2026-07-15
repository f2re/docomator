import type { SqliteExecutor } from "./database.js";
import { SqliteStore } from "./database.js";
import type { MutationContext } from "./knowledge.js";

export interface ScheduleNetworkDeliverySetting {
  scheduleId: string;
  subdirectoryTemplate: string;
  createdAt: string;
  updatedAt: string;
}

interface SettingRow {
  schedule_id: string;
  subdirectory_template: string;
  created_at: string;
  updated_at: string;
}

export class ScheduleNetworkDeliveryValidationError extends Error {
  override readonly name = "ScheduleNetworkDeliveryValidationError";
}

export class ScheduleNetworkDeliveryNotFoundError extends Error {
  override readonly name = "ScheduleNetworkDeliveryNotFoundError";
}

function requiredText(value: string, name: string, maximum: number): string {
  if (typeof value !== "string") {
    throw new ScheduleNetworkDeliveryValidationError(`${name} must be a string`);
  }
  const normalized = value.normalize("NFKC").trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new ScheduleNetworkDeliveryValidationError(`${name} is invalid`);
  }
  return normalized;
}

function timestamp(value: Date | string | undefined): string {
  const date =
    value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ScheduleNetworkDeliveryValidationError("Invalid mutation timestamp");
  }
  return date.toISOString();
}

const allowedTokens = ["schedule", "period", "template", "group"] as const;

export function normalizeScheduleNetworkTemplate(value: string): string {
  const raw = requiredText(value, "networkSubdirectory", 500).replace(/\\/gu, "/");
  if (raw.startsWith("/") || /^[A-Za-z]:/u.test(raw)) {
    throw new ScheduleNetworkDeliveryValidationError(
      "Укажите только вложенный каталог внутри разрешённой сетевой папки."
    );
  }
  const unknownTokens = [...raw.matchAll(/\{([^{}]+)\}/gu)]
    .map((match) => match[1])
    .filter((token) => !allowedTokens.includes(token as (typeof allowedTokens)[number]));
  if (unknownTokens.length > 0 || /[{}]/u.test(raw.replace(/\{(?:schedule|period|template|group)\}/gu, ""))) {
    throw new ScheduleNetworkDeliveryValidationError(
      "В пути используются неподдерживаемые подстановки."
    );
  }
  const segments = raw
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (
    segments.length === 0 ||
    segments.length > 12 ||
    segments.some((segment) => {
      const withoutTokens = segment.replace(/\{(?:schedule|period|template|group)\}/gu, "x");
      return (
        segment === "." ||
        segment === ".." ||
        segment.length > 120 ||
        /[\u0000-\u001f\u007f:*?"<>|]/u.test(withoutTokens)
      );
    })
  ) {
    throw new ScheduleNetworkDeliveryValidationError(
      "Каталог сетевой доставки содержит недопустимые элементы."
    );
  }
  return segments.join("/");
}

function mapSetting(row: SettingRow): ScheduleNetworkDeliverySetting {
  return {
    scheduleId: row.schedule_id,
    subdirectoryTemplate: row.subdirectory_template,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function settingRow(
  connection: SqliteExecutor,
  scheduleId: string
): SettingRow | undefined {
  return connection
    .prepare(
      "SELECT schedule_id, subdirectory_template, created_at, updated_at FROM document_schedule_network_settings WHERE schedule_id = ?"
    )
    .get(scheduleId) as SettingRow | undefined;
}

export class ScheduleNetworkDeliveryRegistry {
  constructor(private readonly store: SqliteStore) {}

  get(scheduleIdValue: string): ScheduleNetworkDeliverySetting | null {
    const scheduleId = requiredText(scheduleIdValue, "scheduleId", 160);
    return this.store.execute((connection) => {
      const row = settingRow(connection, scheduleId);
      return row === undefined ? null : mapSetting(row);
    });
  }

  listForSchedules(scheduleIds: readonly string[]): Map<string, ScheduleNetworkDeliverySetting> {
    const normalized = [...new Set(scheduleIds.map((id) => requiredText(id, "scheduleId", 160)))];
    if (normalized.length === 0) return new Map();
    return this.store.execute((connection) => {
      const placeholders = normalized.map(() => "?").join(", ");
      const rows = connection
        .prepare(`
          SELECT schedule_id, subdirectory_template, created_at, updated_at
          FROM document_schedule_network_settings
          WHERE schedule_id IN (${placeholders})
        `)
        .all(...normalized) as unknown as SettingRow[];
      return new Map(rows.map((row) => [row.schedule_id, mapSetting(row)]));
    });
  }

  set(
    scheduleIdValue: string,
    subdirectoryTemplateValue: string,
    contextInput: MutationContext
  ): ScheduleNetworkDeliverySetting {
    const scheduleId = requiredText(scheduleIdValue, "scheduleId", 160);
    const subdirectoryTemplate = normalizeScheduleNetworkTemplate(
      subdirectoryTemplateValue
    );
    const now = timestamp(contextInput.now);
    return this.store.transaction((connection) => {
      const schedule = connection
        .prepare(
          "SELECT id FROM document_schedules WHERE id = ? AND delivery_channel = 'none' AND email_recipient_id IS NULL"
        )
        .get(scheduleId);
      if (schedule === undefined) {
        throw new ScheduleNetworkDeliveryNotFoundError(
          "Совместимое расписание для сетевой доставки не найдено."
        );
      }
      connection
        .prepare(`
          INSERT INTO document_schedule_network_settings(
            schedule_id, subdirectory_template, created_at, updated_at
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(schedule_id) DO UPDATE SET
            subdirectory_template = excluded.subdirectory_template,
            updated_at = excluded.updated_at
        `)
        .run(scheduleId, subdirectoryTemplate, now, now);
      const row = settingRow(connection, scheduleId);
      if (row === undefined) {
        throw new Error(`Created network schedule setting was not found: ${scheduleId}`);
      }
      return mapSetting(row);
    });
  }
}
