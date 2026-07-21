#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import { verifyBackup } from "./backup-lib.mjs";
import { evaluateControlBackup } from "./pilot-backup-evidence.mjs";

const execFileAsync = promisify(execFile);

function usage() {
  process.stdout.write(`Использование: pilot-readiness.mjs [параметры]\n\nПараметры:\n  --config ФАЙЛ       файл настроек Docomator\n  --url АДРЕС         явный адрес API\n  --output КАТАЛОГ    каталог отчётов\n  --run-backup        создать резервную копию перед проверкой\n  --require-network   считать сетевую папку обязательной\n  --require-smtp      считать SMTP обязательным\n  --json-only         вывести только JSON-результат\n  -h, --help          показать справку\n\nКоды завершения:\n  0  пилотный контур готов\n  1  есть предупреждения, основной контур не заблокирован\n  2  обнаружена блокирующая ошибка\n`);
}

function parseArguments(argv) {
  const options = {
    configFile: "/etc/docomator/docomator.env",
    url: null,
    outputDirectory: null,
    runBackup: false,
    requireNetwork: false,
    requireSmtp: false,
    jsonOnly: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      index += 1;
      const value = argv[index];
      if (value === undefined) throw new Error(`Не указано значение после ${argument}`);
      return value;
    };
    switch (argument) {
      case "--config":
        options.configFile = next();
        break;
      case "--url":
        options.url = next();
        break;
      case "--output":
        options.outputDirectory = next();
        break;
      case "--run-backup":
        options.runBackup = true;
        break;
      case "--require-network":
        options.requireNetwork = true;
        break;
      case "--require-smtp":
        options.requireSmtp = true;
        break;
      case "--json-only":
        options.jsonOnly = true;
        break;
      case "-h":
      case "--help":
        usage();
        process.exit(0);
      default:
        throw new Error(`Неизвестный параметр: ${argument}`);
    }
  }
  return options;
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function booleanValue(value, fallback) {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

async function runCommand(command, args, timeout = 10_000) {
  try {
    const result = await execFileAsync(command, args, {
      timeout,
      maxBuffer: 1024 * 1024,
      encoding: "utf8"
    });
    return {
      ok: true,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      stdout:
        error && typeof error === "object" && typeof error.stdout === "string"
          ? error.stdout.trim()
          : "",
      stderr:
        error && typeof error === "object" && typeof error.stderr === "string"
          ? error.stderr.trim()
          : "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function fetchReadiness(url) {
  try {
    const response = await fetch(`${url.replace(/\/$/u, "")}/api/v1/operations/readiness`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000)
    });
    const body = await response.json();
    if (!response.ok || body?.data === undefined) {
      throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
    }
    return { ok: true, report: body.data, error: null };
  } catch (error) {
    return {
      ok: false,
      report: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function check(input) {
  return {
    id: input.id,
    title: input.title,
    state: input.state,
    required: Boolean(input.required),
    summary: input.summary,
    detail: input.detail ?? null,
    remediation: input.remediation ?? null,
    data: input.data ?? {}
  };
}

async function systemInformation(config) {
  let osRelease = {};
  try {
    osRelease = parseEnv(await fs.readFile("/etc/os-release", "utf8"));
  } catch {
    osRelease = {};
  }
  const [uname, libc, node, libreOffice] = await Promise.all([
    runCommand("uname", ["-a"]),
    runCommand("ldd", ["--version"]),
    Promise.resolve({
      ok: true,
      stdout: process.version,
      stderr: "",
      error: null
    }),
    runCommand(config.DOCOMATOR_LIBREOFFICE_BIN || "/usr/bin/libreoffice", ["--version"])
  ]);
  return {
    os: {
      id: osRelease.ID ?? null,
      name: osRelease.PRETTY_NAME ?? osRelease.NAME ?? null,
      versionId: osRelease.VERSION_ID ?? null,
      version: osRelease.VERSION ?? null
    },
    architecture: process.arch,
    platform: process.platform,
    kernel: uname.stdout || uname.error,
    libc: (libc.stdout || libc.stderr || libc.error || "").split(/\r?\n/u)[0] || null,
    node: node.stdout,
    libreOffice: libreOffice.ok
      ? (libreOffice.stdout || libreOffice.stderr).split(/\r?\n/u)[0] || null
      : null
  };
}

async function systemdChecks(config, options) {
  const systemctl = await runCommand("systemctl", ["--version"]);
  if (!systemctl.ok) {
    return [
      check({
        id: "systemd",
        title: "Системные службы",
        state: "error",
        required: true,
        summary: "systemd недоступен",
        detail: systemctl.error,
        remediation: "Пилотная установка должна выполняться на системе с systemd."
      })
    ];
  }

  const [api, worker, timerEnabled, timerActive, timerLine] = await Promise.all([
    runCommand("systemctl", ["is-active", "docomator-api.service"]),
    runCommand("systemctl", ["is-active", "docomator-worker.service"]),
    runCommand("systemctl", ["is-enabled", "docomator-backup.timer"]),
    runCommand("systemctl", ["is-active", "docomator-backup.timer"]),
    runCommand("systemctl", ["list-timers", "docomator-backup.timer", "--no-legend", "--all"])
  ]);

  const backupEnabled = booleanValue(config.DOCOMATOR_BACKUP_ENABLED, true);
  return [
    check({
      id: "systemd_api",
      title: "Служба API",
      state: api.ok && api.stdout === "active" ? "ok" : "error",
      required: true,
      summary:
        api.ok && api.stdout === "active" ? "Служба API активна" : "Служба API не активна",
      detail: api.stdout || api.stderr || api.error,
      remediation: "Выполните systemctl status docomator-api.service и устраните ошибку запуска."
    }),
    check({
      id: "systemd_worker",
      title: "Фоновый обработчик",
      state: worker.ok && worker.stdout === "active" ? "ok" : "error",
      required: true,
      summary:
        worker.ok && worker.stdout === "active"
          ? "Служба worker активна"
          : "Служба worker не активна",
      detail: worker.stdout || worker.stderr || worker.error,
      remediation: "Выполните systemctl status docomator-worker.service и устраните ошибку запуска."
    }),
    check({
      id: "backup_timer",
      title: "Таймер резервных копий",
      state: !backupEnabled
        ? "disabled"
        : timerEnabled.ok &&
            timerEnabled.stdout === "enabled" &&
            timerActive.ok &&
            timerActive.stdout === "active"
          ? "ok"
          : "error",
      required: backupEnabled,
      summary: !backupEnabled
        ? "Автоматические копии отключены"
        : timerEnabled.ok && timerActive.ok
          ? "Таймер включён и активен"
          : "Таймер не включён или не активен",
      detail: timerLine.stdout || timerEnabled.stdout || timerActive.stdout || timerLine.error,
      remediation: backupEnabled
        ? "Выполните systemctl enable --now docomator-backup.timer."
        : "Включите DOCOMATOR_BACKUP_ENABLED=true перед рабочей эксплуатацией."
    })
  ];
}

async function latestVerifiedBackup(dataDirectory) {
  const root = path.join(dataDirectory, "backups");
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    return {
      ok: false,
      backup: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("backup-")) continue;
    const directory = path.join(root, entry.name);
    try {
      const manifest = JSON.parse(
        await fs.readFile(path.join(directory, "manifest.json"), "utf8")
      );
      if (typeof manifest.createdAt === "string") {
        candidates.push({ directory, createdAt: manifest.createdAt });
      }
    } catch {
      // Повреждённый каталог будет проигнорирован, а отсутствие корректных копий станет ошибкой.
    }
  }
  candidates.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  for (const candidate of candidates) {
    try {
      const manifest = await verifyBackup(candidate.directory);
      return {
        ok: true,
        backup: {
          directory: candidate.directory,
          createdAt: manifest.createdAt,
          releaseVersion: manifest.releaseVersion,
          databaseBytes: manifest.database?.sizeBytes ?? null,
          objectCount: manifest.objects?.count ?? null,
          configIncluded: manifest.config !== null
        },
        error: null
      };
    } catch {
      // Проверяем следующую копию.
    }
  }
  return {
    ok: false,
    backup: null,
    error: "Проверенная резервная копия не найдена"
  };
}

async function backupChecks(config, options, dataDirectory) {
  const backupEnabled = booleanValue(config.DOCOMATOR_BACKUP_ENABLED, true);
  const checks = [];
  let controlStartedAt = null;
  let controlCommand = null;

  if (options.runBackup) {
    controlStartedAt = new Date().toISOString();
    controlCommand = await runCommand(
      "systemctl",
      ["start", "docomator-backup.service"],
      6 * 60 * 60 * 1000
    );
  }

  if (!backupEnabled && !options.runBackup) {
    checks.push(
      check({
        id: "backup_verified",
        title: "Восстановимая резервная копия",
        state: "disabled",
        required: false,
        summary: "Автоматическое резервирование отключено",
        remediation: "Включите резервирование перед рабочей эксплуатацией."
      })
    );
    return checks;
  }

  const latest = await latestVerifiedBackup(dataDirectory);

  if (options.runBackup) {
    const controlEvidence = evaluateControlBackup({
      commandOk: controlCommand?.ok === true,
      commandDetail:
        controlCommand?.stdout ||
        controlCommand?.stderr ||
        controlCommand?.error ||
        null,
      startedAt: controlStartedAt,
      backup: latest.ok ? latest.backup : null,
      expectedReleaseVersion: config.DOCOMATOR_VERSION || null
    });
    checks.push(
      check({
        id: "backup_run",
        title: "Контрольный запуск резервирования",
        state: controlEvidence.ok ? "ok" : "error",
        required: true,
        summary: controlEvidence.summary,
        detail: controlEvidence.detail,
        remediation: controlEvidence.remediation,
        data: controlEvidence.data
      })
    );
  }

  const ageHours = latest.ok
    ? (Date.now() - Date.parse(latest.backup.createdAt)) / 3_600_000
    : Number.POSITIVE_INFINITY;
  const fresh = latest.ok && Number.isFinite(ageHours) && ageHours <= 48;
  checks.push(
    check({
      id: "backup_verified",
      title: "Восстановимая резервная копия",
      state: !latest.ok ? "error" : fresh ? "ok" : "warning",
      required: backupEnabled,
      summary: !latest.ok
        ? "Проверенная копия не найдена"
        : fresh
          ? "Недавняя копия полностью проверена"
          : "Проверенная копия старше 48 часов",
      detail: latest.ok
        ? `${latest.backup.createdAt}; ${latest.backup.directory}`
        : latest.error,
      remediation: latest.ok && fresh
        ? "На отдельном стенде выполните пробное восстановление этой копии."
        : "Запустите systemctl start docomator-backup.service и повторите проверку.",
      data: latest.backup ?? {}
    })
  );
  return checks;
}

function importServerChecks(serverReport, options) {
  if (!serverReport) return [];
  return (serverReport.checks ?? []).map((item) => {
    const required =
      item.required ||
      (options.requireNetwork && item.id === "network_folder") ||
      (options.requireSmtp && item.id === "smtp");
    let state = item.state;
    if (required && item.state === "disabled") state = "error";
    return check({
      id: `server_${item.id}`,
      title: item.title,
      state,
      required,
      summary: item.summary,
      detail: item.detail,
      remediation: item.remediation,
      data: item.data
    });
  });
}

async function atomicWrite(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o750 });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, content, { encoding: "utf8", mode: 0o640 });
  await fs.rename(temporary, filePath);
}

