import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  DEFAULT_INTAKE_LIMITS,
  analyzeOoxmlBuffer,
  inspectOoxmlBuffer
} from "@docomator/document-intake";

import { correlationId } from "./request-context.js";

interface InspectDocumentQuery {
  fileName: string;
}

interface AnalyzeDocumentQuery extends InspectDocumentQuery {
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

const fileNameProperty = {
  type: "string",
  minLength: 1,
  maxLength: 255
} as const;

export function registerDocumentIntakeRoutes(app: FastifyInstance): void {
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
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["fileName"],
          properties: { fileName: fileNameProperty }
        }
      }
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

  app.post<{ Querystring: AnalyzeDocumentQuery; Body: Buffer }>(
    "/api/v1/document-intake/analyze",
    {
      bodyLimit: DEFAULT_INTAKE_LIMITS.maxArchiveBytes,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["fileName"],
          properties: {
            fileName: fileNameProperty,
            limit: { type: "integer", minimum: 10, maximum: 2_000 }
          }
        }
      }
    },
    async (request, reply) => {
      const mediaType = request.headers["content-type"];
      const analysis = await analyzeOoxmlBuffer({
        buffer: request.body,
        fileName: request.query.fileName,
        ...(mediaType === undefined ? {} : { mediaType }),
        ...(request.query.limit === undefined
          ? {}
          : { maxElements: request.query.limit })
      });
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, analysis);
    }
  );
}
