import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  DocumentIntakeError,
  analyzeOoxmlBuffer
} from "@docomator/document-intake";
import {
  ContentAddressedObjectStore,
  DataExtractionRegistry,
  DocumentQuarantineRegistry,
  toJsonValue,
  type JsonValue
} from "@docomator/storage";

import {
  DataExtractionDefinitionError,
  type DataExtractionDefinition,
  type DataExtractionResult,
  buildDataExtractionDefinition,
  dataExtractionCsv,
  extractDataFromStructure,
  validateExtractionCorrections
} from "./data-extraction-service.js";
import {
  correlationId,
  mutationContextFromRequest
} from "./request-context.js";

interface SpaceParams {
  spaceId: string;
}

interface TemplateParams extends SpaceParams {
  templateId: string;
}

interface RunParams extends SpaceParams {
  runId: string;
}

interface ItemParams extends RunParams {
  itemId: string;
}

interface ExtractionFieldBody {
  label: string;
  elementId: string;
  outputType?: "text" | "number" | "integer" | "date";
}

interface CreateTemplateBody {
  title: string;
  sourceRecordId: string;
  fields?: ExtractionFieldBody[];
  repeat?: {
    label?: string;
    columns: ExtractionFieldBody[];
  };
}

interface CreateRunBody {
  templateId: string;
  sourceRecordIds: string[];
  idempotencyKey: string;
}

interface CorrectionsBody {
  expectedVersion: number;
  corrections: JsonValue;
}

interface ListQuery {
  limit?: number;
}

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

const spaceParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["spaceId"],
  properties: {
    spaceId: { type: "string", minLength: 1, maxLength: 160 }
  }
} as const;

const fieldSchema = {
  type: "object",
  additionalProperties: false,
  required: ["label", "elementId"],
  properties: {
    label: { type: "string", minLength: 1, maxLength: 200 },
    elementId: { type: "string", minLength: 1, maxLength: 160 },
    outputType: {
      type: "string",
      enum: ["text", "number", "integer", "date"],
      default: "text"
    }
  }
} as const;

function issuePresentation(issue: Record<string, unknown>): JsonValue {
  const code = String(issue.code ?? "document_analysis_failed");
  const copy: Record<string, { message: string; action: string }> = {
    document_format_mismatch: {
      message: "Документ имеет другой формат, чем образец этого шаблона.",
      action: "Выберите документ того же формата или создайте отдельный шаблон извлечения."
    },
    document_structure_truncated: {
      message: "Документ слишком большой для полного структурного разбора в текущем режиме.",
      action: "Разделите документ или уменьшите область данных и повторите извлечение."
    },
    selector_not_found: {
      message: "В документе не найдено место, отмеченное в образце.",
      action: "Проверьте этот файл и при необходимости исправьте значение вручную."
    },
    value_conversion_failed: {
      message: "Найденное значение не удалось привести к выбранному виду.",
      action: "Исправьте значение в результате или измените тип поля в новом шаблоне."
    },
    repeat_rows_not_found: {
      message: "В отмеченной таблице не найдено строк с данными.",
      action: "Проверьте документ; если таблица расположена иначе, используйте другой шаблон."
    },
    document_analysis_failed: {
      message: "Этот документ не удалось разобрать, остальные файлы пачки сохранены в результате.",
      action: "Проверьте файл, заново сохраните его в DOCX/XLSX и повторите извлечение отдельно."
    }
  };
  const selected = copy[code] ?? copy.document_analysis_failed!;
  return toJsonValue({
    ...issue,
    code,
    message: selected.message,
    suggestedAction: selected.action,
    repair: {
      kind: code === "value_conversion_failed" || code === "selector_not_found"
        ? "replace_value"
        : "review_document"
    }
  });
}

function ensureDefinition(value: JsonValue): DataExtractionDefinition {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.version !== 1 ||
    (value.format !== "docx" && value.format !== "xlsx") ||
    !Array.isArray(value.fields)
  ) {
    throw new DataExtractionDefinitionError(
      "Сохранённый шаблон извлечения повреждён. Создайте шаблон заново."
    );
  }
  return value as unknown as DataExtractionDefinition;
}

