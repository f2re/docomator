import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  PROPERTY_VALUE_TYPES,
  type EmployeeRegistry,
  type EmployeeStatus
} from "@docomator/storage";

import { correlationId, mutationContextFromRequest } from "./request-context.js";

interface SpaceParams {
  spaceId: string;
}

interface EmployeeParams extends SpaceParams {
  employeeId: string;
}

interface ListEmployeesQuery {
  status?: EmployeeStatus;
  limit?: number;
}

interface NewFieldDefinitionBody {
  label: string;
  valueType: string;
  unit?: string;
}

interface CreateEmployeeFieldBody {
  propertyKey?: string;
  definition?: NewFieldDefinitionBody;
  value: unknown;
}

interface CreateEmployeeBody {
  displayName: string;
  status?: EmployeeStatus;
  fields?: CreateEmployeeFieldBody[];
  idempotencyKey?: string;
}

interface UpdateEmployeeFieldBody {
  propertyKey?: string;
  definition?: NewFieldDefinitionBody;
  value: unknown;
}

interface UpdateEmployeeBody {
  displayName?: string;
  status?: EmployeeStatus;
  fields?: UpdateEmployeeFieldBody[];
  idempotencyKey?: string;
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

const statusSchema = {
  type: "string",
  enum: ["active", "inactive", "archived"]
} as const;

const newFieldDefinitionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["label", "valueType"],
  properties: {
    label: { type: "string", minLength: 1, maxLength: 500 },
    valueType: { type: "string", enum: [...PROPERTY_VALUE_TYPES] },
    unit: { type: "string", maxLength: 80 }
  }
} as const;

const createFieldSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value"],
  properties: {
    propertyKey: stableKeySchema,
    definition: newFieldDefinitionSchema,
    value: {}
  },
  oneOf: [{ required: ["propertyKey"] }, { required: ["definition"] }]
} as const;

const updateFieldSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value"],
  properties: {
    propertyKey: stableKeySchema,
    definition: newFieldDefinitionSchema,
    value: {}
  },
  oneOf: [{ required: ["propertyKey"] }, { required: ["definition"] }]
} as const;

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

export function registerEmployeeRoutes(
  app: FastifyInstance,
  registry: EmployeeRegistry
): void {
  app.get<{ Params: SpaceParams; Querystring: ListEmployeesQuery }>(
    "/api/v1/spaces/:spaceId/employees",
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
            status: statusSchema,
            limit: { type: "integer", minimum: 1, maximum: 1_000 }
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        registry.list(request.params.spaceId, request.query)
      )
  );

  app.post<{ Params: SpaceParams; Body: CreateEmployeeBody }>(
    "/api/v1/spaces/:spaceId/employees",
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
          required: ["displayName"],
          properties: {
            displayName: { type: "string", minLength: 1, maxLength: 500 },
            status: statusSchema,
            fields: {
              type: "array",
              maxItems: 200,
              items: createFieldSchema
            },
            idempotencyKey: idSchema
          }
        }
      }
    },
    async (request, reply) => {
      const result = registry.create(
        request.params.spaceId,
        request.body,
        mutationContextFromRequest(request)
      );
      reply.code(result.created ? 201 : 200);
      return responseEnvelope(request, result.profile);
    }
  );

  app.get<{ Params: EmployeeParams }>(
    "/api/v1/spaces/:spaceId/employees/:employeeId",
    {
      schema: {
        params: {
          type: "object",
          required: ["spaceId", "employeeId"],
          properties: { spaceId: idSchema, employeeId: idSchema }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        registry.get(request.params.spaceId, request.params.employeeId)
      )
  );

  app.put<{ Params: EmployeeParams; Body: UpdateEmployeeBody }>(
    "/api/v1/spaces/:spaceId/employees/:employeeId",
    {
      schema: {
        params: {
          type: "object",
          required: ["spaceId", "employeeId"],
          properties: { spaceId: idSchema, employeeId: idSchema }
        },
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            displayName: { type: "string", minLength: 1, maxLength: 500 },
            status: statusSchema,
            fields: {
              type: "array",
              maxItems: 200,
              items: updateFieldSchema
            },
            idempotencyKey: idSchema
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        registry.update(
          request.params.spaceId,
          request.params.employeeId,
          request.body,
          mutationContextFromRequest(request)
        )
      )
  );
}
