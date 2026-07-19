import { constants } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

const ATTACHMENT_NAME = "docomator-axe-result";
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value, maximum = 500) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

async function attachmentBytes(attachment) {
  if (attachment.body !== undefined) {
    return Buffer.from(attachment.body);
  }
  if (!text(attachment.path, 2_000)) {
    throw new Error("axe-вложение не содержит данных.");
  }
  return readFile(attachment.path);
}

function validatedRecord(value, status) {
  if (
    !object(value) ||
    value.version !== 1 ||
    value.kind !== "docomator.axe-result" ||
    value.contractVersion !== 1 ||
    !text(value.project) ||
    !text(value.title) ||
    !text(value.label) ||
    !["light", "dark"].includes(value.theme) ||
    !object(value.viewport) ||
    !Number.isInteger(value.viewport.width) ||
    !Number.isInteger(value.viewport.height) ||
    !Array.isArray(value.wcagTags) ||
    !object(value.axe) ||
    !Array.isArray(value.axe.violations) ||
    !Array.isArray(value.axe.incomplete) ||
    !Array.isArray(value.axe.passes) ||
    !Array.isArray(value.axe.inapplicable)
  ) {
    throw new Error("axe-вложение имеет неподдерживаемую структуру.");
  }
  return { ...value, testStatus: status };
}

async function atomicWrite(target, content) {
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.tmp`
  );
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600
    );
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(() => undefined);
  }
}

export default class AxeJsonReporter {
  constructor(options = {}) {
    this.outputFile = path.resolve(
      options.outputFile ?? ".tmp/axe-report.json"
    );
    this.records = [];
    this.errors = [];
  }

  async onBegin() {
    await unlink(this.outputFile).catch((error) => {
      if (!object(error) || error.code !== "ENOENT") throw error;
    });
  }

  async onTestEnd(_test, result) {
    const attachments = result.attachments.filter(
      (attachment) => attachment.name === ATTACHMENT_NAME
    );
    if (attachments.length > 1) {
      this.errors.push("Один axe-тест создал несколько одноимённых вложений.");
      return;
    }
    const attachment = attachments[0];
    if (attachment === undefined) return;
    try {
      const content = await attachmentBytes(attachment);
      if (content.length < 2 || content.length > MAX_ATTACHMENT_BYTES) {
        throw new Error("размер axe-вложения выходит за допустимый предел.");
      }
      this.records.push(
        validatedRecord(JSON.parse(content.toString("utf8")), result.status)
      );
    } catch (error) {
      this.errors.push(
        error instanceof Error
          ? error.message
          : "Не удалось прочитать axe-вложение."
      );
    }
  }

  async onEnd(result) {
    if (this.errors.length > 0) {
      throw new Error(
        `Не удалось сформировать axe-отчёт: ${this.errors.join(" ")}`
      );
    }
    if (this.records.length === 0) return;
    const records = [...this.records].sort((left, right) => {
      const leftKey = `${left.project}\u0000${left.title}`;
      const rightKey = `${right.project}\u0000${right.title}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    const report = {
      version: 1,
      kind: "docomator.axe-report",
      contractVersion: 1,
      generatedAt: new Date().toISOString(),
      runStatus: result.status,
      summary: {
        checks: records.length,
        violations: records.reduce(
          (total, record) => total + record.axe.violations.length,
          0
        ),
        incomplete: records.reduce(
          (total, record) => total + record.axe.incomplete.length,
          0
        )
      },
      results: records
    };
    await atomicWrite(
      this.outputFile,
      Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8")
    );
  }
}
