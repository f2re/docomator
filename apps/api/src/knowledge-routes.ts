import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  PROPERTY_UI_GROUPS,
  PROPERTY_VALUE_TYPES,
  SpaceScopedKnowledgeRegistry,
  type JsonValue,
  type KnowledgeRegistry,
  type PropertyCardinality,
  type PropertySensitivity
} from "@docomator/storage";

import { correlationId, mutationContextFromRequest } from "./request-context.js";

interface PaginationQuery {
  limit?: number;
}

interface RequiredPropertyDefinitionQuery extends PaginationQuery {
  spaceId: string;
}

interface PropertyValueHistoryQuery extends PaginationQuery {
  propertyKey?: string;
}

interface KeyParams {
  key: string;
}

interface SpaceEntityParams {
  spaceId: string;
  entityId: string;
}

interface SpaceEntityPropertyParams extends SpaceEntityParams {
  propertyKey: string;
}

interface CreateEntityTypeBody {
  key?: string;
  label: string;
  description?: string;
  schema?: { [key: string]: JsonValue };
}

interface CreatePropertyDefinitionBody {
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

interface UpdatePropertyUiGroupBody {
  uiGroup: string;
}

interface AppendPropertyValueBody {
  value: unknown;
  sourceType: string;
  sourceId?: string;
  confidence?: number;
  confirmedBy?: string;
  validFrom?: string;
  validTo?: string;
}

const stableKeySchema = {
  type: "string",
  minLength: 1,
  maxLength: 160,
  pattern: "^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$"
} as const;

const identifierSchema = {
  type: "string",
  minLength: 1,
  maxLength: 160
} as const;

const paginationProperties = {
  limit: { type: "integer", minimum: 1, maximum: 500 }
} as const;

const propertyScopeProperties = {
  spaceId: identifierSchema
} as const;

const requiredPropertyScopeQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["spaceId"],
  properties: propertyScopeProperties
} as const;

const requiredPropertyListQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["spaceId"],
  properties: {
    ...paginationProperties,
    ...propertyScopeProperties
  }
} as const;

const appendPropertyValueBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["value", "sourceType"],
  properties: {
    value: {},
    sourceType: { type: "string", minLength: 1, maxLength: 80 },
    sourceId: { type: "string", maxLength: 160 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    confirmedBy: { type: "string", maxLength: 160 },
    validFrom: { type: "string", minLength: 1, maxLength: 64 },
    validTo: { type: "string", minLength: 1, maxLength: 64 }
  }
} as const;

const propertyHistoryQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ...paginationProperties,
    propertyKey: stableKeySchema
  }
} as const;

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

function propertyRegistry(
  registry: KnowledgeRegistry,
  spaceId: string
): SpaceScopedKnowledgeRegistry {
  return SpaceScopedKnowledgeRegistry.fromRegistry(registry, spaceId);
}

