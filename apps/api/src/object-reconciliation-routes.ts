import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  DocumentGenerationValidationError,
  ObjectReconciliationRegistry,
  ObjectReconciliationValidationError
} from "@docomator/storage";

import { correlationId } from "./request-context.js";

interface ReconciliationQuery {
  maxDetails?: number;
}

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

export function registerObjectReconciliationRoutes(
  app: FastifyInstance,
  registry: ObjectReconciliationRegistry
): void {
  app.get<{ Querystring: ReconciliationQuery }>(
    "/api/v1/storage/reconciliation",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            maxDetails: {
              type: "integer",
              minimum: 1,
              maximum: 1_000
            }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const report = await registry.reconcile({
          maxDetails: request.query.maxDetails ?? 200
        });
        reply.header("cache-control", "no-store");
        return responseEnvelope(request, report);
      } catch (error) {
        if (error instanceof ObjectReconciliationValidationError) {
          throw new DocumentGenerationValidationError(error.message);
        }
        throw error;
      }
    }
  );
}
