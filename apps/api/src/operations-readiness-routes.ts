import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type { ApiConfig } from "@docomator/config";
import {
  ContentAddressedObjectStore,
  RuntimeStatusRegistry,
  SqliteStore,
  type JsonValue
} from "@docomator/storage";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { correlationId } from "./request-context.js";

const execFileAsync = promisify(execFile);

export type OperationsCheckState = "ok" | "warning" | "error" | "disabled";

export interface OperationsCheck {
  id: string;
  title: string;
  state: OperationsCheckState;
  required: boolean;
  summary: string;
  detail: string | null;
  remediation: string | null;
  data: JsonValue;
}

export interface OperationsReadinessReport {
  status: "ready" | "attention" | "blocked";
  generatedAt: string;
  version: string;
  checks: OperationsCheck[];
  summary: {
    ok: number;
    warning: number;
    error: number;
    disabled: number;
    requiredErrors: number;
  };
}

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

function check(input: OperationsCheck): OperationsCheck {
  return input;
}

async function databaseCheck(store: SqliteStore): Promise<OperationsCheck> {
  try {
    const result = store.execute((connection) => {
      const quick = connection.prepare("PRAGMA quick_check(1)").all() as unknown as Array<Record<string, unknown>>;
      const foreignKeys = connection.prepare("PRAGMA foreign_key_check").all() as unknown[];
      const tables = connection
        .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'")
        .get() as { count: number };
      const value = Object.values(quick[0] ?? {})[0];
      return {
        quickCheck: value,
        foreignKeyErrors: foreignKeys.length,
        tableCount: Number(tables.count)
      };
    });
    const valid = result.quickCheck === "ok" && result.foreignKeyErrors === 0;
    return check({
      id: "database",
      title: "База данных SQLite",
      state: valid ? "ok" : "error",
      required: true,
      summary: valid
        ? "Целостность базы подтверждена"
        : "Проверка целостности выявила ошибки",
      detail: valid
        ? `Таблиц: ${result.tableCount}.`
        : `quick_check: ${String(result.quickCheck)}; ошибок внешних ключей: ${result.foreignKeyErrors}.`,
      remediation: valid
        ? null
        : "Остановите службы, создайте резервную копию текущего состояния и восстановите последнюю проверенную копию.",
      data: result
    });
  } catch (error) {
    return check({
      id: "database",
      title: "База данных SQLite",
      state: "error",
      required: true,
      summary: "База данных недоступна для диагностического чтения",
      detail: error instanceof Error ? error.message : String(error),
      remediation: "Проверьте путь DOCOMATOR_DATA_DIR, права службы и журнал docomator-api.",
      data: {}
    });
  }
}

