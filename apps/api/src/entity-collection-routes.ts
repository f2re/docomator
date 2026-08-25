import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  EntityCollectionRegistry,
  type CreateEntityCollectionDefinitionInput,
  type EntityCollectionRecord,
  type ReplaceEntityCollectionItemInput
} from "@docomator/storage";

import { correlationId, mutationContextFromRequest } from "./request-context.js";
import { buildDataExportXlsx, XlsxExportLimitError } from "./xlsx-export.js";

interface SpaceParams {
  spaceId: string;
}

interface CollectionParams extends SpaceParams {
  collectionId: string;
}

interface OwnerCollectionParams extends CollectionParams {
  entityId: string;
}

interface ListQuery {
  ownerEntityTypeKey?: string;
}

interface ReplaceItemsBody {
  items: ReplaceEntityCollectionItemInput[];
}

const idSchema = {
  type: "string",
  minLength: 1,
  maxLength: 160
} as const;

const stableKeySchema = {
  type: "string",
  minLength: 1,
  maxLength: 160,
  pattern: "^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$"
} as const;

const collectionValueTypes = [
  "string",
  "text",
  "number",
  "integer",
  "boolean",
  "date",
  "date-time",
  "enum"
] as const;

function envelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function neutralizeSpreadsheetFormula(value: string): string {
  const trimmed = value.trimStart();
  return /^[=+\-@\t\r]/u.test(trimmed) ? `'${value}` : value;
}

function csvCell(value: string): string {
  const safe = neutralizeSpreadsheetFormula(value);
  return `"${safe.replace(/"/gu, '""')}"`;
}

function exportTable(collection: EntityCollectionRecord): {
  headers: string[];
  rows: string[][];
} {
  const headers = ["№", ...collection.definition.fields.map((field) => field.label)];
  const rows = collection.items.map((item) => [
    String(item.rowNumber),
    ...collection.definition.fields.map((field) => displayValue(item.values[field.key]))
  ]);
  return { headers, rows };
}

function exportName(collection: EntityCollectionRecord, extension: "csv" | "xlsx"): string {
  const safe = collection.definition.label
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 100) || "таблица";
  return `${safe}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

function exportHeaders(
  reply: FastifyReply,
  collection: EntityCollectionRecord,
  extension: "csv" | "xlsx"
): FastifyReply {
  return reply
    .header("cache-control", "no-store")
    .header("x-content-type-options", "nosniff")
    .header(
      "content-disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(exportName(collection, extension))}`
    )
    .header("x-docomator-export-count", String(collection.items.length));
}