function markdownReport(report) {
  const lines = [
    "# Акт пилотной проверки Docomator",
    "",
    `- Дата: ${report.generatedAt}`,
    `- Версия: ${report.version ?? "не указана"}`,
    `- Итог: **${report.status === "passed" ? "готово" : report.status === "attention" ? "требуется внимание" : "пилот заблокирован"}**`,
    `- ОС: ${report.environment.os.name ?? "не определена"}`,
    `- Архитектура: ${report.environment.architecture}`,
    "",
    "## Проверки",
    "",
    "| Проверка | Состояние | Обязательная | Результат |",
    "|---|---|---:|---|"
  ];
  for (const item of report.checks) {
    const state =
      item.state === "ok"
        ? "✅"
        : item.state === "warning"
          ? "⚠️"
          : item.state === "disabled"
            ? "➖"
            : "⛔";
    lines.push(
      `| ${String(item.title).replaceAll("|", "\\|")} | ${state} | ${item.required ? "да" : "нет"} | ${String(item.summary).replaceAll("|", "\\|")} |`
    );
    if (item.remediation) {
      lines.push(`|  |  |  | Действие: ${String(item.remediation).replaceAll("|", "\\|")} |`);
    }
  }
  lines.push(
    "",
    "## Сводка",
    "",
    `- Успешно: ${report.summary.ok}`,
    `- Предупреждений: ${report.summary.warning}`,
    `- Ошибок: ${report.summary.error}`,
    `- Отключено: ${report.summary.disabled}`,
    `- Блокирующих ошибок: ${report.summary.requiredErrors}`,
    ""
  );
  return `${lines.join("\n")}\n`;
}

