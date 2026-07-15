import type { ApiConfig } from "@docomator/config";
import {
  EmailRecipientRegistry,
  EmailRecipientValidationError,
  emailDomainAllowed,
  normalizeEmailAddress,
  type EmailRecipientStatus
} from "@docomator/storage";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { correlationId, mutationContextFromRequest } from "./request-context.js";

interface SpaceParams {
  spaceId: string;
}

interface RecipientParams extends SpaceParams {
  recipientId: string;
}

interface RecipientListQuery {
  includeInactive?: boolean;
}

interface CreateRecipientBody {
  key?: string;
  name: string;
  email: string;
  description?: string;
}

interface UpdateRecipientBody {
  name?: string;
  email?: string;
  description?: string | null;
  status?: EmailRecipientStatus;
}

const idSchema = {
  type: "string",
  minLength: 1,
  maxLength: 160
} as const;

const stableKeySchema = {
  type: "string",
  minLength: 1,
  maxLength: 160,
  pattern: "^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$"
} as const;

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

function requireAllowedEmail(config: ApiConfig, emailValue: string): string {
  if (!config.smtp.enabled) {
    throw new EmailRecipientValidationError(
      "Почтовая доставка не настроена администратором."
    );
  }
  const email = normalizeEmailAddress(emailValue);
  if (!emailDomainAllowed(email, config.smtp.allowedDomains)) {
    throw new EmailRecipientValidationError(
      `Домен ${email.domain} не входит в список разрешённых получателей.`
    );
  }
  return email.address;
}

export function registerEmailRecipientRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  registry: EmailRecipientRegistry
): void {
  app.get<{ Params: SpaceParams; Querystring: RecipientListQuery }>(
    "/api/v1/spaces/:spaceId/email-recipients",
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
          properties: { includeInactive: { type: "boolean" } }
        }
      }
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return responseEnvelope(
        request,
        registry.list(
          request.params.spaceId,
          request.query.includeInactive ?? false
        )
      );
    }
  );

  app.post<{ Params: SpaceParams; Body: CreateRecipientBody }>(
    "/api/v1/spaces/:spaceId/email-recipients",
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
          required: ["name", "email"],
          properties: {
            key: stableKeySchema,
            name: { type: "string", minLength: 1, maxLength: 200 },
            email: { type: "string", minLength: 3, maxLength: 254 },
            description: { type: "string", maxLength: 2_000 }
          }
        }
      }
    },
    async (request, reply) => {
      const email = requireAllowedEmail(config, request.body.email);
      const created = registry.create(
        request.params.spaceId,
        { ...request.body, email },
        mutationContextFromRequest(request)
      );
      reply.code(201).header("cache-control", "no-store");
      return responseEnvelope(request, created);
    }
  );

  app.get<{ Params: RecipientParams }>(
    "/api/v1/spaces/:spaceId/email-recipients/:recipientId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "recipientId"],
          properties: { spaceId: idSchema, recipientId: idSchema }
        }
      }
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return responseEnvelope(
        request,
        registry.get(request.params.spaceId, request.params.recipientId)
      );
    }
  );

  app.put<{ Params: RecipientParams; Body: UpdateRecipientBody }>(
    "/api/v1/spaces/:spaceId/email-recipients/:recipientId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "recipientId"],
          properties: { spaceId: idSchema, recipientId: idSchema }
        },
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 200 },
            email: { type: "string", minLength: 3, maxLength: 254 },
            description: {
              anyOf: [
                { type: "string", maxLength: 2_000 },
                { type: "null" }
              ]
            },
            status: { type: "string", enum: ["active", "inactive"] }
          }
        }
      }
    },
    async (request, reply) => {
      const input = {
        ...request.body,
        ...(request.body.email === undefined
          ? {}
          : { email: requireAllowedEmail(config, request.body.email) })
      };
      const updated = registry.update(
        request.params.spaceId,
        request.params.recipientId,
        input,
        mutationContextFromRequest(request)
      );
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, updated);
    }
  );
}
