import {
  DataImportConflictError,
  DataImportRegistry,
  DataImportValidationError,
  SpaceConflictError,
  SpaceRegistry,
  SpaceValidationError,
  dataImportRegistryFromSpaceRegistry,
  validateExistingImportIdentityProperty,
  type DataImportPropertyMapping
} from "@docomator/storage";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { DocumentIntakeError } from "@docomator/document-intake";

import {
  createImportPreviewToken,
  DataImportParseError,
  parseDataImportBuffer
} from "./data-import-parser.js";
import { correlationId, mutationContextFromRequest } from "./request-context.js";

interface SpaceParams {
  spaceId: string;
}

interface PreviewQuery {
  fileName: string;
}

interface ImportGroupBody {
  key: string;
  name: string;
  description?: string;
}

interface ExecuteImportBody {
  fileName: string;
  fileFormat: "csv" | "xlsx";
  sourceSha256: string;
  previewToken: string;
  entityTypeKey: string;
  identityColumn: string;
  displayNameColumn: string;
  identityPropertyKey: string;
  headers: string[];
  rows: Array<Record<string, string>>;
  mappings: DataImportPropertyMapping[];
  group?: ImportGroupBody | null;
}

interface HistoryQuery {
  limit?: number;
}

const spaceParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["spaceId"],
  properties: {
    spaceId: { type: "string", minLength: 1, maxLength: 160 }
  }
} as const;

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

function importOperation<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof DataImportValidationError) {
      throw new SpaceValidationError(error.message);
    }
    if (error instanceof DataImportConflictError) {
      throw new SpaceConflictError(error.message);
    }
    throw error;
  }
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function validateIdentityMapping(body: ExecuteImportBody): void {
  const identityPropertyKey = normalizeKey(body.identityPropertyKey);
  const mappings = body.mappings.filter(
    (mapping) => normalizeKey(mapping.propertyKey) === identityPropertyKey
  );
  if (mappings.length > 1) {
    throw new SpaceValidationError(
      "Свойство устойчивого ключа сопоставлено более одного раза."
    );
  }
  const mapping = mappings[0];
  if (mapping !== undefined && mapping.column !== body.identityColumn) {
    throw new SpaceValidationError(
      "Свойство устойчивого ключа должно быть сопоставлено с выбранной колонкой устойчивого ключа."
    );
  }
  if (
    mapping?.createIfMissing === true &&
    mapping.valueType !== undefined &&
    mapping.valueType !== "string"
  ) {
    throw new SpaceValidationError(
      "Новое свойство устойчивого ключа должно иметь тип «Короткая строка»."
    );
  }
}

