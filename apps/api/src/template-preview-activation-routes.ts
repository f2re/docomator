import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  ContentAddressedObjectStore,
  TemplateActivationValidationError,
  TemplatePreviewActivationRegistry,
  TemplatePreviewConflictError,
  type TemplateReleaseCandidateKind
} from "@docomator/storage";

import {
  correlationId,
  mutationContextFromRequest
} from "./request-context.js";

interface VersionParams {
  spaceId: string;
  versionId: string;
}

interface PreviewParams {
  spaceId: string;
  requestId: string;
}

interface ActiveVersionParams {
  spaceId: string;
  activeVersionId: string;
}

interface ActiveFileParams extends ActiveVersionParams {
  kind: "compiled" | "preview";
}

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

function inlineDisposition(fileName: string): string {
  return `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function attachmentDisposition(fileName: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function officeMediaType(format: "docx" | "xlsx"): string {
  return format === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

const versionParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["spaceId", "versionId"],
  properties: {
    spaceId: { type: "string", minLength: 1, maxLength: 160 },
    versionId: { type: "string", minLength: 1, maxLength: 160 }
  }
} as const;

const previewParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["spaceId", "requestId"],
  properties: {
    spaceId: { type: "string", minLength: 1, maxLength: 160 },
    requestId: { type: "string", minLength: 1, maxLength: 160 }
  }
} as const;

function registerPreviewRequestRoute(
  app: FastifyInstance,
  registry: TemplatePreviewActivationRegistry,
  route: string,
  versionKind: TemplateReleaseCandidateKind
): void {
  app.post<{ Params: VersionParams }>(
    route,
    { schema: { params: versionParamsSchema } },
    async (request, reply) => {
      const result = registry.requestPreview(
        {
          spaceId: request.params.spaceId,
          versionId: request.params.versionId,
          versionKind
        },
        mutationContextFromRequest(request)
      );
      reply
        .code(result.request.state === "ready" ? 200 : 202)
        .header("cache-control", "no-store");
      return responseEnvelope(request, {
        request: result.request,
        created: result.created,
        retried: result.retried,
        statusUrl: `/api/v1/spaces/${encodeURIComponent(result.request.spaceId)}/template-previews/${encodeURIComponent(result.request.id)}`,
        previewUrl:
          result.request.state === "ready"
            ? `/api/v1/spaces/${encodeURIComponent(result.request.spaceId)}/template-previews/${encodeURIComponent(result.request.id)}/file`
            : null
      });
    }
  );
}

export function registerTemplatePreviewActivationRoutes(
  app: FastifyInstance,
  objectStore: ContentAddressedObjectStore,
  registry: TemplatePreviewActivationRegistry
): void {
  registerPreviewRequestRoute(
    app,
    registry,
    "/api/v1/spaces/:spaceId/template-test-versions/:versionId/preview",
    "single"
  );
  registerPreviewRequestRoute(
    app,
    registry,
    "/api/v1/spaces/:spaceId/template-multi-test-versions/:versionId/preview",
    "multi"
  );

  app.get<{ Params: PreviewParams }>(
    "/api/v1/spaces/:spaceId/template-previews/:requestId",
    { schema: { params: previewParamsSchema } },
    async (request, reply) => {
      const preview = registry.getPreview(
        request.params.spaceId,
        request.params.requestId
      );
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, {
        request: preview,
        previewUrl:
          preview.state === "ready"
            ? `/api/v1/spaces/${encodeURIComponent(preview.spaceId)}/template-previews/${encodeURIComponent(preview.id)}/file`
            : null,
        canActivate: preview.state === "ready",
        canRetry: preview.state === "failed"
      });
    }
  );

  app.get<{ Params: PreviewParams }>(
    "/api/v1/spaces/:spaceId/template-previews/:requestId/file",
    { schema: { params: previewParamsSchema } },
    async (request, reply) => {
      const preview = registry.getPreview(
        request.params.spaceId,
        request.params.requestId
      );
      if (preview.state !== "ready" || preview.previewSha256 === null) {
        throw new TemplatePreviewConflictError(
          "Template preview PDF is not ready"
        );
      }
      const pdf = await objectStore.getBuffer(preview.previewSha256);
      return reply
        .type("application/pdf")
        .header("cache-control", "private, no-store")
        .header(
          "content-disposition",
          inlineDisposition(`предварительный-просмотр-${preview.title}.pdf`)
        )
        .header("x-content-type-options", "nosniff")
        .send(pdf);
    }
  );

  app.post<{ Params: PreviewParams }>(
    "/api/v1/spaces/:spaceId/template-previews/:requestId/activate",
    { schema: { params: previewParamsSchema } },
    async (request, reply) => {
      const preview = registry.getPreview(
        request.params.spaceId,
        request.params.requestId
      );
      if (preview.state !== "ready") {
        throw new TemplateActivationValidationError(
          "Template preview must be ready before activation"
        );
      }
      const active = registry.activateVersion(
        {
          spaceId: request.params.spaceId,
          previewRequestId: request.params.requestId
        },
        mutationContextFromRequest(request)
      );
      reply.code(201).header("cache-control", "no-store");
      return responseEnvelope(request, {
        active,
        catalogUrl: `/api/v1/spaces/${encodeURIComponent(active.spaceId)}/active-templates`,
        compiledUrl: `/api/v1/spaces/${encodeURIComponent(active.spaceId)}/active-templates/${encodeURIComponent(active.id)}/files/compiled`,
        previewUrl: `/api/v1/spaces/${encodeURIComponent(active.spaceId)}/active-templates/${encodeURIComponent(active.id)}/files/preview`
      });
    }
  );

  app.get<{ Params: { spaceId: string } }>(
    "/api/v1/spaces/:spaceId/active-templates",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId"],
          properties: {
            spaceId: { type: "string", minLength: 1, maxLength: 160 }
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        registry.listActiveTemplates(request.params.spaceId)
      )
  );

  app.get<{ Params: ActiveVersionParams }>(
    "/api/v1/spaces/:spaceId/active-templates/:activeVersionId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "activeVersionId"],
          properties: {
            spaceId: { type: "string", minLength: 1, maxLength: 160 },
            activeVersionId: {
              type: "string",
              minLength: 1,
              maxLength: 160
            }
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        registry.getActiveTemplate(
          request.params.spaceId,
          request.params.activeVersionId
        )
      )
  );

  app.get<{ Params: ActiveFileParams }>(
    "/api/v1/spaces/:spaceId/active-templates/:activeVersionId/files/:kind",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "activeVersionId", "kind"],
          properties: {
            spaceId: { type: "string", minLength: 1, maxLength: 160 },
            activeVersionId: {
              type: "string",
              minLength: 1,
              maxLength: 160
            },
            kind: { type: "string", enum: ["compiled", "preview"] }
          }
        }
      }
    },
    async (request, reply) => {
      const active = registry.getActiveTemplate(
        request.params.spaceId,
        request.params.activeVersionId
      );
      const isPreview = request.params.kind === "preview";
      const hash = isPreview ? active.previewSha256 : active.compiledSha256;
      const content = await objectStore.getBuffer(hash);
      const fileName = isPreview
        ? `${active.title}-предварительный-просмотр.pdf`
        : `${active.title}-версия-${active.versionNumber}.${active.format}`;
      return reply
        .type(isPreview ? "application/pdf" : officeMediaType(active.format))
        .header("cache-control", "private, no-store")
        .header("content-disposition", attachmentDisposition(fileName))
        .header("x-content-type-options", "nosniff")
        .send(content);
    }
  );
}
