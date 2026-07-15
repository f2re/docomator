import {
  ContentAddressedObjectStore,
  DocumentDeliveryRegistry,
  DocumentScheduleRegistry,
  ScheduleNetworkDeliveryRegistry,
  safeNetworkFileName,
  writeNetworkFolderFile,
  type DocumentGenerationJobRecord,
  type DocumentScheduleRecord,
  type DocumentScheduleRunRecord
} from "@docomator/storage";

interface MutationContext {
  correlationId: string;
  actorType: string;
  actorId: string;
  now: string;
}

export interface ProcessScheduleNetworkDeliveryInput {
  settings: ScheduleNetworkDeliveryRegistry;
  deliveries: DocumentDeliveryRegistry;
  schedules: DocumentScheduleRegistry;
  objectStore: ContentAddressedObjectStore;
  networkDeliveryRoot: string | null;
  schedule: DocumentScheduleRecord;
  run: DocumentScheduleRunRecord;
  job: DocumentGenerationJobRecord;
  context: MutationContext;
}

function deliverySource(job: DocumentGenerationJobRecord): {
  sha256: string;
  fileName: string;
} {
  if (job.archiveSha256 !== null) {
    return {
      sha256: job.archiveSha256,
      fileName: `${safeNetworkFileName(job.templateTitle, "документы")}-комплект.zip`
    };
  }
  const unit = job.units.find(
    (candidate) =>
      candidate.state === "completed" && candidate.outputSha256 !== null
  );
  if (unit?.outputSha256 === null || unit === undefined) {
    throw new Error("Готовый файл задания не найден для сетевой доставки.");
  }
  return {
    sha256: unit.outputSha256,
    fileName:
      unit.outputName ??
      `${safeNetworkFileName(job.templateTitle, "документ")}.${job.format}`
  };
}

function renderSubdirectory(
  template: string,
  schedule: DocumentScheduleRecord,
  run: DocumentScheduleRunRecord
): string {
  const tokens = {
    schedule: safeNetworkFileName(schedule.name, "расписание"),
    period: safeNetworkFileName(run.periodKey, "период"),
    template: safeNetworkFileName(schedule.templateTitle, "шаблон"),
    group: safeNetworkFileName(schedule.groupName, "группа")
  };
  return template
    .replaceAll("{schedule}", tokens.schedule)
    .replaceAll("{period}", tokens.period)
    .replaceAll("{template}", tokens.template)
    .replaceAll("{group}", tokens.group);
}

export async function processScheduleNetworkDelivery(
  input: ProcessScheduleNetworkDeliveryInput
): Promise<boolean> {
  const setting = input.settings.get(input.schedule.id);
  if (setting === null) return false;

  if (input.networkDeliveryRoot === null) {
    input.schedules.fail(
      input.run.id,
      {
        code: "network_delivery_disabled",
        message:
          "Документы сформированы и сохранены в системе, но сетевая папка не настроена."
      },
      input.context
    );
    return true;
  }

  const source = deliverySource(input.job);
  const destinationRelative = renderSubdirectory(
    setting.subdirectoryTemplate,
    input.schedule,
    input.run
  );
  const attempt = input.deliveries.createNetworkAttempt(
    {
      spaceId: input.schedule.spaceId,
      documentJobId: input.job.id,
      sourceSha256: source.sha256,
      destinationRelative
    },
    input.context
  );

  if (attempt.delivery.state === "completed") {
    input.schedules.complete(
      input.run.id,
      {
        documentJobId: input.job.id,
        networkDeliveryId: attempt.delivery.id,
        destinationRelative: attempt.delivery.destinationRelative,
        deliveredName: attempt.delivery.deliveredName,
        deliveryChannel: "network_folder"
      },
      input.context
    );
    return true;
  }

  try {
    const content = await input.objectStore.getBuffer(source.sha256);
    const written = await writeNetworkFolderFile({
      root: input.networkDeliveryRoot,
      destinationRelative,
      fileName: source.fileName,
      content,
      uniquePrefix: attempt.delivery.id.slice(0, 8)
    });
    const delivery = input.deliveries.completeNetworkAttempt(
      {
        deliveryId: attempt.delivery.id,
        deliveredName: written.deliveredName,
        deliveredBytes: written.deliveredBytes
      },
      input.context
    );
    input.schedules.complete(
      input.run.id,
      {
        documentJobId: input.job.id,
        networkDeliveryId: delivery.id,
        destinationRelative: delivery.destinationRelative,
        deliveredName: delivery.deliveredName,
        deliveredBytes: delivery.deliveredBytes,
        deliveryChannel: "network_folder"
      },
      input.context
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Неизвестная ошибка сетевой папки.";
    try {
      input.deliveries.failNetworkAttempt(
        attempt.delivery.id,
        {
          code: "network_folder_delivery_failed",
          message
        },
        input.context
      );
    } catch {
      // The schedule result remains authoritative for the operator.
    }
    input.schedules.fail(
      input.run.id,
      {
        code: "network_folder_delivery_failed",
        message:
          "Документы сформированы и сохранены в системе, но запись в сетевую папку не выполнена.",
        detail: message
      },
      input.context
    );
  }
  return true;
}