export function registerKnowledgeRoutes(
  app: FastifyInstance,
  registry: KnowledgeRegistry
): void {
  app.post<{ Body: CreateEntityTypeBody }>(
    "/api/v1/knowledge/entity-types",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["label"],
          properties: {
            key: stableKeySchema,
            label: { type: "string", minLength: 1, maxLength: 500 },
            description: { type: "string", maxLength: 2_000 },
            schema: { type: "object", additionalProperties: true }
          }
        }
      }
    },
    async (request, reply) => {
      const created = registry.createEntityType(
        request.body,
        mutationContextFromRequest(request)
      );
      reply.code(201);
      return responseEnvelope(request, created);
    }
  );

  app.get<{ Querystring: PaginationQuery }>(
    "/api/v1/knowledge/entity-types",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: paginationProperties
        }
      }
    },
    async (request) =>
      responseEnvelope(request, registry.listEntityTypes(request.query.limit))
  );

  app.get<{ Params: KeyParams }>(
    "/api/v1/knowledge/entity-types/:key",
    {
      schema: {
        params: {
          type: "object",
          required: ["key"],
          properties: { key: stableKeySchema }
        }
      }
    },
    async (request) =>
      responseEnvelope(request, registry.getEntityType(request.params.key))
  );

  app.post<{
    Querystring: RequiredPropertyDefinitionQuery;
    Body: CreatePropertyDefinitionBody;
  }>(
    "/api/v1/knowledge/property-definitions",
    {
      schema: {
        querystring: requiredPropertyScopeQuerySchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["label", "valueType"],
          properties: {
            key: stableKeySchema,
            label: { type: "string", minLength: 1, maxLength: 500 },
            description: { type: "string", maxLength: 2_000 },
            valueType: { type: "string", enum: [...PROPERTY_VALUE_TYPES] },
            unit: { type: "string", maxLength: 80 },
            cardinality: { type: "string", enum: ["single", "multiple"] },
            sensitivity: {
              type: "string",
              enum: ["public", "internal", "personal", "restricted"]
            },
            appliesTo: {
              type: "array",
              maxItems: 100,
              uniqueItems: true,
              items: stableKeySchema
            },
            validation: { type: "object", additionalProperties: true },
            aliases: {
              type: "array",
              maxItems: 100,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 160 }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const created = propertyRegistry(
        registry,
        request.query.spaceId
      ).createPropertyDefinition(
        request.body,
        mutationContextFromRequest(request)
      );
      reply.code(201);
      return responseEnvelope(request, created);
    }
  );

  app.get<{ Querystring: RequiredPropertyDefinitionQuery }>(
    "/api/v1/knowledge/property-definitions",
    { schema: { querystring: requiredPropertyListQuerySchema } },
    async (request) =>
      responseEnvelope(
        request,
        propertyRegistry(registry, request.query.spaceId).listPropertyDefinitions(
          request.query.limit
        )
      )
  );

  app.get<{ Params: KeyParams; Querystring: RequiredPropertyDefinitionQuery }>(
    "/api/v1/knowledge/property-definitions/:key",
    {
      schema: {
        params: {
          type: "object",
          required: ["key"],
          properties: { key: stableKeySchema }
        },
        querystring: requiredPropertyScopeQuerySchema
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        propertyRegistry(registry, request.query.spaceId).getPropertyDefinition(
          request.params.key
        )
      )
  );

  app.put<{
    Params: KeyParams;
    Querystring: RequiredPropertyDefinitionQuery;
    Body: UpdatePropertyUiGroupBody;
  }>(
    "/api/v1/knowledge/property-definitions/:key/group",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["key"],
          properties: { key: stableKeySchema }
        },
        querystring: requiredPropertyScopeQuerySchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["uiGroup"],
          properties: {
            uiGroup: { type: "string", enum: [...PROPERTY_UI_GROUPS] }
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        propertyRegistry(registry, request.query.spaceId).updatePropertyDefinitionUiGroup(
          request.params.key,
          request.body.uiGroup,
          mutationContextFromRequest(request)
        )
      )
  );

  app.put<{ Params: SpaceEntityPropertyParams; Body: AppendPropertyValueBody }>(
    "/api/v1/spaces/:spaceId/entities/:entityId/properties/:propertyKey",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "entityId", "propertyKey"],
          properties: {
            spaceId: identifierSchema,
            entityId: identifierSchema,
            propertyKey: stableKeySchema
          }
        },
        body: appendPropertyValueBodySchema
      }
    },
    async (request, reply) => {
      const created = propertyRegistry(
        registry,
        request.params.spaceId
      ).appendPropertyValue(
        {
          entityId: request.params.entityId,
          propertyKey: request.params.propertyKey,
          ...request.body
        },
        mutationContextFromRequest(request)
      );
      reply.code(201);
      return responseEnvelope(request, created);
    }
  );

  app.get<{
    Params: SpaceEntityParams;
    Querystring: PropertyValueHistoryQuery;
  }>(
    "/api/v1/spaces/:spaceId/entities/:entityId/property-values",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "entityId"],
          properties: {
            spaceId: identifierSchema,
            entityId: identifierSchema
          }
        },
        querystring: propertyHistoryQuerySchema
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        propertyRegistry(
          registry,
          request.params.spaceId
        ).listPropertyValueHistory(request.params.entityId, request.query)
      )
  );
}
