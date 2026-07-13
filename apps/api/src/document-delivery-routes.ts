import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

import type { ApiConfig } from "@docomator/config";
import {
  ContentAddressedObjectStore,
  DocumentDeliveryConflictError,
  DocumentDeliveryRegistry,
  DocumentDeliveryValidationError,
  DocumentGenerationConflictError,
  DocumentGenerationRegistry
} from "@docomator/storage";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { correlationId, mutationContextFromRequest } from "./request-context.js";

interface JobParams {
  spaceId: string;
  jobId: string;
}

interface DeliverBody {
  subdirectory?: string;
}

const idSchema = {
  type: "string",
  minLength: 1,
  maxLength: 160
} as const;

const paramsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["spaceId", "jobId"],
  properties: {
    spaceId: idSchema,
    jobId: idSchema
  }
} as const;

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
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

function relativeDirectory(value: string | undefined): {
  relative: string;
  segments: string[];
} {
  const raw = (value ?? "Документы").normalize("NFKC").trim();
  if (raw.length === 0 || raw.length > 500) {
    throw new DocumentDeliveryValidationError(
      "Каталог доставки должен содержать от 1 до 500 знаков."
    );
  }
  const normalized = raw.replace(/\\/gu, "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:/u.test(normalized) ||
    normalized.includes("\u0000")
  ) {
    throw new DocumentDeliveryValidationError(
      "Укажите только вложенный каталог внутри разрешённой сетевой папки."
    );
  }
  const segments = normalized
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (
    segments.length === 0 ||
    segments.length > 12 ||
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        segment.length > 120 ||
        /[\u0000-\u001f\u007f:*?"<>|]/u.test(segment)
    )
  ) {
    throw new DocumentDeliveryValidationError(
      "Название вложенного каталога содержит недопустимые элементы."
    );
  }
  return { relative: segments.join("/"), segments };
}

async function requireDirectoryWithoutSymlinks(
  root: string,
  segments: readonly string[]
): Promise<string> {
  let current = root;
  let rootStat;
  try {
    rootStat = await fs.lstat(root);
  } catch {
    throw new DocumentDeliveryValidationError(
      "Разрешённая сетевая папка недоступна. Обратитесь к администратору."
    );
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new DocumentDeliveryValidationError(
      "Разрешённый корень доставки должен быть обычным каталогом."
    );
  }
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new DocumentDeliveryValidationError(
          "Путь доставки содержит недопустимую ссылку или не является каталогом."
        );
      }
    } catch (error) {
      if (
        error instanceof DocumentDeliveryValidationError ||
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
      await fs.mkdir(current, { mode: 0o750 });
      const created = await fs.lstat(current);
      if (!created.isDirectory() || created.isSymbolicLink()) {
        throw new DocumentDeliveryValidationError(
          "Созданный путь доставки не является обычным каталогом."
        );
      }
    }
  }
  const resolvedRoot = path.resolve(root);
  const resolvedCurrent = path.resolve(current);
  if (
    resolvedCurrent !== resolvedRoot &&
    !resolvedCurrent.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new DocumentDeliveryValidationError(
      "Путь доставки выходит за пределы разрешённой папки."
    );
  }
  return resolvedCurrent;
}

async function atomicWrite(
  directory: string,
  fileName: string,
  content: Buffer
): Promise<void> {
  const finalPath = path.join(directory, fileName);
  const temporaryPath = path.join(
    directory,
    `.${fileName}.tmp-${randomUUID()}`
  );
  const handle = await fs.open(
    temporaryPath,
    fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      fsConstants.O_NOFOLLOW,
    0o640
  );
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporaryPath, finalPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

function deliverySource(
  job: ReturnType<DocumentGenerationRegistry["getJob"]>
): { sha256: string; fileName: string } {
  if (job.archiveSha256 !== null) {
    return {
      sha256: job.archiveSha256,
      fileName: `${safeFileName(job.templateTitle, "документы")}-комплект.zip`
    };
  }
  const output = job.units.find(
    (unit) => unit.state === "completed" && unit.outputSha256 !== null
  );
  if (output?.outputSha256 === null || output === undefined) {
    throw new DocumentGenerationConflictError(
      "Document generation output is not ready for delivery"
    );
  }
  return {
    sha256: output.outputSha256,
    fileName:
      output.outputName ??
      `${safeFileName(job.templateTitle, "документ")}.${job.format}`
  };
}

export function registerDocumentDeliveryRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  objectStore: ContentAddressedObjectStore,
  generations: DocumentGenerationRegistry,
  deliveries: DocumentDeliveryRegistry
): void {
  app.get<{ Params: JobParams }>(
    "/api/v1/spaces/:spaceId/document-jobs/:jobId/deliveries",
    { schema: { params: paramsSchema } },
    async (request) =>
      responseEnvelope(request, {
        networkFolderEnabled: config.networkDeliveryRoot !== null,
        deliveries: deliveries.listForJob(
          request.params.spaceId,
          request.params.jobId
        )
      })
  );

  app.post<{ Params: JobParams; Body: DeliverBody }>(
    "/api/v1/spaces/:spaceId/document-jobs/:jobId/deliver/network-folder",
    {
      schema: {
        params: paramsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            subdirectory: { type: "string", maxLength: 500 }
          }
        }
      }
    },
    async (request, reply) => {
      if (config.networkDeliveryRoot === null) {
        throw new DocumentDeliveryValidationError(
          "Доставка в сетевую папку не настроена администратором."
        );
      }
      const job = generations.getJob(
        request.params.spaceId,
        request.params.jobId
      );
      if (
        (job.state !== "completed" && job.state !== "partial") ||
        job.generatedCount < 1
      ) {
        throw new DocumentGenerationConflictError(
          "Document generation output is not ready for delivery"
        );
      }
      const destination = relativeDirectory(request.body.subdirectory);
      const source = deliverySource(job);
      const context = mutationContextFromRequest(request);
      const attempt = deliveries.createNetworkAttempt(
        {
          spaceId: job.spaceId,
          documentJobId: job.id,
          sourceSha256: source.sha256,
          destinationRelative: destination.relative
        },
        context
      );
      if (attempt.delivery.state === "completed") {
        reply.code(200).header("cache-control", "no-store");
        return responseEnvelope(request, {
          delivery: attempt.delivery,
          created: false
        });
      }
      const deliveredName = `${attempt.delivery.id.slice(0, 8)}-${safeFileName(source.fileName, "документ")}`;
      try {
        const directory = await requireDirectoryWithoutSymlinks(
          config.networkDeliveryRoot,
          destination.segments
        );
        const content = await objectStore.getBuffer(source.sha256);
        await atomicWrite(directory, deliveredName, content);
        const delivery = deliveries.completeNetworkAttempt(
          {
            deliveryId: attempt.delivery.id,
            deliveredName,
            deliveredBytes: content.byteLength
          },
          context
        );
        reply
          .code(attempt.created ? 201 : 200)
          .header("cache-control", "no-store");
        return responseEnvelope(request, {
          delivery,
          created: attempt.created
        });
      } catch (error) {
        deliveries.failNetworkAttempt(
          attempt.delivery.id,
          {
            code: "network_folder_delivery_failed",
            message:
              "Не удалось записать результат в сетевую папку. Проверьте доступность ресурса и права службы."
          },
          context
        );
        throw new DocumentDeliveryConflictError(
          "Не удалось записать результат в сетевую папку. Проверьте доступность ресурса и права службы."
        );
      }
    }
  );
}
