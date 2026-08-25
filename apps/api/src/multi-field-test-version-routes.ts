import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  compileEntityCollectionDocx,
  compileScalarFields,
  renderEntityCollectionDocxTrial,
  renderScalarValues,
  type CompiledScalarFieldResult,
  type RenderedScalarFieldValue,
  type ScalarFieldBinding,
  type ScalarValueType
} from "@docomator/template-compiler";
import {
  ContentAddressedObjectStore,
  ENTITY_COLLECTION_ROW_NUMBER_KEY,
  EntityCollectionTemplateRepeatRegistry,
  MultiFieldTestVersionRegistry,
  MultiFieldTestVersionValidationError,
  TemplateDraftRegistry,
  toJsonValue,
  type JsonValue
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

function requiredProvidedValue(
  values: ReadonlyMap<string, string | number | boolean>,
  fieldId: string
): string | number | boolean {
  const value = values.get(fieldId);
  if (value === undefined) {
    throw new MultiFieldTestVersionValidationError(
      `Sample value was not found for field: ${fieldId}`
    );
  }
  return value;
}

function repeatContract(
  repeat:
    | {
        binding: { kind: "docx.repeat-row" | "xlsx.repeat-row" } & Record<string, unknown>;
        technicalBinding: Record<string, unknown>;
      }
    | null
): JsonValue | null {
  return repeat === null
    ? null
    : toJsonValue({
        version: 1,
        kind:
          repeat.binding.kind === "docx.repeat-row"
            ? "docx.repeat-row-contract"
            : "xlsx.repeat-row-contract",
        binding: repeat.binding,
        technicalBinding: repeat.technicalBinding
      });
}

export function registerMultiFieldTestVersionRoutes(
  app: FastifyInstance,
  objectStore: ContentAddressedObjectStore,
  draftRegistry: TemplateDraftRegistry,
  versionRegistry: MultiFieldTestVersionRegistry,
  entityCollectionRepeatRegistry?: EntityCollectionTemplateRepeatRegistry
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
              minItems: 0,
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
      const entityRepeat =
        entityCollectionRepeatRegistry?.getOptionalForDraft(
          request.params.spaceId,
          request.params.draftId
        ) ?? null;
      if (entityRepeat !== null && draft.repeatBinding !== null) {
        throw new MultiFieldTestVersionValidationError(
          "Черновик одновременно содержит два разных источника повторяемой строки. Создайте новый черновик и настройте только один источник."
        );
      }
      if (draft.fields.length === 0) {
        throw new MultiFieldTestVersionValidationError(
          "Для проверки шаблона нужно сохранить хотя бы одно поле."
        );
      }
      if (
        draft.fields.length < 2 &&
        draft.repeatBinding === null &&
        entityRepeat === null
      ) {
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
      if (entityRepeat !== null) {
        for (const field of draft.fields) {
          if (field.key === ENTITY_COLLECTION_ROW_NUMBER_KEY) {
            provided.set(field.id, entityRepeat.numbering.start);
          }
        }
      }
      const missing = draft.fields.filter((field) => !provided.has(field.id));
      const extra = [...provided.keys()].filter(
        (fieldId) => !draft.fields.some((field) => field.id === fieldId)
      );
      if (missing.length > 0 || extra.length > 0) {
        const missingLabels = missing
          .map((field) => `«${field.label}»`)
          .join(", ");
        throw new MultiFieldTestVersionValidationError(
          `Состав полей черновика изменился после открытия формы. Не переданы: ${missingLabels || "нет"}; лишних значений: ${extra.length}. Обновите форму и повторите проверку.`
        );
      }

      const source = await objectStore.getBuffer(draft.sourceSha256);
      let compiledOutput: Buffer;
      let compiledFields: CompiledScalarFieldResult[];
      let compiledModifiedParts: string[];
      let compiledSourceSha256: string;
      let compiledStructureSha256: string;
      let compiledOutputSha256: string;
      let compiledCheckedFields: number;
      let savedRepeatContract: JsonValue | null;
      let entityRepeatVerification: JsonValue | null = null;

      if (entityRepeat === null) {
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
        compiledOutput = compiled.output;
        compiledFields = compiled.fields;
        compiledModifiedParts = compiled.modifiedParts;
        compiledSourceSha256 = compiled.sourceSha256;
        compiledStructureSha256 = compiled.structureSha256;
        compiledOutputSha256 = compiled.outputSha256;
        compiledCheckedFields = compiled.verification.checkedFields;
        savedRepeatContract = repeatContract(
          compiled.repeat as Parameters<typeof repeatContract>[0]
        );
      } else {
        if (draft.format !== "docx") {
          throw new MultiFieldTestVersionValidationError(
            "Повторяемая таблица из карточки сотрудника в этой версии поддерживается только для DOCX."
          );
        }
        const compiled = await compileEntityCollectionDocx({
          source,
          fileName: `${draft.title}.docx`,
          expectedSourceSha256: draft.sourceSha256,
          expectedStructureSha256: draft.structureSha256,
          fields: draft.fields.map((field) => ({
            id: field.id,
            key: field.key,
            label: field.label,
            elementId: field.elementId,
            binding: field.binding
          })),
          repeat: {
            anchorElementId: entityRepeat.anchorElementId,
            part: entityRepeat.part,
            tableIndex: entityRepeat.tableIndex,
            rowIndex: entityRepeat.rowIndex
          }
        });
        compiledOutput = compiled.output;
        compiledFields = compiled.fields;
        compiledModifiedParts = compiled.modifiedParts;
        compiledSourceSha256 = compiled.sourceSha256;
        compiledStructureSha256 = compiled.structureSha256;
        compiledOutputSha256 = compiled.outputSha256;
        compiledCheckedFields = compiled.verification.checkedFields;
        savedRepeatContract = repeatContract({
          binding: compiled.repeat.binding as unknown as {
            kind: "docx.repeat-row";
          } & Record<string, unknown>,
          technicalBinding: compiled.repeat.technicalBinding as unknown as Record<string, unknown>
        });
        entityRepeatVerification = toJsonValue({
          sourceKind: "entity_collection",
          collectionDefinitionId: entityRepeat.collectionDefinitionId,
          collectionVersion: entityRepeat.collectionVersion,
          rowFieldIds: compiled.rowFieldIds,
          scalarFieldIds: compiled.scalarFieldIds,
          numbering: entityRepeat.numbering,
          emptyBehavior: entityRepeat.emptyBehavior
        });
      }

      const compiledByField = new Map(
        compiledFields.map((field) => [field.fieldId, field])
      );
      let renderedOutput: Buffer;
      let renderedFields: RenderedScalarFieldValue[];
      let renderedModifiedParts: string[];
      let renderedOutputSha256: string;
      let renderedCheckedFields: number;
      let repeatCheckedValues = 0;

      if (entityRepeat === null) {
        const parsedRepeat = savedRepeatContract;
        const repeatTechnicalBinding =
          parsedRepeat !== null &&
          typeof parsedRepeat === "object" &&
          !Array.isArray(parsedRepeat) &&
          typeof parsedRepeat.technicalBinding === "object" &&
          parsedRepeat.technicalBinding !== null &&
          !Array.isArray(parsedRepeat.technicalBinding) &&
          parsedRepeat.technicalBinding.kind === "xlsx.repeat-defined-name"
            ? parsedRepeat.technicalBinding
            : null;
        const rendered = await renderScalarValues({
          compiled: compiledOutput,
          ...(repeatTechnicalBinding === null
            ? {}
            : { repeatTechnicalBinding: repeatTechnicalBinding as never }),
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
              value: requiredProvidedValue(provided, field.id),
              formatter: field.formatter
            };
          })
        });
        renderedOutput = rendered.output;
        renderedFields = rendered.fields;
        renderedModifiedParts = rendered.modifiedParts;
        renderedOutputSha256 = rendered.outputSha256;
        renderedCheckedFields = rendered.verification.checkedFields;
      } else {
        if (savedRepeatContract === null) {
          throw new MultiFieldTestVersionValidationError(
            "Repeat contract was not compiled for entity collection"
          );
        }
        const compiledRepeat = await compileEntityCollectionDocx({
          source,
          fileName: `${draft.title}.docx`,
          expectedSourceSha256: draft.sourceSha256,
          expectedStructureSha256: draft.structureSha256,
          fields: draft.fields.map((field) => ({
            id: field.id,
            key: field.key,
            label: field.label,
            elementId: field.elementId,
            binding: field.binding
          })),
          repeat: {
            anchorElementId: entityRepeat.anchorElementId,
            part: entityRepeat.part,
            tableIndex: entityRepeat.tableIndex,
            rowIndex: entityRepeat.rowIndex
          }
        });
        const rendered = await renderEntityCollectionDocxTrial({
          compiled: compiledRepeat.output,
          repeat: compiledRepeat.repeat,
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
              required: field.required,
              technicalBinding: compiledField.technicalBinding,
              fieldBinding: field.binding as unknown as ScalarFieldBinding,
              valueType: field.valueType as ScalarValueType,
              value: requiredProvidedValue(provided, field.id),
              formatter: field.formatter
            };
          })
        });
        renderedOutput = rendered.output;
        renderedFields = rendered.fields;
        renderedModifiedParts = rendered.modifiedParts;
        renderedOutputSha256 = rendered.outputSha256;
        renderedCheckedFields = rendered.verification.checkedFields;
        repeatCheckedValues = rendered.verification.repeatCheckedValues;
      }

      const renderedByField = new Map(
        renderedFields.map((field) => [field.fieldId, field])
      );
      const version = await versionRegistry.recordTestedVersion(
        {
          spaceId: draft.spaceId,
          draftId: draft.id,
          format: draft.format,
          compiledBuffer: compiledOutput,
          trialBuffer: renderedOutput,
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
              sampleValue: toJsonValue(requiredProvidedValue(provided, field.id)),
              renderedValue: renderedField.renderedValue,
              readBackValue: renderedField.readBackValue,
              verification: toJsonValue({
                matched:
                  renderedField.renderedValue === renderedField.readBackValue,
                modifiedPart: renderedField.modifiedPart
              })
            };
          }),
          ...(savedRepeatContract === null
            ? {}
            : { repeatContract: savedRepeatContract }),
          verification: toJsonValue({
            compiledFields: compiledCheckedFields,
            readBackFields: renderedCheckedFields,
            repeatCheckedValues,
            sourceSha256: compiledSourceSha256,
            structureSha256: compiledStructureSha256,
            compiledSha256: compiledOutputSha256,
            trialSha256: renderedOutputSha256,
            modifiedParts: [
              ...new Set([
                ...compiledModifiedParts,
                ...renderedModifiedParts
              ])
            ].sort(),
            ...(entityRepeatVerification === null
              ? {}
              : { entityCollectionRepeat: entityRepeatVerification })
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
          ),
          ...(entityRepeat === null
            ? {}
            : {
                repeatSource: {
                  kind: "entity_collection",
                  collectionDefinitionId: entityRepeat.collectionDefinitionId,
                  numbering: entityRepeat.numbering
                }
              })
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
