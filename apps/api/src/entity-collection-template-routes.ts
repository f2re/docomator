import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  EntityCollectionTemplateRepeatRegistry,
  EntityCollectionTemplateRepeatValidationError,
  TemplateDraftRegistry,
  type JsonValue
} from "@docomator/storage";

import { correlationId, mutationContextFromRequest } from "./request-context.js";

interface DraftParams {
  spaceId: string;
  draftId: string;
}

interface ConfigureBody {
  collectionId: string;
  anchorElementId: string;
  numberingStart?: number;
  numberingStep?: number;
}

const paramsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["spaceId", "draftId"],
  properties: {
    spaceId: { type: "string", minLength: 1, maxLength: 160 },
    draftId: { type: "string", minLength: 1, maxLength: 160 }
  }
} as const;

function envelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

function isObject(value: unknown): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function anchorCoordinate(
  structure: JsonValue,
  anchorElementId: string
): { part: string; tableIndex: number; rowIndex: number } {
  if (!isObject(structure) || !Array.isArray(structure.elements)) {
    throw new EntityCollectionTemplateRepeatValidationError(
      "Сохранённая структура шаблона повреждена. Перезагрузите исходный DOCX и повторите настройку."
    );
  }
  const element = structure.elements.find(
    (candidate) => isObject(candidate) && candidate.id === anchorElementId
  );
  if (!isObject(element) || element.kind !== "paragraph") {
    throw new EntityCollectionTemplateRepeatValidationError(
      "Выбранная ячейка больше не найдена в структуре DOCX. Данные шаблона не изменены; выберите строку заново."
    );
  }
  const location = element.tableLocation;
  if (
    typeof element.part !== "string" ||
    !isObject(location) ||
    typeof location.tableIndex !== "number" ||
    !Number.isInteger(location.tableIndex) ||
    location.tableIndex < 0 ||
    typeof location.rowIndex !== "number" ||
    !Number.isInteger(location.rowIndex) ||
    location.rowIndex < 0
  ) {
    throw new EntityCollectionTemplateRepeatValidationError(
      "Повторяемой областью можно сделать только строку обычной таблицы DOCX. Настройки не сохранены; выберите ячейку нужной строки."
    );
  }
  return {
    part: element.part,
    tableIndex: location.tableIndex,
    rowIndex: location.rowIndex
  };
}

export function registerEntityCollectionTemplateRoutes(
  app: FastifyInstance,
  draftRegistry: TemplateDraftRegistry,
  repeatRegistry: EntityCollectionTemplateRepeatRegistry
): void {
  app.get<{ Params: DraftParams }>(
    "/api/v1/spaces/:spaceId/template-drafts/:draftId/entity-collection-repeat",
    { schema: { params: paramsSchema } },
    async (request, reply) => {
      draftRegistry.getDraft(request.params.spaceId, request.params.draftId);
      reply.header("cache-control", "no-store");
      return envelope(
        request,
        repeatRegistry.getOptionalForDraft(
          request.params.spaceId,
          request.params.draftId
        )
      );
    }
  );

  app.put<{ Params: DraftParams; Body: ConfigureBody }>(
    "/api/v1/spaces/:spaceId/template-drafts/:draftId/entity-collection-repeat",
    {
      schema: {
        params: paramsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["collectionId", "anchorElementId"],
          properties: {
            collectionId: { type: "string", minLength: 1, maxLength: 160 },
            anchorElementId: { type: "string", minLength: 1, maxLength: 300 },
            numberingStart: { type: "integer", minimum: 0, maximum: 1_000_000 },
            numberingStep: { type: "integer", minimum: 1, maximum: 1_000_000 }
          }
        }
      }
    },
    async (request, reply) => {
      const draft = draftRegistry.getDraft(
        request.params.spaceId,
        request.params.draftId
      );
      const coordinate = anchorCoordinate(draft.structure, request.body.anchorElementId);
      const configured = repeatRegistry.configure(
        request.params.spaceId,
        request.params.draftId,
        {
          collectionId: request.body.collectionId,
          anchorElementId: request.body.anchorElementId,
          part: coordinate.part,
          tableIndex: coordinate.tableIndex,
          rowIndex: coordinate.rowIndex,
          ...(request.body.numberingStart === undefined
            ? {}
            : { numberingStart: request.body.numberingStart }),
          ...(request.body.numberingStep === undefined
            ? {}
            : { numberingStep: request.body.numberingStep })
        },
        mutationContextFromRequest(request)
      );
      reply.header("cache-control", "no-store");
      return envelope(request, configured);
    }
  );
}
