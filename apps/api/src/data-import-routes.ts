import {
  AssistedDataImportRegistry,
  DataImportConflictError,
  DataImportValidationError,
  KnowledgeConflictError,
  SpaceConflictError,
  SpaceRegistry,
  SpaceValidationError,
  dataImportOperationIssue,
  type DataImportOperationIssue,
  assistedDataImportRegistryFromSpaceRegistry,
  validateExistingImportIdentityProperty,
  type AssistedDataImportPropertyMapping
} from "@docomator/storage";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

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
  key?: string;
  name: string;
  description?: string;
}

interface ExecuteImportBody {
  fileName: string;
  fileFormat: "csv" | "xlsx";
  sourceSha256: string;
  previewToken: string;
  entityTypeKey?: string;
  identityColumn: string;
  displayNameColumn: string;
  identityPropertyKey?: string;
  headers: string[];
  rows: Array<Record<string, string>>;
  sourceRowNumbers?: number[];
  identityCaseInsensitive?: boolean;
  personName?: {
    normalizeCase?: boolean;
    split?: boolean;
    sourceOrder?: "family-given-patronymic" | "given-patronymic-family";
  };
  mappings: AssistedDataImportPropertyMapping[];
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

function importIssueResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  issue: DataImportOperationIssue
): FastifyReply {
  return reply.code(statusCode).header("cache-control", "no-store").send({
    error: { code: issue.code, message: issue.message, issue },
    correlationId: correlationId(request)
  });
}

function operationIssueFromError(error: unknown): {
  statusCode: number;
  issue: DataImportOperationIssue;
} | null {
  if (error instanceof DataImportValidationError) {
    return {
      statusCode: 400,
      issue:
        error.issue ??
        dataImportOperationIssue({
          code: "mapping_invalid",
          scope: "mapping",
          blockingEffect: "mapping",
          message: error.message,
          suggestedAction:
            "Проверьте отмеченное сопоставление и тип поля. Выбранный файл и остальные настройки сохранены."
        })
    };
  }
  if (error instanceof DataImportConflictError || error instanceof KnowledgeConflictError) {
    return {
      statusCode: 409,
      issue:
        error instanceof DataImportConflictError && error.issue !== null
          ? error.issue
          : dataImportOperationIssue({
              code: "mapping_ambiguous",
              scope: "mapping",
              blockingEffect: "mapping",
              message: error instanceof Error ? error.message : "Сопоставление неоднозначно.",
              suggestedAction:
                "Выберите конкретное поле для проблемной колонки. Остальные настройки сохранены."
            })
    };
  }
  return null;
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
  if (body.identityPropertyKey === undefined) return;
  const identityPropertyKey = normalizeKey(body.identityPropertyKey);
  const mappings = body.mappings.filter(
    (mapping) =>
      mapping.propertyKey !== undefined &&
      normalizeKey(mapping.propertyKey) === identityPropertyKey
  );
  if (mappings.length > 1) {
    const message = "Свойство устойчивого ключа сопоставлено более одного раза.";
    throw new DataImportValidationError(
      message,
      dataImportOperationIssue({
        code: "mapping_duplicate_target",
        scope: "mapping",
        blockingEffect: "mapping",
        message,
        suggestedAction: "Оставьте одно сопоставление для устойчивого ключа.",
        propertyKey: body.identityPropertyKey
      })
    );
  }
  const mapping = mappings[0];
  if (mapping !== undefined && mapping.column !== body.identityColumn) {
    const message = "Свойство устойчивого ключа должно быть сопоставлено с выбранной колонкой устойчивого ключа.";
    throw new DataImportValidationError(
      message,
      dataImportOperationIssue({
        code: "mapping_invalid",
        scope: "mapping",
        blockingEffect: "mapping",
        message,
        suggestedAction: "Сопоставьте устойчивый ключ с той же колонкой, которая выбрана для поиска прежней записи.",
        column: mapping.column,
        propertyKey: body.identityPropertyKey
      })
    );
  }
  if (
    mapping?.createIfMissing === true &&
    mapping.valueType !== undefined &&
    mapping.valueType !== "string"
  ) {
    const message = "Новое свойство устойчивого ключа должно иметь тип «Короткая строка».";
    throw new DataImportValidationError(
      message,
      dataImportOperationIssue({
        code: "mapping_type_mismatch",
        scope: "mapping",
        blockingEffect: "mapping",
        message,
        suggestedAction: "Выберите для устойчивого ключа тип «Короткий текст».",
        column: mapping.column,
        propertyKey: body.identityPropertyKey
      })
    );
  }
}

