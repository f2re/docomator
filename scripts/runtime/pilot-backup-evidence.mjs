const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function timestamp(value, label) {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)) {
    throw new Error(`${label}: требуется точная отметка времени UTC`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label}: некорректная отметка времени UTC`);
  }
  return parsed;
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function evaluateControlBackup({
  commandOk,
  commandDetail = null,
  startedAt,
  backup,
  expectedReleaseVersion = null,
  clockSkewMs = 5_000
}) {
  const startedAtMs = timestamp(startedAt, "startedAt");
  if (!Number.isSafeInteger(clockSkewMs) || clockSkewMs < 0 || clockSkewMs > 60_000) {
    throw new Error("clockSkewMs: допустим диапазон 0..60000");
  }

  if (commandOk !== true) {
    return {
      ok: false,
      summary: "Контрольное резервирование завершилось ошибкой",
      detail: text(commandDetail) ?? "systemd-служба не подтвердила успешный запуск",
      remediation: "Проверьте journalctl -u docomator-backup.service.",
      data: { startedAt, backupCreatedAt: null, releaseVersion: null }
    };
  }

  if (backup === null || typeof backup !== "object" || Array.isArray(backup)) {
    return {
      ok: false,
      summary: "После запуска не найдена проверенная резервная копия",
      detail: text(commandDetail) ?? "Служба завершилась без нового проверяемого каталога backup-*.",
      remediation:
        "Проверьте журнал службы, свободное место и права каталога резервных копий, затем повторите пилотную проверку.",
      data: { startedAt, backupCreatedAt: null, releaseVersion: null }
    };
  }

  const backupCreatedAtMs = timestamp(backup.createdAt, "backup.createdAt");
  const backupCreatedAt = backup.createdAt;
  const releaseVersion = backup.releaseVersion ?? null;

  if (backupCreatedAtMs + clockSkewMs < startedAtMs) {
    return {
      ok: false,
      summary: "Новая контрольная резервная копия не создана",
      detail: `Последняя проверенная копия создана ${backupCreatedAt}, запуск начат ${startedAt}.`,
      remediation:
        "Не используйте прежнюю копию как свидетельство текущего прогона. Проверьте службу резервирования и повторите запуск.",
      data: { startedAt, backupCreatedAt, releaseVersion }
    };
  }

  const expectedVersion = text(expectedReleaseVersion);
  if (expectedVersion !== null && releaseVersion !== expectedVersion) {
    return {
      ok: false,
      summary: "Контрольная копия относится к другому релизу",
      detail: `Ожидалась версия ${expectedVersion}, в manifest указана ${releaseVersion ?? "не указана"}.`,
      remediation:
        "Проверьте DOCOMATOR_VERSION в systemd-окружении и повторите создание резервной копии текущего релиза.",
      data: { startedAt, backupCreatedAt, releaseVersion, expectedReleaseVersion: expectedVersion }
    };
  }

  return {
    ok: true,
    summary: "Новая контрольная резервная копия создана и проверена",
    detail: `${backupCreatedAt}; ${backup.directory ?? "каталог не указан"}`,
    remediation: "На отдельном стенде выполните пробное восстановление этой копии.",
    data: {
      startedAt,
      backupCreatedAt,
      releaseVersion,
      directory: backup.directory ?? null
    }
  };
}
