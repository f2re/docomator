import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  ContentAddressedObjectStore,
  DocumentGenerationConflictError,
  DocumentGenerationRegistry
} from "@docomator/storage";

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

function jobPayload(job: ReturnType<DocumentGenerationRegistry["getJob"]>) {
  const ready = job.state === "completed" || job.state === "partial";
  return {
    job,
    statusUrl: `/api/v1/spaces/${encodeURIComponent(job.spaceId)}/document-jobs/${encodeURIComponent(job.id)}`,
    downloadUrl:
      ready && job.generatedCount > 0
        ? `/api/v1/spaces/${encodeURIComponent(job.spaceId)}/document-jobs/${encodeURIComponent(job.id)}/download`
        : null
  };
}

export function registerDocumentGenerationRoutes(
  app: FastifyInstance,
  objectStore: ContentAddressedObjectStore,
  registry: DocumentGenerationRegistry
): void {
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
      return responseEnvelope(request, {
        ...jobPayload(result.job),
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
    async (request) =>
      responseEnvelope(
        request,
        registry
          .listJobs(request.params.spaceId, request.query.limit ?? 50)
          .map(jobPayload)
      )
  );

  app.get<{ Params: JobParams }>(
    "/api/v1/spaces/:spaceId/document-jobs/:jobId",
    { schema: { params: jobParamsSchema } },
    async (request, reply) => {
      const job = registry.getJob(request.params.spaceId, request.params.jobId);
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, jobPayload(job));
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
      if (job.archiveSha256 !== null) {
        const content = await objectStore.getBuffer(job.archiveSha256);
        return reply
          .type("application/zip")
          .header("cache-control", "private, no-store")
          .header(
            "content-disposition",
            attachment(`комплект-${job.templateTitle}.zip`)
          )
          .header("x-content-type-options", "nosniff")
          .send(content);
      }
      const unit = job.units.find(
        (candidate) =>
          candidate.state === "completed" && candidate.outputSha256 !== null
      );
      if (unit?.outputSha256 === null || unit === undefined) {
        throw new DocumentGenerationConflictError(
          "Document generation output file was not found"
        );
      }
      const content = await objectStore.getBuffer(unit.outputSha256);
      return reply
        .type(officeMediaType(job.format))
        .header("cache-control", "private, no-store")
        .header(
          "content-disposition",
          attachment(
            unit.outputName ?? `${job.templateTitle}.${job.format}`
          )
        )
        .header("x-content-type-options", "nosniff")
        .send(content);
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
