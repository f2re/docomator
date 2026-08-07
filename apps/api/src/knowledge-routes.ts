import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  DEFAULT_SPACE_ID,
  PROPERTY_UI_GROUPS,
  PROPERTY_VALUE_TYPES,
  SpaceScopedKnowledgeRegistry,
  type EntityStatus,
  type JsonValue,
  type KnowledgeRegistry,
  type PropertyCardinality,
  type PropertySensitivity
} from "@docomator/storage";

import { correlationId, mutationContextFromRequest } from "./request-context.js";

interface PaginationQuery {
  limit?: number;
}

interface PropertyDefinitionQuery extends PaginationQuery {
  spaceId?: string;
}

interface RequiredPropertyDefinitionQuery extends PaginationQuery {
  spaceId: string;
}

interface EntityListQuery extends PaginationQuery {
  entityTypeKey?: string;
  status?: EntityStatus;
}

interface PropertyValueHistoryQuery extends PaginationQuery {
  propertyKey?: string;
}

interface KeyParams {
  key: string;
}

interface EntityParams {
  entityId: string;
}

interface EntityPropertyParams extends EntityParams {
  propertyKey: string;
}

interface SpaceEntityParams extends EntityParams {
  spaceId: string;
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

interface CreateEntityBody {
  entityTypeKey: string;
  displayName: string;
  status?: EntityStatus;
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
  spaceId: string | undefined
): SpaceScopedKnowledgeRegistry {
  return SpaceScopedKnowledgeRegistry.fromRegistry(
    registry,
    spaceId ?? DEFAULT_SPACE_ID
  );
}

export function registerKnowledgeRoutes(
  app: FastifyInstance,
  registry: KnowledgeRegistry
): void {
  const defaultSpaceRegistry = propertyRegistry(registry, DEFAULT_SPACE_ID);

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

  app.get<{ Querystring: PropertyDefinitionQuery }>(
    "/api/v1/knowledge/property-definitions",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            ...paginationProperties,
            ...propertyScopeProperties
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        propertyRegistry(registry, request.query.spaceId).listPropertyDefinitions(
          request.query.limit
        )
      )
  );

  app.get<{ Params: KeyParams; Querystring: PropertyDefinitionQuery }>(
    "/api/v1/knowledge/property-definitions/:key",
    {
      schema: {
        params: {
          type: "object",
          required: ["key"],
          properties: { key: stableKeySchema }
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: propertyScopeProperties
        }
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

  // Legacy entity API is deterministic default-space compatibility only.
  // Space-aware UI and integrations must use /api/v1/spaces/:spaceId/entities.
  app.post<{ Body: CreateEntityBody }>(
    "/api/v1/knowledge/entities",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["entityTypeKey", "displayName"],
          properties: {
            entityTypeKey: stableKeySchema,
            displayName: { type: "string", minLength: 1, maxLength: 500 },
            status: { type: "string", enum: ["active", "inactive", "archived"] }
          }
        }
      }
    },
    async (request, reply) => {
      const created = defaultSpaceRegistry.createEntity(
        request.body,
        mutationContextFromRequest(request)
      );
      reply.code(201);
      return responseEnvelope(request, created);
    }
  );

  app.get<{ Querystring: EntityListQuery }>(
    "/api/v1/knowledge/entities",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            ...paginationProperties,
            entityTypeKey: stableKeySchema,
            status: { type: "string", enum: ["active", "inactive", "archived"] }
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(request, defaultSpaceRegistry.listEntities(request.query))
  );

  app.get<{ Params: EntityParams }>(
    "/api/v1/knowledge/entities/:entityId",
    {
      schema: {
        params: {
          type: "object",
          required: ["entityId"],
          properties: {
            entityId: identifierSchema
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(request, defaultSpaceRegistry.getEntity(request.params.entityId))
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

  app.put<{ Params: EntityPropertyParams; Body: AppendPropertyValueBody }>(
    "/api/v1/knowledge/entities/:entityId/properties/:propertyKey",
    {
      schema: {
        params: {
          type: "object",
          required: ["entityId", "propertyKey"],
          properties: {
            entityId: identifierSchema,
            propertyKey: stableKeySchema
          }
        },
        body: appendPropertyValueBodySchema
      }
    },
    async (request, reply) => {
      const created = defaultSpaceRegistry.appendPropertyValue(
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

  app.get<{ Params: EntityParams; Querystring: PropertyValueHistoryQuery }>(
    "/api/v1/knowledge/entities/:entityId/property-values",
    {
      schema: {
        params: {
          type: "object",
          required: ["entityId"],
          properties: {
            entityId: identifierSchema
          }
        },
        querystring: propertyHistoryQuerySchema
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        defaultSpaceRegistry.listPropertyValueHistory(
          request.params.entityId,
          request.query
        )
      )
  );
}
