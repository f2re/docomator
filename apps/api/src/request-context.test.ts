import assert from "node:assert/strict";
import test from "node:test";

import type { FastifyRequest } from "fastify";

import {
  correlationId,
  mutationContextFromRequest
} from "./request-context.js";

function request(
  id: string,
  headers: Record<string, string | undefined>
): FastifyRequest {
  return { id, headers } as unknown as FastifyRequest;
}

test("valid correlation and actor identifiers are preserved", () => {
  const input = request("request-fallback", {
    "x-correlation-id": "document:2026-07-11/001",
    "x-actor-id": "operator-42"
  });

  assert.equal(correlationId(input), "document:2026-07-11/001");
  assert.deepEqual(mutationContextFromRequest(input), {
    correlationId: "document:2026-07-11/001",
    actorType: "api",
    actorId: "operator-42"
  });
});

test("unsafe context headers are replaced with the internal request ID", () => {
  const input = request("request-safe-fallback", {
    "x-correlation-id": "../unsafe value",
    "x-actor-id": "actor with spaces"
  });

  assert.equal(correlationId(input), "request-safe-fallback");
  assert.deepEqual(mutationContextFromRequest(input), {
    correlationId: "request-safe-fallback",
    actorType: "api",
    actorId: "request-safe-fallback"
  });
});
