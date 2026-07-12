import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  DEFAULT_INTAKE_LIMITS,
  DocumentIntakeError,
  inspectOoxmlBuffer
} from "@docomator/document-intake";
import {
  DocumentQuarantineRegistry,
  toJsonValue
} from "@docomator/storage";

import {
  correlationId,
  mutationContextFromRequest
} from "./request-context.js";

interface InspectDocumentQuery {
  fileName: string;
}

interface SpaceParams {
  spaceId: string;
}

interface QuarantineDocumentParams extends SpaceParams {
  recordId: string;
}

interface ListDocumentsQuery {
  limit?: number;
}

const binaryContentTypes = [
  "application/octet-stream",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
];

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

const fileNameQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["fileName"],
  properties: {
    fileName: {
      type: "string",
      minLength: 1,
      maxLength: 255
    }
  }
} as const;

export function registerDocumentIntakeRoutes(
  app: FastifyInstance,
  quarantineRegistry: DocumentQuarantineRegistry
): void {
  app.addContentTypeParser(
    binaryContentTypes,
    { parseAs: "buffer" },
    (_request, body, done) => {
      done(null, body);
    }
  );

  app.post<{ Querystring: InspectDocumentQuery; Body: Buffer }>(
    "/api/v1/document-intake/inspect",
    {
      bodyLimit: DEFAULT_INTAKE_LIMITS.maxArchiveBytes,
      schema: { querystring: fileNameQuerySchema }
    },
    async (request, reply) => {
      const mediaType = request.headers["content-type"];
      const report = await inspectOoxmlBuffer({
        buffer: request.body,
        fileName: request.query.fileName,
        ...(mediaType === undefined ? {} : { mediaType })
      });
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, report);
    }
  );

  app.post<{
    Params: SpaceParams;
    Querystring: InspectDocumentQuery;
    Body: Buffer;
  }>(
    "/api/v1/spaces/:spaceId/document-sources/quarantine",
    {
      bodyLimit: DEFAULT_INTAKE_LIMITS.maxArchiveBytes,
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId"],
          properties: {
            spaceId: { type: "string", minLength: 1, maxLength: 160 }
          }
        },
        querystring: fileNameQuerySchema
      }
    },
    async (request, reply) => {
      const mediaType = request.headers["content-type"];
      const report = await inspectOoxmlBuffer({
        buffer: request.body,
        fileName: request.query.fileName,
        ...(mediaType === undefined ? {} : { mediaType })
      });
      if (report.decision === "rejected") {
        throw new DocumentIntakeError(
          "document_rejected",
          422,
          "Файл нельзя сохранить: сначала устраните блокирующие замечания проверки."
        );
      }

      const record = await quarantineRegistry.saveAcceptedDocument(
        {
          spaceId: request.params.spaceId,
          fileName: report.fileName,
          mediaType: report.mediaType,
          format: report.format,
          decision: report.decision,
          buffer: request.body,
          report: toJsonValue(report),
          expectedSha256: report.sha256
        },
        mutationContextFromRequest(request)
      );
      reply.code(201).header("cache-control", "no-store");
      return responseEnvelope(request, record);
    }
  );

  app.get<{ Params: SpaceParams; Querystring: ListDocumentsQuery }>(
    "/api/v1/spaces/:spaceId/document-sources",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId"],
          properties: {
            spaceId: { type: "string", minLength: 1, maxLength: 160 }
          }
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 500 }
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        quarantineRegistry.listDocuments(request.params.spaceId, {
          ...(request.query.limit === undefined
            ? {}
            : { limit: request.query.limit })
        })
      )
  );

  app.get<{ Params: QuarantineDocumentParams }>(
    "/api/v1/spaces/:spaceId/document-sources/:recordId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "recordId"],
          properties: {
            spaceId: { type: "string", minLength: 1, maxLength: 160 },
            recordId: { type: "string", minLength: 1, maxLength: 160 }
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        quarantineRegistry.getDocument(
          request.params.spaceId,
          request.params.recordId
        )
      )
  );
}
