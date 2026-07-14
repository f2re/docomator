import type { ApiConfig } from "@docomator/config";
import {
  DocumentScheduleRegistry,
  DocumentScheduleValidationError,
  type DocumentGenerationMode,
  type DocumentScheduleDelivery,
  type DocumentScheduleRecurrence,
  type DocumentScheduleStatus
} from "@docomator/storage";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { correlationId, mutationContextFromRequest } from "./request-context.js";

interface SpaceParams {
  spaceId: string;
}

interface ScheduleParams extends SpaceParams {
  scheduleId: string;
}

interface CreateScheduleBody {
  key: string;
  name: string;
  description?: string;
  activeReleaseId: string;
  groupId: string;
  targetMode: DocumentGenerationMode;
  recurrenceKind: DocumentScheduleRecurrence;
  timezone: string;
  localTime: string;
  startDate: string;
  dayOfMonth?: number;
  deliveryChannel: DocumentScheduleDelivery;
  emailRecipientId?: string;
  emailSubject?: string;
  emailMessageText?: string;
}

interface UpdateStatusBody {
  status: DocumentScheduleStatus;
}

interface RunListQuery {
  limit?: number;
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

const scheduleParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["spaceId", "scheduleId"],
  properties: { spaceId: idSchema, scheduleId: idSchema }
} as const;

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

export function registerDocumentScheduleRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  registry: DocumentScheduleRegistry
): void {
  app.get<{ Params: SpaceParams }>(
    "/api/v1/spaces/:spaceId/document-schedules",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId"],
          properties: { spaceId: idSchema }
        }
      }
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, registry.list(request.params.spaceId));
    }
  );

  app.post<{ Params: SpaceParams; Body: CreateScheduleBody }>(
    "/api/v1/spaces/:spaceId/document-schedules",
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
          required: [
            "key",
            "name",
            "activeReleaseId",
            "groupId",
            "targetMode",
            "recurrenceKind",
            "timezone",
            "localTime",
            "startDate",
            "deliveryChannel"
          ],
          properties: {
            key: stableKeySchema,
            name: { type: "string", minLength: 1, maxLength: 300 },
            description: { type: "string", maxLength: 2_000 },
            activeReleaseId: idSchema,
            groupId: idSchema,
            targetMode: {
              type: "string",
              enum: ["one_per_member", "aggregate"]
            },
            recurrenceKind: {
              type: "string",
              enum: ["once", "daily", "monthly"]
            },
            timezone: { type: "string", minLength: 1, maxLength: 100 },
            localTime: {
              type: "string",
              pattern: "^\\d{2}:\\d{2}$"
            },
            startDate: {
              type: "string",
              pattern: "^\\d{4}-\\d{2}-\\d{2}$"
            },
            dayOfMonth: { type: "integer", minimum: 1, maximum: 28 },
            deliveryChannel: { type: "string", enum: ["none", "email"] },
            emailRecipientId: idSchema,
            emailSubject: { type: "string", maxLength: 300 },
            emailMessageText: { type: "string", maxLength: 20_000 }
          }
        }
      }
    },
    async (request, reply) => {
      if (request.body.deliveryChannel === "email" && !config.smtp.enabled) {
        throw new DocumentScheduleValidationError(
          "SMTP отключён; выберите расписание без доставки или настройте почтовый канал."
        );
      }
      const created = registry.create(
        request.params.spaceId,
        request.body,
        mutationContextFromRequest(request)
      );
      reply.code(201).header("cache-control", "no-store");
      return responseEnvelope(request, created);
    }
  );

  app.get<{ Params: ScheduleParams }>(
    "/api/v1/spaces/:spaceId/document-schedules/:scheduleId",
    { schema: { params: scheduleParamsSchema } },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return responseEnvelope(
        request,
        registry.get(request.params.spaceId, request.params.scheduleId)
      );
    }
  );

  app.put<{ Params: ScheduleParams; Body: UpdateStatusBody }>(
    "/api/v1/spaces/:spaceId/document-schedules/:scheduleId/status",
    {
      schema: {
        params: scheduleParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["active", "inactive"] }
          }
        }
      }
    },
    async (request, reply) => {
      const updated = registry.setStatus(
        request.params.spaceId,
        request.params.scheduleId,
        request.body.status,
        mutationContextFromRequest(request)
      );
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, updated);
    }
  );

  app.post<{ Params: ScheduleParams }>(
    "/api/v1/spaces/:spaceId/document-schedules/:scheduleId/run-now",
    { schema: { params: scheduleParamsSchema } },
    async (request, reply) => {
      const run = registry.requestRunNow(
        request.params.spaceId,
        request.params.scheduleId,
        mutationContextFromRequest(request)
      );
      reply.code(201).header("cache-control", "no-store");
      return responseEnvelope(request, run);
    }
  );

  app.get<{ Params: ScheduleParams; Querystring: RunListQuery }>(
    "/api/v1/spaces/:spaceId/document-schedules/:scheduleId/runs",
    {
      schema: {
        params: scheduleParamsSchema,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 200 }
          }
        }
      }
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return responseEnvelope(
        request,
        registry.listRuns(
          request.params.spaceId,
          request.params.scheduleId,
          request.query.limit ?? 50
        )
      );
    }
  );
}
