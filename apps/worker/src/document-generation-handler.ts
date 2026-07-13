import {
  ContentAddressedObjectStore,
  DocumentGenerationRegistry,
  documentValueMissing,
  resolveDocumentMemberValues,
  type JsonValue
} from "@docomator/storage";
import {
  renderAudienceAggregate,
  renderScalarValues,
  writeOoxmlPackage,
  type CompiledTechnicalBinding,
  type OoxmlPackageEntry,
  type ScalarFieldBinding,
  type ScalarValueType
} from "@docomator/template-compiler";

import { PermanentJobError, type JobHandler } from "./processor.js";

export interface DocumentGenerationHandlerOptions {
  registry: DocumentGenerationRegistry;
  objectStore: ContentAddressedObjectStore;
  workerId: string;
  now?: () => Date;
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function documentJobId(payload: JsonValue): string {
  if (!isJsonObject(payload)) {
    throw new PermanentJobError("Задание формирования содержит недопустимые данные.");
  }
  const value = payload.documentJobId;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PermanentJobError(
      "В задании формирования не указан идентификатор операции."
    );
  }
  return value.trim();
}

function safeName(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f\u007f:*?"<>|]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 120);
  return normalized.length === 0 ? fallback : normalized;
}

function errorPayload(message: string, code = "document_generation_failed"): JsonValue {
  return { code, message };
}

function unitFileName(
  position: number,
  displayName: string,
  title: string,
  extension: "docx" | "xlsx"
): string {
  const number = String(position + 1).padStart(4, "0");
  return `${number}-${safeName(displayName, "участник")}-${safeName(title, "документ")}.${extension}`;
}

export function createDocumentGenerationHandler(
  options: DocumentGenerationHandlerOptions
): JobHandler {
  const now = options.now ?? (() => new Date());
  return async ({ job, signal }) => {
    const jobId = documentJobId(job.payload);
    const context = {
      correlationId: `worker:${jobId}`,
      actorType: "worker",
      actorId: options.workerId,
      now: now().toISOString()
    } as const;

    try {
      options.registry.startJob(jobId, context);
      const work = options.registry.getWorkForWorker(jobId);
      const shared = {
        spaceName: work.space.name,
        spaceKey: work.space.key,
        audienceCount: work.members.length
      };

      if (signal.aborted) {
        throw new Error("Формирование отменено до начала обработки.");
      }

      if (work.job.targetMode === "aggregate") {
        const unit = work.job.units[0];
        if (unit === undefined) {
          throw new Error("Для сводного документа не создана единица формирования.");
        }
        options.registry.startUnit(unit.id, context);
        const rows = work.members.map((member) => ({
          member,
          resolved: resolveDocumentMemberValues(
            work.template.fields,
            member,
            shared
          )
        }));
        const missingRows = rows.filter(
          (row) => row.resolved.missingRequired.length > 0
        );
        if (missingRows.length > 0) {
          const preview = missingRows
            .slice(0, 8)
            .map(
              (row) =>
                `${row.member.displayName}: ${row.resolved.missingRequired
                  .map((field) => field.label)
                  .join(", ")}`
            )
            .join("; ");
          options.registry.failUnit(
            unit.id,
            errorPayload(
              `Не заполнены обязательные данные для ${missingRows.length} участников. ${preview}`,
              "required_values_missing"
            ),
            context
          );
        } else {
          const output = renderAudienceAggregate({
            format: work.template.format,
            title: `${work.template.title} — сводный документ`,
            fields: work.template.fields.map((field) => ({
              key: field.key,
              label: field.label,
              valueType: field.valueType as ScalarValueType
            })),
            members: rows.map(({ member, resolved }) => ({
              entityId: member.entityId,
              displayName: member.displayName,
              values: resolved.values
            }))
          });
          const outputName = `${safeName(work.template.title, "сводный-документ")}-участники-${work.members.length}.${work.template.format}`;
          await options.registry.completeUnit(
            unit.id,
            output,
            outputName,
            work.template.format,
            context
          );
        }
      } else {
        const compiled = await options.objectStore.getBuffer(
          work.template.compiledSha256
        );
        const membersById = new Map(
          work.members.map((member) => [member.entityId, member])
        );
        for (const unit of work.job.units) {
          if (signal.aborted) {
            throw new Error("Формирование документов отменено.");
          }
          if (unit.state === "completed") continue;
          options.registry.startUnit(unit.id, context);
          const member =
            unit.primaryEntityId === null
              ? undefined
              : membersById.get(unit.primaryEntityId);
          if (member === undefined) {
            options.registry.failUnit(
              unit.id,
              errorPayload(
                "Участник больше не найден в зафиксированном составе.",
                "snapshot_member_missing"
              ),
              context
            );
            continue;
          }
          const resolved = resolveDocumentMemberValues(
            work.template.fields,
            member,
            shared
          );
          if (resolved.missingRequired.length > 0) {
            options.registry.failUnit(
              unit.id,
              errorPayload(
                `Не заполнены обязательные поля: ${resolved.missingRequired
                  .map((field) => field.label)
                  .join(", ")}.`,
                "required_values_missing"
              ),
              context
            );
            continue;
          }
          const rendered = await renderScalarValues({
            compiled,
            fields: work.template.fields.map((field, index) => {
              const value = resolved.values[index];
              const emptyOptional = !field.required && documentValueMissing(value);
              return {
                fieldId: field.id,
                fieldKey: field.key,
                technicalBinding:
                  field.technicalBinding as unknown as CompiledTechnicalBinding,
                fieldBinding: field.binding as unknown as ScalarFieldBinding,
                valueType: (emptyOptional
                  ? "string"
                  : field.valueType) as ScalarValueType,
                value: emptyOptional ? "" : value
              };
            })
          });
          const outputName = unitFileName(
            unit.position,
            member.displayName,
            work.template.title,
            work.template.format
          );
          await options.registry.completeUnit(
            unit.id,
            rendered.output,
            outputName,
            work.template.format,
            context
          );
        }
      }

      const refreshed = options.registry.getJob(work.job.spaceId, jobId);
      const completedUnits = refreshed.units.filter(
        (unit) => unit.state === "completed" && unit.outputSha256 !== null
      );
      let archive: Buffer | null = null;
      if (completedUnits.length > 1) {
        const entries: OoxmlPackageEntry[] = [];
        for (const unit of completedUnits) {
          if (unit.outputSha256 === null) continue;
          entries.push({
            name: safeName(
              unit.outputName ?? `документ-${unit.position + 1}.${work.template.format}`,
              `документ-${unit.position + 1}.${work.template.format}`
            ),
            content: await options.objectStore.getBuffer(unit.outputSha256),
            isDirectory: false
          });
        }
        archive = writeOoxmlPackage(entries);
      }
      await options.registry.finishJob(jobId, archive, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        options.registry.failJob(jobId, errorPayload(message), context);
      } catch {
        // The original error is more useful to the worker queue.
      }
      throw new PermanentJobError(message);
    }
  };
}
