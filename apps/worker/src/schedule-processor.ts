import type { WorkerConfig } from "@docomator/config";
import {
  ContentAddressedObjectStore,
  DocumentDeliveryRegistry,
  DocumentEmailDeliveryRegistry,
  DocumentGenerationRegistry,
  DocumentPreflightRegistry,
  DocumentScheduleRegistry,
  EmailRecipientRegistry,
  ScheduleNetworkDeliveryRegistry,
  SpaceRegistry,
  type DocumentGenerationJobRecord,
  type DocumentScheduleRecord,
  type DocumentScheduleRunRecord,
  type JsonValue
} from "@docomator/storage";

import { processScheduleNetworkDelivery } from "./schedule-network-delivery.js";

export interface ScheduleProcessorOptions {
  schedules: DocumentScheduleRegistry;
  spaces: SpaceRegistry;
  preflight: DocumentPreflightRegistry;
  generations: DocumentGenerationRegistry;
  emails: DocumentEmailDeliveryRegistry;
  recipients: EmailRecipientRegistry;
  networkSettings: ScheduleNetworkDeliveryRegistry;
  deliveries: DocumentDeliveryRegistry;
  objectStore: ContentAddressedObjectStore;
  networkDeliveryRoot: string | null;
  config: WorkerConfig;
  workerId: string;
  now?: () => Date;
  maxRunsPerTick?: number;
}

export interface ScheduleTickResult {
  dueCreated: number;
  processed: number;
  failed: number;
}

function errorValue(error: unknown): JsonValue {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "UnknownError", message: String(error) };
}

function deliverySource(job: DocumentGenerationJobRecord): {
  sha256: string;
  fileName: string;
} {
  if (job.archiveSha256 !== null) {
    return {
      sha256: job.archiveSha256,
      fileName: `${safeFileName(job.templateTitle, "документы")}-комплект.zip`
    };
  }
  const unit = job.units.find(
    (candidate) =>
      candidate.state === "completed" && candidate.outputSha256 !== null
  );
  if (unit?.outputSha256 === null || unit === undefined) {
    throw new Error("Готовый файл задания не найден для доставки расписания.");
  }
  return {
    sha256: unit.outputSha256,
    fileName:
      unit.outputName ??
      `${safeFileName(job.templateTitle, "документ")}.${job.format}`
  };
}

function safeFileName(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f\u007f:*?"<>|]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[. ]+$/gu, "")
    .slice(0, 160);
  return normalized.length === 0 ? fallback : normalized;
}

function templateText(
  value: string,
  schedule: DocumentScheduleRecord,
  run: DocumentScheduleRunRecord
): string {
  return value
    .replaceAll("{schedule}", schedule.name)
    .replaceAll("{period}", run.periodKey)
    .replaceAll("{template}", schedule.templateTitle)
    .replaceAll("{group}", schedule.groupName);
}

function context(
  workerId: string,
  runId: string,
  now: Date
): {
  correlationId: string;
  actorType: string;
  actorId: string;
  now: string;
} {
  return {
    correlationId: `worker:schedule:${runId}`,
    actorType: "worker",
    actorId: workerId,
    now: now.toISOString()
  };
}

async function processPending(
  options: ScheduleProcessorOptions,
  schedule: DocumentScheduleRecord,
  run: DocumentScheduleRunRecord,
  now: Date
): Promise<void> {
  const mutation = context(options.workerId, run.id, now);
  if (schedule.groupMemberCount < 1) {
    options.schedules.skip(
      run.id,
      {
        code: "empty_group",
        message: "Сохранённая группа пуста; автоматический выпуск пропущен."
      },
      mutation
    );
    return;
  }
  const snapshot = options.spaces.createAudienceSnapshot(
    schedule.spaceId,
    {
      source: { kind: "group", groupId: schedule.groupId },
      targetMode: schedule.targetMode
    },
    mutation
  );
  const preflight = options.preflight.inspect(
    schedule.spaceId,
    schedule.activeReleaseId,
    snapshot.snapshot.id
  );
  if (schedule.targetMode === "aggregate" && preflight.missingMemberCount > 0) {
    options.schedules.skip(
      run.id,
      {
        code: "required_values_missing",
        message:
          "Сводный автоматический выпуск пропущен: не у всех участников заполнены обязательные данные.",
        missingMemberCount: preflight.missingMemberCount,
        missingValueCount: preflight.missingValueCount
      },
      mutation
    );
    return;
  }
  if (schedule.targetMode === "one_per_member" && preflight.readyMemberCount < 1) {
    options.schedules.skip(
      run.id,
      {
        code: "no_ready_members",
        message:
          "Автоматический выпуск пропущен: нет участников с полным набором обязательных данных.",
        missingMemberCount: preflight.missingMemberCount,
        missingValueCount: preflight.missingValueCount
      },
      mutation
    );
    return;
  }
  const generated = options.generations.createJob(
    {
      spaceId: schedule.spaceId,
      activeReleaseId: schedule.activeReleaseId,
      snapshotId: snapshot.snapshot.id,
      idempotencyKey: `schedule:${schedule.id}:${run.periodKey}`
    },
    mutation
  );
  options.schedules.markGenerationRequested(
    run.id,
    snapshot.snapshot.id,
    generated.job.id,
    mutation
  );
}

