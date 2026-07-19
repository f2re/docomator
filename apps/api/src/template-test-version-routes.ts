import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  compileScalarField,
  renderScalarValue,
  type ScalarFieldBinding,
  type ScalarValueType
} from "@docomator/template-compiler";
import {
  ContentAddressedObjectStore,
  TemplateDraftRegistry,
  TemplateDraftValidationError,
  TemplateTestVersionRegistry,
  toJsonValue
} from "@docomator/storage";

import {
  correlationId,
  mutationContextFromRequest
} from "./request-context.js";

interface DraftParams {
  spaceId: string;
  draftId: string;
}

interface VersionParams {
  spaceId: string;
  versionId: string;
}

interface VersionFileParams extends VersionParams {
  kind: "compiled" | "trial";
}

interface TrialBody {
  fieldId: string;
  value: string | number | boolean;
}

interface ListQuery {
  limit?: number;
}

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

function mediaType(format: "docx" | "xlsx"): string {
  return format === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function downloadName(
  versionNumber: number,
  kind: "compiled" | "trial",
  format: "docx" | "xlsx"
): string {
  const role = kind === "compiled" ? "техническая-привязка" : "пробное-заполнение";
  return `шаблон-версия-${versionNumber}-${role}.${format}`;
}

function contentDisposition(fileName: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

const draftParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["spaceId", "draftId"],
  properties: {
    spaceId: { type: "string", minLength: 1, maxLength: 160 },
    draftId: { type: "string", minLength: 1, maxLength: 160 }
  }
} as const;

export function registerTemplateTestVersionRoutes(
  app: FastifyInstance,
  objectStore: ContentAddressedObjectStore,
  draftRegistry: TemplateDraftRegistry,
  versionRegistry: TemplateTestVersionRegistry
): void {
  app.post<{ Params: DraftParams; Body: TrialBody }>(
    "/api/v1/spaces/:spaceId/template-drafts/:draftId/trial",
    {
      schema: {
        params: draftParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["fieldId", "value"],
          properties: {
            fieldId: { type: "string", minLength: 1, maxLength: 160 },
            value: {
              oneOf: [
                { type: "string", maxLength: 20_000 },
                { type: "number" },
                { type: "boolean" }
              ]
            }
          }
        }
      }
    },
    async (request, reply) => {
      const draft = draftRegistry.getDraft(
        request.params.spaceId,
        request.params.draftId
      );
      const field = draft.fields.find(
        (candidate) => candidate.id === request.body.fieldId
      );
      if (draft.repeatBinding !== null) {
        throw new TemplateDraftValidationError(
          "Повторяемую строку нужно проверять целиком через форму всех полей."
        );
      }
      if (field === undefined) {
        throw new TemplateDraftValidationError(
          `Template field was not found in this draft: ${request.body.fieldId}`
        );
      }
      if (field.structureSha256 !== draft.structureSha256) {
        throw new TemplateDraftValidationError(
          "Template field does not match the current draft structure"
        );
      }

      const source = await objectStore.getBuffer(draft.sourceSha256);
      const compiled = await compileScalarField({
        source,
        fileName: `${draft.title}.${draft.format}`,
        expectedSourceSha256: draft.sourceSha256,
        expectedStructureSha256: draft.structureSha256,
        field: {
          id: field.id,
          key: field.key,
          label: field.label,
          elementId: field.elementId,
          binding: field.binding
        }
      });
      const trial = await renderScalarValue({
        compiled: compiled.output,
        technicalBinding: compiled.technicalBinding,
        fieldBinding: field.binding as unknown as ScalarFieldBinding,
        valueType: field.valueType as ScalarValueType,
        value: request.body.value,
        formatter: field.formatter
      });
      const version = await versionRegistry.recordTestedVersion(
        {
          spaceId: draft.spaceId,
          draftId: draft.id,
          fieldId: field.id,
          format: draft.format,
          compiledBuffer: compiled.output,
          trialBuffer: trial.output,
          technicalBinding: toJsonValue(compiled.technicalBinding),
          sampleValue: toJsonValue(request.body.value),
          renderedValue: trial.renderedValue,
          readBackValue: trial.readBackValue,
          verification: toJsonValue({
            bindingFound: compiled.verification.found,
            bindingMessage: compiled.verification.message,
            readBackMatched: trial.verification.matched,
            readBackMessage: trial.verification.message,
            sourceSha256: compiled.sourceSha256,
            structureSha256: compiled.structureSha256,
            compiledSha256: compiled.outputSha256,
            trialSha256: trial.outputSha256,
            modifiedParts: [
              ...new Set([...compiled.modifiedParts, trial.modifiedPart])
            ].sort()
          })
        },
        mutationContextFromRequest(request)
      );

      reply.code(201).header("cache-control", "no-store");
      return responseEnvelope(request, {
        version,
        field: {
          id: field.id,
          key: field.key,
          label: field.label,
          valueType: field.valueType
        },
        verification: {
          technicalBinding: compiled.technicalBinding,
          renderedValue: trial.renderedValue,
          readBackValue: trial.readBackValue,
          matched: trial.verification.matched
        },
        downloads: {
          compiled: `/api/v1/spaces/${encodeURIComponent(draft.spaceId)}/template-test-versions/${encodeURIComponent(version.id)}/files/compiled`,
          trial: `/api/v1/spaces/${encodeURIComponent(draft.spaceId)}/template-test-versions/${encodeURIComponent(version.id)}/files/trial`
        }
      });
    }
  );

  app.get<{ Params: DraftParams; Querystring: ListQuery }>(
    "/api/v1/spaces/:spaceId/template-drafts/:draftId/test-versions",
    {
      schema: {
        params: draftParamsSchema,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 500 }
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        versionRegistry.listVersions(
          request.params.spaceId,
          request.params.draftId,
          request.query.limit ?? 100
        )
      )
  );

  app.get<{ Params: VersionParams }>(
    "/api/v1/spaces/:spaceId/template-test-versions/:versionId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "versionId"],
          properties: {
            spaceId: { type: "string", minLength: 1, maxLength: 160 },
            versionId: { type: "string", minLength: 1, maxLength: 160 }
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        versionRegistry.getVersion(
          request.params.spaceId,
          request.params.versionId
        )
      )
  );

  app.get<{ Params: VersionFileParams }>(
    "/api/v1/spaces/:spaceId/template-test-versions/:versionId/files/:kind",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "versionId", "kind"],
          properties: {
            spaceId: { type: "string", minLength: 1, maxLength: 160 },
            versionId: { type: "string", minLength: 1, maxLength: 160 },
            kind: { type: "string", enum: ["compiled", "trial"] }
          }
        }
      }
    },
    async (request, reply) => {
      const version = versionRegistry.getVersion(
        request.params.spaceId,
        request.params.versionId
      );
      const hash =
        request.params.kind === "compiled"
          ? version.compiledSha256
          : version.trialSha256;
      const buffer = await objectStore.getBuffer(hash);
      return reply
        .type(mediaType(version.format))
        .header("cache-control", "private, no-store")
        .header(
          "content-disposition",
          contentDisposition(
            downloadName(version.versionNumber, request.params.kind, version.format)
          )
        )
        .header("x-content-type-options", "nosniff")
        .send(buffer);
    }
  );
}
