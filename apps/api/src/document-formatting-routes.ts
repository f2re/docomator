import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { DEFAULT_INTAKE_LIMITS } from "@docomator/document-intake";
import {
  ContentAddressedObjectStore,
  DocumentFormattingConflictError,
  DocumentFormattingRegistry,
  toJsonValue
} from "@docomator/storage";
import {
  DocumentFormattingError,
  analyzeDocumentFormatting,
  documentFormattingProfile,
  documentFormattingProfileLabel,
  normalizeDocumentFormattingSettings,
  type DocumentFormattingProfile,
  type DocumentFormattingSettings
} from "@docomator/template-compiler";

import { correlationId, mutationContextFromRequest } from "./request-context.js";

interface SpaceParams { spaceId: string }
interface JobParams extends SpaceParams { jobId: string }
interface ItemParams extends JobParams { itemId: string }
interface AnalyzeQuery { profile: Exclude<DocumentFormattingProfile, "custom"> }
interface CreateJobBody { sourceRecordIds: string[]; settings: DocumentFormattingSettings }

const identifier = { type: "string", minLength: 1, maxLength: 160 } as const;
const settingsSchema = {
  type: "object", additionalProperties: false,
  required: ["profile", "fontFamily", "fontSizePt", "lineSpacing", "firstLineIndentMm", "marginsMm", "bodyAlignment"],
  properties: {
    profile: { type: "string", enum: ["gost-r-7.0.97-2025", "eskd-gost-r-2.105-2019", "custom"] },
    fontFamily: { type: "string", minLength: 1, maxLength: 120 }, fontSizePt: { type: "number", minimum: 8, maximum: 32 },
    lineSpacing: { type: "number", minimum: 1, maximum: 3 }, firstLineIndentMm: { type: "number", minimum: 0, maximum: 50 },
    marginsMm: { type: "object", additionalProperties: false, required: ["top", "right", "bottom", "left"], properties: {
      top: { type: "number", minimum: 5, maximum: 70 }, right: { type: "number", minimum: 5, maximum: 70 }, bottom: { type: "number", minimum: 5, maximum: 70 }, left: { type: "number", minimum: 5, maximum: 70 }
    } },
    bodyAlignment: { type: "string", enum: ["left", "both"] }
  }
} as const;
function envelope<T>(request: FastifyRequest, data: T) { return { data, correlationId: correlationId(request) }; }
function formatError(request: FastifyRequest, reply: FastifyReply, error: DocumentFormattingError) {
  return reply.code(422).header("cache-control", "no-store").send({ error: { code: error.code, message: error.message }, correlationId: correlationId(request) });
}
function safeDisposition(name: string): string { return `attachment; filename*=UTF-8''${encodeURIComponent(name.replace(/[\r\n]/gu, ""))}`; }

