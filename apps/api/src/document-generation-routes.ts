import { loadApiConfig } from "@docomator/config";
import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  ContentAddressedObjectStore,
  DocumentGenerationConflictError,
  DocumentGenerationRegistry,
  type DocumentResultRecord,
  documentResultRegistryFromGenerationRegistry,
  objectCleanupRegistryFromGenerationRegistry,
  runtimeStatusRegistryFromGenerationRegistry,
  sqliteStoreFromGenerationRegistry
} from "@docomator/storage";

import { registerDocumentResultRoutes } from "./document-result-routes.js";
import { registerObjectCleanupRoutes } from "./object-cleanup-routes.js";
import { registerOperationsReadinessRoutes } from "./operations-readiness-routes.js";
import { correlationId, mutationContextFromRequest } from "./request-context.js";

interface SpaceParams {
  spaceId: string;
}

interface JobParams extends SpaceParams {
  jobId: string;
}

interface UnitParams extends JobParams {
  unitId: string;
}

interface CreateJobBody {
  activeReleaseId: string;
  snapshotId: string;
  idempotencyKey?: string;
}

interface ListQuery {
  limit?: number;
}

const idSchema = {
  type: "string",
  minLength: 1,
  maxLength: 160
} as const;

const jobParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["spaceId", "jobId"],
  properties: {
    spaceId: idSchema,
    jobId: idSchema
  }
} as const;

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

function attachment(fileName: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function officeMediaType(format: "docx" | "xlsx"): string {
  return format === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function jobPayload(
  job: ReturnType<DocumentGenerationRegistry["getJob"]>,
  result: DocumentResultRecord | null
) {
  const resultUrl =
    result === null
      ? null
      : `/api/v1/document-results/${encodeURIComponent(result.id)}`;
  return {
    job,
    resultId: result?.id ?? null,
    resultUrl,
    statusUrl: `/api/v1/spaces/${encodeURIComponent(job.spaceId)}/document-jobs/${encodeURIComponent(job.id)}`,
    downloadUrl: resultUrl === null ? null : `${resultUrl}/download`
  };
}

export function registerDocumentGenerationRoutes(
  app: FastifyInstance,
  objectStore: ContentAddressedObjectStore,
  registry: DocumentGenerationRegistry
): void {
  const resultRegistry = documentResultRegistryFromGenerationRegistry(registry);
  registerDocumentResultRoutes(
    app,
    objectStore,
    resultRegistry
  );
  registerObjectCleanupRoutes(
    app,
    objectCleanupRegistryFromGenerationRegistry(registry, objectStore)
  );
  const operationalConfig = loadApiConfig();
  registerOperationsReadinessRoutes(
    app,
    {
      ...operationalConfig,
      dataDir: objectStore.root.replace(/[\\/]objects$/u, "")
    },
    sqliteStoreFromGenerationRegistry(registry),
    objectStore,
    runtimeStatusRegistryFromGenerationRegistry(registry)
  );

  app.post<{ Params: SpaceParams; Body: CreateJobBody }>(
    "/api/v1/spaces/:spaceId/document-jobs",
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
            snapshotId: idSchema,
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
      const result = registry.createJob(
        {
          spaceId: request.params.spaceId,
          activeReleaseId: request.body.activeReleaseId,
          snapshotId: request.body.snapshotId,
          ...(request.body.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: request.body.idempotencyKey })
        },
        mutationContextFromRequest(request)
      );
      reply
        .code(result.created ? 201 : 200)
        .header("cache-control", "no-store");
      const documentResult = resultRegistry.findByDocumentJob(
        result.job.spaceId,
        result.job.id
      );
      return responseEnvelope(request, {
        ...jobPayload(result.job, documentResult),
        created: result.created
      });
    }
  );

  app.get<{ Params: SpaceParams; Querystring: ListQuery }>(
    "/api/v1/spaces/:spaceId/document-jobs",
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
            limit: { type: "integer", minimum: 1, maximum: 200 }
          }
        }
      }
    },
    async (request) => {
      const jobs = registry.listJobs(
        request.params.spaceId,
        request.query.limit ?? 50
      );
      const results = resultRegistry.findByDocumentJobs(
        request.params.spaceId,
        jobs.map((job) => job.id)
      );
      return responseEnvelope(
        request,
        jobs.map((job) => jobPayload(job, results.get(job.id) ?? null))
      );
    }
  );

  app.get<{ Params: JobParams }>(
    "/api/v1/spaces/:spaceId/document-jobs/:jobId",
    { schema: { params: jobParamsSchema } },
    async (request, reply) => {
      const job = registry.getJob(request.params.spaceId, request.params.jobId);
      const result = resultRegistry.findByDocumentJob(job.spaceId, job.id);
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, jobPayload(job, result));
    }
  );

  app.get<{ Params: JobParams }>(
    "/api/v1/spaces/:spaceId/document-jobs/:jobId/download",
    { schema: { params: jobParamsSchema } },
    async (request, reply) => {
      const job = registry.getJob(request.params.spaceId, request.params.jobId);
      if (
        (job.state !== "completed" && job.state !== "partial") ||
        job.generatedCount < 1
      ) {
        throw new DocumentGenerationConflictError(
          "Document generation output is not ready"
        );
      }
      const result = resultRegistry.findByDocumentJob(job.spaceId, job.id);
      if (result === null) {
        throw new DocumentGenerationConflictError(
          "Document generation result is no longer available"
        );
      }
      return reply
        .code(307)
        .header("cache-control", "private, no-store")
        .header(
          "location",
          `/api/v1/document-results/${encodeURIComponent(result.id)}/download`
        )
        .send();
    }
  );

  app.get<{ Params: UnitParams }>(
    "/api/v1/spaces/:spaceId/document-jobs/:jobId/outputs/:unitId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "jobId", "unitId"],
          properties: {
            spaceId: idSchema,
            jobId: idSchema,
            unitId: idSchema
          }
        }
      }
    },
    async (request, reply) => {
      const job = registry.getJob(request.params.spaceId, request.params.jobId);
      const unit = job.units.find(
        (candidate) => candidate.id === request.params.unitId
      );
      if (
        unit === undefined ||
        unit.state !== "completed" ||
        unit.outputSha256 === null
      ) {
        throw new DocumentGenerationConflictError(
          "Document generation output file is not ready"
        );
      }
      const content = await objectStore.getBuffer(unit.outputSha256);
      const result = resultRegistry.findByDocumentJob(job.spaceId, job.id);
      if (result === null) {
        throw new DocumentGenerationConflictError(
          "Document generation result is no longer available"
        );
      }
      resultRegistry.markCollected(
        result.id,
        mutationContextFromRequest(request),
        { kind: "unit", unitId: unit.id }
      );
      return reply
        .type(officeMediaType(job.format))
        .header("cache-control", "private, no-store")
        .header(
          "content-disposition",
          attachment(unit.outputName ?? `документ.${job.format}`)
        )
        .header("x-content-type-options", "nosniff")
        .send(content);
    }
  );
}
