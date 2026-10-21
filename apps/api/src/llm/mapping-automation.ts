import type { CommonConfig } from "@docomator/config";
import { chatCompletionWithLlm } from "./llm-client.js";

export interface TargetPropertyCandidate {
  key: string;
  label: string;
  valueType?: string | undefined;
  description?: string | undefined;
  aliases?: string[] | undefined;
}

export interface MappingSuggestionInput {
  headers: string[];
  samples?: Record<string, string[]> | undefined;
  targetProperties: TargetPropertyCandidate[];
}

export interface ColumnMappingSuggestion {
  column: string;
  propertyKey: string | null;
  confidence: number;
  rationaleRu: string;
  suggestedType?: string | undefined;
  transform?: string | undefined;
}

export interface MappingSuggestionResult {
  status: "success" | "fallback";
  source: "llm" | "heuristic";
  mappings: ColumnMappingSuggestion[];
  model?: string | null | undefined;
  durationMs: number;
}

const SYSTEM_PROMPT = `Ты — экспертный модуль сопоставления данных платформы автоматизации документов «Оформлятор».
Тебе передаётся список колонок из исходного файла таблицы (XLSX или CSV) с примерами значений, а также перечень целевых свойств сущностей/шаблона.
Твоя задача — сопоставить каждую входящую колонку с наиболее подходящим целевым свойством на основе русского языка, делопроизводства и контекста примеров данных.

Правила:
1. Если колонка соответствует целевому свойству (например «ФИО», «Фамилия И.О.», «Сотрудник» -> свойство ФИО / fullName), укажи его propertyKey и confidence от 0.5 до 1.0.
2. Если колонка не подходит ни к одному свойству, укажи propertyKey: null, confidence: 0, и поясни, что это новое или служебное поле.
3. Одно целевое свойство не должно назначаться двум разным колонкам (выбирай наиболее релевантную).
4. Определи рекомендуемый тип данных: "string", "text", "integer", "number", "boolean", "date", "date-time", "enum".
5. Напиши краткое и точное обоснование на русском языке в rationaleRu.

Отвечай строго в формате JSON:
{
  "mappings": [
    {
      "column": "Название колонки в таблице",
      "propertyKey": "ключ_свойства или null",
      "confidence": 0.95,
      "rationaleRu": "Обоснование соответствия на русском языке",
      "suggestedType": "string",
      "transform": "trim"
    }
  ]
}`;

function normalize(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[_\s\-./\\]+/gu, "")
    .trim();
}

function computeSimilarity(source: string, target: string): number {
  const s = normalize(source);
  const t = normalize(target);
  if (!s || !t) return 0;
  if (s === t) return 1.0;
  if (s.includes(t) || t.includes(s)) {
    return Math.max(s.length, t.length) > 0
      ? Math.min(s.length, t.length) / Math.max(s.length, t.length)
      : 0.7;
  }
  return 0;
}

function guessValueType(column: string, samples: string[] = []): string {
  const norm = normalize(column);
  if (norm.includes("дата") || norm.includes("рождения") || norm.includes("выдан")) return "date";
  if (norm.includes("сумма") || norm.includes("оклад") || norm.includes("ставка")) return "number";
  if (norm.includes("номер") || norm.includes("курс") || norm.includes("стаж") || norm.includes("количество")) return "integer";
  if (norm.includes("признак") || norm.includes("активен") || norm.includes("данет")) return "boolean";
  if (norm.includes("примечание") || norm.includes("описание") || norm.includes("комментарий")) return "text";

  if (samples.length > 0) {
    if (samples.every((s) => /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\.\d{1,2}\.\d{4}$/u.test(s.trim()))) return "date";
    if (samples.every((s) => /^-?\d+$/u.test(s.trim()))) return "integer";
    if (samples.every((s) => /^-?\d+(?:[.,]\d+)?$/u.test(s.trim()))) return "number";
    if (samples.every((s) => /^(да|нет|true|false|1|0)$/iu.test(s.trim()))) return "boolean";
  }

  return "string";
}

