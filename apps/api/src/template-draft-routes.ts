import type { FastifyInstance, FastifyRequest } from "fastify";

import { analyzeOoxmlBuffer } from "@docomator/document-intake";
import { defaultScalarFormatter } from "@docomator/template-compiler";
import {
  ContentAddressedObjectStore,
  DocumentQuarantineRegistry,
  type JsonValue,
  TemplateDraftRegistry,
  TemplateDraftValidationError,
  toJsonValue
} from "@docomator/storage";

import {
  correlationId,
  mutationContextFromRequest
} from "./request-context.js";

interface SpaceParams {
  spaceId: string;
}

interface SourceParams extends SpaceParams {
  recordId: string;
}

interface DraftParams extends SpaceParams {
  draftId: string;
}

interface CreateDraftBody {
  title?: string;
}

interface CreateFieldBody {
  key: string;
  label: string;
  valueType:
    | "string"
    | "text"
    | "number"
    | "integer"
    | "boolean"
    | "date"
    | "date-time";
  required?: boolean;
  elementId: string;
  decimalPlaces?: number;
  timeZone?: string;
  textRange?: {
    startOffset: number;
    endOffset: number;
  };
}

interface ListQuery {
  limit?: number;
}

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  object: { [key: string]: JsonValue },
  key: string
): string {
  const value = object[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new TemplateDraftValidationError(
      `Stored structure element is missing ${key}`
    );
  }
  return value;
}

function requiredInteger(
  object: { [key: string]: JsonValue },
  key: string
): number {
  const value = object[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TemplateDraftValidationError(
      `Stored structure element is missing ${key}`
    );
  }
  return value;
}

function findElement(
  structure: JsonValue,
  elementId: string
): { [key: string]: JsonValue } {
  if (!isJsonObject(structure)) {
    throw new TemplateDraftValidationError("Stored document structure is invalid");
  }
  const elements = structure.elements;
  if (!Array.isArray(elements)) {
    throw new TemplateDraftValidationError("Stored document structure has no elements");
  }
  for (const candidate of elements) {
    if (
      isJsonObject(candidate) &&
      candidate.id === elementId &&
      (candidate.kind === "paragraph" || candidate.kind === "cell")
    ) {
      return candidate;
    }
  }
  throw new TemplateDraftValidationError(
    `Structure element was not found: ${elementId}`
  );
}

function bindingForElement(
  element: { [key: string]: JsonValue },
  textRange?: { startOffset: number; endOffset: number }
): {
  kind: "paragraph" | "cell";
  binding: JsonValue;
  preview: string;
} {
  const kind = requiredString(element, "kind");
  const elementId = requiredString(element, "id");
  if (kind === "paragraph") {
    const part = requiredString(element, "part");
    const index = requiredInteger(element, "index");
    const text = typeof element.text === "string" ? element.text : "";
    if (textRange === undefined) {
      return {
        kind,
        binding: toJsonValue({
          version: 1,
          kind: "docx.paragraph",
          elementId,
          part,
          index,
          tableLocation: element.tableLocation ?? null
        }),
        preview: text
      };
    }
    if (element.runsTruncated === true) {
      throw new TemplateDraftValidationError(
        "Абзац содержит слишком много текстовых фрагментов для безопасного выделения. Выберите другой абзац."
      );
    }
    const { startOffset, endOffset } = textRange;
    if (
      !Number.isInteger(startOffset) ||
      !Number.isInteger(endOffset) ||
      startOffset < 0 ||
      endOffset <= startOffset ||
      endOffset > text.length ||
      endOffset > 20_000
    ) {
      throw new TemplateDraftValidationError(
        "Границы выбранного текста не совпадают с сохранённым абзацем. Выделите фрагмент заново."
      );
    }
    const selectedText = text.slice(startOffset, endOffset);
    return {
      kind,
      binding: toJsonValue({
        version: 1,
        kind: "docx.text-range",
        elementId,
        part,
        index,
        startOffset,
        endOffset,
        selectedText,
        tableLocation: element.tableLocation ?? null
      }),
      preview: selectedText
    };
  }
  if (kind === "cell") {
    if (textRange !== undefined) {
      throw new TemplateDraftValidationError(
        "Для XLSX выберите целую ячейку без текстового диапазона."
      );
    }
    const sheetName = requiredString(element, "sheetName");
    const sheetPath = requiredString(element, "sheetPath");
    const address = requiredString(element, "address");
    const value = typeof element.value === "string" ? element.value : "";
    return {
      kind,
      binding: toJsonValue({
        version: 1,
        kind: "xlsx.cell",
        elementId,
        sheetName,
        sheetPath,
        address
      }),
      preview: value
    };
  }
  throw new TemplateDraftValidationError(
    `Unsupported structure element kind: ${kind}`
  );
}

const spaceParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["spaceId"],
  properties: {
    spaceId: { type: "string", minLength: 1, maxLength: 160 }
  }
} as const;

