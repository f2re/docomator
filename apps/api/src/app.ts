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
  DocumentDeliveryConflictError,
  DocumentDeliveryNotFoundError,
  DocumentDeliveryRegistry,
  DocumentDeliveryValidationError,
  DocumentEmailDeliveryConflictError,
  DocumentEmailDeliveryNotFoundError,
  DocumentEmailDeliveryRegistry,
  DocumentEmailDeliveryValidationError,
  DocumentGenerationConflictError,
  DocumentGenerationNotFoundError,
  DocumentGenerationRegistry,
  DocumentGenerationValidationError,
  DocumentPreflightConflictError,
  DocumentPreflightNotFoundError,
  DocumentPreflightRegistry,
  DocumentPreflightValidationError,
  DocumentQuarantineNotFoundError,
  DocumentQuarantineRegistry,
  DocumentQuarantineValidationError,
  DocumentScheduleConflictError,
  DocumentScheduleNotFoundError,
  DocumentScheduleRegistry,
  DocumentScheduleValidationError,
  EmailRecipientConflictError,
  EmailRecipientNotFoundError,
  EmailRecipientRegistry,
  EmailRecipientValidationError,
  EmployeeRegistry,
  KnowledgeConflictError,
  KnowledgeNotFoundError,
  KnowledgeRegistry,
  KnowledgeValidationError,
  MultiFieldTestVersionConflictError,
  MultiFieldTestVersionNotFoundError,
  MultiFieldTestVersionRegistry,
  MultiFieldTestVersionValidationError,
  OperationCenterRegistry,
  PropertyValueValidationError,
  SpaceConflictError,
  SpaceNotFoundError,
  SpaceRegistry,
  SpaceValidationError,
  SqliteStore,
  TemplateActivationNotFoundError,
  TemplateActivationValidationError,
  TemplateDraftConflictError,
  TemplateDraftNotFoundError,
  TemplateDraftRegistry,
  TemplateDraftValidationError,
  TemplatePreviewActivationRegistry,
  TemplatePreviewConflictError,
  TemplatePreviewNotFoundError,
  TemplatePreviewValidationError,
  TemplateTestVersionConflictError,
  TemplateTestVersionNotFoundError,
  TemplateTestVersionRegistry,
  TemplateTestVersionValidationError
} from "@docomator/storage";
import { TemplateCompilerError } from "@docomator/template-compiler";
import Fastify, {
  type FastifyError,
  type FastifyInstance
} from "fastify";

import { registerDocumentDeliveryRoutes } from "./document-delivery-routes.js";
import { registerDocumentEmailRoutes } from "./document-email-routes.js";
import { registerDocumentGenerationRoutes } from "./document-generation-routes.js";
import { registerDocumentGenerationRetryRoutes } from "./document-generation-retry-routes.js";
import { registerDocumentIntakeRoutes } from "./document-intake-routes.js";
import { registerDocumentPreflightRoutes } from "./document-preflight-routes.js";
import { registerDocumentScheduleRoutes } from "./document-schedule-routes.js";
import { registerEmailRecipientRoutes } from "./email-recipient-routes.js";
import { registerEmployeeRoutes } from "./employee-routes.js";
import { registerKnowledgeRoutes } from "./knowledge-routes.js";
import { registerMultiFieldTestVersionRoutes } from "./multi-field-test-version-routes.js";
import { registerOperationCenterRoutes } from "./operation-center-routes.js";
import { correlationId } from "./request-context.js";
import { registerSpaceRoutes } from "./space-routes.js";
import { registerTemplateDraftRoutes } from "./template-draft-routes.js";
import { registerTemplatePreviewActivationRoutes } from "./template-preview-activation-routes.js";
import { registerTemplateTestVersionRoutes } from "./template-test-version-routes.js";
import { registerUiRoutes } from "./ui-routes.js";
import {
  internalErrorMessage,
  requestValidationMessage,
  toUserMessage
} from "./user-message.js";

const startedAt = Date.now();

