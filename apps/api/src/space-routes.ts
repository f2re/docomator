import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  type AudienceSelectionSource,
  type DocumentTargetMode,
  type SpaceActorRole,
  type SpaceMembershipStatus,
  type SpaceRegistry,
  SpaceValidationError,
  type SpaceStatus
} from "@docomator/storage";

import { correlationId, mutationContextFromRequest } from "./request-context.js";

interface SpaceParams {
  spaceId: string;
}

interface ActorParams extends SpaceParams {
  actorId: string;
}

interface EntityParams extends SpaceParams {
  entityId: string;
}

interface GroupParams extends SpaceParams {
  groupId: string;
}

interface SnapshotParams extends SpaceParams {
  snapshotId: string;
}

interface PaginationQuery {
  limit?: number;
}

interface SpaceListQuery extends PaginationQuery {
  actorId?: string;
  status?: SpaceStatus;
}

interface SpaceEntityListQuery extends PaginationQuery {
  entityTypeKey?: string;
  status?: "active" | "inactive" | "archived";
}

interface CreateSpaceBody {
  key: string;
  name: string;
  description?: string;
}

interface UpsertActorMembershipBody {
  role: SpaceActorRole;
  status?: SpaceMembershipStatus;
}

interface CreateSpaceEntityBody {
  entityTypeKey: string;
  displayName: string;
  status?: "active" | "inactive" | "archived";
}

interface CreateGroupBody {
  key: string;
  name: string;
  description?: string;
}

interface ReplaceGroupMembersBody {
  entityIds: string[];
}

interface AudienceSourceBody {
  kind: "all_space" | "group" | "selected";
  entityTypeKey?: string;
  groupId?: string;
  entityIds?: string[];
}