async function objectStoreCheck(
  objectStore: ContentAddressedObjectStore
): Promise<OperationsCheck> {
  const incoming = path.join(objectStore.root, ".incoming");
  const probe = path.join(incoming, `.readiness-${randomUUID()}`);
  try {
    await fs.mkdir(incoming, { recursive: true, mode: 0o750 });
    const handle = await fs.open(
      probe,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      0o640
    );
    try {
      await handle.writeFile("docomator-readiness\n", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rm(probe, { force: true });
    return check({
      id: "object_store",
      title: "Хранилище файлов",
      state: "ok",
      required: true,
      summary: "Запись и синхронизация доступны",
      detail: objectStore.root,
      remediation: null,
      data: { root: objectStore.root }
    });
  } catch (error) {
    await fs.rm(probe, { force: true }).catch(() => undefined);
    return check({
      id: "object_store",
      title: "Хранилище файлов",
      state: "error",
      required: true,
      summary: "Не удалось выполнить контрольную запись",
      detail: error instanceof Error ? error.message : String(error),
      remediation: "Проверьте наличие каталога objects, свободное место и права пользователя службы.",
      data: { root: objectStore.root }
    });
  }
}

async function diskCheck(dataDir: string): Promise<OperationsCheck> {
  try {
    const stats = await fs.statfs(dataDir);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const freeRatio = totalBytes > 0 ? freeBytes / totalBytes : 0;
    const state: OperationsCheckState =
      freeBytes < 512 * 1024 * 1024 || freeRatio < 0.05
        ? "error"
        : freeBytes < 2 * 1024 * 1024 * 1024 || freeRatio < 0.15
          ? "warning"
          : "ok";
    return check({
      id: "disk",
      title: "Свободное место",
      state,
      required: true,
      summary:
        state === "ok"
          ? "Свободного места достаточно"
          : state === "warning"
            ? "Свободное место приближается к пределу"
            : "Свободного места недостаточно для надёжной работы",
      detail: null,
      remediation:
        state === "ok"
          ? null
          : "Удалите ненужные результаты через раздел «Документы», выполните подтверждаемую очистку и проверьте размер резервных копий.",
      data: {
        totalBytes,
        freeBytes,
        usedBytes: Math.max(0, totalBytes - freeBytes),
        freePercent: Math.round(freeRatio * 1000) / 10,
        dataDir
      }
    });
  } catch (error) {
    return check({
      id: "disk",
      title: "Свободное место",
      state: "error",
      required: true,
      summary: "Не удалось получить сведения о файловой системе",
      detail: error instanceof Error ? error.message : String(error),
      remediation: "Проверьте DOCOMATOR_DATA_DIR и доступность файловой системы.",
      data: { dataDir }
    });
  }
}

function workerCheck(runtime: RuntimeStatusRegistry): OperationsCheck {
  const latest = runtime.latest("worker");
  if (latest === null) {
    return check({
      id: "worker",
      title: "Фоновый обработчик",
      state: "error",
      required: true,
      summary: "Worker ещё не публиковал состояние",
      detail: null,
      remediation: "Запустите и включите службу docomator-worker, затем обновите диагностику через минуту.",
      data: {}
    });
  }
  const details =
    typeof latest.details === "object" && latest.details !== null && !Array.isArray(latest.details)
      ? latest.details
      : {};
  const configuredInterval =
    typeof details.heartbeatIntervalMs === "number"
      ? details.heartbeatIntervalMs
      : 30_000;
  const maximumAgeMs = Math.max(120_000, configuredInterval * 3);
  const ageMs = Date.now() - Date.parse(latest.updatedAt);
  const fresh =
    latest.state === "running" && Number.isFinite(ageMs) && ageMs <= maximumAgeMs;
  return check({
    id: "worker",
    title: "Фоновый обработчик",
    state: fresh ? "ok" : "error",
    required: true,
    summary: fresh
      ? "Worker работает и регулярно обновляет состояние"
      : "Состояние worker просрочено или служба остановлена",
    detail: `Экземпляр: ${latest.instanceId}; последнее обновление: ${latest.updatedAt}.`,
    remediation: fresh
      ? null
      : "Проверьте systemctl status docomator-worker и последние записи journalctl -u docomator-worker.",
    data: {
      instanceId: latest.instanceId,
      version: latest.version,
      runtimeState: latest.state,
      updatedAt: latest.updatedAt,
      ageMs,
      maximumAgeMs,
      details: latest.details
    }
  });
}

async function libreOfficeCheck(): Promise<OperationsCheck> {
  const enabled = !["0", "false", "no", "off"].includes(
    (process.env.DOCOMATOR_PREVIEW_ENABLED ?? "true").trim().toLowerCase()
  );
  const binary =
    process.env.DOCOMATOR_LIBREOFFICE_BIN?.trim() || "/usr/bin/libreoffice";
  if (!enabled) {
    return check({
      id: "libreoffice",
      title: "LibreOffice и PDF",
      state: "disabled",
      required: false,
      summary: "PDF-предпросмотр отключён",
      detail: null,
      remediation: "Включите DOCOMATOR_PREVIEW_ENABLED=true для обязательного просмотра перед активацией.",
      data: { binary }
    });
  }
  try {
    await fs.access(binary, fsConstants.X_OK);
    const result = await execFileAsync(binary, ["--version"], {
      timeout: 5_000,
      maxBuffer: 64 * 1024
    });
    const version = `${result.stdout}${result.stderr}`.trim().split(/\r?\n/u)[0] ?? "";
    return check({
      id: "libreoffice",
      title: "LibreOffice и PDF",
      state: "ok",
      required: true,
      summary: "LibreOffice запускается",
      detail: version || binary,
      remediation: null,
      data: { binary, version }
    });
  } catch (error) {
    return check({
      id: "libreoffice",
      title: "LibreOffice и PDF",
      state: "error",
      required: true,
      summary: "LibreOffice недоступен или не запускается",
      detail: error instanceof Error ? error.message : String(error),
      remediation: "Установите LibreOffice из автономного комплекта или исправьте DOCOMATOR_LIBREOFFICE_BIN.",
      data: { binary }
    });
  }
}

async function networkFolderCheck(config: ApiConfig): Promise<OperationsCheck> {
  if (config.networkDeliveryRoot === null) {
    return check({
      id: "network_folder",
      title: "Сетевая папка",
      state: "disabled",
      required: false,
      summary: "Сетевая доставка не настроена",
      detail: null,
      remediation: "Подключите корпоративный ресурс и задайте DOCOMATOR_NETWORK_DELIVERY_ROOT, если этот канал нужен.",
      data: {}
    });
  }
  try {
    const info = await fs.lstat(config.networkDeliveryRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("Корень не является обычным каталогом");
    }
    await fs.access(config.networkDeliveryRoot, fsConstants.R_OK | fsConstants.W_OK);
    return check({
      id: "network_folder",
      title: "Сетевая папка",
      state: "ok",
      required: false,
      summary: "Корпоративный каталог доступен для записи",
      detail: config.networkDeliveryRoot,
      remediation: null,
      data: { root: config.networkDeliveryRoot }
    });
  } catch (error) {
    return check({
      id: "network_folder",
      title: "Сетевая папка",
      state: "error",
      required: false,
      summary: "Настроенный сетевой каталог недоступен",
      detail: error instanceof Error ? error.message : String(error),
      remediation: "Проверьте монтирование ресурса и права пользователя службы docomator.",
      data: { root: config.networkDeliveryRoot }
    });
  }
}

function smtpCheck(config: ApiConfig): OperationsCheck {
  if (!config.smtp.enabled) {
    return check({
      id: "smtp",
      title: "Почтовая доставка",
      state: "disabled",
      required: false,
      summary: "SMTP отключён",
      detail: null,
      remediation: "Настройте SMTP только если требуется почтовая доставка.",
      data: {}
    });
  }
  const host = process.env.DOCOMATOR_SMTP_HOST?.trim() || "";
  const port = Number(process.env.DOCOMATOR_SMTP_PORT || 25);
  const complete =
    host.length > 0 &&
    Number.isInteger(port) &&
    port > 0 &&
    config.smtp.fromAddress !== null &&
    config.smtp.allowedDomains.length > 0;
  return check({
    id: "smtp",
    title: "Почтовая доставка",
    state: complete ? "ok" : "error",
    required: false,
    summary: complete
      ? "Обязательные параметры SMTP заполнены"
      : "SMTP включён, но параметры неполны",
    detail: complete
      ? `${host}:${port}; отправитель: ${config.smtp.fromAddress}; доменов: ${config.smtp.allowedDomains.length}.`
      : null,
    remediation: complete
      ? "Перед пилотом выполните реальную отправку на разрешённый адрес."
      : "Заполните SMTP-сервер, отправителя и разрешённые домены в /etc/docomator/docomator.env.",
    data: {
      host,
      port,
      fromAddress: config.smtp.fromAddress,
      allowedDomainCount: config.smtp.allowedDomains.length,
      maxAttachmentBytes: config.smtp.maxAttachmentBytes
    }
  });
}

async function backupCheck(dataDir: string): Promise<OperationsCheck> {
  const backupRoot = path.join(dataDir, "backups");
  try {
    const entries = await fs.readdir(backupRoot, { withFileTypes: true });
    const candidates: Array<{ directory: string; createdAt: string; manifest: string }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("backup-")) continue;
      const manifestPath = path.join(backupRoot, entry.name, "manifest.json");
      try {
        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
          createdAt?: string;
        };
        const createdAt = manifest.createdAt;
        if (typeof createdAt === "string" && Number.isFinite(Date.parse(createdAt))) {
          candidates.push({
            directory: path.join(backupRoot, entry.name),
            createdAt,
            manifest: manifestPath
          });
        }
      } catch {
        // Invalid directories are ignored and surfaced if no valid backup remains.
      }
    }
    candidates.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const latest = candidates[0];
    if (latest === undefined) {
      throw new Error("Проверенная резервная копия не найдена");
    }
    const ageDays = (Date.now() - Date.parse(latest.createdAt)) / 86_400_000;
    const state: OperationsCheckState = ageDays > 7 ? "warning" : "ok";
    return check({
      id: "backup",
      title: "Резервная копия",
      state,
      required: false,
      summary:
        state === "ok"
          ? "Недавняя резервная копия найдена"
          : "Последняя резервная копия старше семи дней",
      detail: `Создана: ${latest.createdAt}; каталог: ${latest.directory}.`,
      remediation:
        state === "ok"
          ? "Перед пилотом проверьте восстановление на отдельном стенде."
          : "Запустите npm run backup или настроенный системный таймер резервного копирования.",
      data: {
        latestCreatedAt: latest.createdAt,
        latestDirectory: latest.directory,
        ageDays: Math.round(ageDays * 10) / 10,
        validBackupCount: candidates.length
      }
    });
  } catch (error) {
    return check({
      id: "backup",
      title: "Резервная копия",
      state: "warning",
      required: false,
      summary: "Проверенная резервная копия не найдена",
      detail: error instanceof Error ? error.message : String(error),
      remediation: `Создайте копию в ${backupRoot} и выполните пробное восстановление на отдельном стенде.`,
      data: { backupRoot }
    });
  }
}