export function registerTemplateDraftRoutes(
  app: FastifyInstance,
  quarantineRegistry: DocumentQuarantineRegistry,
  objectStore: ContentAddressedObjectStore,
  draftRegistry: TemplateDraftRegistry
): void {
  app.post<{ Params: SourceParams; Body: CreateDraftBody }>(
    "/api/v1/spaces/:spaceId/document-sources/:recordId/draft",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "recordId"],
          properties: {
            spaceId: { type: "string", minLength: 1, maxLength: 160 },
            recordId: { type: "string", minLength: 1, maxLength: 160 }
          }
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 500 }
          }
        }
      }
    },
    async (request, reply) => {
      const source = quarantineRegistry.getDocument(
        request.params.spaceId,
        request.params.recordId
      );
      const buffer = await objectStore.getBuffer(source.sha256);
      const structure = await analyzeOoxmlBuffer({
        buffer,
        fileName: source.fileName,
        mediaType: source.mediaType,
        maxElements: 2_000
      });
      if (structure.sourceSha256 !== source.sha256) {
        throw new TemplateDraftValidationError(
          "Stored source checksum changed before draft creation"
        );
      }
      const draft = draftRegistry.createOrGetDraft(
        {
          spaceId: source.spaceId,
          sourceRecordId: source.id,
          title: request.body.title?.trim() || source.fileName,
          format: source.format,
          sourceSha256: source.sha256,
          structureVersion: 1,
          structureSha256: structure.structureSha256,
          structure: toJsonValue(structure),
          structureTruncated: structure.truncated
        },
        mutationContextFromRequest(request)
      );
      reply.code(201).header("cache-control", "no-store");
      return responseEnvelope(request, draft);
    }
  );

  app.get<{ Params: SpaceParams; Querystring: ListQuery }>(
    "/api/v1/spaces/:spaceId/template-drafts",
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
        draftRegistry.listDrafts(
          request.params.spaceId,
          request.query.limit ?? 100
        )
      )
  );

  app.get<{ Params: DraftParams }>(
    "/api/v1/spaces/:spaceId/template-drafts/:draftId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "draftId"],
          properties: {
            spaceId: { type: "string", minLength: 1, maxLength: 160 },
            draftId: { type: "string", minLength: 1, maxLength: 160 }
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        draftRegistry.getDraft(request.params.spaceId, request.params.draftId)
      )
  );

  app.post<{ Params: DraftParams; Body: CreateFieldBody }>(
    "/api/v1/spaces/:spaceId/template-drafts/:draftId/fields",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "draftId"],
          properties: {
            spaceId: { type: "string", minLength: 1, maxLength: 160 },
            draftId: { type: "string", minLength: 1, maxLength: 160 }
          }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["key", "label", "valueType", "elementId"],
          properties: {
            key: { type: "string", minLength: 1, maxLength: 160 },
            label: { type: "string", minLength: 1, maxLength: 500 },
            valueType: {
              type: "string",
              enum: [
                "string",
                "text",
                "number",
                "integer",
                "boolean",
                "date",
                "date-time"
              ]
            },
            required: { type: "boolean", default: false },
            elementId: { type: "string", minLength: 1, maxLength: 160 },
            decimalPlaces: {
              type: "integer",
              minimum: 0,
              maximum: 6
            },
            timeZone: {
              type: "string",
              minLength: 1,
              maxLength: 100,
              pattern: "^(?:UTC|[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+)$"
            },
            textRange: {
              type: "object",
              additionalProperties: false,
              required: ["startOffset", "endOffset"],
              properties: {
                startOffset: {
                  type: "integer",
                  minimum: 0,
                  maximum: 19_999
                },
                endOffset: {
                  type: "integer",
                  minimum: 1,
                  maximum: 20_000
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const draft = draftRegistry.getDraft(
        request.params.spaceId,
        request.params.draftId
      );
      const element = findElement(draft.structure, request.body.elementId);
      const binding = bindingForElement(element, request.body.textRange);
      if (
        request.body.decimalPlaces !== undefined &&
        request.body.valueType !== "number"
      ) {
        throw new TemplateDraftValidationError(
          "Число знаков после запятой можно задать только для числового поля."
        );
      }
      if (
        request.body.timeZone !== undefined &&
        request.body.valueType !== "date-time"
      ) {
        throw new TemplateDraftValidationError(
          "Часовой пояс можно задать только для поля даты и времени."
        );
      }
      const formatter = defaultScalarFormatter(request.body.valueType, {
        ...(request.body.decimalPlaces === undefined
          ? {}
          : { fractionDigits: request.body.decimalPlaces }),
        ...(request.body.timeZone === undefined
          ? {}
          : { timeZone: request.body.timeZone })
      });
      const field = draftRegistry.createField(
        request.params.spaceId,
        draft.id,
        {
          key: request.body.key,
          label: request.body.label,
          valueType: request.body.valueType,
          required: request.body.required ?? false,
          elementId: request.body.elementId,
          elementKind: binding.kind,
          binding: binding.binding,
          formatter: toJsonValue(formatter),
          originalPreview: binding.preview,
          structureSha256: draft.structureSha256
        },
        mutationContextFromRequest(request)
      );
      reply.code(201).header("cache-control", "no-store");
      return responseEnvelope(request, {
        draftId: draft.id,
        structureSha256: draft.structureSha256,
        field
      });
    }
  );
}
