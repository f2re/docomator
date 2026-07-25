import { TemplateCompilerError } from "./compiler.js";

export type ScalarValueType =
  | "string"
  | "text"
  | "enum"
  | "number"
  | "integer"
  | "boolean"
  | "date"
  | "date-time";

export type PersonNameSourceOrder =
  | "family-given-patronymic"
  | "given-patronymic-family"
  | "family-given"
  | "given-family";

export type ScalarFormatter =
  | { version: 1; kind: "legacy" }
  | { version: 1; kind: "identity" }
  | {
      version: 1;
      kind: "person-name.ru";
      sourceOrder: PersonNameSourceOrder;
      pattern: string;
    }
  | { version: 1; kind: "number.ru"; fractionDigits: number | null }
  | { version: 1; kind: "date.ru" }
  | { version: 1; kind: "date-time.ru"; timeZone: string }
  | { version: 1; kind: "boolean.ru" };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatterError(message: string): never {
  throw new TemplateCompilerError("invalid_formatter", message);
}

function fractionDigits(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 6) {
    return formatterError("Число знаков после запятой должно быть от 0 до 6.");
  }
  return value as number;
}

function timeZone(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 100 ||
    !/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+)$/u.test(value)
  ) {
    return formatterError("Указан недопустимый часовой пояс даты и времени.");
  }
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: value }).format(new Date(0));
  } catch {
    return formatterError("Указанный часовой пояс не поддерживается системой.");
  }
  return value;
}

const PERSON_NAME_SOURCE_ORDERS: readonly PersonNameSourceOrder[] = [
  "family-given-patronymic",
  "given-patronymic-family",
  "family-given",
  "given-family"
];
const PERSON_NAME_TOKEN_PATTERN = /\{([^{}]+)\}/gu;
const PERSON_NAME_TOKENS = new Set([
  "Фамилия",
  "Имя",
  "Отчество",
  "Ф",
  "И",
  "О"
]);

interface PersonNameParts {
  family: string;
  given: string;
  patronymic: string;
}

function personNameSourceOrder(value: unknown): PersonNameSourceOrder {
  if (
    typeof value === "string" &&
    (PERSON_NAME_SOURCE_ORDERS as readonly string[]).includes(value)
  ) {
    return value as PersonNameSourceOrder;
  }
  return formatterError("Не удалось определить порядок частей ФИО в исходных данных.");
}

function personNamePattern(value: unknown): string {
  if (typeof value !== "string") {
    return formatterError("Шаблон записи ФИО должен содержать текст.");
  }
  const normalized = value.normalize("NFKC").trim();
  if (
    normalized.length === 0 ||
    normalized.length > 160 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    return formatterError("Шаблон записи ФИО должен содержать от 1 до 160 безопасных знаков.");
  }
  let tokenCount = 0;
  for (const match of normalized.matchAll(PERSON_NAME_TOKEN_PATTERN)) {
    const token = match[1] ?? "";
    tokenCount += 1;
    if (!PERSON_NAME_TOKENS.has(token)) {
      return formatterError(`В шаблоне ФИО неизвестная часть «${token}».`);
    }
  }
  const withoutTokens = normalized.replace(PERSON_NAME_TOKEN_PATTERN, "");
  if (tokenCount === 0 || withoutTokens.includes("{") || withoutTokens.includes("}")) {
    return formatterError(
      "Используйте части {Фамилия}, {Имя}, {Отчество}, {Ф}, {И} или {О}."
    );
  }
  return normalized;
}

function compactInitials(value: string): [string, string] | null {
  const match = /^(\p{L})\.\s*(\p{L})\.?$/u.exec(value);
  return match === null ? null : [match[1] ?? "", match[2] ?? ""];
}

function parsePersonName(value: string, order: PersonNameSourceOrder): PersonNameParts {
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (normalized === "") return { family: "", given: "", patronymic: "" };
  const words = normalized.split(" ");
  if (order === "family-given-patronymic") {
    const initials = words.length === 2 ? compactInitials(words[1] ?? "") : null;
    return {
      family: words[0] ?? "",
      given: initials?.[0] ?? words[1] ?? "",
      patronymic: initials?.[1] ?? words.slice(2).join(" ")
    };
  }
  if (order === "given-patronymic-family") {
    const initials = words.length === 2 ? compactInitials(words[0] ?? "") : null;
    return {
      family: words.at(-1) ?? "",
      given: initials?.[0] ?? words[0] ?? "",
      patronymic: initials?.[1] ?? words.slice(1, -1).join(" ")
    };
  }
  if (order === "family-given") {
    return {
      family: words[0] ?? "",
      given: words.slice(1).join(" "),
      patronymic: ""
    };
  }
  return {
    family: words.slice(1).join(" "),
    given: words[0] ?? "",
    patronymic: ""
  };
}

function personNameInitial(value: string): string {
  return value.match(/\p{L}/u)?.[0]?.toLocaleUpperCase("ru-RU") ?? "";
}

function formatPersonName(value: string, formatter: Extract<ScalarFormatter, { kind: "person-name.ru" }>): string {
  const parts = parsePersonName(value, formatter.sourceOrder);
  const values: Record<string, string> = {
    Фамилия: parts.family,
    Имя: parts.given,
    Отчество: parts.patronymic,
    Ф: personNameInitial(parts.family),
    И: personNameInitial(parts.given),
    О: personNameInitial(parts.patronymic)
  };
  const rendered = formatter.pattern
    .replace(PERSON_NAME_TOKEN_PATTERN, (_match, token: string) => values[token] ?? "")
    .replace(/\s+/gu, " ")
    .replace(/\s+([,.;:])/gu, "$1")
    .replace(/([,.;:])(?:\s*\1)+/gu, "$1")
    .replace(/(^|[\s(])[,.;:]+(?=\s|$|\))/gu, "$1")
    .replace(/\s+[,.;:]+$/gu, "")
    .trim();
  return /[\p{L}\p{N}]/u.test(rendered) ? rendered : "";
}

