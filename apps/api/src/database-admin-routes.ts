import type { FastifyInstance, FastifyReply } from "fastify";

import type {
  DatabaseAdminRegistry,
  JsonValue,
  PropertyCardinality,
  PropertySensitivity
} from "@docomator/storage";

import { mutationContextFromRequest } from "./request-context.js";

interface TableParams {
  table: string;
}

interface TableRowsQuery {
  limit?: number;
  offset?: number;
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  search?: string;
}

interface TableExportQuery extends TableRowsQuery {
  format?: "csv" | "json";
}

interface CreatePropertyQuery {
  spaceId: string;
}

interface CreatePropertyBody {
  key?: string;
  label: string;
  description?: string;
  valueType: string;
  unit?: string;
  cardinality?: PropertyCardinality;
  sensitivity?: PropertySensitivity;
  appliesTo?: string[];
  validation?: { [key: string]: JsonValue };
  aliases?: string[];
}

const pageQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 200 },
    offset: { type: "integer", minimum: 0, maximum: 10_000_000 },
    sortColumn: { type: "string", minLength: 1, maxLength: 160 },
    sortDirection: { type: "string", enum: ["asc", "desc"] },
    search: { type: "string", maxLength: 300 }
  }
} as const;

function noStore(reply: FastifyReply): void {
  reply.header("cache-control", "no-store");
}

export function registerDatabaseAdminRoutes(
  app: FastifyInstance,
  registry: DatabaseAdminRegistry
): void {
  app.get("/api/v1/admin/database/tables", async (_request, reply) => {
    noStore(reply);
    return { data: registry.listTables() };
  });

  app.get<{ Params: TableParams; Querystring: TableRowsQuery }>(
    "/api/v1/admin/database/tables/:table/rows",
    {
      schema: {
        params: {
          type: "object",
          required: ["table"],
          additionalProperties: false,
          properties: {
            table: { type: "string", minLength: 1, maxLength: 160 }
          }
        },
        querystring: pageQuerySchema
      }
    },
    async (request, reply) => {
      noStore(reply);
      return {
        data: registry.listRows({
          table: request.params.table,
          ...(request.query.limit === undefined
            ? {}
            : { limit: request.query.limit }),
          ...(request.query.offset === undefined
            ? {}
            : { offset: request.query.offset }),
          ...(request.query.sortColumn === undefined
            ? {}
            : { sortColumn: request.query.sortColumn }),
          ...(request.query.sortDirection === undefined
            ? {}
            : { sortDirection: request.query.sortDirection }),
          ...(request.query.search === undefined
            ? {}
            : { search: request.query.search })
        })
      };
    }
  );

  app.get<{ Params: TableParams; Querystring: TableExportQuery }>(
    "/api/v1/admin/database/tables/:table/export",
    {
      schema: {
        params: {
          type: "object",
          required: ["table"],
          additionalProperties: false,
          properties: {
            table: { type: "string", minLength: 1, maxLength: 160 }
          }
        },
        querystring: {
          ...pageQuerySchema,
          properties: {
            ...pageQuerySchema.properties,
            limit: { type: "integer", minimum: 1, maximum: 10_000 },
            format: { type: "string", enum: ["csv", "json"] }
          }
        }
      }
    },
    async (request, reply) => {
      const result = registry.exportTable(
        {
          table: request.params.table,
          format: request.query.format === "json" ? "json" : "csv",
          ...(request.query.limit === undefined
            ? { limit: 10_000 }
            : { limit: request.query.limit }),
          ...(request.query.sortColumn === undefined
            ? {}
            : { sortColumn: request.query.sortColumn }),
          ...(request.query.sortDirection === undefined
            ? {}
            : { sortDirection: request.query.sortDirection }),
          ...(request.query.search === undefined
            ? {}
            : { search: request.query.search })
        },
        mutationContextFromRequest(request)
      );
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
      reply.header("content-type", result.contentType);
      reply.header(
        "content-disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`
      );
      reply.header("x-docomator-exported-rows", String(result.rowCount));
      return reply.send(result.content);
    }
  );

  app.get("/api/v1/admin/database/check", async (_request, reply) => {
    noStore(reply);
    return { data: registry.quickCheck() };
  });

  app.post<{ Querystring: CreatePropertyQuery; Body: CreatePropertyBody }>(
    "/api/v1/admin/database/properties",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId"],
          properties: {
            spaceId: { type: "string", minLength: 1, maxLength: 160 }
          }
        },
        body: {
          type: "object",
          required: ["label", "valueType"],
          additionalProperties: false,
          properties: {
            key: { type: "string", minLength: 1, maxLength: 160 },
            label: { type: "string", minLength: 1, maxLength: 300 },
            description: { type: "string", maxLength: 2_000 },
            valueType: { type: "string", minLength: 1, maxLength: 80 },
            unit: { type: "string", maxLength: 80 },
            cardinality: {
              type: "string",
              enum: ["single", "multiple"]
            },
            sensitivity: {
              type: "string",
              enum: ["public", "internal", "personal", "restricted"]
            },
            appliesTo: {
              type: "array",
              maxItems: 100,
              items: { type: "string", minLength: 1, maxLength: 160 }
            },
            validation: { type: "object" },
            aliases: {
              type: "array",
              maxItems: 100,
              items: { type: "string", minLength: 1, maxLength: 300 }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const record = registry.createPropertyDefinition(
        request.query.spaceId,
        request.body,
        mutationContextFromRequest(request)
      );
      noStore(reply);
      return reply.code(201).send({ data: record });
    }
  );
}