function ensureResult(value: JsonValue): DataExtractionResult {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.version !== 1 ||
    !Array.isArray(value.fields)
  ) {
    throw new DataExtractionDefinitionError(
      "Сохранённый результат извлечения повреждён. Повторите запуск."
    );
  }
  return value as unknown as DataExtractionResult;
}

export function registerDataExtractionRoutes(
  app: FastifyInstance,
  quarantineRegistry: DocumentQuarantineRegistry,
  objectStore: ContentAddressedObjectStore,
  extractionRegistry: DataExtractionRegistry
): void {
  app.post<{ Params: SpaceParams; Body: CreateTemplateBody }>(
    "/api/v1/spaces/:spaceId/data-extraction/templates",
    {
      schema: {
        params: spaceParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["title", "sourceRecordId"],
          properties: {
            title: { type: "string", minLength: 1, maxLength: 500 },
            sourceRecordId: { type: "string", minLength: 1, maxLength: 160 },
            fields: {
              type: "array",
              maxItems: 50,
              items: fieldSchema
            },
            repeat: {
              type: "object",
              additionalProperties: false,
              required: ["columns"],
              properties: {
                label: { type: "string", minLength: 1, maxLength: 200 },
                columns: {
                  type: "array",
                  minItems: 1,
                  maxItems: 30,
                  items: fieldSchema
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const source = quarantineRegistry.getDocument(
        request.params.spaceId,
        request.body.sourceRecordId
      );
      const buffer = await objectStore.getBuffer(source.sha256);
      const structure = await analyzeOoxmlBuffer({
        buffer,
        fileName: source.fileName,
        mediaType: source.mediaType,
        maxElements: 2_000
      });
      if (structure.sourceSha256 !== source.sha256) {
        throw new DataExtractionDefinitionError(
          "Контрольная сумма исходника изменилась после проверки."
        );
      }
      const definition = buildDataExtractionDefinition(structure, {
        ...(request.body.fields === undefined ? {} : { fields: request.body.fields }),
        ...(request.body.repeat === undefined ? {} : { repeat: request.body.repeat })
      });
      const record = extractionRegistry.createTemplate(
        {
          spaceId: source.spaceId,
          title: request.body.title,
          format: source.format,
          sampleSourceRecordId: source.id,
          sampleSha256: source.sha256,
          structureSha256: structure.structureSha256,
          definition: toJsonValue(definition)
        },
        mutationContextFromRequest(request)
      );
      reply.code(201).header("cache-control", "no-store");
      return responseEnvelope(request, record);
    }
  );

  app.get<{ Params: SpaceParams; Querystring: ListQuery }>(
    "/api/v1/spaces/:spaceId/data-extraction/templates",
    {
      schema: {
        params: spaceParamsSchema,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 500 }
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        extractionRegistry.listTemplates(request.params.spaceId, request.query.limit)
      )
  );

  app.get<{ Params: TemplateParams }>(
    "/api/v1/spaces/:spaceId/data-extraction/templates/:templateId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "templateId"],
          properties: {
            spaceId: { type: "string", minLength: 1, maxLength: 160 },
            templateId: { type: "string", minLength: 1, maxLength: 160 }
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        extractionRegistry.getTemplate(request.params.spaceId, request.params.templateId)
      )
  );

  app.post<{ Params: SpaceParams; Body: CreateRunBody }>(
    "/api/v1/spaces/:spaceId/data-extraction/runs",
    {
      schema: {
        params: spaceParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["templateId", "sourceRecordIds", "idempotencyKey"],
          properties: {
            templateId: { type: "string", minLength: 1, maxLength: 160 },
            sourceRecordIds: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 160 }
            },
            idempotencyKey: { type: "string", minLength: 1, maxLength: 200 }
          }
        }
      }
    },
    async (request, reply) => {
      const template = extractionRegistry.getTemplate(
        request.params.spaceId,
        request.body.templateId
      );
      const definition = ensureDefinition(template.definition);
      const items = [];
      for (const sourceRecordId of request.body.sourceRecordIds) {
        const source = quarantineRegistry.getDocument(request.params.spaceId, sourceRecordId);
        const buffer = await objectStore.getBuffer(source.sha256);
        let result: DataExtractionResult;
        let issues: JsonValue[];
        try {
          const structure = await analyzeOoxmlBuffer({
            buffer,
            fileName: source.fileName,
            mediaType: source.mediaType,
            maxElements: 2_000
          });
          if (structure.sourceSha256 !== source.sha256) {
            throw new Error("Content-addressed source changed during extraction");
          }
          const extracted = extractDataFromStructure(structure, definition);
          result = extracted.result;
          issues = extracted.issues.map((issue) =>
            issuePresentation(issue as unknown as Record<string, unknown>)
          );
        } catch (error) {
          if (!(error instanceof DocumentIntakeError)) throw error;
          result = { version: 1, fields: [], repeat: null };
          issues = [
            issuePresentation({
              code: "document_analysis_failed",
              severity: "error",
              parameters: { intakeCode: error.code }
            })
          ];
        }
        items.push({
          sourceRecordId: source.id,
          sourceName: source.fileName,
          sourceSha256: source.sha256,
          result: toJsonValue(result),
          issues: toJsonValue(issues)
        });
      }

      const run = extractionRegistry.createOrGetRun(
        {
          spaceId: request.params.spaceId,
          templateId: template.id,
          idempotencyKey: request.body.idempotencyKey,
          templateSnapshot: template.definition,
          items
        },
        mutationContextFromRequest(request)
      );
      reply.code(201).header("cache-control", "no-store");
      return responseEnvelope(request, run);
    }
  );

  app.get<{ Params: SpaceParams; Querystring: ListQuery }>(
    "/api/v1/spaces/:spaceId/data-extraction/runs",
    {
      schema: {
        params: spaceParamsSchema,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 500 }
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        extractionRegistry.listRuns(request.params.spaceId, request.query.limit)
      )
  );

  app.get<{ Params: RunParams }>(
    "/api/v1/spaces/:spaceId/data-extraction/runs/:runId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "runId"],
          properties: {
            spaceId: { type: "string", minLength: 1, maxLength: 160 },
            runId: { type: "string", minLength: 1, maxLength: 160 }
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        extractionRegistry.getRun(request.params.spaceId, request.params.runId)
      )
  );

  app.patch<{ Params: ItemParams; Body: CorrectionsBody }>(
    "/api/v1/spaces/:spaceId/data-extraction/runs/:runId/items/:itemId/corrections",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "runId", "itemId"],
          properties: {
            spaceId: { type: "string", minLength: 1, maxLength: 160 },
            runId: { type: "string", minLength: 1, maxLength: 160 },
            itemId: { type: "string", minLength: 1, maxLength: 160 }
          }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["expectedVersion", "corrections"],
          properties: {
            expectedVersion: { type: "integer", minimum: 1 },
            corrections: { type: "object" }
          }
        }
      }
    },
    async (request) => {
      const run = extractionRegistry.getRun(request.params.spaceId, request.params.runId);
      const item = run.items.find((candidate) => candidate.id === request.params.itemId);
      if (item === undefined) {
        throw new DataExtractionDefinitionError(
          "Результат документа не найден в выбранном запуске."
        );
      }
      const corrections = validateExtractionCorrections(
        ensureResult(item.result),
        request.body.corrections
      );
      return responseEnvelope(
        request,
        extractionRegistry.replaceItemCorrections(
          request.params.spaceId,
          run.id,
          item.id,
          corrections,
          request.body.expectedVersion,
          mutationContextFromRequest(request)
        )
      );
    }
  );

  app.get<{ Params: RunParams }>(
    "/api/v1/spaces/:spaceId/data-extraction/runs/:runId/export.csv",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "runId"],
          properties: {
            spaceId: { type: "string", minLength: 1, maxLength: 160 },
            runId: { type: "string", minLength: 1, maxLength: 160 }
          }
        }
      }
    },
    async (request, reply) => {
      const run = extractionRegistry.getRun(request.params.spaceId, request.params.runId);
      const csv = dataExtractionCsv(run);
      return reply
        .header("cache-control", "no-store")
        .header("content-disposition", `attachment; filename="docomator-extraction-${run.id}.csv"`)
        .type("text/csv; charset=utf-8")
        .send(csv);
    }
  );
}
