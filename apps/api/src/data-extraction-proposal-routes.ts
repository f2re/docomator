import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  DEFAULT_INTAKE_LIMITS,
  analyzeOoxmlBuffer
} from "@docomator/document-intake";

import { proposeDataExtraction } from "./data-extraction-proposal.js";
import { correlationId } from "./request-context.js";

interface ProposalQuery {
  fileName: string;
  limit?: number;
}

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

export function registerDataExtractionProposalRoutes(app: FastifyInstance): void {
  app.post<{ Querystring: ProposalQuery; Body: Buffer }>(
    "/api/v1/data-extraction/propose",
    {
      bodyLimit: DEFAULT_INTAKE_LIMITS.maxArchiveBytes,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["fileName"],
          properties: {
            fileName: { type: "string", minLength: 1, maxLength: 255 },
            limit: {
              type: "integer",
              minimum: 10,
              maximum: 2_000,
              default: 2_000
            }
          }
        }
      }
    },
    async (request, reply) => {
      const mediaType = request.headers["content-type"];
      const structure = await analyzeOoxmlBuffer({
        buffer: request.body,
        fileName: request.query.fileName,
        maxElements: request.query.limit ?? 2_000,
        ...(mediaType === undefined ? {} : { mediaType })
      });
      const proposal = proposeDataExtraction(structure);
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, { structure, proposal });
    }
  );
}
