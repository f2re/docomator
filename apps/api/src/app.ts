import fs from "node:fs/promises";
import path from "node:path";

import type { ApiConfig } from "@docomator/config";
import type {
  HealthResponse,
  ReadinessResponse,
  SystemInfoResponse
} from "@docomator/contracts";
import { DocumentIntakeError } from "@docomator/document-intake";
import {
  ContentAddressedObjectStore,
  DocumentQuarantineNotFoundError,
  DocumentQuarantineRegistry,
  DocumentQuarantineValidationError,
  KnowledgeConflictError,
  KnowledgeNotFoundError,
  KnowledgeRegistry,
  KnowledgeValidationError,
  PropertyValueValidationError,
  SpaceConflictError,
  SpaceNotFoundError,
  SpaceRegistry,
  SpaceValidationError,
  SqliteStore
} from "@docomator/storage";
import Fastify, {
  type FastifyError,
  type FastifyInstance
} from "fastify";

import { registerDocumentIntakeRoutes } from "./document-intake-routes.js";
import { registerKnowledgeRoutes } from "./knowledge-routes.js";
import { correlationId } from "./request-context.js";
import { registerSpaceRoutes } from "./space-routes.js";
import { registerUiRoutes } from "./ui-routes.js";
import {
  internalErrorMessage,
  requestValidationMessage,
  toUserMessage
} from "./user-message.js";

const startedAt = Date.now();

export interface AppDependencies {
  store?: SqliteStore;
  knowledgeRegistry?: KnowledgeRegistry;
  spaceRegistry?: SpaceRegistry;
  quarantineRegistry?: DocumentQuarantineRegistry;
  uiDirectory?: string;
}

function uptimeSeconds(): number {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

async function pathAccessible(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function databaseSchemaReady(store: SqliteStore): boolean {
  try {
    return store.execute((database) => {
      const requiredTables = [
        "schema_migrations",
        "entity_types",
        "property_definitions",
        "worker_jobs",
        "domain_events",
        "spaces",
        "space_entity_ownership",
        "audience_groups",
        "audience_snapshots",
        "document_quarantine_records"
      ];
      const rows = database
        .prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name IN (
              'schema_migrations', 'entity_types', 'property_definitions',
              'worker_jobs', 'domain_events', 'spaces',
              'space_entity_ownership', 'audience_groups', 'audience_snapshots',
              'document_quarantine_records'
            )
        `)
        .all() as unknown as Array<{ name: string }>;
      return new Set(rows.map((row) => row.name)).size === requiredTables.length;
    });
  } catch {
    return false;
  }
}

export function buildApp(
  config: ApiConfig,
  dependencies: AppDependencies = {}
): FastifyInstance {
  const ownsStore = dependencies.store === undefined;
  const store =
    dependencies.store ??
    new SqliteStore({ databasePath: path.join(config.dataDir, "docomator.db") });
  const knowledgeRegistry =
    dependencies.knowledgeRegistry ?? new KnowledgeRegistry(store);
  const spaceRegistry = dependencies.spaceRegistry ?? new SpaceRegistry(store);
  const quarantineRegistry =
    dependencies.quarantineRegistry ??
    new DocumentQuarantineRegistry(
      store,
      new ContentAddressedObjectStore(path.join(config.dataDir, "objects"))
    );

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers.set-cookie"
        ],
        censor: "[СКРЫТО]"
      }
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-correlation-id", correlationId(request));
  });

  if (ownsStore) {
    app.addHook("onClose", async () => {
      store.close();
    });
  }

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const requestCorrelationId = correlationId(request);
    let statusCode = 500;
    let code = "internal_error";
    let message = internalErrorMessage();

    if (error instanceof DocumentIntakeError) {
      statusCode = error.statusCode;
      code = error.code;
      message = error.userMessage;
    } else if (error instanceof DocumentQuarantineValidationError) {
      statusCode = 400;
      code = "document_quarantine_validation_failed";
      message = toUserMessage(error);
    } else if (error instanceof DocumentQuarantineNotFoundError) {
      statusCode = 404;
      code = "document_quarantine_not_found";
      message = toUserMessage(error);
    } else if (error instanceof KnowledgeValidationError) {
      statusCode = 400;
      code = "knowledge_validation_failed";
      message = toUserMessage(error);
    } else if (error instanceof PropertyValueValidationError) {
      statusCode = 400;
      code = "property_value_validation_failed";
      message = toUserMessage(error);
    } else if (error instanceof KnowledgeNotFoundError) {
      statusCode = 404;
      code = "knowledge_not_found";
      message = toUserMessage(error);
    } else if (error instanceof KnowledgeConflictError) {
      statusCode = 409;
      code = "knowledge_conflict";
      message = toUserMessage(error);
    } else if (error instanceof SpaceValidationError) {
      statusCode = 400;
      code = "space_validation_failed";
      message = toUserMessage(error);
    } else if (error instanceof SpaceNotFoundError) {
      statusCode = 404;
      code = "space_not_found";
      message = toUserMessage(error);
    } else if (error instanceof SpaceConflictError) {
      statusCode = 409;
      code = "space_conflict";
      message = toUserMessage(error);
    } else if (error.validation !== undefined) {
      statusCode = 400;
      code = "request_validation_failed";
      message = requestValidationMessage();
    } else if (
      error.statusCode !== undefined &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      statusCode = error.statusCode;
      code = "request_failed";
      message = toUserMessage(error);
    } else {
      request.log.error(
        { err: error, correlationId: requestCorrelationId },
        "запрос завершился ошибкой"
      );
    }

    void reply.code(statusCode).send({
      error: { code, message },
      correlationId: requestCorrelationId
    });
  });

  app.get("/healthz", async (): Promise<HealthResponse> => ({
    service: "api",
    status: "ok",
    version: config.version,
    timestamp: new Date().toISOString(),
    uptimeSeconds: uptimeSeconds()
  }));

  app.get("/readyz", async (_request, reply): Promise<ReadinessResponse> => {
    const dataDirectoryReady = await pathAccessible(config.dataDir);
    const databaseReady = databaseSchemaReady(store);
    const ready = dataDirectoryReady && databaseReady;

    if (!ready) {
      reply.code(503);
    }

    return {
      service: "api",
      status: ready ? "ok" : "degraded",
      version: config.version,
      timestamp: new Date().toISOString(),
      uptimeSeconds: uptimeSeconds(),
      checks: {
        dataDirectory: dataDirectoryReady ? "ok" : "error",
        database: databaseReady ? "ok" : "error"
      }
    };
  });

  app.get("/api/v1/system/info", async (): Promise<SystemInfoResponse> => ({
    name: "docomator",
    version: config.version,
    architecture: "modular-monolith",
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    features: {
      offlineFirst: true,
      localLlm: config.llmEnabled,
      documentFormats: ["docx", "xlsx"]
    }
  }));

  registerUiRoutes(app, dependencies.uiDirectory);
  registerKnowledgeRoutes(app, knowledgeRegistry);
  registerSpaceRoutes(app, spaceRegistry);
  registerDocumentIntakeRoutes(app, quarantineRegistry, spaceRegistry);

  return app;
}
