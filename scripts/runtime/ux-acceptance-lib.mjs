import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";

const MANUAL_CHECKS = Object.freeze([
  "keyboard-route",
  "focus-order-return",
  "screen-reader",
  "text-zoom-200",
  "touch-targets",
  "form-preservation",
  "correlation-identifiers"
]);
const TASKS = Object.freeze([
  "add-employee-and-field",
  "connect-template",
  "generate-personal-documents"
]);
const VIEWPORTS = Object.freeze([320, 768, 1440]);
const THEMES = Object.freeze(["light", "dark"]);
const AUTOMATION_EVIDENCE = Object.freeze([
  "playwright-json-report",
  "axe-json-report"
]);
const STATUS_VALUES = new Set(["pending", "passed", "failed"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

class EvidenceValidationError extends Error {}

function timestamp(value) {
  if (typeof value !== "string" || !UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString() === value &&
    parsed <= Date.now() + 5 * 60_000
  );
}

function text(value, maximum = 2_000) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value, allowed, label, errors) {
  if (!object(value)) return false;
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    errors.push(`${label}: неизвестные поля ${unexpected.join(", ")}.`);
    return false;
  }
  return true;
}

function exactIds(items, expected, label, errors) {
  if (!Array.isArray(items)) {
    errors.push(`${label}: ожидается массив.`);
    return false;
  }
  const ids = items.map((item) => (object(item) ? item.id : null));
  if (
    ids.length !== expected.length ||
    new Set(ids).size !== ids.length ||
    expected.some((id) => !ids.includes(id))
  ) {
    errors.push(`${label}: состав проверок не совпадает с обязательным протоколом.`);
    return false;
  }
  return true;
}

export function createUxAcceptanceTemplate() {
  return {
    version: 1,
    kind: "docomator.ux-acceptance",
    environment: {
      platform: "",
      operatingSystem: "",
      browserVersion: "",
      screenReader: "",
      commitSha: "",
      testedAt: null
    },
    manualChecks: MANUAL_CHECKS.map((id) => ({
      id,
      status: "pending",
      checkedAt: null,
      evidence: ""
    })),
    visualBaselines: VIEWPORTS.flatMap((viewport) =>
      THEMES.map((theme) => ({
        viewport,
        theme,
        file: "",
        sha256: null,
        approvedAt: null,
        reviewerId: null
      }))
    ),
    automationEvidence: AUTOMATION_EVIDENCE.map((id) => ({
      id,
      file: "",
      sha256: null,
      completedAt: null
    })),
    participants: ["participant-01", "participant-02"].map(
      (participantId) => ({
        participantId,
        firstTimeUser: null,
        projectContributor: null,
        priorTraining: null,
        assistanceEvents: null,
        tasks: TASKS.map((id) => ({
          id,
          status: "pending",
          startedAt: null,
          completedAt: null,
          evidence: ""
        }))
      })
    ),
    decision: {
      status: "pending",
      approvedAt: null,
      reviewerId: null,
      evidence: ""
    }
  };
}

