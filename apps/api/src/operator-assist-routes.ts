import type { ApiConfig } from "@docomator/config";
import {
  DocumentScheduleRegistry,
  DocumentScheduleValidationError,
  normalizeScheduleNetworkTemplate,
  OperatorAssistRegistry,
  scheduleNetworkRegistryFromScheduleRegistry,
  sqliteStoreFromDocumentScheduleRegistry,
  type DocumentGenerationMode,
  type DocumentScheduleDelivery,
  type DocumentScheduleRecurrence,
  type JsonValue,
  type PropertySensitivity,
  type SpaceStatus
} from "@docomator/storage";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { correlationId, mutationContextFromRequest } from "./request-context.js";

interface SpaceParams {
  spaceId: string;
}

interface PropertyParams {
  key: string;
}

interface GroupParams extends SpaceParams {
  groupId: string;
}

interface ScheduleParams extends SpaceParams {
  scheduleId: string;
}

interface SuggestionsQuery {
  limit?: number;
}

interface UpdatePropertyBody {
  label?: string;
  description?: string | null;
  unit?: string | null;
  sensitivity?: PropertySensitivity;
  validation?: { [key: string]: JsonValue };
  aliases?: string[];
}

interface ExtendOptionsBody {
  values: string[];
}

interface UpdateGroupBody {
  name?: string;
  description?: string | null;
  status?: SpaceStatus;
}

interface UpdateScheduleBody {
  name?: string;
  description?: string | null;
  activeReleaseId?: string;
  groupId?: string;
  targetMode?: DocumentGenerationMode;
  recurrenceKind?: DocumentScheduleRecurrence;
  timezone?: string;
  localTime?: string;
  startDate?: string;
  dayOfMonth?: number | null;
  deliveryChannel?: DocumentScheduleDelivery;
  emailRecipientId?: string | null;
  emailSubject?: string | null;
  emailMessageText?: string | null;
}

