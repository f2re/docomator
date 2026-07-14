export type DocumentScheduleRecurrence = "once" | "daily" | "monthly";

export interface DocumentScheduleTimeInput {
  recurrenceKind: DocumentScheduleRecurrence;
  timezone: string;
  localTime: string;
  startDate: string;
  dayOfMonth: number | null;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export class ScheduleTimeValidationError extends Error {
  override readonly name = "ScheduleTimeValidationError";
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  const existing = formatterCache.get(timezone);
  if (existing !== undefined) return existing;
  let created: Intl.DateTimeFormat;
  try {
    created = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
  } catch {
    throw new ScheduleTimeValidationError(
      `Неподдерживаемый часовой пояс: ${timezone}`
    );
  }
  formatterCache.set(timezone, created);
  return created;
}

export function normalizeTimeZone(value: string): string {
  if (typeof value !== "string") {
    throw new ScheduleTimeValidationError("Часовой пояс должен содержать текст.");
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 100) {
    throw new ScheduleTimeValidationError("Укажите корректный часовой пояс IANA.");
  }
  formatter(normalized).format(new Date(0));
  return normalized;
}

export function normalizeLocalTime(value: string): string {
  if (typeof value !== "string") {
    throw new ScheduleTimeValidationError("Время должно содержать текст.");
  }
  const match = /^(\d{2}):(\d{2})$/u.exec(value.trim());
  if (match === null) {
    throw new ScheduleTimeValidationError("Время должно иметь формат ЧЧ:ММ.");
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new ScheduleTimeValidationError("Указано недопустимое время суток.");
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function normalizeLocalDate(value: string): string {
  if (typeof value !== "string") {
    throw new ScheduleTimeValidationError("Дата должна содержать текст.");
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value.trim());
  if (match === null) {
    throw new ScheduleTimeValidationError("Дата должна иметь формат ГГГГ-ММ-ДД.");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new ScheduleTimeValidationError("Указана несуществующая дата.");
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDate(value: string): { year: number; month: number; day: number } {
  const normalized = normalizeLocalDate(value);
  return {
    year: Number(normalized.slice(0, 4)),
    month: Number(normalized.slice(5, 7)),
    day: Number(normalized.slice(8, 10))
  };
}

function parseTime(value: string): { hour: number; minute: number } {
  const normalized = normalizeLocalTime(value);
  return {
    hour: Number(normalized.slice(0, 2)),
    minute: Number(normalized.slice(3, 5))
  };
}

function numberPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes
): number {
  const value = parts.find((part) => part.type === type)?.value;
  if (value === undefined) {
    throw new ScheduleTimeValidationError(
      "Среда выполнения не вернула компоненты локального времени."
    );
  }
  return Number(value);
}

export function localPartsAt(date: Date, timezoneValue: string): LocalParts {
  const timezone = normalizeTimeZone(timezoneValue);
  const parts = formatter(timezone).formatToParts(date);
  return {
    year: numberPart(parts, "year"),
    month: numberPart(parts, "month"),
    day: numberPart(parts, "day"),
    hour: numberPart(parts, "hour"),
    minute: numberPart(parts, "minute")
  };
}

function localNumber(parts: LocalParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute
  );
}

function sameLocal(left: LocalParts, right: LocalParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

function sameLocalDate(left: LocalParts, right: LocalParts): boolean {
  return (
    left.year === right.year && left.month === right.month && left.day === right.day
  );
}

function instantForLocal(parts: LocalParts, timezone: string): Date {
  const naive = localNumber(parts);
  const start = naive - 16 * 60 * 60 * 1000;
  const end = naive + 16 * 60 * 60 * 1000;
  let firstAfter: { local: number; instant: Date } | null = null;
  for (let timestamp = start; timestamp <= end; timestamp += 60_000) {
    const instant = new Date(timestamp);
    const observed = localPartsAt(instant, timezone);
    if (sameLocal(observed, parts)) return instant;
    if (sameLocalDate(observed, parts)) {
      const observedNumber = localNumber(observed);
      if (
        observedNumber > naive &&
        (firstAfter === null || observedNumber < firstAfter.local)
      ) {
        firstAfter = { local: observedNumber, instant };
      }
    }
  }
  if (firstAfter !== null) return firstAfter.instant;
  throw new ScheduleTimeValidationError(
    "Не удалось сопоставить локальные дату и время с часовым поясом."
  );
}

function compareDate(
  left: { year: number; month: number; day: number },
  right: { year: number; month: number; day: number }
): number {
  return (
    Date.UTC(left.year, left.month - 1, left.day) -
    Date.UTC(right.year, right.month - 1, right.day)
  );
}

function addDays(
  value: { year: number; month: number; day: number },
  count: number
): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + count));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function addMonths(
  value: { year: number; month: number },
  count: number
): { year: number; month: number } {
  const date = new Date(Date.UTC(value.year, value.month - 1 + count, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function scheduleParts(
  date: { year: number; month: number; day: number },
  time: { hour: number; minute: number }
): LocalParts {
  return { ...date, ...time };
}

function validateInput(input: DocumentScheduleTimeInput): DocumentScheduleTimeInput {
  const recurrenceKind = input.recurrenceKind;
  if (
    recurrenceKind !== "once" &&
    recurrenceKind !== "daily" &&
    recurrenceKind !== "monthly"
  ) {
    throw new ScheduleTimeValidationError("Неподдерживаемая периодичность.");
  }
  const timezone = normalizeTimeZone(input.timezone);
  const localTime = normalizeLocalTime(input.localTime);
  const startDate = normalizeLocalDate(input.startDate);
  const dayOfMonth =
    recurrenceKind === "monthly"
      ? input.dayOfMonth
      : null;
  if (
    recurrenceKind === "monthly" &&
    (!Number.isInteger(dayOfMonth) || dayOfMonth === null || dayOfMonth < 1 || dayOfMonth > 28)
  ) {
    throw new ScheduleTimeValidationError(
      "Для ежемесячного запуска укажите день от 1 до 28."
    );
  }
  return {
    recurrenceKind,
    timezone,
    localTime,
    startDate,
    dayOfMonth
  };
}

export function initialScheduleRunAt(
  inputValue: DocumentScheduleTimeInput,
  nowValue: Date | string = new Date()
): string {
  const input = validateInput(inputValue);
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  if (Number.isNaN(now.getTime())) {
    throw new ScheduleTimeValidationError("Недопустимое текущее время.");
  }
  const start = parseDate(input.startDate);
  const time = parseTime(input.localTime);
  const localNow = localPartsAt(now, input.timezone);

  if (input.recurrenceKind === "once") {
    const candidate = instantForLocal(scheduleParts(start, time), input.timezone);
    if (candidate.getTime() <= now.getTime()) {
      throw new ScheduleTimeValidationError(
        "Однократный запуск должен быть назначен на будущее."
      );
    }
    return candidate.toISOString();
  }

  if (input.recurrenceKind === "daily") {
    let date =
      compareDate(start, localNow) > 0
        ? start
        : { year: localNow.year, month: localNow.month, day: localNow.day };
    let candidate = instantForLocal(scheduleParts(date, time), input.timezone);
    if (candidate.getTime() <= now.getTime()) {
      date = addDays(date, 1);
      candidate = instantForLocal(scheduleParts(date, time), input.timezone);
    }
    return candidate.toISOString();
  }

  const day = input.dayOfMonth ?? 1;
  let month =
    Date.UTC(start.year, start.month - 1, 1) >
    Date.UTC(localNow.year, localNow.month - 1, 1)
      ? { year: start.year, month: start.month }
      : { year: localNow.year, month: localNow.month };
  let date = { year: month.year, month: month.month, day };
  if (compareDate(date, start) < 0) {
    month = addMonths(month, 1);
    date = { year: month.year, month: month.month, day };
  }
  let candidate = instantForLocal(scheduleParts(date, time), input.timezone);
  if (candidate.getTime() <= now.getTime()) {
    month = addMonths(month, 1);
    candidate = instantForLocal(
      scheduleParts({ year: month.year, month: month.month, day }, time),
      input.timezone
    );
  }
  return candidate.toISOString();
}

export function followingScheduleRunAt(
  inputValue: DocumentScheduleTimeInput,
  previousRunAtValue: Date | string
): string | null {
  const input = validateInput(inputValue);
  if (input.recurrenceKind === "once") return null;
  const previous =
    previousRunAtValue instanceof Date
      ? previousRunAtValue
      : new Date(previousRunAtValue);
  if (Number.isNaN(previous.getTime())) {
    throw new ScheduleTimeValidationError("Недопустимое время предыдущего запуска.");
  }
  const local = localPartsAt(previous, input.timezone);
  const time = parseTime(input.localTime);
  if (input.recurrenceKind === "daily") {
    const nextDate = addDays(
      { year: local.year, month: local.month, day: local.day },
      1
    );
    return instantForLocal(scheduleParts(nextDate, time), input.timezone).toISOString();
  }
  const nextMonth = addMonths({ year: local.year, month: local.month }, 1);
  return instantForLocal(
    scheduleParts(
      {
        year: nextMonth.year,
        month: nextMonth.month,
        day: input.dayOfMonth ?? 1
      },
      time
    ),
    input.timezone
  ).toISOString();
}

export function schedulePeriodKey(
  recurrenceKind: DocumentScheduleRecurrence,
  dueAtValue: Date | string,
  timezoneValue: string
): string {
  const dueAt = dueAtValue instanceof Date ? dueAtValue : new Date(dueAtValue);
  if (Number.isNaN(dueAt.getTime())) {
    throw new ScheduleTimeValidationError("Недопустимое время периода расписания.");
  }
  const local = localPartsAt(dueAt, timezoneValue);
  const date = `${String(local.year).padStart(4, "0")}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
  return recurrenceKind === "monthly" ? date.slice(0, 7) : date;
}