function resultCounts(store: SqliteStore): OperationsCheck {
  try {
    const counts = store.execute((connection) =>
      connection
        .prepare(`
          SELECT
            SUM(CASE WHEN state = 'new' THEN 1 ELSE 0 END) AS new_count,
            SUM(CASE WHEN state IN ('new', 'viewed') THEN 1 ELSE 0 END) AS waiting_count,
            SUM(CASE WHEN state = 'collected' THEN 1 ELSE 0 END) AS collected_count
          FROM document_result_items
        `)
        .get() as {
        new_count: number | null;
        waiting_count: number | null;
        collected_count: number | null;
      }
    );
    return check({
      id: "results",
      title: "Общее хранилище документов",
      state: "ok",
      required: true,
      summary: "Реестр результатов доступен",
      detail: `Новых: ${Number(counts.new_count ?? 0)}; ожидают работы: ${Number(counts.waiting_count ?? 0)}; забрано: ${Number(counts.collected_count ?? 0)}.`,
      remediation: null,
      data: {
        newCount: Number(counts.new_count ?? 0),
        waitingCount: Number(counts.waiting_count ?? 0),
        collectedCount: Number(counts.collected_count ?? 0)
      }
    });
  } catch (error) {
    return check({
      id: "results",
      title: "Общее хранилище документов",
      state: "error",
      required: true,
      summary: "Реестр результатов недоступен",
      detail: error instanceof Error ? error.message : String(error),
      remediation: "Проверьте применение миграций и состояние базы данных.",
      data: {}
    });
  }
}