export function validateUxAcceptance(value) {
  const errors = [];
  const missing = [];
  let failed = false;
  if (
    !object(value) ||
    value.version !== 1 ||
    value.kind !== "docomator.ux-acceptance"
  ) {
    return {
      state: "invalid",
      errors: ["Файл не является актом UX-приёмки версии 1."],
      missing: []
    };
  }
  exactKeys(
    value,
    [
      "version",
      "kind",
      "environment",
      "manualChecks",
      "visualBaselines",
      "automationEvidence",
      "participants",
      "decision"
    ],
    "root",
    errors
  );

  if (!object(value.environment)) {
    errors.push("environment: ожидается объект.");
  } else {
    exactKeys(
      value.environment,
      [
        "platform",
        "operatingSystem",
        "browserVersion",
        "screenReader",
        "commitSha",
        "testedAt"
      ],
      "environment",
      errors
    );
    if (value.environment.platform !== "linux") {
      missing.push("environment.platform=linux");
    }
    for (const field of ["operatingSystem", "browserVersion", "screenReader"]) {
      if (!text(value.environment[field], 500)) {
        missing.push(`environment.${field}`);
      }
    }
    if (!COMMIT_PATTERN.test(value.environment.commitSha ?? "")) {
      missing.push("environment.commitSha");
    }
    if (!timestamp(value.environment.testedAt)) {
      missing.push("environment.testedAt");
    }
  }

  if (exactIds(value.manualChecks, MANUAL_CHECKS, "manualChecks", errors)) {
    for (const item of value.manualChecks) {
      exactKeys(item, ["id", "status", "checkedAt", "evidence"], `manualChecks.${item.id}`, errors);
      if (!STATUS_VALUES.has(item.status)) {
        errors.push(`manualChecks.${item.id}: недопустимый статус.`);
        continue;
      }
      if (item.status === "failed") failed = true;
      if (item.status !== "passed") missing.push(`manualChecks.${item.id}`);
      if (item.status === "passed") {
        if (!timestamp(item.checkedAt)) missing.push(`manualChecks.${item.id}.checkedAt`);
        if (!text(item.evidence)) missing.push(`manualChecks.${item.id}.evidence`);
      }
    }
  }

  if (!Array.isArray(value.visualBaselines) || value.visualBaselines.length !== 6) {
    errors.push("visualBaselines: требуются шесть вариантов 320/768/1440 × light/dark.");
  } else {
    const coordinates = value.visualBaselines.map(
      (item) => `${item?.viewport}:${item?.theme}`
    );
    const expected = VIEWPORTS.flatMap((viewport) =>
      THEMES.map((theme) => `${viewport}:${theme}`)
    );
    if (
      new Set(coordinates).size !== coordinates.length ||
      expected.some((coordinate) => !coordinates.includes(coordinate))
    ) {
      errors.push("visualBaselines: набор размеров и тем не совпадает с протоколом.");
    } else {
      for (const item of value.visualBaselines) {
        const coordinate = `${item.viewport}:${item.theme}`;
        exactKeys(
          item,
          ["viewport", "theme", "file", "sha256", "approvedAt", "reviewerId"],
          `visualBaselines.${coordinate}`,
          errors
        );
        if (!text(item.file, 500)) {
          missing.push(`visualBaselines.${coordinate}.file`);
        }
        if (!SHA256_PATTERN.test(item.sha256 ?? "")) {
          missing.push(`visualBaselines.${coordinate}.sha256`);
        }
        if (!timestamp(item.approvedAt)) {
          missing.push(`visualBaselines.${coordinate}.approvedAt`);
        }
        if (!ID_PATTERN.test(item.reviewerId ?? "")) {
          missing.push(`visualBaselines.${coordinate}.reviewerId`);
        }
      }
    }
  }

  if (
    exactIds(
      value.automationEvidence,
      AUTOMATION_EVIDENCE,
      "automationEvidence",
      errors
    )
  ) {
    for (const item of value.automationEvidence) {
      exactKeys(
        item,
        ["id", "file", "sha256", "completedAt"],
        `automationEvidence.${item.id}`,
        errors
      );
      if (!text(item.file, 500)) {
        missing.push(`automationEvidence.${item.id}.file`);
      }
      if (!SHA256_PATTERN.test(item.sha256 ?? "")) {
        missing.push(`automationEvidence.${item.id}.sha256`);
      }
      if (!timestamp(item.completedAt)) {
        missing.push(`automationEvidence.${item.id}.completedAt`);
      }
    }
  }

  if (!Array.isArray(value.participants) || value.participants.length !== 2) {
    errors.push("participants: требуются ровно два независимых участника.");
  } else {
    const participantIds = value.participants.map((item) => item?.participantId);
    if (
      participantIds.some((id) => !ID_PATTERN.test(id ?? "")) ||
      new Set(participantIds).size !== 2
    ) {
      errors.push("participants: нужны два разных безопасных псевдонима.");
    }
    for (const [index, participant] of value.participants.entries()) {
      if (!object(participant)) {
        errors.push(`participants.${index + 1}: ожидается объект.`);
        continue;
      }
      const participantId = ID_PATTERN.test(participant.participantId ?? "")
        ? participant.participantId
        : `index-${index + 1}`;
      exactKeys(
        participant,
        [
          "participantId",
          "firstTimeUser",
          "projectContributor",
          "priorTraining",
          "assistanceEvents",
          "tasks"
        ],
        `participants.${participantId}`,
        errors
      );
      if (participant.firstTimeUser !== true) {
        missing.push(`participants.${participantId}.firstTimeUser`);
      }
      if (participant.projectContributor !== false) {
        missing.push(`participants.${participantId}.projectContributor=false`);
      }
      if (participant.priorTraining !== false) {
        missing.push(`participants.${participantId}.priorTraining=false`);
      }
      if (participant.assistanceEvents !== 0) {
        missing.push(`participants.${participantId}.assistanceEvents=0`);
      }
      if (!exactIds(participant?.tasks, TASKS, `participants.${participantId}.tasks`, errors)) {
        continue;
      }
      for (const task of participant.tasks) {
        exactKeys(
          task,
          ["id", "status", "startedAt", "completedAt", "evidence"],
          `participants.${participantId}.${task.id}`,
          errors
        );
        if (!STATUS_VALUES.has(task.status)) {
          errors.push(`participants.${participantId}.${task.id}: недопустимый статус.`);
          continue;
        }
        if (task.status === "failed") failed = true;
        if (task.status !== "passed") {
          missing.push(`participants.${participantId}.${task.id}`);
        } else {
          if (!timestamp(task.startedAt)) {
            missing.push(`participants.${participantId}.${task.id}.startedAt`);
          }
          if (!timestamp(task.completedAt)) {
            missing.push(`participants.${participantId}.${task.id}.completedAt`);
          }
          if (
            timestamp(task.startedAt) &&
            timestamp(task.completedAt) &&
            Date.parse(task.startedAt) > Date.parse(task.completedAt)
          ) {
            errors.push(
              `participants.${participantId}.${task.id}: время завершения раньше начала.`
            );
          }
          if (!text(task.evidence)) {
            missing.push(`participants.${participantId}.${task.id}.evidence`);
          }
        }
      }
    }
  }

  if (!object(value.decision)) {
    errors.push("decision: ожидается объект.");
  } else {
    exactKeys(
      value.decision,
      ["status", "approvedAt", "reviewerId", "evidence"],
      "decision",
      errors
    );
    if (!STATUS_VALUES.has(value.decision.status)) {
      errors.push("decision.status: недопустимый статус.");
    } else {
      if (value.decision.status === "failed") failed = true;
      if (value.decision.status !== "passed") missing.push("decision.status");
    }
    if (value.decision.status === "passed") {
      if (!timestamp(value.decision.approvedAt)) missing.push("decision.approvedAt");
      if (!ID_PATTERN.test(value.decision.reviewerId ?? "")) {
        missing.push("decision.reviewerId");
      }
      if (!text(value.decision.evidence)) missing.push("decision.evidence");
    }
  }

  return {
    state:
      errors.length > 0
        ? "invalid"
        : failed
          ? "failed"
          : missing.length > 0
            ? "incomplete"
            : "passed",
    errors,
    missing: [...new Set(missing)]
  };
}

