import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  compileScalarFields,
  renderScalarValues,
  type ScalarFieldBinding,
  type ScalarValueType
} from "@docomator/template-compiler";
import {
  ContentAddressedObjectStore,
  MultiFieldTestVersionRegistry,
  MultiFieldTestVersionValidationError,
  TemplateDraftRegistry,
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

interface FileParams extends VersionParams {
  kind: "compiled" | "trial";
}

interface ValueInput {
  fieldId: string;
  value: string | number | boolean;
}

interface TrialAllBody {
  values: ValueInput[];
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

function disposition(fileName: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function fileName(
  versionNumber: number,
  kind: "compiled" | "trial",
  format: "docx" | "xlsx"
): string {
  const role = kind === "compiled" ? "многополевая-привязка" : "многополевая-проверка";
  return `шаблон-версия-${versionNumber}-${role}.${format}`;
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

function uniqueValues(values: readonly ValueInput[]): Map<string, string | number | boolean> {
  const result = new Map<string, string | number | boolean>();
  for (const item of values) {
    if (result.has(item.fieldId)) {
      throw new MultiFieldTestVersionValidationError(
        `Duplicate fieldId in multi-field request: ${item.fieldId}`
      );
    }
    result.set(item.fieldId, item.value);
  }
  return result;
}

export function registerMultiFieldTestVersionRoutes(
  app: FastifyInstance,
  objectStore: ContentAddressedObjectStore,
  draftRegistry: TemplateDraftRegistry,
  versionRegistry: MultiFieldTestVersionRegistry
): void {
  app.post<{ Params: DraftParams; Body: TrialAllBody }>(
    "/api/v1/spaces/:spaceId/template-drafts/:draftId/trial-all",
    {
      schema: {
        params: draftParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["values"],
          properties: {
            values: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["fieldId", "value"],
                properties: {
                  fieldId: { type: "string", minLength: 1, maxLength: 160 },
                  value: {
                    anyOf: [
                      { type: "string", maxLength: 20_000 },
                      { type: "number" },
                      { type: "boolean" }
                    ]
                  }
                }
              }
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
      if (draft.fields.length < 2 && draft.repeatBinding === null) {
        throw new MultiFieldTestVersionValidationError(
          "Multi-field trial requires at least two saved fields"
        );
      }
      if (draft.fields.length > 100) {
        throw new MultiFieldTestVersionValidationError(
          "Multi-field trial supports at most 100 saved fields"
        );
      }
      const provided = uniqueValues(request.body.values);
      const missing = draft.fields.filter((field) => !provided.has(field.id));
      const extra = [...provided.keys()].filter(
        (fieldId) => !draft.fields.some((field) => field.id === fieldId)
      );
      if (missing.length > 0 || extra.length > 0) {
        throw new MultiFieldTestVersionValidationError(
          `Multi-field trial must provide exactly all draft fields; missing=${missing
            .map((field) => field.key)
            .join(",")}; extra=${extra.join(",")}`
        );
      }

      const source = await objectStore.getBuffer(draft.sourceSha256);
      const compiled = await compileScalarFields({
        source,
        fileName: `${draft.title}.${draft.format}`,
        expectedSourceSha256: draft.sourceSha256,
        expectedStructureSha256: draft.structureSha256,
        fields: draft.fields.map((field) => ({
          id: field.id,
          key: field.key,
          label: field.label,
          elementId: field.elementId,
          binding: field.binding
        })),
        ...(draft.repeatBinding === null
          ? {}
          : { repeatBinding: draft.repeatBinding })
      });
      if (draft.repeatBinding !== null && compiled.repeat === null) {
        throw new MultiFieldTestVersionValidationError(
          "Compiled repeat row was not found"
        );
      }
      const repeatContract =
        compiled.repeat === null
          ? null
          : toJsonValue({
              version: 1,
              kind:
                compiled.repeat.binding.kind === "docx.repeat-row"
                  ? "docx.repeat-row-contract"
                  : "xlsx.repeat-row-contract",
              binding: compiled.repeat.binding,
              technicalBinding: compiled.repeat.technicalBinding
            });
      const compiledByField = new Map(
        compiled.fields.map((field) => [field.fieldId, field])
      );
      const rendered = await renderScalarValues({
        compiled: compiled.output,
        ...(compiled.repeat?.technicalBinding.kind ===
        "xlsx.repeat-defined-name"
          ? { repeatTechnicalBinding: compiled.repeat.technicalBinding }
          : {}),
        fields: draft.fields.map((field) => {
          const compiledField = compiledByField.get(field.id);
          if (compiledField === undefined) {
            throw new MultiFieldTestVersionValidationError(
              `Compiled field was not found: ${field.key}`
            );
          }
          return {
            fieldId: field.id,
            fieldKey: field.key,
            technicalBinding: compiledField.technicalBinding,
            fieldBinding: field.binding as unknown as ScalarFieldBinding,
            valueType: field.valueType as ScalarValueType,
            value: provided.get(field.id),
            formatter: field.formatter
          };
        })
      });
      const renderedByField = new Map(
        rendered.fields.map((field) => [field.fieldId, field])
      );
      const version = await versionRegistry.recordTestedVersion(
        {
          spaceId: draft.spaceId,
          draftId: draft.id,
          format: draft.format,
          compiledBuffer: compiled.output,
          trialBuffer: rendered.output,
          fields: draft.fields.map((field) => {
            const compiledField = compiledByField.get(field.id);
            const renderedField = renderedByField.get(field.id);
            if (compiledField === undefined || renderedField === undefined) {
              throw new MultiFieldTestVersionValidationError(
                `Final field result was not found: ${field.key}`
              );
            }
            return {
              fieldId: field.id,
              fieldKey: field.key,
              fieldLabel: field.label,
              valueType: field.valueType,
              required: field.required,
              binding: field.binding,
              formatter: field.formatter,
              technicalBinding: toJsonValue(compiledField.technicalBinding),
              sampleValue: toJsonValue(provided.get(field.id)),
              renderedValue: renderedField.renderedValue,
              readBackValue: renderedField.readBackValue,
              verification: toJsonValue({
                matched:
                  renderedField.renderedValue === renderedField.readBackValue,
                modifiedPart: renderedField.modifiedPart
              })
            };
          }),
          ...(repeatContract === null ? {} : { repeatContract }),
          verification: toJsonValue({
            compiledFields: compiled.verification.checkedFields,
            readBackFields: rendered.verification.checkedFields,
            sourceSha256: compiled.sourceSha256,
            structureSha256: compiled.structureSha256,
            compiledSha256: compiled.outputSha256,
            trialSha256: rendered.outputSha256,
            modifiedParts: [
              ...new Set([
                ...compiled.modifiedParts,
                ...rendered.modifiedParts
              ])
            ].sort()
          })
        },
        mutationContextFromRequest(request)
      );

      reply.code(201).header("cache-control", "no-store");
      return responseEnvelope(request, {
        version,
        verification: {
          fieldCount: version.fieldCount,
          allMatched: version.fields.every(
            (field) => field.renderedValue === field.readBackValue
          )
        },
        downloads: {
          compiled: `/api/v1/spaces/${encodeURIComponent(version.spaceId)}/template-multi-test-versions/${encodeURIComponent(version.id)}/files/compiled`,
          trial: `/api/v1/spaces/${encodeURIComponent(version.spaceId)}/template-multi-test-versions/${encodeURIComponent(version.id)}/files/trial`
        }
      });
    }
  );

  app.get<{ Params: DraftParams; Querystring: ListQuery }>(
    "/api/v1/spaces/:spaceId/template-drafts/:draftId/multi-test-versions",
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
    "/api/v1/spaces/:spaceId/template-multi-test-versions/:versionId",
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

  app.get<{ Params: FileParams }>(
    "/api/v1/spaces/:spaceId/template-multi-test-versions/:versionId/files/:kind",
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
      const content = await objectStore.getBuffer(hash);
      return reply
        .type(mediaType(version.format))
        .header("cache-control", "private, no-store")
        .header(
          "content-disposition",
          disposition(
            fileName(
              version.versionNumber,
              request.params.kind,
              version.format
            )
          )
        )
        .header("x-content-type-options", "nosniff")
        .send(content);
    }
  );
}
