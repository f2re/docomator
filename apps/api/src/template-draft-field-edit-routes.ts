import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  defaultScalarFormatter,
  parseScalarFormatter
} from "@docomator/template-compiler";
import {
  type JsonValue,
  TemplateDraftFieldEditor,
  TemplateDraftValidationError,
  toJsonValue
} from "@docomator/storage";

import { correlationId, mutationContextFromRequest } from "./request-context.js";

interface FieldParams {
  spaceId: string;
  draftId: string;
  fieldId: string;
}

interface UpdateFieldBody {
  key: string;
  label: string;
  valueType:
    | "string"
    | "text"
    | "enum"
    | "number"
    | "integer"
    | "boolean"
    | "date"
    | "date-time";
  required?: boolean;
  decimalPlaces?: number;
  timeZone?: string;
  personName?: {
    sourceOrder:
      | "family-given-patronymic"
      | "given-patronymic-family"
      | "family-given"
      | "given-family";
    pattern: string;
  };
}

const idSchema = {
  type: "string",
  minLength: 1,
  maxLength: 160
} as const;

const paramsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["spaceId", "draftId", "fieldId"],
  properties: {
    spaceId: idSchema,
    draftId: idSchema,
    fieldId: idSchema
  }
} as const;

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

function formatterFor(body: UpdateFieldBody): JsonValue {
  if (body.decimalPlaces !== undefined && body.valueType !== "number") {
    throw new TemplateDraftValidationError(
      "Число знаков после запятой можно задать только для числового поля."
    );
  }
  if (body.timeZone !== undefined && body.valueType !== "date-time") {
    throw new TemplateDraftValidationError(
      "Часовой пояс можно задать только для поля даты и времени."
    );
  }
  if (
    body.personName !== undefined &&
    body.valueType !== "string" &&
    body.valueType !== "text"
  ) {
    throw new TemplateDraftValidationError(
      "Вариант записи ФИО можно задать только для текстового поля."
    );
  }
  const formatter =
    body.personName === undefined
      ? defaultScalarFormatter(body.valueType, {
          ...(body.decimalPlaces === undefined
            ? {}
            : { fractionDigits: body.decimalPlaces }),
          ...(body.timeZone === undefined ? {} : { timeZone: body.timeZone })
        })
      : parseScalarFormatter(body.valueType, {
          version: 1,
          kind: "person-name.ru",
          sourceOrder: body.personName.sourceOrder,
          pattern: body.personName.pattern
        });
  return toJsonValue(formatter);
}

export function registerTemplateDraftFieldEditRoutes(
  app: FastifyInstance,
  editor: TemplateDraftFieldEditor
): void {

  app.put<{ Params: FieldParams; Body: UpdateFieldBody }>(
    "/api/v1/spaces/:spaceId/template-drafts/:draftId/fields/:fieldId",
    {
      schema: {
        params: paramsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["key", "label", "valueType"],
          properties: {
            key: { type: "string", minLength: 1, maxLength: 160 },
            label: { type: "string", minLength: 1, maxLength: 500 },
            valueType: {
              type: "string",
              enum: [
                "string",
                "text",
                "enum",
                "number",
                "integer",
                "boolean",
                "date",
                "date-time"
              ]
            },
            required: { type: "boolean", default: false },
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
            }
          }
        }
      }
    },
    async (request, reply) => {
      const field = editor.update(
        request.params.spaceId,
        request.params.draftId,
        request.params.fieldId,
        {
          key: request.body.key,
          label: request.body.label,
          valueType: request.body.valueType,
          required: request.body.required ?? false,
          formatter: formatterFor(request.body)
        },
        mutationContextFromRequest(request)
      );
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, { field });
    }
  );

  app.delete<{ Params: FieldParams }>(
    "/api/v1/spaces/:spaceId/template-drafts/:draftId/fields/:fieldId",
    { schema: { params: paramsSchema } },
    async (request, reply) => {
      const result = editor.delete(
        request.params.spaceId,
        request.params.draftId,
        request.params.fieldId,
        mutationContextFromRequest(request)
      );
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, result);
    }
  );
}