function buildHeuristicMappings(
  input: MappingSuggestionInput,
  started: number
): MappingSuggestionResult {
  const usedProperties = new Set<string>();
  const mappings: ColumnMappingSuggestion[] = [];

  for (const column of input.headers) {
    const samples = input.samples?.[column] || [];
    let bestCandidate: TargetPropertyCandidate | null = null;
    let bestScore = 0;
    let rationale = "Новое поле карточки";

    for (const prop of input.targetProperties) {
      if (usedProperties.has(prop.key)) continue;

      const candidates = [prop.label, prop.key, ...(prop.aliases || [])];
      for (const candidate of candidates) {
        const score = computeSimilarity(column, candidate);
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = prop;
          rationale = score === 1.0
            ? `Точное совпадение с полем «${prop.label}»`
            : `Совпадение названия с полем «${prop.label}» (${Math.round(score * 100)}%)`;
        }
      }
    }

    const suggestedType = bestCandidate?.valueType || guessValueType(column, samples);

    if (bestCandidate && bestScore >= 0.6) {
      usedProperties.add(bestCandidate.key);
      mappings.push({
        column,
        propertyKey: bestCandidate.key,
        confidence: Math.round(bestScore * 100) / 100,
        rationaleRu: rationale,
        suggestedType
      });
    } else {
      mappings.push({
        column,
        propertyKey: null,
        confidence: 0,
        rationaleRu: "Рекомендуется создать новое поле или оставить без импорта",
        suggestedType
      });
    }
  }

  return {
    status: "fallback",
    source: "heuristic",
    mappings,
    durationMs: Date.now() - started
  };
}

export async function suggestMappings(
  config: CommonConfig,
  input: MappingSuggestionInput,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<MappingSuggestionResult> {
  const started = Date.now();

  if (!config.llmEnabled || input.headers.length === 0) {
    return buildHeuristicMappings(input, started);
  }

  const userPrompt = JSON.stringify({
    sourceColumns: input.headers.map((h) => ({
      column: h,
      samples: (input.samples?.[h] || []).slice(0, 3)
    })),
    targetProperties: input.targetProperties.map((p) => ({
      key: p.key,
      label: p.label,
      valueType: p.valueType || "string",
      description: p.description || "",
      aliases: p.aliases || []
    }))
  }, null, 2);

  const completion = await chatCompletionWithLlm({
    config,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `Сопоставь колонки таблицы с целевыми свойствами:\n${userPrompt}`,
    fetchImpl: options.fetchImpl
  });

  if (!completion.success || !completion.json) {
    return buildHeuristicMappings(input, started);
  }

  const rawMappings = completion.json.mappings;
  if (!Array.isArray(rawMappings) || rawMappings.length === 0) {
    return buildHeuristicMappings(input, started);
  }

  const validTargetKeys = new Set(input.targetProperties.map((p) => p.key));
  const mappedResults = new Map<string, ColumnMappingSuggestion>();

  for (const item of rawMappings) {
    if (!item || typeof item !== "object") continue;
    const col = String((item as { column?: unknown }).column || "").trim();
    if (!col) continue;

    const rawKey = (item as { propertyKey?: unknown }).propertyKey;
    const propKey = typeof rawKey === "string" && validTargetKeys.has(rawKey) ? rawKey : null;
    const conf = Number((item as { confidence?: unknown }).confidence);
    const confidence = Number.isFinite(conf) ? Math.max(0, Math.min(conf, 1)) : propKey ? 0.8 : 0;
    const rationaleRu = typeof (item as { rationaleRu?: unknown }).rationaleRu === "string"
      ? (item as { rationaleRu: string }).rationaleRu.trim()
      : propKey ? `Сопоставлено с ${propKey}` : "Новое поле";
    const suggestedType = typeof (item as { suggestedType?: unknown }).suggestedType === "string"
      ? (item as { suggestedType: string }).suggestedType.trim()
      : undefined;
    const transform = typeof (item as { transform?: unknown }).transform === "string"
      ? (item as { transform: string }).transform.trim()
      : undefined;

    mappedResults.set(col, {
      column: col,
      propertyKey: propKey,
      confidence,
      rationaleRu,
      suggestedType,
      transform
    });
  }

  // Ensure all requested headers are covered
  const finalMappings: ColumnMappingSuggestion[] = input.headers.map((h) => {
    const found = mappedResults.get(h);
    if (found) return found;
    return {
      column: h,
      propertyKey: null,
      confidence: 0,
      rationaleRu: "Рекомендуется создать новое поле",
      suggestedType: guessValueType(h, input.samples?.[h] || [])
    };
  });

  return {
    status: "success",
    source: "llm",
    mappings: finalMappings,
    model: completion.model,
    durationMs: Date.now() - started
  };
}
