import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  DEFAULT_INTAKE_LIMITS,
  inspectOoxmlBuffer
} from "@docomator/document-intake";

import { correlationId } from "./request-context.js";

interface InspectDocumentQuery {
  fileName: string;
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
          properties: {
            fileName: {
              type: "string",
              minLength: 1,
              maxLength: 255
            }
          }
        }
      }
    },
    async (request, reply) => {
      const report = await inspectOoxmlBuffer({
        buffer: request.body,
        fileName: request.query.fileName,
        mediaType: request.headers["content-type"]
      });
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, report);
    }
  );
}
