import type { FastifyInstance, FastifyRequest } from "fastify";

import { OperationCenterRegistry } from "@docomator/storage";

import { correlationId } from "./request-context.js";
import { toUserMessage } from "./user-message.js";

interface SpaceParams {
  spaceId: string;
}

interface ListQuery {
  limit?: number;
}

const idSchema = {
  type: "string",
  minLength: 1,
  maxLength: 160
} as const;

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

function storedErrorMessage(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return toUserMessage(new Error(value));
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string" &&
    value.message.trim().length > 0
  ) {
    return toUserMessage(new Error(value.message));
  }
  return null;
}

function operationPayload(
  operation: ReturnType<OperationCenterRegistry["list"]>[number]
) {
  const { error, ...publicOperation } = operation;
  return {
    ...publicOperation,
    failureReason:
      operation.state === "failed"
        ? storedErrorMessage(error) ??
          "Операция завершилась с ошибкой. Откройте исходный раздел и повторите действие."
        : null
  };
}

export function registerOperationCenterRoutes(
  app: FastifyInstance,
  registry: OperationCenterRegistry
): void {
  app.get<{ Params: SpaceParams; Querystring: ListQuery }>(
    "/api/v1/spaces/:spaceId/operations",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId"],
          properties: { spaceId: idSchema }
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 50
            }
          }
        }
      }
    },
    async (request, reply) => {
      const operations = registry.list(
        request.params.spaceId,
        request.query.limit ?? 50
      );
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, operations.map(operationPayload));
    }
  );
}
