import type { CommonConfig } from "@docomator/config";
import { chatCompletionWithLlm } from "./llm-client.js";

export interface ErrorDiagnosisInput {
  errorCode?: string | undefined;
  errorMessage: string;
  stage?: "import" | "preflight" | "generation" | "general" | string | undefined;
  context?: Record<string, unknown> | undefined;
}

export interface ErrorAutoFix {
  applicable: boolean;
  descriptionRu?: string | undefined;
  columnMappings?: Record<string, string> | undefined;
  normalizedValues?: Record<string, unknown> | undefined;
  retryRecommended?: boolean | undefined;
}

export interface ErrorDiagnosisResult {
  status: "success" | "fallback";
  source: "llm" | "heuristic";
  explanationRu: string;
  suggestedActionRu: string;
  autoFix?: ErrorAutoFix | undefined;
  model?: string | null | undefined;
  durationMs: number;
}

const SYSTEM_PROMPT = `Ты — экспертный инженер платформы автоматизации документов «Оформлятор».
Твоя задача — проанализировать возникшую в процессе работы ошибку (импорт данных, проверка перед формированием, сборка шаблона), объяснить её причину на понятном русском языке без технического жаргона и предложить пользователю точные действия для исправления.
Если ошибку можно исправить автоматически (например, исправить сопоставление колонок, убрать дубликат, нормализовать дату/число), укажи это в объекте autoFix.

Ты ДОЛЖЕН ответить строго в формате JSON со следующими полями:
{
  "explanationRu": "Понятное объяснение сути ошибки на русском языке",
  "suggestedActionRu": "Конкретные шаги для пользователя по устранению ошибки",
  "autoFix": {
    "applicable": true/false,
    "descriptionRu": "Что именно будет исправлено автоматически (если применимо)",
    "columnMappings": { "НазваниеКолонки": "ключ_свойства" },
    "normalizedValues": { "ключ_поля": "исправленное_значение" },
    "retryRecommended": true/false
  }
}`;

function buildHeuristicDiagnosis(
  input: ErrorDiagnosisInput,
  started: number
): ErrorDiagnosisResult {
  const code = (input.errorCode || "").toLowerCase();
  const msg = input.errorMessage || "";
  const stage = input.stage || "general";
  const context = input.context || {};

  let explanationRu = `Произошла ошибка на этапе «${stage}»: ${msg}`;
  let suggestedActionRu = "Проверьте введённые данные и настройки операции.";
  let autoFix: ErrorAutoFix | undefined;

  if (code === "mapping_duplicate_target" || msg.includes("более одного раза")) {
    explanationRu = "Одно и то же свойство карточки назначено сразу нескольким колонкам таблицы. В системе каждое свойство должно сопоставляться только с одной колонкой.";
    suggestedActionRu = "В таблице сопоставления оставьте свойство только для одной колонки, а для остальных выберите «Не импортировать» или создайте новые поля.";
    autoFix = {
      applicable: false,
      retryRecommended: false
    };
  } else if (code === "mapping_invalid" || msg.includes("устойчивого ключа")) {
    explanationRu = "Колонка устойчивого идентификатора (ключа) не совпадает с выбранным ключевым свойством.";
    suggestedActionRu = "Убедитесь, что колонка поиска прежней записи сопоставлена именно с ключевым полем карточки.";
    autoFix = { applicable: false, retryRecommended: false };
  } else if (code === "mapping_type_mismatch" || msg.includes("тип")) {
    explanationRu = "Тип данных в колонке не соответствует типу свойства карточки (например, текст в числовом поле).";
    suggestedActionRu = "Проверьте выбранный тип данных для колонки или очистите некорректные ячейки в исходном файле.";
    autoFix = { applicable: false, retryRecommended: false };
  } else if (code === "mapping_ambiguous" || msg.includes("неоднозначно")) {
    explanationRu = "Не удалось однозначно определить, какому свойству соответствует одна из колонок таблицы.";
    suggestedActionRu = "Выберите конкретное свойство из выпадающего списка вручную.";
    autoFix = { applicable: false, retryRecommended: false };
  } else if (stage === "preflight" || msg.includes("недостающ") || context.missingFields) {
    const missing = Array.isArray(context.missingFields)
      ? (context.missingFields as string[]).join(", ")
      : "";
    explanationRu = `Перед формированием документа обнаружены незаполненные обязательные поля${missing ? `: ${missing}` : ""}. Без них сформированный документ будет неполным.`;
    suggestedActionRu = "Заполните недостающие значения в форме быстрого исправления ниже или откройте карточки сотрудников и укажите данные.";
    autoFix = { applicable: false, retryRecommended: true };
  } else if (msg.includes("файл") || msg.includes("csv") || msg.includes("xlsx") || code.includes("parse")) {
    explanationRu = "Не удалось прочитать структуру загруженного файла таблицы. Возможно, файл повреждён, заблокирован или имеет нестандартную кодировку.";
    suggestedActionRu = "Сохраните файл заново в формате XLSX или CSV (в кодировке UTF-8) и повторите загрузку.";
    autoFix = { applicable: false, retryRecommended: true };
  }

  return {
    status: "fallback",
    source: "heuristic",
    explanationRu,
    suggestedActionRu,
    autoFix,
    durationMs: Date.now() - started
  };
}

