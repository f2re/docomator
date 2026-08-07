import {
  AssistedDataImportRegistry,
  DataImportConflictError,
  DataImportValidationError,
  SpaceConflictError,
  SpaceRegistry,
  SpaceValidationError,
  assistedDataImportRegistryFromSpaceRegistry,
  validateExistingImportIdentityProperty,
  type AssistedDataImportPropertyMapping
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

interface ImportRowErrorLike {
  rowNumber: number;
  externalKey: string | null;
  message: string;
}

interface StructuredImportRowError extends ImportRowErrorLike {
  code: string;
  column?: string;
  propertyKey?: string;
  rawValue?: string;
  suggestedAction: string;
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
  if (body.identityPropertyKey === undefined) return;
  const identityPropertyKey = normalizeKey(body.identityPropertyKey);
  const mappings = body.mappings.filter(
    (mapping) =>
      mapping.propertyKey !== undefined &&
      normalizeKey(mapping.propertyKey) === identityPropertyKey
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
  body: ExecuteImportBody
): void {
  validateIdentityMapping(body);
  if (body.identityPropertyKey === undefined) return;
  importOperation(() =>
    validateExistingImportIdentityProperty({
      spaces,
      entityTypeKey: body.entityTypeKey ?? "person",
      identityPropertyKey: body.identityPropertyKey ?? "",
      mappings: body.mappings
    })
  );
}

function sourceRow(body: ExecuteImportBody, rowNumber: number): Record<string, string> | null {
  const physicalRows = body.sourceRowNumbers ?? body.rows.map((_row, index) => index + 2);
  const index = physicalRows.findIndex((number) => number === rowNumber);
  return index >= 0 ? body.rows[index] ?? null : null;
}

function quotedValues(message: string): string[] {
  return [...message.matchAll(/«([^»]+)»/gu)]
    .map((match) => match[1]?.normalize("NFKC").trim() ?? "")
    .filter(Boolean);
}

function inferImportErrorColumn(
  error: ImportRowErrorLike,
  body: ExecuteImportBody
): string | undefined {
  const explicit = /колонк(?:а|е|у|ой)\s+«([^»]+)»/iu.exec(error.message)?.[1];
  if (explicit !== undefined && body.headers.includes(explicit)) return explicit;
  if (/устойчив|повторяется внутри файла|одинаковым ключом/iu.test(error.message)) {
    return body.identityColumn;
  }
  if (/фио|отображаемым названием|два или три слова/iu.test(error.message)) {
    return body.displayNameColumn;
  }
  const row = sourceRow(body, error.rowNumber);
  if (row === null) return undefined;
  for (const value of quotedValues(error.message)) {
    const matches = body.headers.filter(
      (header) => String(row[header] ?? "").normalize("NFKC").trim() === value
    );
    if (matches.length === 1) return matches[0];
  }
  return undefined;
}

function importErrorCode(message: string): string {
  const text = message.toLocaleLowerCase("ru-RU");
  if (/не заполнена колонка/u.test(text)) return "required_value_missing";
  if (/повторяется внутри файла|несколько объектов с одинаков/u.test(text)) {
    return "duplicate_identity";
  }
  if (/не является целым числом/u.test(text)) return "invalid_integer";
  if (/не является числом/u.test(text)) return "invalid_number";
  if (/не распознано как дата и время/u.test(text)) return "invalid_datetime";
  if (/не распознано как дата|недопустимую дату/u.test(text)) return "invalid_date";
  if (/да\/нет/u.test(text)) return "invalid_boolean";
  if (/несколько полей|выберите существующее поле/u.test(text)) {
    return "ambiguous_mapping";
  }
  if (/фио|два или три слова/u.test(text)) return "invalid_person_name";
  if (/не применяется к типу/u.test(text)) return "property_type_mismatch";
  return "row_validation_failed";
}

function suggestedImportAction(code: string): string {
  switch (code) {
    case "required_value_missing":
      return "Заполните обязательную ячейку либо выберите другую колонку для названия или устойчивого идентификатора.";
    case "duplicate_identity":
      return "Исправьте повтор в исходной таблице или выберите колонку, где значения действительно уникальны.";
    case "invalid_integer":
    case "invalid_number":
      return "Если это код или номер, выберите текстовый тип. Если это число — исправьте значение в исходной таблице.";
    case "invalid_date":
    case "invalid_datetime":
      return "Приведите значение к формату даты/времени либо выберите текстовый тип, если колонка не является датой.";
    case "invalid_boolean":
      return "Используйте да/нет, 1/0, true/false или +/− либо выберите текстовый тип поля.";
    case "ambiguous_mapping":
      return "Выберите конкретное существующее поле или создайте новое поле для этой колонки.";
    case "invalid_person_name":
      return "Проверьте порядок ФИО или отключите разделение ФИО для неоднозначной строки.";
    case "property_type_mismatch":
      return "Выберите поле, применимое к текущему типу объектов, либо создайте отдельное поле в этом пространстве.";
    default:
      return "Проверьте сопоставление, тип поля и исходное значение, затем снова запустите предварительную проверку.";
  }
}

function structuredImportError(
  error: ImportRowErrorLike,
  body: ExecuteImportBody
): StructuredImportRowError {
  const column = inferImportErrorColumn(error, body);
  const mapping =
    column === undefined
      ? undefined
      : body.mappings.find((candidate) => candidate.column === column);
  const row = sourceRow(body, error.rowNumber);
  const rawValue = column === undefined || row === null ? undefined : row[column];
  const code = importErrorCode(error.message);
  return {
    rowNumber: error.rowNumber,
    externalKey: error.externalKey,
    message: error.message,
    code,
    ...(column === undefined ? {} : { column }),
    ...(mapping?.propertyKey === undefined
      ? {}
      : { propertyKey: mapping.propertyKey }),
    ...(rawValue === undefined ? {} : { rawValue }),
    suggestedAction: suggestedImportAction(code)
  };
}

function withStructuredImportErrors<T extends { errors: ImportRowErrorLike[] }>(
  result: T,
  body: ExecuteImportBody
): Omit<T, "errors"> & { errors: StructuredImportRowError[] } {
  return {
    ...result,
    errors: result.errors.map((error) => structuredImportError(error, body))
  };
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
    "/api/v1/spaces/:spaceId/data-import/plan",
    {
      bodyLimit: 16 * 1024 * 1024,
      schema: {
        params: spaceParamsSchema,
        body: executeImportBodySchema
      }
    },
    async (request, reply) => {
      validatePreviewToken(request.body);
      validateLegacyIdentity(spaces, request.body);
      const plan = importOperation(() =>
        registry.plan(
          request.params.spaceId,
          registryInput(request.body),
          mutationContextFromRequest(request)
        )
      );
      const structuredPlan = withStructuredImportErrors(plan, request.body);
      const { mappingResolutions: _mappingResolutions, ...publicPlan } = structuredPlan;
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, publicPlan);
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
      validatePreviewToken(request.body);
      validateLegacyIdentity(spaces, request.body);
      const result = importOperation(() =>
        registry.execute(
          request.params.spaceId,
          registryInput(request.body),
          mutationContextFromRequest(request)
        )
      );
      const structuredResult = withStructuredImportErrors(result, request.body);
      reply.code(201).header("cache-control", "no-store");
      return responseEnvelope(
        request,
        importResultForClient(
          structuredResult,
          request.body.identityPropertyKey !== undefined
        )
      );
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
