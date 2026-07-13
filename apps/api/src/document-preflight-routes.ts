import type { FastifyInstance, FastifyRequest } from "fastify";

import { DocumentPreflightRegistry } from "@docomator/storage";

import { correlationId } from "./request-context.js";

interface SpaceParams {
  spaceId: string;
}

interface PreflightBody {
  activeReleaseId: string;
  snapshotId: string;
}

const idSchema = {
  type: "string",
  minLength: 1,
  maxLength: 160
} as const;

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

export function registerDocumentPreflightRoutes(
  app: FastifyInstance,
  registry: DocumentPreflightRegistry
): void {
  app.post<{ Params: SpaceParams; Body: PreflightBody }>(
    "/api/v1/spaces/:spaceId/document-jobs/preflight",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId"],
          properties: { spaceId: idSchema }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["activeReleaseId", "snapshotId"],
          properties: {
            activeReleaseId: idSchema,
            snapshotId: idSchema
          }
        }
      }
    },
    async (request, reply) => {
      const result = registry.inspect(
        request.params.spaceId,
        request.body.activeReleaseId,
        request.body.snapshotId
      );
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, result);
    }
  );
}