export async function diagnoseError(
  config: CommonConfig,
  input: ErrorDiagnosisInput,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<ErrorDiagnosisResult> {
  const started = Date.now();

  // If LLM is not enabled, immediately return deterministic heuristic analysis
  if (!config.llmEnabled) {
    return buildHeuristicDiagnosis(input, started);
  }

  const userPrompt = JSON.stringify({
    stage: input.stage || "general",
    errorCode: input.errorCode || "unknown",
    errorMessage: input.errorMessage,
    context: input.context || {}
  }, null, 2);

  const completion = await chatCompletionWithLlm({
    config,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `Проанализируй следующую ошибку и сформируй решение:\n${userPrompt}`,
    fetchImpl: options.fetchImpl
  });

  if (!completion.success || !completion.json) {
    // Graceful fallback: LLM was unreachable, timed out, or returned invalid JSON
    return buildHeuristicDiagnosis(input, started);
  }

  const json = completion.json;
  const explanationRu = typeof json.explanationRu === "string" && json.explanationRu.trim().length > 0
    ? json.explanationRu.trim()
    : input.errorMessage;
  const suggestedActionRu = typeof json.suggestedActionRu === "string" && json.suggestedActionRu.trim().length > 0
    ? json.suggestedActionRu.trim()
    : "Проверьте исходные данные.";

  let autoFix: ErrorAutoFix | undefined;
  if (json.autoFix && typeof json.autoFix === "object" && !Array.isArray(json.autoFix)) {
    const rawFix = json.autoFix as Record<string, unknown>;
    autoFix = {
      applicable: Boolean(rawFix.applicable),
      descriptionRu: typeof rawFix.descriptionRu === "string" ? rawFix.descriptionRu : undefined,
      columnMappings: rawFix.columnMappings && typeof rawFix.columnMappings === "object" && !Array.isArray(rawFix.columnMappings)
        ? (rawFix.columnMappings as Record<string, string>)
        : undefined,
      normalizedValues: rawFix.normalizedValues && typeof rawFix.normalizedValues === "object" && !Array.isArray(rawFix.normalizedValues)
        ? (rawFix.normalizedValues as Record<string, unknown>)
        : undefined,
      retryRecommended: typeof rawFix.retryRecommended === "boolean" ? rawFix.retryRecommended : undefined
    };
  }

  return {
    status: "success",
    source: "llm",
    explanationRu,
    suggestedActionRu,
    autoFix,
    model: completion.model,
    durationMs: Date.now() - started
  };
}