export function registerEntityCollectionRoutes(
  app: FastifyInstance,
  registry: EntityCollectionRegistry
): void {
  app.post<{ Params: SpaceParams; Body: CreateEntityCollectionDefinitionInput }>(
    "/api/v1/spaces/:spaceId/entity-collections",
    {
      schema: {
        params: {
          type: "object",
          required: ["spaceId"],
          properties: { spaceId: idSchema }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["label", "ownerEntityTypeKey", "fields"],
          properties: {
            id: idSchema,
            key: stableKeySchema,
            label: { type: "string", minLength: 1, maxLength: 500 },
            description: { type: ["string", "null"], maxLength: 2_000 },
            ownerEntityTypeKey: stableKeySchema,
            minItems: { type: "integer", minimum: 0, maximum: 1_000 },
            maxItems: { type: "integer", minimum: 1, maximum: 1_000 },
            fields: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "valueType"],
                properties: {
                  id: idSchema,
                  key: stableKeySchema,
                  label: { type: "string", minLength: 1, maxLength: 500 },
                  description: { type: ["string", "null"], maxLength: 2_000 },
                  valueType: { type: "string", enum: [...collectionValueTypes] },
                  unit: { type: ["string", "null"], maxLength: 80 },
                  required: { type: "boolean" },
                  validation: { type: "object", additionalProperties: true }
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const created = registry.createDefinition(
        request.params.spaceId,
        request.body,
        mutationContextFromRequest(request)
      );
      reply.code(201).header("cache-control", "no-store");
      return envelope(request, created);
    }
  );

  app.get<{ Params: SpaceParams; Querystring: ListQuery }>(
    "/api/v1/spaces/:spaceId/entity-collections",
    {
      schema: {
        params: {
          type: "object",
          required: ["spaceId"],
          properties: { spaceId: idSchema }
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { ownerEntityTypeKey: stableKeySchema }
        }
      }
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return envelope(
        request,
        registry.listDefinitions(
          request.params.spaceId,
          request.query.ownerEntityTypeKey
        )
      );
    }
  );

  app.get<{ Params: CollectionParams }>(
    "/api/v1/spaces/:spaceId/entity-collections/:collectionId",
    {
      schema: {
        params: {
          type: "object",
          required: ["spaceId", "collectionId"],
          properties: { spaceId: idSchema, collectionId: idSchema }
        }
      }
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return envelope(
        request,
        registry.getDefinition(
          request.params.spaceId,
          request.params.collectionId
        )
      );
    }
  );

  app.get<{ Params: OwnerCollectionParams }>(
    "/api/v1/spaces/:spaceId/entities/:entityId/collections/:collectionId",
    {
      schema: {
        params: {
          type: "object",
          required: ["spaceId", "entityId", "collectionId"],
          properties: {
            spaceId: idSchema,
            entityId: idSchema,
            collectionId: idSchema
          }
        }
      }
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return envelope(
        request,
        registry.getCollection(
          request.params.spaceId,
          request.params.entityId,
          request.params.collectionId
        )
      );
    }
  );

  app.put<{ Params: OwnerCollectionParams; Body: ReplaceItemsBody }>(
    "/api/v1/spaces/:spaceId/entities/:entityId/collections/:collectionId/items",
    {
      schema: {
        params: {
          type: "object",
          required: ["spaceId", "entityId", "collectionId"],
          properties: {
            spaceId: idSchema,
            entityId: idSchema,
            collectionId: idSchema
          }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["items"],
          properties: {
            items: {
              type: "array",
              maxItems: 1_000,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["values"],
                properties: {
                  id: idSchema,
                  values: { type: "object", additionalProperties: true }
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const saved = registry.replaceItems(
        request.params.spaceId,
        request.params.entityId,
        request.params.collectionId,
        request.body.items,
        mutationContextFromRequest(request)
      );
      reply.header("cache-control", "no-store");
      return envelope(request, saved);
    }
  );

  app.get<{ Params: OwnerCollectionParams }>(
    "/api/v1/spaces/:spaceId/entities/:entityId/collections/:collectionId/export.csv",
    {
      schema: {
        params: {
          type: "object",
          required: ["spaceId", "entityId", "collectionId"],
          properties: {
            spaceId: idSchema,
            entityId: idSchema,
            collectionId: idSchema
          }
        }
      }
    },
    async (request, reply) => {
      const collection = registry.getCollection(
        request.params.spaceId,
        request.params.entityId,
        request.params.collectionId
      );
      const table = exportTable(collection);
      const body = `\uFEFF${[table.headers, ...table.rows]
        .map((row) => row.map(csvCell).join(";"))
        .join("\r\n")}\r\n`;
      return exportHeaders(reply, collection, "csv")
        .type("text/csv; charset=utf-8")
        .send(body);
    }
  );

  app.get<{ Params: OwnerCollectionParams }>(
    "/api/v1/spaces/:spaceId/entities/:entityId/collections/:collectionId/export.xlsx",
    {
      schema: {
        params: {
          type: "object",
          required: ["spaceId", "entityId", "collectionId"],
          properties: {
            spaceId: idSchema,
            entityId: idSchema,
            collectionId: idSchema
          }
        }
      }
    },
    async (request, reply) => {
      const collection = registry.getCollection(
        request.params.spaceId,
        request.params.entityId,
        request.params.collectionId
      );
      const table = exportTable(collection);
      try {
        return exportHeaders(reply, collection, "xlsx")
          .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
          .send(buildDataExportXlsx(table.headers, table.rows));
      } catch (error) {
        if (error instanceof XlsxExportLimitError) {
          return reply.code(413).send({
            error: {
              code: "entity_collection_export_too_large",
              message: "Таблица слишком велика для безопасного экспорта XLSX. Сократите число строк или длину значений."
            },
            correlationId: correlationId(request)
          });
        }
        throw error;
      }
    }
  );
}
