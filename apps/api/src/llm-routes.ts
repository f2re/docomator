import type { FastifyInstance, FastifyRequest } from "fastify";
import type { CommonConfig } from "@docomator/config";
import type { SpaceRegistry } from "@docomator/storage";

import { correlationId } from "./request-context.js";
import {
  diagnoseLlm,
  diagnoseError,
  suggestMappings,
  fillMissingValues,
  chatCompletionWithLlm,
  type TargetPropertyCandidate,
  type MissingFieldDefinition
} from "./llm/index.js";

interface SpaceParams {
  spaceId: string;
}

interface TestPromptBody {
  prompt?: string | undefined;
}

interface DiagnoseErrorBody {
  errorCode?: string | undefined;
  errorMessage: string;
  stage?: string | undefined;
  context?: Record<string, unknown> | undefined;
}

interface SuggestMappingsBody {
  headers: string[];
  samples?: Record<string, string[]> | undefined;
  targetProperties?: TargetPropertyCandidate[] | undefined;
}

interface FillValuesBody {
  templateTitle?: string | undefined;
  entityName?: string | undefined;
  existingValues?: Record<string, unknown> | undefined;
  missingFields: MissingFieldDefinition[];
}

const idSchema = {
  type: "string",
  minLength: 1,
  maxLength: 160
} as const;

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

export function registerLlmRoutes(
  app: FastifyInstance,
  config: CommonConfig,
  spaceRegistry: SpaceRegistry
): void {
  // System-level LLM status check
  app.get(
    "/api/v1/llm/status",
    async (request, reply) => {
      const result = await diagnoseLlm(config);
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, result);
    }
  );

  // Space-level LLM status check
  app.get<{ Params: SpaceParams }>(
    "/api/v1/spaces/:spaceId/llm/status",
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
      spaceRegistry.getSpace(request.params.spaceId);
      const result = await diagnoseLlm(config);
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, result);
    }
  );

  // System-level LLM test completion
  app.post<{ Body: TestPromptBody }>(
    "/api/v1/llm/test",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            prompt: { type: "string", maxLength: 1000 }
          }
        }
      }
    },
    async (request, reply) => {
      const prompt = request.body?.prompt?.trim() ||
        "Ответь кратко на русском языке: подтверди готовность к работе с документами.";
      const result = await chatCompletionWithLlm({
        config,
        systemPrompt: "Ты — интеллектуальный помощник системы документационного оборота Оформлятор. Отвечай кратко, чётко и вежливо на русском языке.",
        userPrompt: prompt,
        maxTokens: 256
      });
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, {
        success: result.success,
        status: result.status,
        reply: result.content || "",
        model: result.model || config.llmModel || null,
        endpoint: result.endpoint || config.llmBaseUrl || null,
        durationMs: result.durationMs,
        error: result.error || null
      });
    }
  );

  // Space-level LLM test completion
  app.post<{ Params: SpaceParams; Body: TestPromptBody }>(
    "/api/v1/spaces/:spaceId/llm/test",
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
          properties: {
            prompt: { type: "string", maxLength: 1000 }
          }
        }
      }
    },
    async (request, reply) => {
      spaceRegistry.getSpace(request.params.spaceId);
      const prompt = request.body?.prompt?.trim() ||
        "Ответь кратко на русском языке: подтверди готовность к работе с документами.";
      const result = await chatCompletionWithLlm({
        config,
        systemPrompt: "Ты — интеллектуальный помощник системы документационного оборота Оформлятор. Отвечай кратко, чётко и вежливо на русском языке.",
        userPrompt: prompt,
        maxTokens: 256
      });
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, {
        success: result.success,
        status: result.status,
        reply: result.content || "",
        model: result.model || config.llmModel || null,
        endpoint: result.endpoint || config.llmBaseUrl || null,
        durationMs: result.durationMs,
        error: result.error || null
      });
    }
  );

  // Diagnose errors (import, preflight, generation, or general)
  app.post<{ Params: SpaceParams; Body: DiagnoseErrorBody }>(
    "/api/v1/spaces/:spaceId/llm/diagnose-error",
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
          required: ["errorMessage"],
          properties: {
            errorCode: { type: "string", maxLength: 200 },
            errorMessage: { type: "string", minLength: 1, maxLength: 5000 },
            stage: { type: "string", maxLength: 100 },
            context: { type: "object", additionalProperties: true }
          }
        }
      }
    },
    async (request, reply) => {
      spaceRegistry.getSpace(request.params.spaceId);
      const result = await diagnoseError(config, {
        errorCode: request.body.errorCode,
        errorMessage: request.body.errorMessage,
        stage: request.body.stage,
        context: request.body.context
      });
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, result);
    }
  );

  // Suggest column mappings for tabular import
  app.post<{ Params: SpaceParams; Body: SuggestMappingsBody }>(
    "/api/v1/spaces/:spaceId/llm/suggest-mappings",
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
          required: ["headers"],
          properties: {
            headers: {
              type: "array",
              items: { type: "string", maxLength: 200 },
              maxItems: 200
            },
            samples: {
              type: "object",
              additionalProperties: {
                type: "array",
                items: { type: "string", maxLength: 1000 },
                maxItems: 10
              }
            },
            targetProperties: {
              type: "array",
              items: {
                type: "object",
                required: ["key", "label"],
                properties: {
                  key: { type: "string", maxLength: 160 },
                  label: { type: "string", maxLength: 200 },
                  valueType: { type: "string", maxLength: 50 },
                  description: { type: "string", maxLength: 1000 },
                  aliases: {
                    type: "array",
                    items: { type: "string", maxLength: 200 }
                  }
                }
              },
              maxItems: 300
            }
          }
        }
      }
    },
    async (request, reply) => {
      spaceRegistry.getSpace(request.params.spaceId);
      const targetProperties = request.body.targetProperties || [];
      const result = await suggestMappings(config, {
        headers: request.body.headers,
        samples: request.body.samples,
        targetProperties
      });
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, result);
    }
  );

  // Auto-fill missing required fields
  app.post<{ Params: SpaceParams; Body: FillValuesBody }>(
    "/api/v1/spaces/:spaceId/llm/fill-values",
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
          required: ["missingFields"],
          properties: {
            templateTitle: { type: "string", maxLength: 500 },
            entityName: { type: "string", maxLength: 500 },
            existingValues: { type: "object", additionalProperties: true },
            missingFields: {
              type: "array",
              items: {
                type: "object",
                required: ["key", "label"],
                properties: {
                  key: { type: "string", maxLength: 160 },
                  label: { type: "string", maxLength: 200 },
                  valueType: { type: "string", maxLength: 50 },
                  description: { type: "string", maxLength: 1000 }
                }
              },
              maxItems: 100
            }
          }
        }
      }
    },
    async (request, reply) => {
      spaceRegistry.getSpace(request.params.spaceId);
      const result = await fillMissingValues(config, {
        templateTitle: request.body.templateTitle,
        entityName: request.body.entityName,
        existingValues: request.body.existingValues,
        missingFields: request.body.missingFields
      });
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, result);
    }
  );
}
