import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  DocumentGenerationConflictError,
  DocumentGenerationRegistry,
  SpaceRegistry
} from "@docomator/storage";

import { correlationId, mutationContextFromRequest } from "./request-context.js";

interface RetryParams {
  spaceId: string;
  jobId: string;
}

interface RetryBody {
  idempotencyKey?: string;
}

const idSchema = {
  type: "string",
  minLength: 1,
  maxLength: 160
} as const;

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

export function registerDocumentGenerationRetryRoutes(
  app: FastifyInstance,
  spaces: SpaceRegistry,
  generations: DocumentGenerationRegistry
): void {
  app.post<{ Params: RetryParams; Body: RetryBody }>(
    "/api/v1/spaces/:spaceId/document-jobs/:jobId/retry-failed",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "jobId"],
          properties: {
            spaceId: idSchema,
            jobId: idSchema
          }
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            idempotencyKey: {
              type: "string",
              minLength: 1,
              maxLength: 240
            }
          }
        }
      }
    },
    async (request, reply) => {
      const original = generations.getJob(
        request.params.spaceId,
        request.params.jobId
      );
      const failedUnits = original.units.filter((unit) => unit.state === "failed");
      if (failedUnits.length === 0) {
        throw new DocumentGenerationConflictError(
          "Document generation job has no failed outputs to retry"
        );
      }

      const context = mutationContextFromRequest(request);
      let snapshotId = original.snapshotId;
      if (original.targetMode === "one_per_member") {
        const entityIds = failedUnits
          .map((unit) => unit.primaryEntityId)
          .filter((entityId): entityId is string => entityId !== null);
        if (entityIds.length === 0) {
          throw new DocumentGenerationConflictError(
            "Failed document outputs do not reference audience members"
          );
        }
        const retrySnapshot = spaces.createAudienceSnapshot(
          request.params.spaceId,
          {
            source: { kind: "selected", entityIds },
            targetMode: "one_per_member"
          },
          context
        );
        snapshotId = retrySnapshot.snapshot.id;
      }

      const result = generations.createJob(
        {
          spaceId: request.params.spaceId,
          activeReleaseId: original.activeReleaseId,
          snapshotId,
          ...(request.body.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: request.body.idempotencyKey })
        },
        context
      );
      const job = result.job;
      reply
        .code(result.created ? 201 : 200)
        .header("cache-control", "no-store");
      return responseEnvelope(request, {
        job,
        created: result.created,
        retriedFromJobId: original.id,
        retriedUnitCount: failedUnits.length,
        statusUrl: `/api/v1/spaces/${encodeURIComponent(job.spaceId)}/document-jobs/${encodeURIComponent(job.id)}`,
        downloadUrl: null
      });
    }
  );
}