export function defaultScalarFormatter(
  valueType: ScalarValueType,
  options: { fractionDigits?: number | null; timeZone?: string } = {}
): ScalarFormatter {
  if (valueType === "string" || valueType === "text" || valueType === "enum") {
    return { version: 1, kind: "identity" };
  }
  if (valueType === "number") {
    return {
      version: 1,
      kind: "number.ru",
      fractionDigits: fractionDigits(options.fractionDigits)
    };
  }
  if (valueType === "integer") {
    return { version: 1, kind: "number.ru", fractionDigits: 0 };
  }
  if (valueType === "boolean") {
    return { version: 1, kind: "boolean.ru" };
  }
  if (valueType === "date") {
    return { version: 1, kind: "date.ru" };
  }
  if (valueType === "date-time") {
    return {
      version: 1,
      kind: "date-time.ru",
      timeZone: timeZone(options.timeZone ?? "Europe/Moscow")
    };
  }
  return formatterError("Для типа поля не найден безопасный формат вывода.");
}

export function parseScalarFormatter(
  valueType: ScalarValueType,
  value: unknown
): ScalarFormatter {
  if (value === undefined) {
    return defaultScalarFormatter(valueType);
  }
  if (!isObject(value) || value.version !== 1) {
    return formatterError("Сохранённый формат поля имеет неподдерживаемую версию.");
  }
  if (value.kind === "default") {
    return defaultScalarFormatter(valueType);
  }
  if (value.kind === "legacy") {
    return { version: 1, kind: "legacy" };
  }
  if (value.kind === "identity") {
    if (valueType !== "string" && valueType !== "text" && valueType !== "enum") {
      return formatterError("Текстовый формат не соответствует типу поля.");
    }
    return { version: 1, kind: "identity" };
  }
  if (value.kind === "person-name.ru") {
    if (valueType !== "string" && valueType !== "text") {
      return formatterError("Формат ФИО можно применить только к текстовому полю.");
    }
    return {
      version: 1,
      kind: "person-name.ru",
      sourceOrder: personNameSourceOrder(value.sourceOrder),
      pattern: personNamePattern(value.pattern)
    };
  }
  if (value.kind === "number.ru") {
    if (valueType !== "number" && valueType !== "integer") {
      return formatterError("Числовой формат не соответствует типу поля.");
    }
    const digits = fractionDigits(value.fractionDigits);
    if (valueType === "integer" && digits !== 0) {
      return formatterError("Для целого числа допустимо только 0 знаков после запятой.");
    }
    return { version: 1, kind: "number.ru", fractionDigits: digits };
  }
  if (value.kind === "boolean.ru") {
    if (valueType !== "boolean") {
      return formatterError("Логический формат не соответствует типу поля.");
    }
    return { version: 1, kind: "boolean.ru" };
  }
  if (value.kind === "date.ru") {
    if (valueType !== "date") {
      return formatterError("Формат даты не соответствует типу поля.");
    }
    return { version: 1, kind: "date.ru" };
  }
  if (value.kind === "date-time.ru") {
    if (valueType !== "date-time") {
      return formatterError("Формат даты и времени не соответствует типу поля.");
    }
    return {
      version: 1,
      kind: "date-time.ru",
      timeZone: timeZone(value.timeZone)
    };
  }
  return formatterError("Сохранённый формат поля не поддерживается.");
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function dateParts(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) {
    return formatterError("Дата должна иметь формат ГГГГ-ММ-ДД.");
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
    return formatterError("Указана несуществующая календарная дата.");
  }
  return { year, month, day };
}

export function formatScalarDisplay(
  valueType: ScalarValueType,
  value: string | number | boolean,
  formatterValue: unknown
): string {
  const formatter = parseScalarFormatter(valueType, formatterValue);
  if (formatter.kind === "legacy") {
    if (valueType === "boolean") {
      if (typeof value !== "boolean") {
        return formatterError("Логическое значение должно быть «да» или «нет».");
      }
      return value ? "Да" : "Нет";
    }
    return String(value);
  }
  if (formatter.kind === "identity") return String(value);
  if (formatter.kind === "person-name.ru") {
    return formatPersonName(String(value), formatter);
  }
  if (formatter.kind === "boolean.ru") {
    if (typeof value !== "boolean") {
      return formatterError("Логическое значение должно быть «да» или «нет».");
    }
    return value ? "Да" : "Нет";
  }
  if (formatter.kind === "number.ru") {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number)) {
      return formatterError("Числовое значение должно быть конечным числом.");
    }
    const normalized = Object.is(number, -0) ? 0 : number;
    return new Intl.NumberFormat("ru-RU", {
      useGrouping: false,
      minimumFractionDigits: formatter.fractionDigits ?? 0,
      maximumFractionDigits: formatter.fractionDigits ?? 20
    }).format(normalized);
  }
  if (formatter.kind === "date.ru") {
    const parts = dateParts(String(value));
    return `${twoDigits(parts.day)}.${twoDigits(parts.month)}.${parts.year}`;
  }
  if (formatter.kind === "date-time.ru") {
    const text = String(value);
    if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(text)) {
      return formatterError("Дата и время должны содержать явный часовой пояс.");
    }
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
      return formatterError("Указаны недопустимые дата и время.");
    }
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: formatter.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPart["type"]): string =>
      parts.find((candidate) => candidate.type === type)?.value ?? "";
    return `${part("day")}.${part("month")}.${part("year")} ${part("hour")}:${part("minute")}`;
  }
  return formatterError("Сохранённый формат поля не поддерживается.");
}
