const MAXIMUM_RELEASE_RESPONSE_BYTES = 64 * 1024;
const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+~_-]{0,127}$/u;
const RELEASE_KEYS = [
  "gitCommit",
  "name",
  "releaseMetadataSha256",
  "source",
  "version"
];

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}

function exactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function validateInstalledReleaseIdentity(value, expectedVersion = null) {
  const identity = record(value);
  if (identity === null || !exactKeys(identity, RELEASE_KEYS)) {
    throw new Error("API идентичности релиза вернул неподдерживаемую структуру.");
  }
  if (
    identity.name !== "docomator" ||
    typeof identity.version !== "string" ||
    !VERSION_PATTERN.test(identity.version) ||
    typeof identity.gitCommit !== "string" ||
    !COMMIT_PATTERN.test(identity.gitCommit) ||
    typeof identity.releaseMetadataSha256 !== "string" ||
    !SHA256_PATTERN.test(identity.releaseMetadataSha256) ||
    identity.source !== "installed"
  ) {
    throw new Error("API не подтвердил идентичность установленного релиза.");
  }
  if (
    expectedVersion !== null &&
    expectedVersion !== "" &&
    identity.version !== expectedVersion
  ) {
    throw new Error(
      `Версия работающего API ${identity.version} не совпадает с ожидаемой ${expectedVersion}.`
    );
  }
  return {
    name: identity.name,
    version: identity.version,
    gitCommit: identity.gitCommit,
    releaseMetadataSha256: identity.releaseMetadataSha256,
    source: identity.source
  };
}

export async function fetchInstalledReleaseIdentity(baseUrl, expectedVersion = null) {
  let endpoint;
  try {
    endpoint = new URL("/api/v1/system/release", baseUrl);
  } catch {
    throw new Error("Адрес API для проверки релиза некорректен.");
  }
  let response;
  try {
    response = await fetch(endpoint, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    throw new Error(`API идентичности релиза недоступен: ${errorMessage(error)}`);
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAXIMUM_RELEASE_RESPONSE_BYTES
  ) {
    throw new Error("Ответ API идентичности релиза превышает допустимый размер.");
  }

  let source;
  try {
    source = await response.text();
  } catch (error) {
    throw new Error(`Не удалось прочитать идентичность релиза: ${errorMessage(error)}`);
  }
  if (Buffer.byteLength(source, "utf8") > MAXIMUM_RELEASE_RESPONSE_BYTES) {
    throw new Error("Ответ API идентичности релиза превышает допустимый размер.");
  }
  if (!response.ok) {
    throw new Error(`API идентичности релиза вернул HTTP ${response.status}.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("API идентичности релиза вернул некорректный JSON.");
  }
  return validateInstalledReleaseIdentity(parsed, expectedVersion);
}

function pilotCheck(input) {
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

function summarize(checks) {
  const requiredErrors = checks.filter(
    (item) => item.required && item.state === "error"
  ).length;
  return {
    ok: checks.filter((item) => item.state === "ok").length,
    warning: checks.filter((item) => item.state === "warning").length,
    error: checks.filter((item) => item.state === "error").length,
    disabled: checks.filter((item) => item.state === "disabled").length,
    requiredErrors
  };
}

function statusFromSummary(summary) {
  if (summary.requiredErrors > 0) return "failed";
  if (summary.warning > 0 || summary.error > 0) return "attention";
  return "passed";
}

export function bindPilotReleaseIdentity(reportInput, identity, failure = null) {
  const report = record(reportInput);
  if (report === null || !Array.isArray(report.checks)) {
    throw new Error("Пилотный отчёт имеет неподдерживаемую структуру.");
  }
  const checks = report.checks.filter((item) => item?.id !== "release_identity");
  if (identity !== null) {
    checks.splice(
      Math.min(1, checks.length),
      0,
      pilotCheck({
        id: "release_identity",
        title: "Идентичность установленного релиза",
        state: "ok",
        required: true,
        summary: `Запущен commit ${identity.gitCommit.slice(0, 12)}`,
        detail: `release.json SHA-256: ${identity.releaseMetadataSha256}`,
        remediation: "Используйте этот commit и SHA-256 при заполнении целевого акта.",
        data: identity
      })
    );
  } else {
    checks.splice(
      Math.min(1, checks.length),
      0,
      pilotCheck({
        id: "release_identity",
        title: "Идентичность установленного релиза",
        state: "error",
        required: true,
        summary: "Не удалось подтвердить установленный релиз",
        detail: failure || "Причина не указана",
        remediation:
          "Проверьте /api/v1/system/release, release.json текущего каталога и настройки службы API."
      })
    );
  }

  const summary = summarize(checks);
  return {
    ...report,
    version: identity?.version ?? report.version ?? null,
    release: identity,
    status: statusFromSummary(summary),
    summary,
    checks
  };
}

export function pilotMarkdownReport(report) {
  const lines = [
    "# Акт пилотной проверки Docomator",
    "",
    `- Дата: ${report.generatedAt}`,
    `- Версия: ${report.version ?? "не указана"}`,
    `- Git commit: ${report.release?.gitCommit ?? "не подтверждён"}`,
    `- SHA-256 release.json: ${report.release?.releaseMetadataSha256 ?? "не подтверждён"}`,
    `- Итог: **${report.status === "passed" ? "готово" : report.status === "attention" ? "требуется внимание" : "пилот заблокирован"}**`,
    `- ОС: ${report.environment?.os?.name ?? "не определена"}`,
    `- Архитектура: ${report.environment?.architecture ?? "не определена"}`,
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
      lines.push(
        `|  |  |  | Действие: ${String(item.remediation).replaceAll("|", "\\|")} |`
      );
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
