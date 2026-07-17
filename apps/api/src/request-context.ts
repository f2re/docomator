import type { FastifyRequest } from "fastify";

import type { MutationContext } from "@docomator/storage";

const CONTEXT_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;

function headerValue(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return CONTEXT_VALUE_PATTERN.test(normalized) ? normalized : null;
}

export function correlationId(request: FastifyRequest): string {
  return headerValue(request, "x-correlation-id") ?? request.id;
}

export function mutationContextFromRequest(request: FastifyRequest): MutationContext {
  return {
    correlationId: correlationId(request),
    actorType: "api",
    // Это непроверенное обозначение инициатора для аудита, а не субъект доступа.
    actorId: headerValue(request, "x-actor-id") ?? request.id
  };
}
