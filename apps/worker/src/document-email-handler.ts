import type { WorkerConfig } from "@docomator/config";
import {
  ContentAddressedObjectStore,
  DocumentEmailDeliveryRegistry,
  emailDomainAllowed,
  normalizeEmailAddress,
  type JsonValue
} from "@docomator/storage";

import { PermanentJobError, type JobHandler } from "./processor.js";
import { SmtpClientError, sendSmtpMail } from "./smtp-client.js";

export interface DocumentEmailHandlerOptions {
  registry: DocumentEmailDeliveryRegistry;
  objectStore: ContentAddressedObjectStore;
  config: WorkerConfig;
  workerId: string;
  now?: () => Date;
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deliveryId(payload: JsonValue): string {
  if (!isJsonObject(payload)) {
    throw new PermanentJobError(
      "Задание почтовой доставки содержит недопустимые данные."
    );
  }
  const value = payload.emailDeliveryId;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PermanentJobError(
      "В задании почтовой доставки не указан идентификатор операции."
    );
  }
  return value.trim();
}

function errorPayload(error: unknown): JsonValue {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error instanceof SmtpClientError
        ? {
            retryable: error.retryable,
            smtpCode: error.smtpCode
          }
        : {})
    };
  }
  return { name: "UnknownError", message: String(error) };
}

export function createDocumentEmailHandler(
  options: DocumentEmailHandlerOptions
): JobHandler {
  const now = options.now ?? (() => new Date());
  return async ({ job, signal }) => {
    const id = deliveryId(job.payload);
    const context = {
      correlationId: `worker:email:${id}`,
      actorType: "worker",
      actorId: options.workerId,
      now: now().toISOString()
    } as const;

    try {
      if (!options.config.smtp.enabled || options.config.smtp.fromAddress === null) {
        throw new SmtpClientError(
          "Почтовая доставка отключена или не полностью настроена.",
          false
        );
      }
      options.registry.start(id, context);
      const work = options.registry.getWorkForWorker(id);
      const delivery = work.delivery;
      const recipient = normalizeEmailAddress(delivery.recipientEmail);
      if (!emailDomainAllowed(recipient, options.config.smtp.allowedDomains)) {
        throw new SmtpClientError(
          `Домен получателя ${recipient.domain} не разрешён настройками SMTP.`,
          false
        );
      }
      if (delivery.attachmentBytes > options.config.smtp.maxAttachmentBytes) {
        throw new SmtpClientError(
          `Размер вложения ${delivery.attachmentBytes} превышает разрешённый предел ${options.config.smtp.maxAttachmentBytes}.`,
          false
        );
      }
      if (signal.aborted) {
        throw new SmtpClientError("Почтовая доставка отменена.", true);
      }
      const attachment = await options.objectStore.getBuffer(
        delivery.sourceSha256
      );
      if (attachment.byteLength !== delivery.attachmentBytes) {
        throw new SmtpClientError(
          "Размер сохранённого вложения не совпадает с заданием доставки.",
          false
        );
      }
      const result = await sendSmtpMail(
        {
          host: options.config.smtp.host,
          port: options.config.smtp.port,
          secure: options.config.smtp.secure,
          startTls: options.config.smtp.startTls,
          rejectUnauthorized: options.config.smtp.rejectUnauthorized,
          user: options.config.smtp.user,
          password: options.config.smtp.password,
          timeoutMs: options.config.smtp.connectionTimeoutMs
        },
        {
          fromAddress: options.config.smtp.fromAddress,
          fromName: options.config.smtp.fromName,
          recipientEmail: delivery.recipientEmail,
          recipientName: delivery.recipientName,
          subject: delivery.subject,
          text: delivery.messageText,
          messageId: delivery.messageId,
          attachmentName: delivery.attachmentName,
          attachment
        },
        signal
      );
      options.registry.complete(id, result.response, {
        ...context,
        now: now().toISOString()
      });
    } catch (error) {
      const retryable =
        error instanceof SmtpClientError ? error.retryable : true;
      const final = !retryable || job.attempts >= job.maxAttempts;
      try {
        options.registry.failAttempt(id, errorPayload(error), final, {
          ...context,
          now: now().toISOString()
        });
      } catch {
        // Preserve the original delivery failure for the queue.
      }
      const message =
        error instanceof Error ? error.message : "Неизвестная ошибка почтовой доставки.";
      if (!retryable) {
        throw new PermanentJobError(message);
      }
      throw new Error(message);
    }
  };
}