async function processGenerated(
  options: ScheduleProcessorOptions,
  schedule: DocumentScheduleRecord,
  run: DocumentScheduleRunRecord,
  now: Date
): Promise<void> {
  const mutation = context(options.workerId, run.id, now);
  if (run.documentJobId === null) {
    throw new Error("Запуск расписания не содержит идентификатор задания документов.");
  }
  const job = options.generations.getJob(schedule.spaceId, run.documentJobId);
  if (job.state === "pending" || job.state === "running") return;
  if (job.generatedCount < 1 || job.state === "failed") {
    options.schedules.fail(
      run.id,
      job.error ?? {
        code: "document_generation_failed",
        message: "Автоматическое формирование не создало ни одного документа."
      },
      mutation
    );
    return;
  }

  const networkHandled = await processScheduleNetworkDelivery({
    settings: options.networkSettings,
    deliveries: options.deliveries,
    schedules: options.schedules,
    objectStore: options.objectStore,
    networkDeliveryRoot: options.networkDeliveryRoot,
    schedule,
    run,
    job,
    context: mutation
  });
  if (networkHandled) return;

  if (schedule.deliveryChannel === "none") {
    options.schedules.complete(
      run.id,
      {
        documentJobId: job.id,
        generatedCount: job.generatedCount,
        failedCount: job.failedCount,
        deliveryChannel: "none"
      },
      mutation
    );
    return;
  }
  if (!options.config.smtp.enabled) {
    options.schedules.fail(
      run.id,
      {
        code: "smtp_disabled",
        message: "SMTP отключён; автоматическая доставка не выполнена."
      },
      mutation
    );
    return;
  }
  if (schedule.emailRecipientId === null) {
    throw new Error("В почтовом расписании не указан сохранённый получатель.");
  }
  const recipient = options.recipients.get(
    schedule.spaceId,
    schedule.emailRecipientId
  );
  if (recipient.status !== "active") {
    options.schedules.fail(
      run.id,
      {
        code: "recipient_inactive",
        message: "Сохранённый получатель отключён; письмо не поставлено в очередь."
      },
      mutation
    );
    return;
  }
  const source = deliverySource(job);
  const email = options.emails.create(
    {
      spaceId: schedule.spaceId,
      documentJobId: job.id,
      sourceSha256: source.sha256,
      attachmentName: source.fileName,
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      subject: templateText(
        schedule.emailSubject ?? `Документы: ${schedule.templateTitle}`,
        schedule,
        run
      ),
      messageText: templateText(
        schedule.emailMessageText ?? "Документы находятся во вложении.",
        schedule,
        run
      ),
      maxAttachmentBytes: options.config.smtp.maxAttachmentBytes
    },
    mutation
  );
  options.schedules.markDeliveryRequested(run.id, email.delivery.id, mutation);
}

function processDelivery(
  options: ScheduleProcessorOptions,
  schedule: DocumentScheduleRecord,
  run: DocumentScheduleRunRecord,
  now: Date
): void {
  const mutation = context(options.workerId, run.id, now);
  if (run.emailDeliveryId === null) {
    throw new Error("Запуск расписания не содержит идентификатор почтовой доставки.");
  }
  const delivery = options.emails.get(schedule.spaceId, run.emailDeliveryId);
  if (delivery.state === "completed") {
    options.schedules.complete(
      run.id,
      {
        documentJobId: run.documentJobId,
        emailDeliveryId: delivery.id,
        recipientEmail: delivery.recipientEmail,
        messageId: delivery.messageId,
        deliveryChannel: "email"
      },
      mutation
    );
    return;
  }
  if (delivery.state === "failed") {
    options.schedules.fail(
      run.id,
      delivery.error ?? {
        code: "email_delivery_failed",
        message: "Почтовая доставка завершилась ошибкой."
      },
      mutation
    );
  }
}

async function processRun(
  options: ScheduleProcessorOptions,
  run: DocumentScheduleRunRecord,
  now: Date
): Promise<void> {
  const work = options.schedules.getRunWork(run.id);
  if (work.run.state === "pending") {
    await processPending(options, work.schedule, work.run, now);
    return;
  }
  if (work.run.state === "generation_requested") {
    await processGenerated(options, work.schedule, work.run, now);
    return;
  }
  if (work.run.state === "delivery_requested") {
    processDelivery(options, work.schedule, work.run, now);
  }
}

export async function processScheduleTick(
  options: ScheduleProcessorOptions
): Promise<ScheduleTickResult> {
  const now = options.now?.() ?? new Date();
  const limit = options.maxRunsPerTick ?? 20;
  const dueCreated = options.schedules.claimDue(now, limit);
  const runs = options.schedules.listRunnable(limit);
  let processed = 0;
  let failed = 0;
  for (const run of runs) {
    try {
      await processRun(options, run, now);
      processed += 1;
    } catch (error) {
      failed += 1;
      try {
        options.schedules.fail(
          run.id,
          errorValue(error),
          context(options.workerId, run.id, now)
        );
      } catch {
        // Preserve the main worker loop; the run remains visible for diagnosis.
      }
    }
  }
  return { dueCreated, processed, failed };
}
