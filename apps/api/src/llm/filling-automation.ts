import type { CommonConfig } from "@docomator/config";
import { chatCompletionWithLlm } from "./llm-client.js";

export interface MissingFieldDefinition {
  key: string;
  label: string;
  valueType?: string | undefined;
  description?: string | undefined;
}

export interface ValueFillingInput {
  templateTitle?: string | undefined;
  entityName?: string | undefined;
  existingValues?: Record<string, unknown> | undefined;
  missingFields: MissingFieldDefinition[];
}

export interface FilledFieldDetail {
  propertyKey: string;
  value: unknown;
  rationaleRu: string;
}

export interface ValueFillingResult {
  status: "success" | "fallback";
  source: "llm" | "fallback";
  filledValues: Record<string, unknown>;
  rationaleRu: string;
  details: FilledFieldDetail[];
  model?: string | null | undefined;
  durationMs: number;
}

const SYSTEM_PROMPT = `Ты — экспертный ИИ-модуль заполнения реквизитов платформы автоматизации документов «Оформлятор».
Тебе передаётся название формируемого документа (шаблона), ФИО/наименование субъекта (сотрудника), уже заполненные свойства карточки, а также перечень недостающих обязательных полей.
Твоя задача — предложить корректные, юридически и грамматически грамотные русскоязычные значения для недостающих полей там, где их можно вывести из контекста или где они являются стандартными реквизитами делопроизводства.

Правила:
1. Выводи сокращённые инициалы («Иванов И.И.») из полного ФИО.
2. Подставляй стандартный город/место составления («г. Москва» или город из подразделения), если поле связано с городом.
3. Подставляй текущую дату или год, если требуется дата приказа или текущий отчётный период.
4. Не придумывай паспортные данные, номера счетов или персональные конфиденциальные коды, если их нет в контексте. Если поле требует уникального ввода оператора, не заполняй его.
5. Для каждого заполненного поля поясни причину в rationaleRu.

Отвечай строго в формате JSON:
{
  "rationaleRu": "Общий комментарий к предложенным значениям",
  "filledValues": {
    "ключ_поля": "значение"
  },
  "details": [
    {
      "propertyKey": "ключ_поля",
      "value": "значение",
      "rationaleRu": "Краткое обоснование вывода значения"
    }
  ]
}`;

function deriveShortName(fullName: string): string | null {
  const parts = fullName.trim().split(/\s+/u);
  if (parts.length >= 3 && parts[0] && parts[1] && parts[2]) {
    return `${parts[0]} ${parts[1][0]?.toUpperCase()}.${parts[2][0]?.toUpperCase()}.`;
  }
  if (parts.length === 2 && parts[0] && parts[1]) {
    return `${parts[0]} ${parts[1][0]?.toUpperCase()}.`;
  }
  return null;
}

function buildFallbackFilling(
  input: ValueFillingInput,
  started: number
): ValueFillingResult {
  const filledValues: Record<string, unknown> = {};
  const details: FilledFieldDetail[] = [];

  const fullName = String(
    input.existingValues?.fullName ||
    input.existingValues?.fio ||
    input.existingValues?.name ||
    input.entityName ||
    ""
  ).trim();

  for (const field of input.missingFields) {
    const norm = field.key.toLowerCase();
    const label = field.label.toLowerCase();

    // Check if short name can be trivially derived from full name
    if ((norm.includes("short") || norm.includes("initial") || label.includes("инициал") || label.includes("сокр")) && fullName) {
      const derived = deriveShortName(fullName);
      if (derived) {
        filledValues[field.key] = derived;
        details.push({
          propertyKey: field.key,
          value: derived,
          rationaleRu: "Сформировано сокращённое имя с инициалами из ФИО"
        });
        continue;
      }
    }

    // Check current year / date
    if (norm.includes("current_year") || label.includes("текущий год")) {
      const year = new Date().getFullYear();
      filledValues[field.key] = field.valueType === "integer" || field.valueType === "number" ? year : String(year);
      details.push({
        propertyKey: field.key,
        value: year,
        rationaleRu: "Текущий календарный год"
      });
      continue;
    }
  }

  const rationaleRu = details.length > 0
    ? `Автоматически заполнено полей: ${details.length}. Остальные поля заполняются вручную.`
    : "Сервер ИИ недоступен. Заполните недостающие поля вручную в форме быстрого исправления.";

  return {
    status: "fallback",
    source: "fallback",
    filledValues,
    rationaleRu,
    details,
    durationMs: Date.now() - started
  };
}

export async function fillMissingValues(
  config: CommonConfig,
  input: ValueFillingInput,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<ValueFillingResult> {
  const started = Date.now();

  if (!config.llmEnabled || input.missingFields.length === 0) {
    return buildFallbackFilling(input, started);
  }

  const userPrompt = JSON.stringify({
    templateTitle: input.templateTitle || "",
    entityName: input.entityName || "",
    existingValues: input.existingValues || {},
    missingFields: input.missingFields.map((f) => ({
      key: f.key,
      label: f.label,
      valueType: f.valueType || "string",
      description: f.description || ""
    }))
  }, null, 2);

  const completion = await chatCompletionWithLlm({
    config,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `Заполни недостающие поля документа:\n${userPrompt}`,
    fetchImpl: options.fetchImpl
  });

  if (!completion.success || !completion.json) {
    return buildFallbackFilling(input, started);
  }

  const rawValues = completion.json.filledValues;
  if (!rawValues || typeof rawValues !== "object" || Array.isArray(rawValues)) {
    return buildFallbackFilling(input, started);
  }

  const validKeys = new Set(input.missingFields.map((f) => f.key));
  const filledValues: Record<string, unknown> = {};
  const details: FilledFieldDetail[] = [];

  for (const [key, val] of Object.entries(rawValues as Record<string, unknown>)) {
    if (validKeys.has(key) && val !== null && val !== undefined && val !== "") {
      filledValues[key] = val;
    }
  }

  const rawDetails = completion.json.details;
  if (Array.isArray(rawDetails)) {
    for (const item of rawDetails) {
      if (item && typeof item === "object") {
        const pk = String((item as { propertyKey?: unknown }).propertyKey || "").trim();
        if (validKeys.has(pk) && pk in filledValues) {
          details.push({
            propertyKey: pk,
            value: filledValues[pk],
            rationaleRu: String((item as { rationaleRu?: unknown }).rationaleRu || "Заполнено ИИ").trim()
          });
        }
      }
    }
  }

  // If details array was missing in model output, create default details from filledValues
  if (details.length === 0 && Object.keys(filledValues).length > 0) {
    for (const [key, val] of Object.entries(filledValues)) {
      details.push({
        propertyKey: key,
        value: val,
        rationaleRu: "Значение подобрано на основе контекста документа"
      });
    }
  }

  const rationaleRu = typeof completion.json.rationaleRu === "string" && completion.json.rationaleRu.trim().length > 0
    ? completion.json.rationaleRu.trim()
    : `ИИ предложил значения для ${Object.keys(filledValues).length} полей`;

  return {
    status: "success",
    source: "llm",
    filledValues,
    rationaleRu,
    details,
    model: completion.model,
    durationMs: Date.now() - started
  };
}