export function registerDocumentFormattingRoutes(app: FastifyInstance, registry: DocumentFormattingRegistry, objectStore: ContentAddressedObjectStore): void {
  app.get("/api/v1/document-formatting/profiles", async (request, reply) => {
    const profiles = (["gost-r-7.0.97-2025", "eskd-gost-r-2.105-2019"] as const).map((profile) => ({
      id: profile, label: documentFormattingProfileLabel(profile), settings: documentFormattingProfile(profile),
      scope: profile === "gost-r-7.0.97-2025"
        ? "Базовое оформление организационно-распорядительного DOCX; шрифт и часть параметров остаются редактируемой локальной политикой."
        : "Базовое оформление текстового DOCX ЕСКД; рамки, основные надписи и смысловая разметка не синтезируются без явных правил."
    }));
    reply.header("cache-control", "no-store"); return envelope(request, profiles);
  });

  app.post<{ Querystring: AnalyzeQuery; Body: Buffer }>("/api/v1/document-formatting/analyze", {
    bodyLimit: DEFAULT_INTAKE_LIMITS.maxArchiveBytes,
    schema: { querystring: { type: "object", additionalProperties: false, required: ["profile"], properties: { profile: { type: "string", enum: ["gost-r-7.0.97-2025", "eskd-gost-r-2.105-2019"] } } } }
  }, async (request, reply) => {
    try { const analysis = await analyzeDocumentFormatting(request.body, documentFormattingProfile(request.query.profile)); reply.header("cache-control", "no-store"); return envelope(request, analysis); }
    catch (error) { if (error instanceof DocumentFormattingError) return formatError(request, reply, error); throw error; }
  });

  app.post<{ Params: SpaceParams; Body: CreateJobBody }>("/api/v1/spaces/:spaceId/document-formatting/jobs", {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["spaceId"], properties: { spaceId: identifier } },
      body: { type: "object", additionalProperties: false, required: ["sourceRecordIds", "settings"], properties: {
        sourceRecordIds: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true, items: identifier }, settings: settingsSchema
      } }
    }
  }, async (request, reply) => {
    const settings = normalizeDocumentFormattingSettings(request.body.settings);
    const job = registry.createJob({ spaceId: request.params.spaceId, sourceRecordIds: request.body.sourceRecordIds, settings: toJsonValue(settings) }, mutationContextFromRequest(request));
    reply.code(202).header("cache-control", "no-store"); return envelope(request, job);
  });

  app.get<{ Params: SpaceParams; Querystring: { limit?: number } }>("/api/v1/spaces/:spaceId/document-formatting/jobs", {
    schema: { params: { type: "object", additionalProperties: false, required: ["spaceId"], properties: { spaceId: identifier } }, querystring: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100 } } } }
  }, async (request, reply) => { reply.header("cache-control", "no-store"); return envelope(request, registry.listJobs(request.params.spaceId, request.query.limit ?? 30)); });

  app.get<{ Params: JobParams }>("/api/v1/spaces/:spaceId/document-formatting/jobs/:jobId", {
    schema: { params: { type: "object", additionalProperties: false, required: ["spaceId", "jobId"], properties: { spaceId: identifier, jobId: identifier } } }
  }, async (request, reply) => { reply.header("cache-control", "no-store"); return envelope(request, registry.getJob(request.params.spaceId, request.params.jobId)); });

  app.post<{ Params: JobParams }>("/api/v1/spaces/:spaceId/document-formatting/jobs/:jobId/retry", {
    schema: { params: { type: "object", additionalProperties: false, required: ["spaceId", "jobId"], properties: { spaceId: identifier, jobId: identifier } } }
  }, async (request, reply) => {
    const previous = registry.getJob(request.params.spaceId, request.params.jobId);
    const failed = previous.items.filter((item) => item.state === "failed").map((item) => item.sourceRecordId);
    if (failed.length === 0) throw new DocumentFormattingConflictError("В этой операции нет файлов, требующих повторного запуска.");
    if (previous.settings === null || Array.isArray(previous.settings) || typeof previous.settings !== "object") throw new DocumentFormattingConflictError("Настройки предыдущей операции повреждены; повторный запуск остановлен.");
    const settings = normalizeDocumentFormattingSettings(previous.settings as unknown as DocumentFormattingSettings);
    const job = registry.createJob({ spaceId: request.params.spaceId, sourceRecordIds: failed, settings: toJsonValue(settings), retryOfJobId: previous.id }, mutationContextFromRequest(request));
    reply.code(202).header("cache-control", "no-store"); return envelope(request, job);
  });

  app.get<{ Params: ItemParams }>("/api/v1/spaces/:spaceId/document-formatting/jobs/:jobId/items/:itemId/download", {
    schema: { params: { type: "object", additionalProperties: false, required: ["spaceId", "jobId", "itemId"], properties: { spaceId: identifier, jobId: identifier, itemId: identifier } } }
  }, async (request, reply) => {
    const output = registry.getOutput(request.params.spaceId, request.params.jobId, request.params.itemId); const buffer = await objectStore.getBuffer(output.sha256);
    return reply.type("application/vnd.openxmlformats-officedocument.wordprocessingml.document").header("cache-control", "no-store").header("content-disposition", safeDisposition(output.fileName)).send(buffer);
  });
}
