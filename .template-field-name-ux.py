from __future__ import annotations

from pathlib import Path
import re

ROOT = Path.cwd()


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def write(relative: str, content: str) -> None:
    path = ROOT / relative
    path.write_text(content, encoding="utf-8")
    print(f"updated {relative}")


def replace_once(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return content.replace(old, new, 1)


def replace_between(content: str, start: str, end: str, replacement: str, label: str) -> str:
    pattern = re.compile(re.escape(start) + r".*?(?=" + re.escape(end) + r")", re.S)
    updated, count = pattern.subn(replacement.rstrip() + "\n\n", content, count=1)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one block, found {count}")
    return updated


def append_once(content: str, marker: str, addition: str, label: str) -> str:
    if marker in content:
        raise SystemExit(f"{label}: marker already present")
    return content.rstrip() + "\n\n" + addition.strip() + "\n"


# ---------------------------------------------------------------------------
# Safe declarative Russian personal-name formatter.
# ---------------------------------------------------------------------------
path = "packages/template-compiler/src/scalar-formatter.ts"
content = read(path)
content = replace_once(
    content,
    '''export type ScalarFormatter =
  | { version: 1; kind: "legacy" }
  | { version: 1; kind: "identity" }
  | { version: 1; kind: "number.ru"; fractionDigits: number | null }
  | { version: 1; kind: "date.ru" }
  | { version: 1; kind: "date-time.ru"; timeZone: string }
  | { version: 1; kind: "boolean.ru" };''',
    '''export type PersonNameSourceOrder =
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
  | { version: 1; kind: "boolean.ru" };''',
    "formatter union",
)
content = replace_once(
    content,
    '''function timeZone(value: unknown): string {
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
''',
    '''function timeZone(value: unknown): string {
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
const PERSON_NAME_TOKEN_PATTERN = /\\{([^{}]+)\\}/gu;
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
    /[\\u0000-\\u001f\\u007f]/u.test(normalized)
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
  const match = /^(\\p{L})\\.\\s*(\\p{L})\\.?$/u.exec(value);
  return match === null ? null : [match[1] ?? "", match[2] ?? ""];
}

function parsePersonName(value: string, order: PersonNameSourceOrder): PersonNameParts {
  const normalized = value.normalize("NFKC").trim().replace(/\\s+/gu, " ");
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
  return value.match(/\\p{L}/u)?.[0]?.toLocaleUpperCase("ru-RU") ?? "";
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
    .replace(/\\s+/gu, " ")
    .replace(/\\s+([,.;:])/gu, "$1")
    .replace(/([,.;:])(?:\\s*\\1)+/gu, "$1")
    .replace(/(^|[\\s(])[,.;:]+(?=\\s|$|\\))/gu, "$1")
    .replace(/\\s+[,.;:]+$/gu, "")
    .trim();
  return /[\\p{L}\\p{N}]/u.test(rendered) ? rendered : "";
}
''',
    "person name helpers",
)
content = replace_once(
    content,
    '''  if (value.kind === "identity") {
    if (valueType !== "string" && valueType !== "text") {
      return formatterError("Текстовый формат не соответствует типу поля.");
    }
    return { version: 1, kind: "identity" };
  }
  if (value.kind === "number.ru") {''',
    '''  if (value.kind === "identity") {
    if (valueType !== "string" && valueType !== "text") {
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
  if (value.kind === "number.ru") {''',
    "formatter parser",
)
content = replace_once(
    content,
    '''  if (formatter.kind === "identity") return String(value);
  if (formatter.kind === "boolean.ru") {''',
    '''  if (formatter.kind === "identity") return String(value);
  if (formatter.kind === "person-name.ru") {
    return formatPersonName(String(value), formatter);
  }
  if (formatter.kind === "boolean.ru") {''',
    "formatter renderer",
)
write(path, content)


# Text fields must pass through their formatter before being written.
path = "packages/template-compiler/src/scalar-render.ts"
content = read(path)
content = replace_once(
    content,
    '''  if (valueType === "string") {
    const text = requiredText(value, "пробное значение", 4_000);
    return { display: text, xlsxMode: "inline-string", xlsxValue: text };
  }
  if (valueType === "text") {
    const text = requiredText(value, "пробное значение", 20_000);
    return { display: text, xlsxMode: "inline-string", xlsxValue: text };
  }''',
    '''  if (valueType === "string") {
    const text = requiredText(value, "пробное значение", 4_000);
    const display = formatScalarDisplay(valueType, text, formatterValue);
    return { display, xlsxMode: "inline-string", xlsxValue: display };
  }
  if (valueType === "text") {
    const text = requiredText(value, "пробное значение", 20_000);
    const display = formatScalarDisplay(valueType, text, formatterValue);
    return { display, xlsxMode: "inline-string", xlsxValue: display };
  }''',
    "text rendering",
)
write(path, content)


# ---------------------------------------------------------------------------
# API contract for declarative FIO formatting.
# ---------------------------------------------------------------------------
path = "apps/api/src/template-draft-routes.ts"
content = read(path)
content = replace_once(
    content,
    'import { defaultScalarFormatter } from "@docomator/template-compiler";',
    '''import {
  defaultScalarFormatter,
  parseScalarFormatter
} from "@docomator/template-compiler";''',
    "API imports",
)
content = replace_once(
    content,
    '''  decimalPlaces?: number;
  timeZone?: string;
  repeatRow?: boolean;''',
    '''  decimalPlaces?: number;
  timeZone?: string;
  personName?: {
    sourceOrder:
      | "family-given-patronymic"
      | "given-patronymic-family"
      | "family-given"
      | "given-family";
    pattern: string;
  };
  repeatRow?: boolean;''',
    "API body type",
)
content = replace_once(
    content,
    '''            timeZone: {
              type: "string",
              minLength: 1,
              maxLength: 100,
              pattern: "^(?:UTC|[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+)$"
            },
            repeatRow: { type: "boolean", default: false },''',
    '''            timeZone: {
              type: "string",
              minLength: 1,
              maxLength: 100,
              pattern: "^(?:UTC|[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+)$"
            },
            personName: {
              type: "object",
              additionalProperties: false,
              required: ["sourceOrder", "pattern"],
              properties: {
                sourceOrder: {
                  type: "string",
                  enum: [
                    "family-given-patronymic",
                    "given-patronymic-family",
                    "family-given",
                    "given-family"
                  ]
                },
                pattern: { type: "string", minLength: 1, maxLength: 160 }
              }
            },
            repeatRow: { type: "boolean", default: false },''',
    "API schema",
)
content = replace_once(
    content,
    '''      const formatter = defaultScalarFormatter(request.body.valueType, {
        ...(request.body.decimalPlaces === undefined
          ? {}
          : { fractionDigits: request.body.decimalPlaces }),
        ...(request.body.timeZone === undefined
          ? {}
          : { timeZone: request.body.timeZone })
      });''',
    '''      if (
        request.body.personName !== undefined &&
        request.body.valueType !== "string" &&
        request.body.valueType !== "text"
      ) {
        throw new TemplateDraftValidationError(
          "Вариант записи ФИО можно задать только для текстового поля."
        );
      }
      const formatter =
        request.body.personName === undefined
          ? defaultScalarFormatter(request.body.valueType, {
              ...(request.body.decimalPlaces === undefined
                ? {}
                : { fractionDigits: request.body.decimalPlaces }),
              ...(request.body.timeZone === undefined
                ? {}
                : { timeZone: request.body.timeZone })
            })
          : parseScalarFormatter(request.body.valueType, {
              version: 1,
              kind: "person-name.ru",
              sourceOrder: request.body.personName.sourceOrder,
              pattern: request.body.personName.pattern
            });''',
    "API formatter derivation",
)
write(path, content)


# ---------------------------------------------------------------------------
# User interaction: virtual FIO source, format preview and explicit placement.
# ---------------------------------------------------------------------------
path = "apps/api/ui/document-structure.js"
content = read(path)
property_block = r'''const structureSystemPropertyDefinitions = [
  {
    key: "__system_display_name__",
    label: "ФИО сотрудника",
    valueType: "string",
    systemSource: "display-name",
    appliesTo: ["person"]
  }
];

const structureNamePatterns = {
  identity: null,
  full: "{Фамилия} {Имя} {Отчество}",
  "family-initials": "{Фамилия} {И}.{О}.",
  "initials-family": "{И}.{О}. {Фамилия}",
  family: "{Фамилия}",
  "family-given": "{Фамилия} {Имя}",
  "given-family": "{Имя} {Фамилия}",
  "given-patronymic": "{Имя} {Отчество}"
};

function structureSelectedDefinition(propertyKey = document.querySelector("#documentFieldProperty")?.value || "") {
  return (
    structureSystemPropertyDefinitions.find((definition) => definition.key === propertyKey) ||
    structurePropertyDefinitions.find((definition) => definition.key === propertyKey)
  );
}

function structureStableToken(value) {
  let hash = 2166136261;
  for (let index = 0; index < String(value).length; index += 1) {
    hash ^= String(value).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function structureEffectiveDefinition(definition, element) {
  if (definition?.systemSource !== "display-name") return definition;
  return {
    ...definition,
    key: `subject.name_${structureStableToken(element.id)}.display_name`
  };
}

function structurePropertyOptions() {
  const applicable = structurePropertyDefinitions.filter((definition) => {
    const appliesTo = Array.isArray(definition.appliesTo) ? definition.appliesTo : [];
    return appliesTo.length === 0 || appliesTo.includes("person");
  });
  const cardOptions = applicable
    .map(
      (definition) =>
        `<option value="${structureEscape(definition.key)}">${structureEscape(definition.label)} · ${structureEscape(structureFieldTypeLabel(definition.valueType))}</option>`
    )
    .join("");
  return [
    '<optgroup label="Основные сведения">',
    '<option value="__system_display_name__">ФИО сотрудника · с выбором варианта записи</option>',
    "</optgroup>",
    ...(cardOptions ? ['<optgroup label="Поля карточки">', cardOptions, "</optgroup>"] : []),
    '<option value="__new__">Добавить новое поле сотрудника…</option>'
  ].join("");
}

async function loadStructurePropertyDefinitions() {
  const body = await structureFetchJson(
    "/api/v1/knowledge/property-definitions?limit=500"
  );
  structurePropertyDefinitions = Array.isArray(body.data) ? body.data : [];
}

function renderNewStructurePropertyFields() {
  const select = document.querySelector("#documentFieldProperty");
  const fields = document.querySelector("#documentNewPropertyFields");
  if (!select || !fields) return;
  fields.hidden = select.value !== "__new__";
  renderStructureFormatterFields();
  updateStructureFieldReadiness();
}

function selectedStructureValueType() {
  const propertyKey = document.querySelector("#documentFieldProperty")?.value || "";
  if (propertyKey === "__new__") {
    return document.querySelector("#documentFieldType")?.value || "string";
  }
  return structureSelectedDefinition(propertyKey)?.valueType || "string";
}

function structureNamePatternError(pattern) {
  const text = String(pattern || "").normalize("NFKC").trim();
  if (!text || text.length > 160 || /[\u0000-\u001f\u007f]/u.test(text)) {
    return "Укажите безопасный шаблон длиной до 160 знаков.";
  }
  const allowed = new Set(["Фамилия", "Имя", "Отчество", "Ф", "И", "О"]);
  let count = 0;
  const rest = text.replace(/\{([^{}]+)\}/gu, (_match, token) => {
    count += 1;
    return allowed.has(token) ? "" : `{${token}}`;
  });
  if (count === 0 || rest.includes("{") || rest.includes("}")) {
    return "Используйте части {Фамилия}, {Имя}, {Отчество}, {Ф}, {И} или {О}.";
  }
  return "";
}

function structureSelectedPersonName(form = document) {
  const presentation = form.querySelector("#documentFieldTextPresentation")?.value || "identity";
  if (presentation === "identity") return null;
  const pattern =
    presentation === "custom"
      ? form.querySelector("#documentFieldNamePattern")?.value?.trim() || ""
      : structureNamePatterns[presentation];
  const error = structureNamePatternError(pattern);
  if (error) throw { message: error };
  return {
    sourceOrder:
      form.querySelector("#documentFieldNameSourceOrder")?.value ||
      "family-given-patronymic",
    pattern
  };
}

function structureNamePreview() {
  const presentation = document.querySelector("#documentFieldTextPresentation")?.value || "identity";
  const options = document.querySelector("#documentFieldNameOptions");
  const custom = document.querySelector("#documentFieldNamePatternField");
  const preview = document.querySelector("#documentFieldNamePreview");
  if (options) options.hidden = presentation === "identity";
  if (custom) custom.hidden = presentation !== "custom";
  if (!preview || presentation === "identity") {
    updateStructureFieldReadiness();
    return;
  }
  const pattern =
    presentation === "custom"
      ? document.querySelector("#documentFieldNamePattern")?.value || ""
      : structureNamePatterns[presentation] || "";
  const error = structureNamePatternError(pattern);
  if (error) {
    preview.className = "structure-name-preview is-error";
    preview.textContent = error;
    updateStructureFieldReadiness();
    return;
  }
  const sourceOrder =
    document.querySelector("#documentFieldNameSourceOrder")?.value ||
    "family-given-patronymic";
  const source =
    sourceOrder === "given-patronymic-family"
      ? "Иван Иванович Иванов"
      : sourceOrder === "given-family"
        ? "Иван Иванов"
        : sourceOrder === "family-given"
          ? "Иванов Иван"
          : "Иванов Иван Иванович";
  const values = {
    Фамилия: "Иванов",
    Имя: "Иван",
    Отчество: sourceOrder === "family-given" || sourceOrder === "given-family" ? "" : "Иванович",
    Ф: "И",
    И: "И",
    О: sourceOrder === "family-given" || sourceOrder === "given-family" ? "" : "И"
  };
  const result = pattern
    .replace(/\{([^{}]+)\}/gu, (_match, token) => values[token] || "")
    .replace(/\s+/gu, " ")
    .replace(/\s+([,.;:])/gu, "$1")
    .replace(/([,.;:])(?:\s*\1)+/gu, "$1")
    .replace(/\s+[,.;:]+$/gu, "")
    .trim();
  preview.className = "structure-name-preview";
  preview.textContent = `Пример: «${source}» → «${result}».`;
  updateStructureFieldReadiness();
}

function renderStructureFormatterFields() {
  const container = document.querySelector("#documentFieldFormatter");
  if (!container) return;
  const valueType = selectedStructureValueType();
  if (valueType === "number") {
    const options = [
      '<option value="">Без фиксированного количества</option>',
      ...Array.from(
        { length: 7 },
        (_, digits) => `<option value="${digits}">${digits}</option>`
      )
    ].join("");
    container.hidden = false;
    container.innerHTML = `
      <label>
        <span>Знаков после запятой</span>
        <select id="documentFieldDecimalPlaces">${options}</select>
        <small>В документе используется запятая. Без фиксации лишние нули не добавляются.</small>
      </label>`;
    updateStructureFieldReadiness();
    return;
  }
  if (valueType === "date-time") {
    const detectedTimeZone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow";
    container.hidden = false;
    container.innerHTML = `
      <label>
        <span>Часовой пояс документа</span>
        <input id="documentFieldTimeZone" type="text" maxlength="100" value="${structureEscape(detectedTimeZone)}" placeholder="Europe/Moscow" />
        <small>Дата и время будут зафиксированы в этом часовом поясе, например 16.07.2026 12:30.</small>
      </label>`;
    updateStructureFieldReadiness();
    return;
  }
  if (valueType === "string" || valueType === "text") {
    const systemName = structureSelectedDefinition()?.systemSource === "display-name";
    container.hidden = false;
    container.innerHTML = `
      <div class="structure-name-format">
        <label>
          <span>Как записать текст в документе?</span>
          <select id="documentFieldTextPresentation">
            <option value="identity"${systemName ? "" : " selected"}>Без изменений</option>
            <optgroup label="Варианты ФИО">
              <option value="full"${systemName ? " selected" : ""}>Фамилия Имя Отчество</option>
              <option value="family-initials">Фамилия И.О.</option>
              <option value="initials-family">И.О. Фамилия</option>
              <option value="family">Только фамилия</option>
              <option value="family-given">Фамилия Имя</option>
              <option value="given-family">Имя Фамилия</option>
              <option value="given-patronymic">Имя Отчество</option>
              <option value="custom">Свой шаблон…</option>
            </optgroup>
          </select>
          <small>Варианты ФИО применяйте к полю, где хранится полное имя сотрудника.</small>
        </label>
        <div id="documentFieldNameOptions" class="structure-name-options" hidden>
          <label>
            <span>Как ФИО записано в карточке?</span>
            <select id="documentFieldNameSourceOrder">
              <option value="family-given-patronymic">Фамилия Имя Отчество</option>
              <option value="given-patronymic-family">Имя Отчество Фамилия</option>
              <option value="family-given">Фамилия Имя</option>
              <option value="given-family">Имя Фамилия</option>
            </select>
            <small>Это нужно, чтобы система правильно определила фамилию и инициалы.</small>
          </label>
          <label id="documentFieldNamePatternField" hidden>
            <span>Свой шаблон записи</span>
            <input id="documentFieldNamePattern" type="text" maxlength="160" value="{Фамилия} {И}.{О}." />
            <small>Доступны {Фамилия}, {Имя}, {Отчество}, {Ф}, {И}, {О}.</small>
          </label>
          <output id="documentFieldNamePreview" class="structure-name-preview"></output>
        </div>
      </div>`;
    container
      .querySelector("#documentFieldTextPresentation")
      ?.addEventListener("change", structureNamePreview);
    container
      .querySelector("#documentFieldNameSourceOrder")
      ?.addEventListener("change", structureNamePreview);
    container
      .querySelector("#documentFieldNamePattern")
      ?.addEventListener("input", structureNamePreview);
    structureNamePreview();
    return;
  }
  container.innerHTML = "";
  container.hidden = true;
  updateStructureFieldReadiness();
}

function structureTextRangeControl(element) {
  if (element.kind !== "paragraph") return "";
  if (!element.text) {
    return `
      <div class="structure-placement-card is-ready">
        <input id="documentFieldParagraphMode" type="hidden" value="whole" />
        <strong>Пустое место готово к заполнению</strong>
        <small>Значение будет вставлено в этот абзац или ячейку таблицы. Выделять текст не нужно.</small>
      </div>`;
  }
  const rangeUnavailable = Boolean(element.runsTruncated);
  return `
    <fieldset class="structure-placement-field">
      <legend>Что заменить в этом абзаце?</legend>
      <label class="structure-choice-field">
        <input type="radio" name="documentFieldParagraphMode" value="range"${rangeUnavailable ? " disabled" : " checked"} />
        <span><strong>Только выделенный текст</strong><small>Подпись до и после выделения останется без изменений.</small></span>
      </label>
      <label class="structure-choice-field">
        <input type="radio" name="documentFieldParagraphMode" value="whole"${rangeUnavailable ? " checked" : ""} />
        <span><strong>Весь абзац</strong><small>Всё содержимое выбранного абзаца будет заменено значением поля.</small></span>
      </label>
      <label class="structure-text-range-field" for="documentFieldTextRange">
        <span>Выделите заменяемый фрагмент</span>
        <textarea id="documentFieldTextRange" readonly${rangeUnavailable ? " disabled" : ""}>${structureEscape(element.text)}</textarea>
        <small id="documentFieldTextRangeMessage">${
          rangeUnavailable
            ? "В абзаце слишком много текстовых фрагментов для точного выделения. Доступна замена всего абзаца."
            : "Выделите плейсхолдер или другой изменяемый текст."
        }</small>
      </label>
    </fieldset>`;
}'''
content = replace_between(
    content,
    "function structurePropertyOptions() {",
    "function structureCellCoordinate(address) {",
    property_block,
    "UI property/formatter block",
)
selection_block = r'''function selectedStructureParagraphMode(form = document) {
  return (
    form.querySelector("#documentFieldParagraphMode")?.value ||
    form.querySelector('input[name="documentFieldParagraphMode"]:checked')?.value ||
    "range"
  );
}

function captureStructureTextRange() {
  const control = document.querySelector("#documentFieldTextRange");
  const message = document.querySelector("#documentFieldTextRangeMessage");
  if (
    !control ||
    !message ||
    !selectedStructureElement ||
    selectedStructureParagraphMode() !== "range"
  ) {
    updateStructureFieldReadiness();
    return;
  }
  const startOffset = control.selectionStart;
  const endOffset = control.selectionEnd;
  if (endOffset <= startOffset) {
    selectedStructureTextRange = null;
    message.textContent =
      "Выделите плейсхолдер или другой изменяемый текст. Подпись до и после выделения останется без изменений.";
    updateStructureFieldReadiness();
    return;
  }
  selectedStructureTextRange = { startOffset, endOffset };
  const selected = selectedStructureElement.text.slice(startOffset, endOffset);
  message.textContent = `Будет заменён только фрагмент «${selected}». Остальной текст абзаца сохранится.`;
  updateStructureFieldReadiness();
}

function renderStructureParagraphMode() {
  const mode = selectedStructureParagraphMode();
  const control = document.querySelector("#documentFieldTextRange");
  const message = document.querySelector("#documentFieldTextRangeMessage");
  if (mode === "whole") {
    selectedStructureTextRange = null;
    if (control) control.disabled = true;
    if (message) {
      message.textContent =
        "Будет заменён весь абзац. Используйте этот режим только когда его текущий текст не нужно сохранять.";
    }
  } else {
    if (control) control.disabled = false;
    if (message && selectedStructureTextRange === null) {
      message.textContent =
        "Выделите плейсхолдер или другой изменяемый текст. Подпись до и после выделения останется без изменений.";
    }
  }
  updateStructureFieldReadiness();
}

function structureFieldBlockReason(form) {
  if (!selectedStructureElement) return "Сначала выберите место в документе.";
  if (selectedStructureElement.kind === "cell" && selectedStructureElement.formula) {
    return "Эта ячейка содержит формулу и не может быть полем сотрудника.";
  }
  if (
    selectedStructureElement.kind === "cell" &&
    structureDraft?.repeatBinding?.kind === "xlsx.repeat-row" &&
    !structureRepeatContainsElement(structureDraft.repeatBinding, selectedStructureElement)
  ) {
    return "Ячейка находится вне ранее сохранённого повторяемого диапазона.";
  }
  const propertyKey = form.querySelector("#documentFieldProperty")?.value || "";
  if (!propertyKey) return "Выберите поле сотрудника.";
  if (propertyKey === "__new__") {
    const label = form.querySelector("#documentFieldLabel")?.value?.trim() || "";
    const confirmed = Boolean(form.querySelector("#documentPropertyConfirm")?.checked);
    if (!label || !confirmed) {
      return "Укажите название нового поля и подтвердите его добавление карточкам сотрудников.";
    }
  }
  if (selectedStructureElement.kind === "paragraph") {
    const mode = selectedStructureParagraphMode(form);
    if (mode === "range" && selectedStructureTextRange === null) {
      return "Выделите в абзаце текст, который нужно заменить, либо выберите замену всего абзаца.";
    }
  }
  try {
    structureSelectedPersonName(form);
  } catch (error) {
    return error?.message || "Проверьте вариант записи ФИО.";
  }
  return "";
}

function structureFieldReadyMessage(form) {
  const definition = structureSelectedDefinition(
    form.querySelector("#documentFieldProperty")?.value || ""
  );
  const fieldLabel =
    definition?.label || form.querySelector("#documentFieldLabel")?.value?.trim() || "поле";
  if (selectedStructureElement?.kind === "cell") {
    return `Готово: «${fieldLabel}» будет записано в выбранную ячейку.`;
  }
  if (!selectedStructureElement?.text) {
    return `Готово: «${fieldLabel}» будет вставлено в пустое место. Нажмите «Связать с документом».`;
  }
  if (selectedStructureParagraphMode(form) === "whole") {
    return `Готово: «${fieldLabel}» заменит весь выбранный абзац.`;
  }
  const range = selectedStructureTextRange;
  const selected = range
    ? selectedStructureElement.text.slice(range.startOffset, range.endOffset)
    : "";
  return `Готово: «${fieldLabel}» заменит только фрагмент «${selected}».`;
}

function updateStructureFieldReadiness() {
  const form = document.querySelector("#documentFieldForm");
  const button = form?.querySelector("#documentFieldSave");
  const message = form?.querySelector("#documentFieldMessage");
  if (!form || !button || !message || fieldBusy) return;
  const reason = structureFieldBlockReason(form);
  button.disabled = Boolean(reason);
  message.className = reason ? "is-warning" : "is-ready";
  message.textContent = reason || structureFieldReadyMessage(form);
}

function renderStructureSelection(element) {
  selectedStructureElement = element;
  selectedStructureTextRange = null;
  document.querySelectorAll(".structure-element.is-selected").forEach((item) => {
    item.classList.remove("is-selected");
    item.setAttribute("aria-pressed", "false");
  });
  const selected = document.querySelector(`[data-structure-id="${CSS.escape(element.id)}"]`);
  selected?.classList.add("is-selected");
  selected?.setAttribute("aria-pressed", "true");

  const detail = document.querySelector("#documentStructureSelection");
  if (!detail) return;
  const formulaUnavailable = element.kind === "cell" && Boolean(element.formula);
  const outsideCurrentRepeat = Boolean(
    element.kind === "cell" &&
      structureDraft?.repeatBinding?.kind === "xlsx.repeat-row" &&
      !structureRepeatContainsElement(structureDraft.repeatBinding, element)
  );
  const fieldUnavailable = formulaUnavailable || outsideCurrentRepeat;
  detail.innerHTML = `
    <div class="structure-selection-content">
      <strong>${structureEscape(structureLocation(element))}</strong>
      <p>${structureEscape(structurePreview(element))}</p>
      <form class="structure-field-form" id="documentFieldForm" novalidate>
        <div class="structure-field-grid">
          ${structureTextRangeControl(element)}
          ${structureRepeatRowControl(element)}
          <label>
            <span>Какое поле сотрудника поставить сюда?</span>
            <select id="documentFieldProperty" name="propertyKey">${structurePropertyOptions()}</select>
            <small>Для ФИО доступны полная запись, фамилия, инициалы и собственный безопасный шаблон.</small>
          </label>
          <div id="documentNewPropertyFields" class="structure-new-property" hidden>
            <label>
              <span>Название нового поля</span>
              <input id="documentFieldLabel" name="label" type="text" maxlength="500" placeholder="Например, Должность" />
            </label>
            <label>
              <span>Тип значения</span>
              <select id="documentFieldType" name="valueType">${fieldTypeOptions()}</select>
            </label>
            <label class="structure-required-field">
              <input id="documentPropertyConfirm" type="checkbox" />
              <span><strong>Добавить поле всем сотрудникам</strong><small>Поле появится в карточках и будет доступно другим шаблонам.</small></span>
            </label>
          </div>
          <div id="documentFieldFormatter" class="structure-new-property" hidden></div>
          <label class="structure-required-field">
            <input id="documentFieldRequired" name="required" type="checkbox" />
            <span><strong>Обязательное поле</strong><small>Без значения документ нельзя будет завершить.</small></span>
          </label>
        </div>
        <details class="intake-technical">
          <summary>Технические сведения</summary>
          <p>Координата: <code>${structureEscape(element.id)}</code>. Часть пакета: <code>${structureEscape(element.part || element.sheetName || "не указана")}</code>. Сервер повторно проверит её по сохранённой структуре.</p>
        </details>
        <div class="structure-field-actions">
          <button class="primary-button" id="documentFieldSave" type="submit" disabled>Связать с документом</button>
          <p id="documentFieldMessage"${fieldUnavailable ? ' class="is-warning"' : ""}></p>
        </div>
      </form>
    </div>`;
  detail.hidden = false;
  detail
    .querySelector("#documentFieldProperty")
    ?.addEventListener("change", renderNewStructurePropertyFields);
  detail
    .querySelector("#documentFieldType")
    ?.addEventListener("change", renderStructureFormatterFields);
  detail
    .querySelector("#documentFieldRepeatArea")
    ?.addEventListener("change", renderStructureRepeatAreaFields);
  detail
    .querySelectorAll('input[name="documentFieldRepeatSelection"]')
    .forEach((control) =>
      control.addEventListener("change", renderStructureRepeatAreaFields)
    );
  detail
    .querySelectorAll('input[name="documentFieldParagraphMode"]')
    .forEach((control) => control.addEventListener("change", renderStructureParagraphMode));
  const textRange = detail.querySelector("#documentFieldTextRange");
  for (const eventName of ["select", "mouseup", "keyup", "touchend"]) {
    textRange?.addEventListener(eventName, captureStructureTextRange);
  }
  const form = detail.querySelector("#documentFieldForm");
  form?.addEventListener("input", updateStructureFieldReadiness);
  form?.addEventListener("change", updateStructureFieldReadiness);
  form?.addEventListener("submit", saveSelectedField);
  renderNewStructurePropertyFields();
  renderStructureRepeatAreaFields();
  renderStructureParagraphMode();
  updateStructureFieldReadiness();
}'''
content = replace_between(
    content,
    "function captureStructureTextRange() {",
    "async function loadStructureDraft() {",
    selection_block,
    "UI placement/selection block",
)

save_block = r'''async function saveSelectedField(event) {
  event.preventDefault();
  if (fieldBusy || !selectedStructureElement || !structureReport) return;
  const form = event.currentTarget;
  const button = form.querySelector("#documentFieldSave");
  const message = form.querySelector("#documentFieldMessage");
  const propertyKey = form.querySelector("#documentFieldProperty")?.value || "";
  let definition = structureSelectedDefinition(propertyKey);
  const label = form.querySelector("#documentFieldLabel")?.value?.trim() || "";
  const valueType = form.querySelector("#documentFieldType")?.value || "string";
  const required = Boolean(form.querySelector("#documentFieldRequired")?.checked);
  const repeatRow = Boolean(form.querySelector("#documentFieldRepeatRow")?.checked);
  const paragraphMode = selectedStructureParagraphMode(form);
  const creatingProperty = propertyKey === "__new__";
  const propertyConfirmed = Boolean(form.querySelector("#documentPropertyConfirm")?.checked);
  const blockReason = structureFieldBlockReason(form);
  if (blockReason) {
    message.className = "is-error";
    message.textContent = blockReason;
    return;
  }
  let repeatArea;
  let personName;
  try {
    repeatArea = selectedStructureRepeatArea(form);
    personName = structureSelectedPersonName(form);
  } catch (error) {
    message.className = "is-error";
    message.textContent = error?.message || "Проверьте настройки поля.";
    return;
  }
  if (!propertyKey || (creatingProperty && (!label || !propertyConfirmed))) {
    message.className = "is-error";
    message.textContent = creatingProperty
      ? "Укажите название и подтвердите добавление поля всем сотрудникам."
      : "Выберите поле сотрудника.";
    return;
  }

  fieldBusy = true;
  button.disabled = true;
  message.className = "is-loading";
  message.textContent =
    "Проверяем сохранённый исходник, координату и выбранный вариант записи значения.";

  try {
    const { spaceId, draft } = await loadStructureDraft();
    if (creatingProperty) {
      const labelMatches = structurePropertyDefinitions.filter(
        (candidate) =>
          candidate.label.trim().toLocaleLowerCase("ru-RU") ===
          label.toLocaleLowerCase("ru-RU")
      );
      if (labelMatches.length > 1) {
        throw { message: `Найдено несколько полей «${label}». Выберите нужное из списка.` };
      }
      const labelMatch = labelMatches[0];
      if (labelMatch && labelMatch.valueType !== valueType) {
        throw { message: `Поле «${label}» уже существует с другим типом значения.` };
      }
      if (labelMatch) {
        definition = labelMatch;
      } else {
        const definitionBody = await structureFetchJson(
          "/api/v1/knowledge/property-definitions",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              label,
              valueType,
              appliesTo: ["person"],
              sensitivity: "personal"
            })
          }
        );
        definition = definitionBody.data;
        structurePropertyDefinitions = [
          ...structurePropertyDefinitions,
          definition
        ];
      }
    }
    if (!definition) throw { message: "Выбранное поле сотрудника не найдено." };
    definition = structureEffectiveDefinition(definition, selectedStructureElement);
    const decimalPlacesValue =
      form.querySelector("#documentFieldDecimalPlaces")?.value ?? "";
    const timeZone =
      form.querySelector("#documentFieldTimeZone")?.value?.trim() || "";
    const fieldBody = await structureFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draft.id)}/fields`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: definition.key,
          label: definition.label,
          valueType: definition.valueType,
          required,
          elementId: selectedStructureElement.id,
          ...(repeatRow ? { repeatRow: true } : {}),
          ...(repeatArea ? { repeatArea } : {}),
          ...(personName ? { personName } : {}),
          ...(definition.valueType === "number" && decimalPlacesValue !== ""
            ? { decimalPlaces: Number(decimalPlacesValue) }
            : {}),
          ...(definition.valueType === "date-time" && timeZone
            ? { timeZone }
            : {}),
          ...(selectedStructureElement.kind === "paragraph" && paragraphMode === "range"
            ? { textRange: selectedStructureTextRange }
            : {})
        })
      }
    );
    message.className = "is-success";
    message.innerHTML = `Поле «${structureEscape(fieldBody.data.field.label)}» связано с документом. Следующий шаг — пробное заполнение.`;
    button.textContent = "Связано";
    button.hidden = true;
    structureDraft.repeatBinding = fieldBody.data.repeatBinding;
    structureDraft.fields = [
      ...(Array.isArray(structureDraft.fields) ? structureDraft.fields : []),
      fieldBody.data.field
    ];
    form.querySelectorAll("input, select, textarea").forEach((control) => {
      control.disabled = true;
    });
    const actions = form.querySelector(".structure-field-actions");
    actions?.insertAdjacentHTML(
      "beforeend",
      `<div class="structure-field-next">
        <button class="secondary-button" id="documentFieldAddAnother" type="button">Добавить ещё поле</button>
        <button class="primary-button" id="documentFieldsContinue" type="button">Перейти к проверке</button>
      </div>`
    );
    actions
      ?.querySelector("#documentFieldAddAnother")
      ?.addEventListener("click", () => {
        const next = document.querySelector(".structure-element:not(.is-selected)");
        next?.focus();
        next?.scrollIntoView({
          block: "center",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth"
        });
      });
    actions
      ?.querySelector("#documentFieldsContinue")
      ?.addEventListener("click", () => {
        globalThis.docomatorTemplateWizard?.complete(2, {
          sourceId: draft.sourceRecordId || structureWizardArtifacts().sourceId,
          draftId: draft.id
        });
      });
  } catch (error) {
    const operationId = error?.operationId || "";
    message.className = "is-error";
    message.innerHTML = `${structureEscape(error?.message || "Сохранить поле не удалось.")}${operationId ? ` Идентификатор операции: <code>${structureEscape(operationId)}</code>.` : ""}`;
    button.disabled = false;
  } finally {
    fieldBusy = false;
  }
}'''
content = replace_between(
    content,
    "async function saveSelectedField(event) {",
    "function renderStructure(report, operationId) {",
    save_block,
    "UI save block",
)
content = replace_once(
    content,
    'В DOCX выберите абзац, затем выделите только изменяемый текст. В XLSX выберите нужную ячейку.',
    'В DOCX пустой абзац можно заполнить сразу; в абзаце с текстом выберите фрагмент или замену всего абзаца. В XLSX выберите нужную ячейку.',
    "structure guidance",
)
write(path, content)


# CSS for the new placement and formatter controls.
path = "apps/api/ui/template-field.css"
content = read(path)
addition = r'''.structure-placement-field,
.structure-placement-card {
  grid-column: 1 / -1;
  margin: 0;
  padding: 0.85rem;
  border: 1px solid var(--border);
  border-radius: 0.85rem;
  background: var(--surface);
}

.structure-placement-field {
  display: grid;
  gap: 0.65rem;
}

.structure-placement-field legend {
  padding: 0 0.25rem;
  color: var(--text);
  font-weight: 650;
}

.structure-placement-card {
  display: grid;
  gap: 0.25rem;
}

.structure-placement-card.is-ready {
  border-color: color-mix(in srgb, var(--success) 55%, var(--border));
}

.structure-choice-field {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.65rem;
  align-items: start;
}

.structure-choice-field input {
  width: 1.15rem;
  height: 1.15rem;
  margin-top: 0.2rem;
}

.structure-choice-field span {
  display: grid;
  gap: 0.2rem;
}

.structure-choice-field strong,
.structure-placement-card strong {
  color: var(--text);
}

.structure-placement-card small,
.structure-choice-field small {
  color: var(--muted);
  line-height: 1.4;
}

.structure-name-format,
.structure-name-options {
  display: grid;
  gap: 0.75rem;
}

.structure-name-options {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding-top: 0.75rem;
  border-top: 1px solid var(--border);
}

.structure-name-options[hidden],
.structure-name-options label[hidden] {
  display: none;
}

.structure-name-preview {
  grid-column: 1 / -1;
  display: block;
  padding: 0.7rem 0.8rem;
  border-radius: 0.7rem;
  background: var(--accent-soft);
  color: var(--text);
  font-size: 0.88rem;
  line-height: 1.45;
}

.structure-name-preview.is-error {
  background: color-mix(in srgb, var(--danger) 14%, var(--surface));
  color: var(--danger);
}

.structure-field-actions p.is-warning {
  color: var(--warning, #d9a441);
}

.structure-field-actions p.is-ready {
  color: var(--success);
}

.structure-field-grid textarea:disabled {
  opacity: 0.68;
  cursor: not-allowed;
}

@media (max-width: 760px) {
  .structure-name-options {
    grid-template-columns: 1fr;
  }
}'''
content = append_once(content, ".structure-name-preview {", addition, "template field CSS")
write(path, content)


# ---------------------------------------------------------------------------
# Tests: formatter, rendering, API and browser request contract.
# ---------------------------------------------------------------------------
path = "packages/template-compiler/src/scalar-formatter.test.ts"
content = read(path)
addition = r'''test("Russian personal-name formatter supports common and custom variants", () => {
  const source = "Иванов Иван Иванович";
  assert.equal(
    formatScalarDisplay("string", source, {
      version: 1,
      kind: "person-name.ru",
      sourceOrder: "family-given-patronymic",
      pattern: "{Фамилия} {И}.{О}."
    }),
    "Иванов И.И."
  );
  assert.equal(
    formatScalarDisplay("string", source, {
      version: 1,
      kind: "person-name.ru",
      sourceOrder: "family-given-patronymic",
      pattern: "{И}.{О}. {Фамилия}"
    }),
    "И.И. Иванов"
  );
  assert.equal(
    formatScalarDisplay("string", source, {
      version: 1,
      kind: "person-name.ru",
      sourceOrder: "family-given-patronymic",
      pattern: "{Фамилия}"
    }),
    "Иванов"
  );
  assert.equal(
    formatScalarDisplay("string", "Иван Иванович Иванов", {
      version: 1,
      kind: "person-name.ru",
      sourceOrder: "given-patronymic-family",
      pattern: "{Фамилия}, {Имя} {Отчество}"
    }),
    "Иванов, Иван Иванович"
  );
  assert.equal(
    formatScalarDisplay("string", "Иванов Иван", {
      version: 1,
      kind: "person-name.ru",
      sourceOrder: "family-given",
      pattern: "{Фамилия} {И}.{О}."
    }),
    "Иванов И."
  );
  assert.equal(
    formatScalarDisplay("string", "Иванов И.И.", {
      version: 1,
      kind: "person-name.ru",
      sourceOrder: "family-given-patronymic",
      pattern: "{И}.{О}. {Фамилия}"
    }),
    "И.И. Иванов"
  );
});

test("personal-name formatter rejects scripts and unknown tokens", () => {
  for (const formatter of [
    {
      version: 1,
      kind: "person-name.ru",
      sourceOrder: "family-given-patronymic",
      pattern: "{Должность} {Фамилия}"
    },
    {
      version: 1,
      kind: "person-name.ru",
      sourceOrder: "unknown",
      pattern: "{Фамилия}"
    },
    {
      version: 1,
      kind: "person-name.ru",
      sourceOrder: "family-given-patronymic",
      pattern: "return employee.name"
    }
  ]) {
    assert.throws(
      () => parseScalarFormatter("string", formatter),
      (error: unknown) =>
        error instanceof TemplateCompilerError && error.code === "invalid_formatter"
    );
  }
});'''
content = append_once(content, 'test("Russian personal-name formatter supports', addition, "formatter tests")
write(path, content)

path = "packages/template-compiler/src/scalar-render.test.ts"
content = read(path)
addition = r'''test("text fields apply the selected personal-name format before DOCX rendering", async () => {
  const input = await compiledDocx();
  const result = await renderScalarValue({
    compiled: input.compiled.output,
    technicalBinding: input.compiled.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: "string",
    value: "Иванов Иван Иванович",
    formatter: {
      version: 1,
      kind: "person-name.ru",
      sourceOrder: "family-given-patronymic",
      pattern: "{Фамилия} {И}.{О}."
    }
  });

  assert.equal(result.renderedValue, "Иванов И.И.");
  assert.equal(result.readBackValue, "Иванов И.И.");
  const entries = await readOoxmlPackage(result.output);
  const xml = packageEntry(entries, "word/document.xml").content.toString("utf8");
  assert.match(xml, /Иванов И\.И\./u);
});'''
content = append_once(content, 'test("text fields apply the selected personal-name format', addition, "render tests")
write(path, content)

path = "apps/api/src/template-draft-routes.test.ts"
content = read(path)
content = replace_once(
    content,
    '''<w:p><w:r><w:t>ФИО получателя</w:t></w:r></w:p><w:p><w:r><w:t>Должность</w:t></w:r></w:p><w:p><w:r><w:t>ФИО: ______</w:t></w:r></w:p></w:body>''',
    '''<w:p><w:r><w:t>ФИО получателя</w:t></w:r></w:p><w:p><w:r><w:t>Должность</w:t></w:r></w:p><w:p><w:r><w:t>ФИО: ______</w:t></w:r></w:p><w:p><w:r><w:t></w:t></w:r></w:p></w:body>''',
    "empty paragraph fixture",
)
addition = r'''test("API accepts an empty DOCX paragraph and stores a safe FIO formatter", async () => {
  const { app, dataDir } = await testApp();
  try {
    const source = await quarantineSource(app);
    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/${source.id}/draft`,
      headers: { "content-type": "application/json" },
      payload: {}
    });
    const draft = draftResponse.json().data as {
      id: string;
      structure: {
        elements: Array<{ id: string; kind: string; text: string }>;
      };
    };
    const emptyParagraph = draft.structure.elements.find(
      (element) => element.kind === "paragraph" && element.text === ""
    );
    const otherParagraph = draft.structure.elements.find(
      (element) => element.kind === "paragraph" && element.text === "Должность"
    );
    assert.ok(emptyParagraph);
    assert.ok(otherParagraph);

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "subject.name_a1b2c3d4.display_name",
        label: "ФИО сотрудника",
        valueType: "string",
        elementId: emptyParagraph.id,
        personName: {
          sourceOrder: "family-given-patronymic",
          pattern: "{Фамилия} {И}.{О}."
        }
      }
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json().data.field.originalPreview, "");
    assert.equal(created.json().data.field.binding.kind, "docx.paragraph");
    assert.deepEqual(created.json().data.field.formatter, {
      version: 1,
      kind: "person-name.ru",
      sourceOrder: "family-given-patronymic",
      pattern: "{Фамилия} {И}.{О}."
    });

    const invalid = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "subject.name_deadbeef.display_name",
        label: "ФИО сотрудника",
        valueType: "string",
        elementId: otherParagraph.id,
        personName: {
          sourceOrder: "family-given-patronymic",
          pattern: "{Неизвестно}"
        }
      }
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.match(invalid.json().error.message, /неизвестн.*част/ui);
  } finally {
    await app.close();
    await fsPromises.rm(dataDir, { recursive: true, force: true });
  }
});'''
content = append_once(content, 'test("API accepts an empty DOCX paragraph', addition, "API field tests")
write(path, content)

path = "tests/e2e/template-and-generation.spec.mjs"
content = read(path)
addition = r'''test("мастер предлагает варианты ФИО и отправляет безопасный формат", async ({
  page
}) => {
  const scenario = await installDocomatorApiMock(page);
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("templates");
  await uploadAndSaveSource(page, templateCases[0]);
  await page.locator("#documentStructureButton").click();
  await page.locator(".structure-element").first().click();
  const textRange = page.locator("#documentFieldTextRange");
  await textRange.evaluate((control) => {
    const start = control.value.indexOf("______");
    control.focus();
    control.setSelectionRange(start, start + 6);
    control.dispatchEvent(new Event("select", { bubbles: true }));
  });

  await expect(page.locator("#documentFieldProperty")).toHaveValue(
    "__system_display_name__"
  );
  await page
    .locator("#documentFieldTextPresentation")
    .selectOption("family-initials");
  await expect(page.locator("#documentFieldNamePreview")).toContainText(
    "Иванов И.И."
  );
  await page.locator("#documentFieldSave").click();
  await expect(page.locator("#documentFieldMessage")).toContainText(
    "Следующий шаг — пробное заполнение"
  );

  expect(scenario.fieldRequests).toHaveLength(1);
  expect(scenario.fieldRequests[0].key).toMatch(
    /^subject\.name_[0-9a-f]{8}\.display_name$/u
  );
  expect(scenario.fieldRequests[0]).toMatchObject({
    label: "ФИО сотрудника",
    valueType: "string",
    personName: {
      sourceOrder: "family-given-patronymic",
      pattern: "{Фамилия} {И}.{О}."
    }
  });
});'''
content = append_once(content, 'test("мастер предлагает варианты ФИО', addition, "browser FIO test")
write(path, content)


# Small release note so the changed behavior is discoverable.
path = "docs/CHANGELOG.md"
content = read(path)
entry = '''## 2026-07-25 — понятная привязка пустых мест и варианты ФИО

- Пустой абзац DOCX теперь можно связать с полем без фиктивного текста и ручного выделения.
- Для абзаца с текстом явно выбирается замена выделенного фрагмента либо всего абзаца.
- Добавлено системное поле «ФИО сотрудника» с вариантами «Фамилия И.О.», «И.О. Фамилия», фамилией и собственным безопасным шаблоном.
- Перед сохранением интерфейс показывает, что именно будет заменено, а кнопка сопровождается конкретной причиной недоступности.
'''
if entry.splitlines()[0] not in content:
    first_heading_end = content.find("\n", content.find("#"))
    if first_heading_end == -1:
        content = entry + "\n" + content
    else:
        content = content[: first_heading_end + 1] + "\n" + entry + "\n" + content[first_heading_end + 1 :]
write(path, content)

print("all requested patches applied")
