import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  DocumentGenerationConflictError,
  DocumentGenerationValidationError,
  ObjectCleanupConflictError,
  ObjectCleanupRegistry,
  ObjectCleanupValidationError,
  cleanupCutoffFromDays
} from "@docomator/storage";

import { correlationId, mutationContextFromRequest } from "./request-context.js";

interface UsageQuery {
  minimumAgeDays?: number;
}

interface PreviewBody {
  minimumAgeDays: number;
}

interface ExecuteBody {
  cutoff: string;
  confirmationToken: string;
}

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

function cleanupOperation<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof ObjectCleanupValidationError) {
      throw new DocumentGenerationValidationError(error.message);
    }
    if (error instanceof ObjectCleanupConflictError) {
      throw new DocumentGenerationConflictError(error.message);
    }
    throw error;
  }
}

export function registerObjectCleanupRoutes(
  app: FastifyInstance,
  registry: ObjectCleanupRegistry
): void {
  app.get<{ Querystring: UsageQuery }>(
    "/api/v1/storage/usage",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            minimumAgeDays: {
              type: "integer",
              minimum: 1,
              maximum: 3_650
            }
          }
        }
      }
    },
    async (request, reply) => {
      const usage = cleanupOperation(() =>
        registry.usage(request.query.minimumAgeDays ?? 7)
      );
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, usage);
    }
  );

  app.post<{ Body: PreviewBody }>(
    "/api/v1/storage/cleanup/preview",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["minimumAgeDays"],
          properties: {
            minimumAgeDays: {
              type: "integer",
              minimum: 1,
              maximum: 3_650
            }
          }
        }
      }
    },
    async (request, reply) => {
      const cutoff = cleanupOperation(() =>
        cleanupCutoffFromDays(request.body.minimumAgeDays)
      );
      const plan = cleanupOperation(() => registry.preview(cutoff));
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, plan);
    }
  );

  app.post<{ Body: ExecuteBody }>(
    "/api/v1/storage/cleanup/execute",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["cutoff", "confirmationToken"],
          properties: {
            cutoff: {
              type: "string",
              minLength: 20,
              maxLength: 40
            },
            confirmationToken: {
              type: "string",
              pattern: "^[a-fA-F0-9]{64}$"
            }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const result = await registry.execute(
          request.body.cutoff,
          request.body.confirmationToken,
          mutationContextFromRequest(request)
        );
        reply.header("cache-control", "no-store");
        return responseEnvelope(request, result);
      } catch (error) {
        if (error instanceof ObjectCleanupValidationError) {
          throw new DocumentGenerationValidationError(error.message);
        }
        if (error instanceof ObjectCleanupConflictError) {
          throw new DocumentGenerationConflictError(error.message);
        }
        throw error;
      }
    }
  );
}