export interface AppDependencies {
  store?: SqliteStore;
  objectStore?: ContentAddressedObjectStore;
  knowledgeRegistry?: KnowledgeRegistry;
  spaceRegistry?: SpaceRegistry;
  documentDeliveryRegistry?: DocumentDeliveryRegistry;
  documentEmailDeliveryRegistry?: DocumentEmailDeliveryRegistry;
  documentGenerationRegistry?: DocumentGenerationRegistry;
  documentPreflightRegistry?: DocumentPreflightRegistry;
  documentScheduleRegistry?: DocumentScheduleRegistry;
  emailRecipientRegistry?: EmailRecipientRegistry;
  employeeRegistry?: EmployeeRegistry;
  quarantineRegistry?: DocumentQuarantineRegistry;
  templateDraftRegistry?: TemplateDraftRegistry;
  templateTestVersionRegistry?: TemplateTestVersionRegistry;
  multiFieldTestVersionRegistry?: MultiFieldTestVersionRegistry;
  operationCenterRegistry?: OperationCenterRegistry;
  templatePreviewActivationRegistry?: TemplatePreviewActivationRegistry;
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
        "document_quarantine_records",
        "template_drafts",
        "template_draft_fields",
        "template_test_versions",
        "template_multi_test_versions",
        "template_multi_test_version_fields",
        "template_release_candidates",
        "template_release_candidate_fields",
        "template_release_previews",
        "template_releases",
        "template_release_pointers",
        "document_generation_jobs",
        "document_generation_units",
        "document_deliveries",
        "document_email_deliveries",
        "space_email_recipients",
        "document_schedules",
        "document_schedule_runs",
        "employee_create_requests",
        "employee_update_requests"
      ];
      const placeholders = requiredTables.map(() => "?").join(", ");
      const rows = database
        .prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name IN (${placeholders})
        `)
        .all(...requiredTables) as unknown as Array<{ name: string }>;
      if (new Set(rows.map((row) => row.name)).size !== requiredTables.length) {
        return false;
      }
      const xlsxRepeatMigration = database
        .prepare("SELECT name FROM schema_migrations WHERE name = ?")
        .get("0025_xlsx_repeat_rows.sql");
      if (xlsxRepeatMigration === undefined) {
        return false;
      }
      const requiredColumns = [
        ["template_draft_fields", "formatter_json"],
        ["template_multi_test_version_fields", "formatter_json"],
        ["template_release_candidate_fields", "formatter_json"],
        ["template_drafts", "repeat_binding_json"],
        ["template_multi_test_versions", "repeat_contract_json"],
        ["template_release_candidates", "repeat_contract_json"]
      ] as const;
      const column = database.prepare(
        "SELECT name FROM pragma_table_info(?) WHERE name = ?"
      );
      return requiredColumns.every(
        ([tableName, columnName]) =>
          column.get(tableName, columnName) !== undefined
      );
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
  const objectStore =
    dependencies.objectStore ??
    new ContentAddressedObjectStore(path.join(config.dataDir, "objects"));
  const knowledgeRegistry =
    dependencies.knowledgeRegistry ?? new KnowledgeRegistry(store);
  const spaceRegistry = dependencies.spaceRegistry ?? new SpaceRegistry(store);
  const documentDeliveryRegistry =
    dependencies.documentDeliveryRegistry ?? new DocumentDeliveryRegistry(store);
  const documentEmailDeliveryRegistry =
    dependencies.documentEmailDeliveryRegistry ??
    new DocumentEmailDeliveryRegistry(store);
  const documentGenerationRegistry =
    dependencies.documentGenerationRegistry ??
    new DocumentGenerationRegistry(store, objectStore);
  const documentPreflightRegistry =
    dependencies.documentPreflightRegistry ?? new DocumentPreflightRegistry(store);
  const documentScheduleRegistry =
    dependencies.documentScheduleRegistry ?? new DocumentScheduleRegistry(store);
  const emailRecipientRegistry =
    dependencies.emailRecipientRegistry ?? new EmailRecipientRegistry(store);
  const employeeRegistry =
    dependencies.employeeRegistry ??
    new EmployeeRegistry(store, {
      knowledge: knowledgeRegistry,
      spaces: spaceRegistry
    });
  const quarantineRegistry =
    dependencies.quarantineRegistry ??
    new DocumentQuarantineRegistry(store, objectStore);
  const templateDraftRegistry =
    dependencies.templateDraftRegistry ?? new TemplateDraftRegistry(store);
  const templateTestVersionRegistry =
    dependencies.templateTestVersionRegistry ??
    new TemplateTestVersionRegistry(store, objectStore);
  const multiFieldTestVersionRegistry =
    dependencies.multiFieldTestVersionRegistry ??
    new MultiFieldTestVersionRegistry(store, objectStore);
  const operationCenterRegistry =
    dependencies.operationCenterRegistry ?? new OperationCenterRegistry(store);
  const templatePreviewActivationRegistry =
    dependencies.templatePreviewActivationRegistry ??
    new TemplatePreviewActivationRegistry(store, objectStore);

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
    } else if (error instanceof TemplateCompilerError) {
      statusCode = 422;
      code = error.code;
      message = error.userMessage;
    } else if (error instanceof DocumentScheduleValidationError) {
      statusCode = 400;
      code = "document_schedule_validation_failed";
      message = toUserMessage(error);
    } else if (error instanceof DocumentScheduleNotFoundError) {
      statusCode = 404;
      code = "document_schedule_not_found";
      message = toUserMessage(error);
    } else if (error instanceof DocumentScheduleConflictError) {
      statusCode = 409;
      code = "document_schedule_conflict";
      message = toUserMessage(error);
    } else if (error instanceof EmailRecipientValidationError) {
      statusCode = 400;
      code = "email_recipient_validation_failed";
      message = toUserMessage(error);
    } else if (error instanceof EmailRecipientNotFoundError) {
      statusCode = 404;
      code = "email_recipient_not_found";
      message = toUserMessage(error);
    } else if (error instanceof EmailRecipientConflictError) {
      statusCode = 409;
      code = "email_recipient_conflict";
      message = toUserMessage(error);
    } else if (error instanceof DocumentEmailDeliveryValidationError) {
      statusCode = 400;
      code = "document_email_delivery_validation_failed";
      message = toUserMessage(error);
    } else if (error instanceof DocumentEmailDeliveryNotFoundError) {
      statusCode = 404;
      code = "document_email_delivery_not_found";
      message = toUserMessage(error);
    } else if (error instanceof DocumentEmailDeliveryConflictError) {
      statusCode = 409;
      code = "document_email_delivery_conflict";
      message = toUserMessage(error);
    } else if (error instanceof DocumentDeliveryValidationError) {
      statusCode = 400;
      code = "document_delivery_validation_failed";
      message = toUserMessage(error);
    } else if (error instanceof DocumentDeliveryNotFoundError) {
      statusCode = 404;
      code = "document_delivery_not_found";
      message = toUserMessage(error);
    } else if (error instanceof DocumentDeliveryConflictError) {
      statusCode = 409;
      code = "document_delivery_conflict";
      message = toUserMessage(error);
    } else if (error instanceof DocumentPreflightValidationError) {
      statusCode = 400;
      code = "document_preflight_validation_failed";
      message = toUserMessage(error);
    } else if (error instanceof DocumentPreflightNotFoundError) {
      statusCode = 404;
      code = "document_preflight_not_found";
      message = toUserMessage(error);
    } else if (error instanceof DocumentPreflightConflictError) {
      statusCode = 409;
      code = "document_preflight_conflict";
      message = toUserMessage(error);
    } else if (error instanceof DocumentGenerationValidationError) {
      statusCode = 400;
      code = "document_generation_validation_failed";
      message = toUserMessage(error);
    } else if (error instanceof DocumentGenerationNotFoundError) {
      statusCode = 404;
      code = "document_generation_not_found";
      message = toUserMessage(error);
    } else if (error instanceof DocumentGenerationConflictError) {
      statusCode = 409;
      code = "document_generation_conflict";
      message = toUserMessage(error);
    } else if (error instanceof DocumentQuarantineValidationError) {
      statusCode = 400;
      code = "document_quarantine_validation_failed";
      message = toUserMessage(error);
    } else if (error instanceof DocumentQuarantineNotFoundError) {
      statusCode = 404;
      code = "document_quarantine_not_found";
      message = toUserMessage(error);
    } else if (error instanceof TemplateDraftValidationError) {
      statusCode = 400;
      code = "template_draft_validation_failed";
      message = toUserMessage(error);
    } else if (error instanceof TemplateDraftNotFoundError) {
      statusCode = 404;
      code = "template_draft_not_found";
      message = toUserMessage(error);
    } else if (error instanceof TemplateDraftConflictError) {
      statusCode = 409;
      code = "template_draft_conflict";
      message = toUserMessage(error);
    } else if (error instanceof MultiFieldTestVersionValidationError) {
      statusCode = 400;
      code = "multi_field_test_version_validation_failed";
      message = toUserMessage(error);
    } else if (error instanceof MultiFieldTestVersionNotFoundError) {
      statusCode = 404;
      code = "multi_field_test_version_not_found";
      message = toUserMessage(error);
    } else if (error instanceof MultiFieldTestVersionConflictError) {
      statusCode = 409;
      code = "multi_field_test_version_conflict";
      message = toUserMessage(error);
    } else if (error instanceof TemplateTestVersionValidationError) {
      statusCode = 400;
      code = "template_test_version_validation_failed";
      message = toUserMessage(error);
    } else if (error instanceof TemplateTestVersionNotFoundError) {
      statusCode = 404;
      code = "template_test_version_not_found";
      message = toUserMessage(error);
    } else if (error instanceof TemplateTestVersionConflictError) {
      statusCode = 409;
      code = "template_test_version_conflict";
      message = toUserMessage(error);
    } else if (error instanceof TemplatePreviewValidationError) {
      statusCode = 400;
      code = "template_preview_validation_failed";
      message = toUserMessage(error);
    } else if (error instanceof TemplatePreviewNotFoundError) {
      statusCode = 404;
      code = "template_preview_not_found";
      message = toUserMessage(error);
    } else if (error instanceof TemplatePreviewConflictError) {
      statusCode = 409;
      code = "template_preview_conflict";
      message = toUserMessage(error);
    } else if (error instanceof TemplateActivationValidationError) {
      statusCode = 400;
      code = "template_activation_validation_failed";
      message = toUserMessage(error);
    } else if (error instanceof TemplateActivationNotFoundError) {
      statusCode = 404;
      code = "template_activation_not_found";
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
  registerEmployeeRoutes(app, employeeRegistry);
  registerOperationCenterRoutes(app, operationCenterRegistry);
  registerEmailRecipientRoutes(app, config, emailRecipientRegistry);
  registerDocumentScheduleRoutes(app, config, documentScheduleRegistry);
  registerDocumentPreflightRoutes(app, documentPreflightRegistry);
  registerDocumentGenerationRoutes(
    app,
    objectStore,
    documentGenerationRegistry
  );
  registerDocumentGenerationRetryRoutes(
    app,
    spaceRegistry,
    documentGenerationRegistry
  );
  registerDocumentDeliveryRoutes(
    app,
    config,
    objectStore,
    documentGenerationRegistry,
    documentDeliveryRegistry
  );
  registerDocumentEmailRoutes(
    app,
    config,
    documentGenerationRegistry,
    documentEmailDeliveryRegistry
  );
  registerDocumentIntakeRoutes(app, quarantineRegistry, spaceRegistry);
  registerTemplateDraftRoutes(
    app,
    quarantineRegistry,
    objectStore,
    templateDraftRegistry
  );
  registerTemplateTestVersionRoutes(
    app,
    objectStore,
    templateDraftRegistry,
    templateTestVersionRegistry
  );
  registerMultiFieldTestVersionRoutes(
    app,
    objectStore,
    templateDraftRegistry,
    multiFieldTestVersionRegistry
  );
  registerTemplatePreviewActivationRoutes(
    app,
    objectStore,
    templatePreviewActivationRegistry
  );

  return app;
}