const options = parseArguments(process.argv.slice(2));
const configFile = path.resolve(options.configFile);
const config = (await exists(configFile))
  ? parseEnv(await fs.readFile(configFile, "utf8"))
  : {};
const dataDirectory = path.resolve(
  config.DOCOMATOR_DATA_DIR || process.env.DOCOMATOR_DATA_DIR || "/var/lib/docomator"
);
const host = config.DOCOMATOR_HOST || "127.0.0.1";
const localHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
const url = options.url || `http://${localHost}:${config.DOCOMATOR_PORT || "8080"}`;
const outputDirectory = path.resolve(
  options.outputDirectory || path.join(dataDirectory, "pilot-reports")
);
const generatedAt = new Date().toISOString();
const operationId = generatedAt.replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");

const readiness = await fetchReadiness(url);
const checks = [
  check({
    id: "readiness_endpoint",
    title: "Диагностический API",
    state: readiness.ok ? "ok" : "error",
    required: true,
    summary: readiness.ok
      ? "Диагностический отчёт API получен"
      : "Диагностический API недоступен",
    detail: readiness.ok ? url : readiness.error,
    remediation: "Проверьте docomator-api.service, адрес и порт в конфигурации."
  }),
  ...(await systemdChecks(config, options)),
  ...importServerChecks(readiness.report, options),
  ...(await backupChecks(config, options, dataDirectory))
];

