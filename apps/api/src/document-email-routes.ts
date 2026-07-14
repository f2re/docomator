import type { ApiConfig } from "@docomator/config";
import {
  DocumentEmailDeliveryRegistry,
  DocumentEmailDeliveryValidationError,
  DocumentGenerationConflictError,
  DocumentGenerationRegistry,
  emailDomainAllowed,
  normalizeEmailAddress
} from "@docomator/storage";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { correlationId, mutationContextFromRequest } from "./request-context.js";

interface JobParams {
  spaceId: string;
  jobId: string;
}

interface DeliveryParams extends JobParams {
  deliveryId: string;
}

interface SendEmailBody {
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  messageText: string;
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

function deliverySource(
  job: ReturnType<DocumentGenerationRegistry["getJob"]>
): { sha256: string; fileName: string } {
  if (job.archiveSha256 !== null) {
    return {
      sha256: job.archiveSha256,
      fileName: `${safeFileName(job.templateTitle, "документы")}-комплект.zip`
    };
  }
  const output = job.units.find(
    (unit) => unit.state === "completed" && unit.outputSha256 !== null
  );
  if (output?.outputSha256 === null || output === undefined) {
    throw new DocumentGenerationConflictError(
      "Document generation output is not ready for delivery"
    );
  }
  return {
    sha256: output.outputSha256,
    fileName:
      output.outputName ??
      `${safeFileName(job.templateTitle, "документ")}.${job.format}`
  };
}

function publicConfig(config: ApiConfig) {
  return {
    enabled: config.smtp.enabled,
    fromAddress: config.smtp.fromAddress,
    fromName: config.smtp.fromName,
    allowedDomains: config.smtp.allowedDomains,
    maxAttachmentBytes: config.smtp.maxAttachmentBytes
  };
}

export function registerDocumentEmailRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  generations: DocumentGenerationRegistry,
  deliveries: DocumentEmailDeliveryRegistry
): void {
  app.get<{ Params: JobParams }>(
    "/api/v1/spaces/:spaceId/document-jobs/:jobId/email-deliveries",
    { schema: { params: jobParamsSchema } },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, {
        smtp: publicConfig(config),
        deliveries: deliveries.listForJob(
          request.params.spaceId,
          request.params.jobId
        )
      });
    }
  );

  app.get<{ Params: DeliveryParams }>(
    "/api/v1/spaces/:spaceId/document-jobs/:jobId/email-deliveries/:deliveryId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "jobId", "deliveryId"],
          properties: {
            spaceId: idSchema,
            jobId: idSchema,
            deliveryId: idSchema
          }
        }
      }
    },
    async (request, reply) => {
      const delivery = deliveries.get(
        request.params.spaceId,
        request.params.deliveryId
      );
      if (delivery.documentJobId !== request.params.jobId) {
        throw new DocumentEmailDeliveryValidationError(
          "Почтовая отправка не относится к указанному заданию."
        );
      }
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, delivery);
    }
  );

  app.post<{ Params: JobParams; Body: SendEmailBody }>(
    "/api/v1/spaces/:spaceId/document-jobs/:jobId/deliver/email",
    {
      schema: {
        params: jobParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["recipientEmail", "subject", "messageText"],
          properties: {
            recipientEmail: {
              type: "string",
              minLength: 3,
              maxLength: 254
            },
            recipientName: {
              type: "string",
              maxLength: 200
            },
            subject: {
              type: "string",
              minLength: 1,
              maxLength: 300
            },
            messageText: {
              type: "string",
              minLength: 1,
              maxLength: 20_000
            }
          }
        }
      }
    },
    async (request, reply) => {
      if (!config.smtp.enabled || config.smtp.fromAddress === null) {
        throw new DocumentEmailDeliveryValidationError(
          "Почтовая доставка не настроена администратором."
        );
      }
      const recipient = normalizeEmailAddress(
        request.body.recipientEmail,
        "recipientEmail"
      );
      if (!emailDomainAllowed(recipient, config.smtp.allowedDomains)) {
        throw new DocumentEmailDeliveryValidationError(
          `Домен получателя ${recipient.domain} не входит в список разрешённых.`
        );
      }
      const job = generations.getJob(
        request.params.spaceId,
        request.params.jobId
      );
      if (
        (job.state !== "completed" && job.state !== "partial") ||
        job.generatedCount < 1
      ) {
        throw new DocumentGenerationConflictError(
          "Document generation output is not ready for delivery"
        );
      }
      const source = deliverySource(job);
      const result = deliveries.create(
        {
          spaceId: job.spaceId,
          documentJobId: job.id,
          sourceSha256: source.sha256,
          attachmentName: source.fileName,
          recipientEmail: recipient.address,
          ...(request.body.recipientName === undefined
            ? {}
            : { recipientName: request.body.recipientName }),
          subject: request.body.subject,
          messageText: request.body.messageText,
          maxAttachmentBytes: config.smtp.maxAttachmentBytes
        },
        mutationContextFromRequest(request)
      );
      reply
        .code(result.created ? 201 : 200)
        .header("cache-control", "no-store");
      return responseEnvelope(request, {
        delivery: result.delivery,
        created: result.created,
        statusUrl: `/api/v1/spaces/${encodeURIComponent(job.spaceId)}/document-jobs/${encodeURIComponent(job.id)}/email-deliveries/${encodeURIComponent(result.delivery.id)}`
      });
    }
  );
}