function validatePreviewToken(body: ExecuteImportBody): void {
  const expectedToken = createImportPreviewToken({
    sourceSha256: body.sourceSha256.toLowerCase(),
    headers: body.headers,
    rows: body.rows,
    ...(body.sourceRowNumbers === undefined
      ? {}
      : { sourceRowNumbers: body.sourceRowNumbers })
  });
  if (expectedToken !== body.previewToken.toLowerCase()) {
    throw new SpaceConflictError(
      "Данные предварительного просмотра изменились. Загрузите файл заново."
    );
  }
}

function registryInput(body: ExecuteImportBody) {
  return {
    fileName: body.fileName,
    fileFormat: body.fileFormat,
    sourceSha256: body.sourceSha256,
    identityColumn: body.identityColumn,
    displayNameColumn: body.displayNameColumn,
    headers: body.headers,
    rows: body.rows,
    mappings: body.mappings,
    ...(body.sourceRowNumbers === undefined
      ? {}
      : { sourceRowNumbers: body.sourceRowNumbers }),
    ...(body.identityCaseInsensitive === undefined
      ? {}
      : { identityCaseInsensitive: body.identityCaseInsensitive }),
    ...(body.personName === undefined
      ? {}
      : { personName: body.personName }),
    ...(body.entityTypeKey === undefined
      ? {}
      : { entityTypeKey: body.entityTypeKey }),
    ...(body.identityPropertyKey === undefined
      ? {}
      : { identityPropertyKey: body.identityPropertyKey }),
    ...(body.group === undefined ? {} : { group: body.group })
  };
}

function validateLegacyIdentity(
  spaces: SpaceRegistry,
  spaceIdentity: string,
  body: ExecuteImportBody
): void {
  validateIdentityMapping(body);
  if (body.identityPropertyKey === undefined) return;
  validateExistingImportIdentityProperty({
    spaces,
    spaceIdentity,
    entityTypeKey: body.entityTypeKey ?? "person",
    identityPropertyKey: body.identityPropertyKey ?? "",
    mappings: body.mappings
  });
}

function importResultForClient<T extends {
  id: string;
  spaceId: string;
  entityTypeKey: string;
  sourceSha256: string;
  identityPropertyKey: string;
  groupId: string | null;
  mappingResolutions?: unknown;
}>(result: T, includeTechnicalDetails: boolean) {
  if (includeTechnicalDetails) return result;
  const {
    id: _id,
    spaceId: _spaceId,
    entityTypeKey: _entityTypeKey,
    sourceSha256: _sourceSha256,
    identityPropertyKey: _identityPropertyKey,
    groupId: _groupId,
    mappingResolutions: _mappingResolutions,
    ...publicResult
  } = result;
  return publicResult;
}

const executeImportBodySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "fileName",
    "fileFormat",
    "sourceSha256",
    "previewToken",
    "identityColumn",
    "displayNameColumn",
    "headers",
    "rows",
    "mappings"
  ],
  properties: {
    fileName: { type: "string", minLength: 1, maxLength: 255 },
    fileFormat: { type: "string", enum: ["csv", "xlsx"] },
    sourceSha256: { type: "string", pattern: "^[a-fA-F0-9]{64}$" },
    previewToken: { type: "string", pattern: "^[a-fA-F0-9]{64}$" },
    entityTypeKey: { type: "string", minLength: 1, maxLength: 160 },
    identityColumn: { type: "string", minLength: 1, maxLength: 300 },
    displayNameColumn: { type: "string", minLength: 1, maxLength: 300 },
    identityPropertyKey: { type: "string", minLength: 1, maxLength: 160 },
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
    sourceRowNumbers: {
      type: "array",
      minItems: 1,
      maxItems: 1_000,
      items: { type: "integer", minimum: 1, maximum: 1_048_576 }
    },
    identityCaseInsensitive: { type: "boolean" },
    personName: {
      type: "object",
      additionalProperties: false,
      properties: {
        normalizeCase: { type: "boolean" },
        split: { type: "boolean" },
        sourceOrder: {
          type: "string",
          enum: ["family-given-patronymic", "given-patronymic-family"]
        }
      }
    },
    mappings: {
      type: "array",
      minItems: 0,
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["column"],
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
          },
          sensitivity: {
            type: "string",
            enum: ["public", "internal", "personal", "restricted"]
          },
          aliases: {
            type: "array",
            maxItems: 100,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 160 }
          },
          enumValues: {
            type: "array",
            maxItems: 500,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 160 }
          },
          allowCustom: { type: "boolean" },
          caseInsensitive: { type: "boolean" },
          transform: {
            type: "string",
            enum: ["person-family", "person-given", "person-patronymic"]
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
          required: ["name"],
          properties: {
            key: { type: "string", minLength: 1, maxLength: 160 },
            name: { type: "string", minLength: 1, maxLength: 300 },
            description: { type: "string", maxLength: 2_000 }
          }
        }
      ]
    }
  }
} as const;

export function registerDataImportRoutes(
  app: FastifyInstance,
  spaces: SpaceRegistry,
  registry: AssistedDataImportRegistry = assistedDataImportRegistryFromSpaceRegistry(spaces)
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
        if (error instanceof DataImportParseError) {
          return importIssueResponse(request, reply, 422, error.issue);
        }
        throw error;
      }
    }
  );

  app.post<{ Params: SpaceParams; Body: ExecuteImportBody }>(
    "/api/v1/spaces/:spaceId/data-import/plan",
    {
      bodyLimit: 16 * 1024 * 1024,
      schema: {
        params: spaceParamsSchema,
        body: executeImportBodySchema
      }
    },
    async (request, reply) => {
      try {
        validatePreviewToken(request.body);
        validateLegacyIdentity(spaces, request.params.spaceId, request.body);
        const plan = registry.plan(
          request.params.spaceId,
          registryInput(request.body),
          mutationContextFromRequest(request)
        );
        const { mappingResolutions: _mappingResolutions, ...publicPlan } = plan;
        reply.header("cache-control", "no-store");
        return responseEnvelope(request, publicPlan);
      } catch (error) {
        const operation = operationIssueFromError(error);
        if (operation !== null) {
          return importIssueResponse(
            request,
            reply,
            operation.statusCode,
            operation.issue
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
        body: executeImportBodySchema
      }
    },
    async (request, reply) => {
      try {
        validatePreviewToken(request.body);
        validateLegacyIdentity(spaces, request.params.spaceId, request.body);
        const result = registry.execute(
          request.params.spaceId,
          registryInput(request.body),
          mutationContextFromRequest(request)
        );
        reply.code(201).header("cache-control", "no-store");
        return responseEnvelope(
          request,
          importResultForClient(
            result,
            request.body.identityPropertyKey !== undefined
          )
        );
      } catch (error) {
        const operation = operationIssueFromError(error);
        if (operation !== null) {
          return importIssueResponse(
            request,
            reply,
            operation.statusCode,
            operation.issue
          );
        }
        throw error;
      }
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