export function registerOperationsReadinessRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  store: SqliteStore,
  objectStore: ContentAddressedObjectStore,
  runtime: RuntimeStatusRegistry
): void {
  app.get("/api/v1/operations/readiness", async (request, reply) => {
    runtime.heartbeat({
      serviceType: "api",
      instanceId: `${process.pid}`,
      version: config.version,
      state: "running",
      details: {
        pid: process.pid,
        host: config.host,
        port: config.port
      }
    });
    const checks = await Promise.all([
      databaseCheck(store),
      objectStoreCheck(objectStore),
      diskCheck(config.dataDir),
      Promise.resolve(workerCheck(runtime)),
      libreOfficeCheck(),
      networkFolderCheck(config),
      Promise.resolve(smtpCheck(config)),
      backupCheck(config.dataDir),
      Promise.resolve(resultCounts(store))
    ]);
    const summary = {
      ok: checks.filter((item) => item.state === "ok").length,
      warning: checks.filter((item) => item.state === "warning").length,
      error: checks.filter((item) => item.state === "error").length,
      disabled: checks.filter((item) => item.state === "disabled").length,
      requiredErrors: checks.filter(
        (item) => item.required && item.state === "error"
      ).length
    };
    const status: OperationsReadinessReport["status"] =
      summary.requiredErrors > 0
        ? "blocked"
        : summary.error > 0 || summary.warning > 0
          ? "attention"
          : "ready";
    const report: OperationsReadinessReport = {
      status,
      generatedAt: new Date().toISOString(),
      version: config.version,
      checks,
      summary
    };
    reply.header("cache-control", "no-store");
    return responseEnvelope(request, report);
  });
}