interface UpdateNetworkScheduleBody {
  name?: string;
  description?: string | null;
  activeReleaseId?: string;
  groupId?: string;
  targetMode?: DocumentGenerationMode;
  recurrenceKind?: DocumentScheduleRecurrence;
  timezone?: string;
  localTime?: string;
  startDate?: string;
  dayOfMonth?: number | null;
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

const scheduleUpdateProperties = {
  name: { type: "string", minLength: 1, maxLength: 300 },
  description: {
    anyOf: [{ type: "string", maxLength: 2_000 }, { type: "null" }]
  },
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
  dayOfMonth: {
    anyOf: [
      { type: "integer", minimum: 1, maximum: 28 },
      { type: "null" }
    ]
  }
} as const;

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

export function registerOperatorAssistRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  scheduleRegistry: DocumentScheduleRegistry
): void {
  const registry = new OperatorAssistRegistry(
    sqliteStoreFromDocumentScheduleRegistry(scheduleRegistry)
  );
  const networkRegistry =
    scheduleNetworkRegistryFromScheduleRegistry(scheduleRegistry);

  app.get<{ Params: SpaceParams; Querystring: SuggestionsQuery }>(
    "/api/v1/spaces/:spaceId/property-suggestions",
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
            limit: { type: "integer", minimum: 1, maximum: 100 }
          }
        }
      }
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      return responseEnvelope(
        request,
        registry.listPropertySuggestions(
          request.params.spaceId,
          request.query.limit ?? 20
        )
      );
    }
  );

  app.put<{ Params: PropertyParams; Body: UpdatePropertyBody }>(
    "/api/v1/knowledge/property-definitions/:key",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["key"],
          properties: { key: stableKeySchema }
        },
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            label: { type: "string", minLength: 1, maxLength: 500 },
            description: {
              anyOf: [
                { type: "string", maxLength: 2_000 },
                { type: "null" }
              ]
            },
            unit: {
              anyOf: [
                { type: "string", maxLength: 80 },
                { type: "null" }
              ]
            },
            sensitivity: {
              type: "string",
              enum: ["public", "internal", "personal", "restricted"]
            },
            validation: { type: "object", additionalProperties: true },
            aliases: {
              type: "array",
              maxItems: 100,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 160 }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const updated = registry.updatePropertyDefinition(
        request.params.key,
        request.body,
        mutationContextFromRequest(request)
      );
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, updated);
    }
  );

  app.post<{ Params: PropertyParams; Body: ExtendOptionsBody }>(
    "/api/v1/knowledge/property-definitions/:key/options",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["key"],
          properties: { key: stableKeySchema }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["values"],
          properties: {
            values: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: { type: "string", minLength: 1, maxLength: 160 }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const updated = registry.extendEnumOptions(
        request.params.key,
        request.body.values,
        mutationContextFromRequest(request)
      );
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, updated);
    }
  );

  app.put<{ Params: GroupParams; Body: UpdateGroupBody }>(
    "/api/v1/spaces/:spaceId/groups/:groupId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "groupId"],
          properties: { spaceId: idSchema, groupId: idSchema }
        },
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 500 },
            description: {
              anyOf: [
                { type: "string", maxLength: 2_000 },
                { type: "null" }
              ]
            },
            status: { type: "string", enum: ["active", "archived"] }
          }
        }
      }
    },
    async (request, reply) => {
      const updated = registry.updateGroup(
        request.params.spaceId,
        request.params.groupId,
        request.body,
        mutationContextFromRequest(request)
      );
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, updated);
    }
  );

  app.put<{ Params: ScheduleParams; Body: UpdateScheduleBody }>(
    "/api/v1/spaces/:spaceId/document-schedules/:scheduleId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "scheduleId"],
          properties: { spaceId: idSchema, scheduleId: idSchema }
        },
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            ...scheduleUpdateProperties,
            deliveryChannel: { type: "string", enum: ["none", "email"] },
            emailRecipientId: {
              anyOf: [idSchema, { type: "null" }]
            },
            emailSubject: {
              anyOf: [
                { type: "string", maxLength: 300 },
                { type: "null" }
              ]
            },
            emailMessageText: {
              anyOf: [
                { type: "string", maxLength: 20_000 },
                { type: "null" }
              ]
            }
          }
        }
      }
    },
    async (request, reply) => {
      if (
        request.body.deliveryChannel === "email" &&
        !config.smtp.enabled
      ) {
        throw new DocumentScheduleValidationError(
          "SMTP отключён; выберите расписание без доставки или настройте почтовый канал."
        );
      }
      const updated = registry.updateSchedule(
        request.params.spaceId,
        request.params.scheduleId,
        request.body,
        mutationContextFromRequest(request)
      );
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, updated);
    }
  );

  app.put<{ Params: ScheduleParams; Body: UpdateNetworkScheduleBody }>(
    "/api/v1/spaces/:spaceId/document-schedules/:scheduleId/network-folder",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "scheduleId"],
          properties: { spaceId: idSchema, scheduleId: idSchema }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["deliveryChannel", "networkSubdirectory"],
          properties: {
            ...scheduleUpdateProperties,
            deliveryChannel: {
              type: "string",
              enum: ["network_folder"]
            },
            networkSubdirectory: {
              type: "string",
              minLength: 1,
              maxLength: 500
            }
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
      const {
        networkSubdirectory,
        deliveryChannel: _deliveryChannel,
        ...scheduleInput
      } = request.body;
      const context = mutationContextFromRequest(request);
      const updated = registry.updateSchedule(
        request.params.spaceId,
        request.params.scheduleId,
        {
          ...scheduleInput,
          deliveryChannel: "none",
          emailRecipientId: null,
          emailSubject: null,
          emailMessageText: null
        },
        context
      );
      const setting = networkRegistry.set(
        updated.id,
        normalizeScheduleNetworkTemplate(networkSubdirectory),
        context
      );
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, {
        ...updated,
        deliveryChannel: "network_folder" as const,
        networkSubdirectory: setting.subdirectoryTemplate
      });
    }
  );
}