interface CreateAudienceSnapshotBody {
  source: AudienceSourceBody;
  targetMode: DocumentTargetMode;
  includeInactive?: boolean;
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

const paginationProperties = {
  limit: { type: "integer", minimum: 1, maximum: 1_000 }
} as const;

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

function parseAudienceSource(source: AudienceSourceBody): AudienceSelectionSource {
  if (source.kind === "all_space") {
    return source.entityTypeKey === undefined
      ? { kind: "all_space" }
      : { kind: "all_space", entityTypeKey: source.entityTypeKey };
  }
  if (source.kind === "group") {
    if (source.groupId === undefined) {
      throw new SpaceValidationError("source.groupId is required for group selection");
    }
    return { kind: "group", groupId: source.groupId };
  }
  if (source.entityIds === undefined) {
    throw new SpaceValidationError("source.entityIds is required for selected selection");
  }
  return { kind: "selected", entityIds: source.entityIds };
}

export function registerSpaceRoutes(
  app: FastifyInstance,
  registry: SpaceRegistry
): void {
  app.post<{ Body: CreateSpaceBody }>(
    "/api/v1/spaces",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["key", "name"],
          properties: {
            key: stableKeySchema,
            name: { type: "string", minLength: 1, maxLength: 500 },
            description: { type: "string", maxLength: 2_000 }
          }
        }
      }
    },
    async (request, reply) => {
      const created = registry.createSpace(
        request.body,
        mutationContextFromRequest(request)
      );
      reply.code(201);
      return responseEnvelope(request, created);
    }
  );

  app.get<{ Querystring: SpaceListQuery }>(
    "/api/v1/spaces",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            ...paginationProperties,
            actorId: idSchema,
            status: { type: "string", enum: ["active", "archived"] }
          }
        }
      }
    },
    async (request) => responseEnvelope(request, registry.listSpaces(request.query))
  );

  app.get<{ Params: SpaceParams }>(
    "/api/v1/spaces/:spaceId",
    {
      schema: {
        params: {
          type: "object",
          required: ["spaceId"],
          properties: { spaceId: idSchema }
        }
      }
    },
    async (request) =>
      responseEnvelope(request, registry.getSpace(request.params.spaceId))
  );

  app.put<{ Params: ActorParams; Body: UpsertActorMembershipBody }>(
    "/api/v1/spaces/:spaceId/access-members/:actorId",
    {
      schema: {
        params: {
          type: "object",
          required: ["spaceId", "actorId"],
          properties: { spaceId: idSchema, actorId: idSchema }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["role"],
          properties: {
            role: {
              type: "string",
              enum: ["owner", "manager", "editor", "viewer"]
            },
            status: { type: "string", enum: ["active", "inactive"] }
          }
        }
      }
    },
    async (request) => {
      const input = {
        actorId: request.params.actorId,
        role: request.body.role,
        ...(request.body.status === undefined
          ? {}
          : { status: request.body.status })
      };
      return responseEnvelope(
        request,
        registry.upsertActorMembership(
          request.params.spaceId,
          input,
          mutationContextFromRequest(request)
        )
      );
    }
  );

  app.get<{ Params: SpaceParams }>(
    "/api/v1/spaces/:spaceId/access-members",
    {
      schema: {
        params: {
          type: "object",
          required: ["spaceId"],
          properties: { spaceId: idSchema }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        registry.listActorMemberships(request.params.spaceId)
      )
  );

  app.post<{ Params: SpaceParams; Body: CreateSpaceEntityBody }>(
    "/api/v1/spaces/:spaceId/entities",
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
          required: ["entityTypeKey", "displayName"],
          properties: {
            entityTypeKey: stableKeySchema,
            displayName: { type: "string", minLength: 1, maxLength: 500 },
            status: {
              type: "string",
              enum: ["active", "inactive", "archived"]
            }
          }
        }
      }
    },
    async (request, reply) => {
      const created = registry.createEntity(
        request.params.spaceId,
        request.body,
        mutationContextFromRequest(request)
      );
      reply.code(201);
      return responseEnvelope(request, created);
    }
  );

  app.get<{ Params: SpaceParams; Querystring: SpaceEntityListQuery }>(
    "/api/v1/spaces/:spaceId/entities",
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
          properties: {
            ...paginationProperties,
            entityTypeKey: stableKeySchema,
            status: {
              type: "string",
              enum: ["active", "inactive", "archived"]
            }
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        registry.listEntities(request.params.spaceId, request.query)
      )
  );

  app.put<{ Params: EntityParams }>(
    "/api/v1/spaces/:spaceId/entities/:entityId",
    {
      schema: {
        params: {
          type: "object",
          required: ["spaceId", "entityId"],
          properties: { spaceId: idSchema, entityId: idSchema }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        registry.assignEntity(
          request.params.spaceId,
          request.params.entityId,
          mutationContextFromRequest(request)
        )
      )
  );

  app.post<{ Params: SpaceParams; Body: CreateGroupBody }>(
    "/api/v1/spaces/:spaceId/groups",
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
          required: ["key", "name"],
          properties: {
            key: stableKeySchema,
            name: { type: "string", minLength: 1, maxLength: 500 },
            description: { type: "string", maxLength: 2_000 }
          }
        }
      }
    },
    async (request, reply) => {
      const created = registry.createGroup(
        request.params.spaceId,
        request.body,
        mutationContextFromRequest(request)
      );
      reply.code(201);
      return responseEnvelope(request, created);
    }
  );

  app.get<{ Params: SpaceParams; Querystring: PaginationQuery }>(
    "/api/v1/spaces/:spaceId/groups",
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
          properties: paginationProperties
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        registry.listGroups(request.params.spaceId, request.query.limit)
      )
  );

  app.put<{ Params: GroupParams; Body: ReplaceGroupMembersBody }>(
    "/api/v1/spaces/:spaceId/groups/:groupId/members",
    {
      schema: {
        params: {
          type: "object",
          required: ["spaceId", "groupId"],
          properties: { spaceId: idSchema, groupId: idSchema }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["entityIds"],
          properties: {
            entityIds: {
              type: "array",
              maxItems: 1_000,
              items: idSchema
            }
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        registry.replaceGroupMembers(
          request.params.spaceId,
          request.params.groupId,
          request.body.entityIds,
          mutationContextFromRequest(request)
        )
      )
  );

  app.get<{ Params: GroupParams }>(
    "/api/v1/spaces/:spaceId/groups/:groupId/members",
    {
      schema: {
        params: {
          type: "object",
          required: ["spaceId", "groupId"],
          properties: { spaceId: idSchema, groupId: idSchema }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        registry.listGroupMembers(
          request.params.spaceId,
          request.params.groupId
        )
      )
  );

  app.post<{ Params: SpaceParams; Body: CreateAudienceSnapshotBody }>(
    "/api/v1/spaces/:spaceId/audience-snapshots",
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
          required: ["source", "targetMode"],
          properties: {
            targetMode: {
              type: "string",
              enum: ["one_per_member", "aggregate"]
            },
            includeInactive: { type: "boolean" },
            source: {
              type: "object",
              additionalProperties: false,
              required: ["kind"],
              properties: {
                kind: {
                  type: "string",
                  enum: ["all_space", "group", "selected"]
                },
                entityTypeKey: stableKeySchema,
                groupId: idSchema,
                entityIds: {
                  type: "array",
                  maxItems: 1_000,
                  items: idSchema
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const input = {
        source: parseAudienceSource(request.body.source),
        targetMode: request.body.targetMode,
        ...(request.body.includeInactive === undefined
          ? {}
          : { includeInactive: request.body.includeInactive })
      };
      const result = registry.createAudienceSnapshot(
        request.params.spaceId,
        input,
        mutationContextFromRequest(request)
      );
      reply.code(201);
      return responseEnvelope(request, result);
    }
  );

  app.get<{ Params: SpaceParams; Querystring: PaginationQuery }>(
    "/api/v1/spaces/:spaceId/audience-snapshots",
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
          properties: paginationProperties
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        registry.listAudienceSnapshots(
          request.params.spaceId,
          request.query.limit
        )
      )
  );

  app.get<{ Params: SnapshotParams }>(
    "/api/v1/spaces/:spaceId/audience-snapshots/:snapshotId",
    {
      schema: {
        params: {
          type: "object",
          required: ["spaceId", "snapshotId"],
          properties: { spaceId: idSchema, snapshotId: idSchema }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        registry.getAudienceSnapshot(
          request.params.spaceId,
          request.params.snapshotId
        )
      )
  );
}
