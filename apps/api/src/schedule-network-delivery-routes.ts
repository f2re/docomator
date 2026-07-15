import type { ApiConfig } from "@docomator/config";
import {
  DocumentScheduleNotFoundError,
  DocumentScheduleRegistry,
  DocumentScheduleValidationError,
  ScheduleNetworkDeliveryNotFoundError,
  ScheduleNetworkDeliveryRegistry,
  ScheduleNetworkDeliveryValidationError,
  normalizeScheduleNetworkTemplate,
  type DocumentGenerationMode,
  type DocumentScheduleRecurrence
} from "@docomator/storage";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { correlationId, mutationContextFromRequest } from "./request-context.js";

interface SpaceParams {
  spaceId: string;
}

interface CreateNetworkScheduleBody {
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
  deliveryChannel: "network_folder";
  networkSubdirectory: string;
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

function networkOperation<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof ScheduleNetworkDeliveryValidationError) {
      throw new DocumentScheduleValidationError(error.message);
    }
    if (error instanceof ScheduleNetworkDeliveryNotFoundError) {
      throw new DocumentScheduleNotFoundError(error.message);
    }
    throw error;
  }
}

function decorateSchedule(
  schedule: ReturnType<DocumentScheduleRegistry["get"]>,
  network: ReturnType<ScheduleNetworkDeliveryRegistry["get"]>
) {
  return network === null
    ? { ...schedule, networkSubdirectory: null }
    : {
        ...schedule,
        deliveryChannel: "network_folder" as const,
        networkSubdirectory: network.subdirectoryTemplate
      };
}

export function registerScheduleNetworkDeliveryRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  schedules: DocumentScheduleRegistry,
  network: ScheduleNetworkDeliveryRegistry
): void {
  app.get<{ Params: SpaceParams }>(
    "/api/v1/spaces/:spaceId/document-schedule-network-settings",
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
      const items = schedules.list(request.params.spaceId);
      const settings = networkOperation(() =>
        network.listForSchedules(items.map((item) => item.id))
      );
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, {
        networkFolderEnabled: config.networkDeliveryRoot !== null,
        items: items
          .filter((item) => settings.has(item.id))
          .map((item) => decorateSchedule(item, settings.get(item.id) ?? null))
      });
    }
  );

  app.post<{ Params: SpaceParams; Body: CreateNetworkScheduleBody }>(
    "/api/v1/spaces/:spaceId/document-schedules/network-folder",
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
            "deliveryChannel",
            "networkSubdirectory"
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
            localTime: { type: "string", pattern: "^\\d{2}:\\d{2}$" },
            startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            dayOfMonth: { type: "integer", minimum: 1, maximum: 28 },
            deliveryChannel: { type: "string", enum: ["network_folder"] },
            networkSubdirectory: { type: "string", minLength: 1, maxLength: 500 }
          }
        }
      }
    },
    async (request, reply) => {
      if (config.networkDeliveryRoot === null) {
        throw new DocumentScheduleValidationError(
          "Сетевая доставка не настроена администратором."
        );
      }
      const subdirectory = networkOperation(() =>
        normalizeScheduleNetworkTemplate(request.body.networkSubdirectory)
      );
      const context = mutationContextFromRequest(request);
      const created = schedules.create(
        request.params.spaceId,
        {
          key: request.body.key,
          name: request.body.name,
          ...(request.body.description === undefined
            ? {}
            : { description: request.body.description }),
          activeReleaseId: request.body.activeReleaseId,
          groupId: request.body.groupId,
          targetMode: request.body.targetMode,
          recurrenceKind: request.body.recurrenceKind,
          timezone: request.body.timezone,
          localTime: request.body.localTime,
          startDate: request.body.startDate,
          ...(request.body.dayOfMonth === undefined
            ? {}
            : { dayOfMonth: request.body.dayOfMonth }),
          deliveryChannel: "none"
        },
        context
      );
      const setting = networkOperation(() =>
        network.set(created.id, subdirectory, context)
      );
      reply.code(201).header("cache-control", "no-store");
      return responseEnvelope(request, decorateSchedule(created, setting));
    }
  );
}
