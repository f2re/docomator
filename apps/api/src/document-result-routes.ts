import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  ContentAddressedObjectStore,
  DocumentGenerationConflictError,
  DocumentGenerationNotFoundError,
  DocumentGenerationValidationError,
  DocumentResultConflictError,
  DocumentResultNotFoundError,
  DocumentResultRegistry,
  DocumentResultValidationError,
  type DocumentResultOrigin
} from "@docomator/storage";

import { correlationId, mutationContextFromRequest } from "./request-context.js";

interface ResultParams {
  resultId: string;
}

interface ResultQuery {
  state?: "new" | "viewed" | "collected" | "available" | "all";
  origin?: DocumentResultOrigin;
  limit?: number;
}

const idSchema = {
  type: "string",
  minLength: 1,
  maxLength: 160
} as const;

const resultParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["resultId"],
  properties: { resultId: idSchema }
} as const;

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

function resultOperation<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof DocumentResultValidationError) {
      throw new DocumentGenerationValidationError(error.message);
    }
    if (error instanceof DocumentResultNotFoundError) {
      throw new DocumentGenerationNotFoundError(error.message);
    }
    if (error instanceof DocumentResultConflictError) {
      throw new DocumentGenerationConflictError(error.message);
    }
    throw error;
  }
}

function attachment(fileName: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function safeFileName(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f\u007f:*?"<>|]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[. ]+$/gu, "")
    .slice(0, 160);
  return normalized.length === 0 ? fallback : normalized;
}

function officeMediaType(format: "docx" | "xlsx"): string {
  return format === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

export function registerDocumentResultRoutes(
  app: FastifyInstance,
  objectStore: ContentAddressedObjectStore,
  registry: DocumentResultRegistry
): void {
  app.get("/api/v1/document-results/summary", async (request, reply) => {
    reply.header("cache-control", "no-store");
    return responseEnvelope(request, resultOperation(() => registry.summary()));
  });

  app.get<{ Querystring: ResultQuery }>(
    "/api/v1/document-results",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            state: {
              type: "string",
              enum: ["new", "viewed", "collected", "available", "all"]
            },
            origin: { type: "string", enum: ["manual", "schedule"] },
            limit: { type: "integer", minimum: 1, maximum: 500 }
          }
        }
      }
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const items = resultOperation(() =>
        registry.list({
          ...(request.query.state === undefined
            ? {}
            : { state: request.query.state }),
          ...(request.query.origin === undefined
            ? {}
            : { origin: request.query.origin }),
          ...(request.query.limit === undefined
            ? {}
            : { limit: request.query.limit })
        })
      );
      return responseEnvelope(request, items);
    }
  );

  app.get<{ Params: ResultParams }>(
    "/api/v1/document-results/:resultId",
    { schema: { params: resultParamsSchema } },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return responseEnvelope(
        request,
        resultOperation(() => registry.get(request.params.resultId))
      );
    }
  );

  app.post<{ Params: ResultParams }>(
    "/api/v1/document-results/:resultId/view",
    { schema: { params: resultParamsSchema } },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return responseEnvelope(
        request,
        resultOperation(() =>
          registry.markViewed(
            request.params.resultId,
            mutationContextFromRequest(request)
          )
        )
      );
    }
  );

  app.post(
    "/api/v1/document-results/view-all",
    async (request, reply) => {
      const changed = resultOperation(() =>
        registry.markAllViewed(mutationContextFromRequest(request))
      );
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, { changed });
    }
  );

  app.get<{ Params: ResultParams }>(
    "/api/v1/document-results/:resultId/download",
    { schema: { params: resultParamsSchema } },
    async (request, reply) => {
      const result = resultOperation(() => registry.get(request.params.resultId));
      const sha256 = result.archiveSha256 ?? result.singleOutputSha256;
      if (sha256 === null) {
        throw new DocumentGenerationConflictError(
          "Document result no longer contains a downloadable file"
        );
      }
      const content = await objectStore.getBuffer(sha256);
      resultOperation(() =>
        registry.markCollected(
          request.params.resultId,
          mutationContextFromRequest(request)
        )
      );
      const isArchive = result.archiveSha256 !== null;
      const fileName = isArchive
        ? `${safeFileName(result.templateTitle, "документы")}-комплект.zip`
        : result.singleOutputName ??
          `${safeFileName(result.templateTitle, "документ")}.${result.format}`;
      return reply
        .type(isArchive ? "application/zip" : officeMediaType(result.format))
        .header("cache-control", "private, no-store")
        .header("content-disposition", attachment(fileName))
        .header("x-content-type-options", "nosniff")
        .send(content);
    }
  );

  app.delete<{ Params: ResultParams }>(
    "/api/v1/document-results/:resultId",
    { schema: { params: resultParamsSchema } },
    async (request, reply) => {
      const result = resultOperation(() =>
        registry.delete(
          request.params.resultId,
          mutationContextFromRequest(request)
        )
      );
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, {
        id: result.id,
        documentJobId: result.documentJobId,
        state: result.state,
        deletedAt: result.deletedAt
      });
    }
  );
}