export function registerDataImportRoutes(
  app: FastifyInstance,
  spaces: SpaceRegistry,
  registry: DataImportRegistry = dataImportRegistryFromSpaceRegistry(spaces)
): void {
  app.post<{ Params: SpaceParams; Querystring: PreviewQuery; Body: Buffer }>(
    "/api/v1/spaces/:spaceId/data-import/preview",
    {
      bodyLimit: 8 * 1024 * 1024,
      schema: {
        params: spaceParamsSchema,
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["fileName"],
          properties: {
            fileName: { type: "string", minLength: 1, maxLength: 255 }
          }
        }
      }
    },
    async (request, reply) => {
      spaces.getSpace(request.params.spaceId);
      try {
        const preview = await parseDataImportBuffer({
          buffer: request.body,
          fileName: request.query.fileName
        });
        reply.header("cache-control", "no-store");
        return responseEnvelope(request, preview);
      } catch (error) {
        if (error instanceof Error) {
          throw new DocumentIntakeError(
            error instanceof DataImportParseError
              ? "data_import_parse_failed"
              : "data_import_read_failed",
            422,
            error.message
          );
        }
        throw error;
      }
    }
  );

  app.post<{ Params: SpaceParams; Body: ExecuteImportBody }>(
    "/api/v1/spaces/:spaceId/data-import/execute",
    {
      bodyLimit: 16 * 1024 * 1024,
      schema: {
        params: spaceParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "fileName",
            "fileFormat",
            "sourceSha256",
            "previewToken",
            "entityTypeKey",
            "identityColumn",
            "displayNameColumn",
            "identityPropertyKey",
            "headers",
            "rows",
            "mappings"
          ],
          properties: {
            fileName: { type: "string", minLength: 1, maxLength: 255 },
            fileFormat: { type: "string", enum: ["csv", "xlsx"] },
            sourceSha256: {
              type: "string",
              pattern: "^[a-fA-F0-9]{64}$"
            },
            previewToken: {
              type: "string",
              pattern: "^[a-fA-F0-9]{64}$"
            },
            entityTypeKey: { type: "string", minLength: 1, maxLength: 160 },
            identityColumn: { type: "string", minLength: 1, maxLength: 300 },
            displayNameColumn: { type: "string", minLength: 1, maxLength: 300 },
            identityPropertyKey: {
              type: "string",
              minLength: 1,
              maxLength: 160
            },
            headers: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: { type: "string", minLength: 1, maxLength: 300 }
            },
            rows: {
              type: "array",
              minItems: 1,
              maxItems: 1_000,
              items: {
                type: "object",
                additionalProperties: { type: "string", maxLength: 20_000 }
              }
            },
            mappings: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["column", "propertyKey"],
                properties: {
                  column: { type: "string", minLength: 1, maxLength: 300 },
                  propertyKey: { type: "string", minLength: 1, maxLength: 160 },
                  createIfMissing: { type: "boolean" },
                  label: { type: "string", maxLength: 300 },
                  valueType: {
                    type: "string",
                    enum: [
                      "string",
                      "text",
                      "number",
                      "integer",
                      "boolean",
                      "date",
                      "date-time",
                      "enum"
                    ]
                  }
                }
              }
            },
            group: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["key", "name"],
                  properties: {
                    key: { type: "string", minLength: 1, maxLength: 160 },
                    name: { type: "string", minLength: 1, maxLength: 300 },
                    description: { type: "string", maxLength: 2_000 }
                  }
                }
              ]
            }
          }
        }
      }
    },
    async (request, reply) => {
      const expectedToken = createImportPreviewToken({
        sourceSha256: request.body.sourceSha256.toLowerCase(),
        headers: request.body.headers,
        rows: request.body.rows
      });
      if (expectedToken !== request.body.previewToken.toLowerCase()) {
        throw new SpaceConflictError(
          "Данные предварительного просмотра изменились. Загрузите файл заново."
        );
      }
      validateIdentityMapping(request.body);
      importOperation(() =>
        validateExistingImportIdentityProperty({
          spaces,
          entityTypeKey: request.body.entityTypeKey,
          identityPropertyKey: request.body.identityPropertyKey,
          mappings: request.body.mappings
        })
      );
      const result = importOperation(() =>
        registry.execute(
          request.params.spaceId,
          {
            fileName: request.body.fileName,
            fileFormat: request.body.fileFormat,
            sourceSha256: request.body.sourceSha256,
            entityTypeKey: request.body.entityTypeKey,
            identityColumn: request.body.identityColumn,
            displayNameColumn: request.body.displayNameColumn,
            identityPropertyKey: request.body.identityPropertyKey,
            headers: request.body.headers,
            rows: request.body.rows,
            mappings: request.body.mappings,
            ...(request.body.group === undefined
              ? {}
              : { group: request.body.group })
          },
          mutationContextFromRequest(request)
        )
      );
      reply.code(201).header("cache-control", "no-store");
      return responseEnvelope(request, result);
    }
  );

  app.get<{ Params: SpaceParams; Querystring: HistoryQuery }>(
    "/api/v1/spaces/:spaceId/data-import/runs",
    {
      schema: {
        params: spaceParamsSchema,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 200 }
          }
        }
      }
    },
    async (request, reply) => {
      const runs = importOperation(() =>
        registry.list(request.params.spaceId, request.query.limit ?? 50)
      );
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, runs);
    }
  );
}