const requiredErrors = checks.filter(
  (item) => item.required && item.state === "error"
).length;
const summary = {
  ok: checks.filter((item) => item.state === "ok").length,
  warning: checks.filter((item) => item.state === "warning").length,
  error: checks.filter((item) => item.state === "error").length,
  disabled: checks.filter((item) => item.state === "disabled").length,
  requiredErrors
};
const status =
  requiredErrors > 0
    ? "failed"
    : summary.warning > 0 || summary.error > 0
      ? "attention"
      : "passed";
const report = {
  format: "docomator-pilot-readiness",
  version: config.DOCOMATOR_VERSION || readiness.report?.version || null,
  generatedAt,
  status,
  url,
  configFile,
  dataDirectory,
  options: {
    runBackup: options.runBackup,
    requireNetwork: options.requireNetwork,
    requireSmtp: options.requireSmtp
  },
  environment: await systemInformation(config),
  summary,
  checks
};

const jsonPath = path.join(outputDirectory, `pilot-${operationId}.json`);
const markdownPath = path.join(outputDirectory, `pilot-${operationId}.md`);
await atomicWrite(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
await atomicWrite(markdownPath, markdownReport(report));

const result = {
  status,
  jsonReport: jsonPath,
  markdownReport: markdownPath,
  summary
};
if (options.jsonOnly) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else {
  process.stdout.write(
    `${status === "passed" ? "✅" : status === "attention" ? "⚠️" : "⛔"} ${
      status === "passed"
        ? "Пилотный контур готов."
        : status === "attention"
          ? "Пилотный контур работает с предупреждениями."
          : "Пилотный запуск заблокирован."
    }\nJSON: ${jsonPath}\nОтчёт: ${markdownPath}\n`
  );
}
process.exitCode = status === "passed" ? 0 : status === "attention" ? 1 : 2;