function evidenceRecords(value) {
  if (!object(value)) return [];
  return [
    ...(Array.isArray(value.visualBaselines) ? value.visualBaselines : []),
    ...(Array.isArray(value.automationEvidence) ? value.automationEvidence : [])
  ];
}

function safeEvidencePath(value) {
  if (!text(value, 500) || path.isAbsolute(value) || value.includes("\\")) {
    return false;
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) return false;
  const segments = value.split("/");
  return (
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..") &&
    path.posix.normalize(value) === value
  );
}

function evidenceErrorMessage(error) {
  if (error instanceof EvidenceValidationError) return error.message;
  if (object(error) && error.code === "ENOENT") return "файл не найден";
  if (object(error) && error.code === "EACCES") return "нет доступа к файлу";
  if (object(error) && error.code === "ELOOP") {
    return "символические ссылки запрещены";
  }
  return "не удалось безопасно прочитать файл";
}

async function readEvidenceFile(target) {
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const information = await handle.stat();
    if (
      !information.isFile() ||
      information.size < 1 ||
      information.size > 50 * 1024 * 1024
    ) {
      throw new EvidenceValidationError(
        "ожидается обычный файл размером до 50 МБ"
      );
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function validateUxAcceptanceFiles(value, actPath) {
  const result = validateUxAcceptance(value);
  if (result.state === "invalid" || result.state === "failed") return result;
  const errors = [...result.errors];
  let root;
  try {
    root = await realpath(path.dirname(path.resolve(actPath)));
  } catch {
    return {
      ...result,
      state: "invalid",
      errors: ["Не удалось безопасно открыть каталог акта UX-приёмки."]
    };
  }
  for (const record of evidenceRecords(value)) {
    if (!text(record.file, 500) || !SHA256_PATTERN.test(record.sha256 ?? "")) {
      continue;
    }
    if (!safeEvidencePath(record.file)) {
      errors.push(`Недопустимый путь свидетельства: ${JSON.stringify(record.file)}`);
      continue;
    }
    const target = path.resolve(root, record.file);
    const relative = path.relative(root, target);
    if (relative.length === 0 || relative.startsWith("..") || path.isAbsolute(relative)) {
      errors.push(`Свидетельство выходит за каталог акта: ${record.file}`);
      continue;
    }
    try {
      if ((await realpath(target)) !== target) {
        throw new EvidenceValidationError(
          "путь содержит символическую ссылку"
        );
      }
      const content = await readEvidenceFile(target);
      if (Object.prototype.hasOwnProperty.call(record, "viewport")) {
        if (
          path.extname(record.file).toLowerCase() !== ".png" ||
          content.length < 24 ||
          !content.subarray(0, 8).equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
          ) ||
          content.readUInt32BE(16) !== record.viewport ||
          content.readUInt32BE(20) < 1
        ) {
          throw new EvidenceValidationError(
            "PNG-сигнатура или ширина эталона не совпадает"
          );
        }
      } else {
        if (path.extname(record.file).toLowerCase() !== ".json") {
          throw new EvidenceValidationError(
            "автоматический отчёт должен быть JSON-файлом"
          );
        }
        try {
          JSON.parse(content.toString("utf8"));
        } catch {
          throw new EvidenceValidationError(
            "автоматический отчёт содержит некорректный JSON"
          );
        }
      }
      const actual = createHash("sha256").update(content).digest("hex");
      if (actual !== record.sha256) {
        throw new EvidenceValidationError("SHA-256 не совпадает");
      }
    } catch (error) {
      errors.push(
        `Свидетельство ${JSON.stringify(record.file)} не прошло проверку: ${evidenceErrorMessage(error)}`
      );
    }
  }
  return {
    ...result,
    state: errors.length > 0 ? "invalid" : result.state,
    errors
  };
}

export const UX_ACCEPTANCE_MANUAL_CHECKS = MANUAL_CHECKS;
export const UX_ACCEPTANCE_TASKS = TASKS;
