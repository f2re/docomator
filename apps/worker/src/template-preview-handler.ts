import path from "node:path";

import type { WorkerConfig } from "@docomator/config";
import {
  ContentAddressedObjectStore,
  TemplatePreviewActivationRegistry,
  TemplatePreviewConflictError,
  TemplatePreviewNotFoundError,
  toJsonValue,
  type JsonValue
} from "@docomator/storage";

import {
  convertOfficeToPdf,
  LibreOfficePreviewError,
  type LibreOfficePreviewOptions,
  type LibreOfficePreviewResult
} from "./libreoffice-preview.js";
import {
  PermanentJobError,
  type JobHandler
} from "./processor.js";

export interface TemplatePreviewHandlerOptions {
  registry: TemplatePreviewActivationRegistry;
  objectStore: ContentAddressedObjectStore;
  config: Pick<
    WorkerConfig,
    | "dataDir"
    | "workerId"
    | "previewEnabled"
    | "libreOfficeBinary"
    | "previewTimeoutMs"
    | "previewMaxOutputBytes"
  >;
  convert?: (
    options: LibreOfficePreviewOptions
  ) => Promise<LibreOfficePreviewResult>;
  now?: () => Date;
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function previewRequestId(payload: JsonValue): string {
  if (!isJsonObject(payload)) {
    throw new PermanentJobError(
      "Задание предварительного просмотра содержит недопустимые данные."
    );
  }
  const value = payload.previewRequestId;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PermanentJobError(
      "В задании предварительного просмотра не указан идентификатор запроса."
    );
  }
  return value.trim();
}

function failurePayload(error: unknown): JsonValue {
  if (error instanceof LibreOfficePreviewError) {
    return {
      code: error.code,
      message: error.userMessage
    };
  }
  if (error instanceof TemplatePreviewNotFoundError) {
    return {
      code: "preview_request_not_found",
      message: "Запрос предварительного просмотра больше не найден."
    };
  }
  if (error instanceof TemplatePreviewConflictError) {
    return {
      code: "preview_state_conflict",
      message: "Состояние предварительного просмотра изменилось. Обновите страницу."
    };
  }
  return {
    code: "preview_internal_error",
    message:
      "Предварительный просмотр создать не удалось. Повторите действие или обратитесь к администратору."
  };
}

function technicalMessage(error: unknown): string {
  if (error instanceof LibreOfficePreviewError) {
    return `${error.code}: ${error.technicalMessage}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function createTemplatePreviewHandler(
  options: TemplatePreviewHandlerOptions
): JobHandler {
  const convert = options.convert ?? convertOfficeToPdf;
  const now = options.now ?? (() => new Date());

  return async ({ job, signal }) => {
    const requestId = previewRequestId(job.payload);
    const request = options.registry.getPreviewForWorker(requestId);
    if (request.state === "ready") return;
    if (request.state === "failed") {
      throw new PermanentJobError(
        "Запрос предварительного просмотра уже завершён ошибкой. Создайте новую попытку."
      );
    }

    const context = {
      correlationId: request.correlationId,
      actorType: "worker",
      actorId: options.config.workerId,
      now: now().toISOString()
    } as const;

    if (!options.config.previewEnabled) {
      const error = new LibreOfficePreviewError(
        "preview_disabled",
        "Предварительный просмотр отключён администратором."
      );
      options.registry.failPreview(requestId, failurePayload(error), context);
      throw new PermanentJobError(technicalMessage(error));
    }

    try {
      const trialDocument = await options.objectStore.getBuffer(
        request.trialSha256
      );
      const converted = await convert({
        binary: options.config.libreOfficeBinary,
        input: trialDocument,
        format: request.format,
        temporaryRoot: path.join(options.config.dataDir, "tmp", "previews"),
        timeoutMs: options.config.previewTimeoutMs,
        maxOutputBytes: options.config.previewMaxOutputBytes,
        signal
      });
      await options.registry.completePreview(
        {
          requestId,
          previewBuffer: converted.pdf,
          converter: toJsonValue(converted.metadata)
        },
        context
      );
    } catch (error) {
      try {
        const current = options.registry.getPreviewForWorker(requestId);
        if (current.state === "pending") {
          options.registry.failPreview(
            requestId,
            failurePayload(error),
            context
          );
        }
      } catch (stateError) {
        throw new PermanentJobError(
          `${technicalMessage(error)}; failed to persist preview error: ${technicalMessage(stateError)}`
        );
      }
      throw new PermanentJobError(technicalMessage(error));
    }
  };
}
