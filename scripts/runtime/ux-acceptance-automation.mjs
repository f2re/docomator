import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  stat,
  unlink
} from "node:fs/promises";
import path from "node:path";

import {
  validateUxAcceptance,
  validateUxAcceptanceFiles
} from "./ux-acceptance-lib.mjs";
import {
  uxAutomationReviewKey,
  validateUxAutomationReport
} from "./ux-acceptance-report-contracts.mjs";

const MAX_JSON_BYTES = 50 * 1024 * 1024;

export class UxAutomationEvidenceError extends Error {}

function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readRegularFile(filePath, label, maximum = MAX_JSON_BYTES) {
  const resolved = path.resolve(filePath);
  let canonical;
  try {
    canonical = await realpath(resolved);
  } catch {
    throw new UxAutomationEvidenceError(`${label}: файл не найден.`);
  }
  if ((await lstat(resolved)).isSymbolicLink()) {
    throw new UxAutomationEvidenceError(
      `${label}: символическая ссылка на файл запрещена.`
    );
  }
  let handle;
  try {
    handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
    const information = await handle.stat();
    if (
      !information.isFile() ||
      information.size < 2 ||
      information.size > maximum
    ) {
      throw new UxAutomationEvidenceError(
        `${label}: ожидается обычный файл размером до 50 МБ.`
      );
    }
    return await handle.readFile();
  } catch (error) {
    if (error instanceof UxAutomationEvidenceError) throw error;
    throw new UxAutomationEvidenceError(`${label}: не удалось безопасно прочитать файл.`);
  } finally {
    await handle?.close();
  }
}

function parseJson(content, label) {
  try {
    return JSON.parse(content.toString("utf8"));
  } catch {
    throw new UxAutomationEvidenceError(`${label}: файл содержит некорректный JSON.`);
  }
}

function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

async function trustedDirectory(directory, label) {
  const resolved = path.resolve(directory);
  let canonical;
  try {
    canonical = await realpath(resolved);
  } catch {
    throw new UxAutomationEvidenceError(`${label}: каталог не найден.`);
  }
  const information = await stat(canonical);
  const uid = currentUid();
  if (
    !information.isDirectory() ||
    (uid !== null && information.uid !== uid) ||
    (information.mode & 0o022) !== 0
  ) {
    throw new UxAutomationEvidenceError(
      `${label}: каталог должен принадлежать текущему пользователю и запрещать запись группе и остальным.`
    );
  }
  return canonical;
}

async function assertTrustedAct(actPath) {
  const information = await stat(actPath);
  const uid = currentUid();
  if (
    !information.isFile() ||
    (uid !== null && information.uid !== uid) ||
    (information.mode & 0o022) !== 0
  ) {
    throw new UxAutomationEvidenceError(
      "Акт UX-приёмки должен принадлежать текущему пользователю и быть защищён от посторонней записи."
    );
  }
}

async function evidenceDirectory(actPath) {
  const directory = path.join(path.dirname(actPath), "evidence");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const canonical = await trustedDirectory(
    directory,
    "Каталог автоматических свидетельств"
  );
  if (canonical !== directory) {
    throw new UxAutomationEvidenceError(
      "Каталог свидетельств содержит символическую ссылку или не является каталогом."
    );
  }
  return canonical;
}

async function contentAddressedEvidence(directory, prefix, content) {
  const sha256 = createHash("sha256").update(content).digest("hex");
  const fileName = `${prefix}-${sha256.slice(0, 16)}.json`;
  const target = path.join(directory, fileName);
  const temporary = path.join(
    directory,
    `.${fileName}.${process.pid}.${randomUUID()}.tmp`
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
    try {
      await link(temporary, target);
    } catch (error) {
      if (!object(error) || error.code !== "EEXIST") throw error;
      const existing = await readRegularFile(
        target,
        "Существующее автоматическое свидетельство"
      );
      if (!existing.equals(content)) {
        throw new UxAutomationEvidenceError(
          "Существующее автоматическое свидетельство не совпадает со своим именем."
        );
      }
    }
  } finally {
    await handle?.close();
    await unlink(temporary).catch(() => undefined);
  }
  return {
    file: `evidence/${fileName}`,
    sha256
  };
}

async function atomicCreateAct(actPath, updated) {
  const content = Buffer.from(`${JSON.stringify(updated, null, 2)}\n`, "utf8");
  const temporary = path.join(
    path.dirname(actPath),
    `.${path.basename(actPath)}.${process.pid}.${randomUUID()}.tmp`
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
    try {
      await link(temporary, actPath);
    } catch (error) {
      if (!object(error) || error.code !== "EEXIST") throw error;
      if ((await lstat(actPath)).isSymbolicLink()) {
        throw new UxAutomationEvidenceError(
          "Выходной акт UX-приёмки не может быть символической ссылкой."
        );
      }
      await assertTrustedAct(actPath);
      const existing = await readRegularFile(
        actPath,
        "Существующий выходной акт UX-приёмки",
        1024 * 1024
      );
      if (!existing.equals(content)) {
        throw new UxAutomationEvidenceError(
          "Выходной акт уже существует и отличается; сборщик не перезаписывает данные."
        );
      }
    }
  } finally {
    await handle?.close();
    await unlink(temporary).catch(() => undefined);
  }
}

export async function collectUxAutomationEvidence({
  actPath: actValue,
  outputActPath: outputActValue,
  playwrightReportPath,
  axeReportPath
}) {
  const requestedActPath = path.resolve(actValue);
  try {
    if ((await lstat(requestedActPath)).isSymbolicLink()) {
      throw new UxAutomationEvidenceError(
        "Акт UX-приёмки: символическая ссылка на файл запрещена."
      );
    }
  } catch (error) {
    if (error instanceof UxAutomationEvidenceError) throw error;
  }
  const canonicalActPath = await realpath(requestedActPath).catch(
    () => requestedActPath
  );
  const parent = await trustedDirectory(
    path.dirname(canonicalActPath),
    "Каталог акта UX-приёмки"
  );
  const actPath = path.join(parent, path.basename(canonicalActPath));
  await assertTrustedAct(actPath);

  const requestedOutputPath = path.resolve(outputActValue);
  try {
    if ((await lstat(requestedOutputPath)).isSymbolicLink()) {
      throw new UxAutomationEvidenceError(
        "Выходной акт UX-приёмки не может быть символической ссылкой."
      );
    }
  } catch (error) {
    if (error instanceof UxAutomationEvidenceError) throw error;
    if (!object(error) || error.code !== "ENOENT") throw error;
  }
  const outputParent = await trustedDirectory(
    path.dirname(requestedOutputPath),
    "Каталог выходного акта UX-приёмки"
  );
  if (outputParent !== parent) {
    throw new UxAutomationEvidenceError(
      "Входной и выходной акты UX-приёмки должны находиться в одном доверенном каталоге."
    );
  }
  const outputActPath = path.join(parent, path.basename(requestedOutputPath));
  if (outputActPath === actPath) {
    throw new UxAutomationEvidenceError(
      "Выходной акт должен иметь новое имя; входной акт не изменяется."
    );
  }

  const actContent = await readRegularFile(
    actPath,
    "Акт UX-приёмки",
    1024 * 1024
  );
  const act = parseJson(actContent, "Акт UX-приёмки");
  const currentValidation = await validateUxAcceptanceFiles(act, actPath);
  if (
    currentValidation.state === "invalid" ||
    currentValidation.state === "failed"
  ) {
    throw new UxAutomationEvidenceError(
      "Акт UX-приёмки повреждён или содержит неуспешную проверку."
    );
  }
  if (act.decision?.status === "passed") {
    throw new UxAutomationEvidenceError(
      "Утверждённый акт UX-приёмки неизменяем; создайте новый акт для другого прогона."
    );
  }

  const [playwrightContent, axeContent] = await Promise.all([
    readRegularFile(playwrightReportPath, "Playwright-отчёт"),
    readRegularFile(axeReportPath, "Axe-отчёт")
  ]);
  let playwrightContract;
  let axeContract;
  const expectedBinding = {
    commitSha: act.environment?.commitSha,
    bundleManifestSha256: act.environment?.bundleManifestSha256,
    releaseMetadataSha256: act.environment?.releaseMetadataSha256,
    browserVersion: act.environment?.browserVersion
  };
  try {
    playwrightContract = validateUxAutomationReport(
      "playwright-json-report",
      parseJson(playwrightContent, "Playwright-отчёт"),
      expectedBinding
    );
    axeContract = validateUxAutomationReport(
      "axe-json-report",
      parseJson(axeContent, "Axe-отчёт"),
      expectedBinding
    );
    if (
      playwrightContract.binding.bundleManifestSha256 !==
        axeContract.binding.bundleManifestSha256 ||
      playwrightContract.binding.releaseMetadataSha256 !==
        axeContract.binding.releaseMetadataSha256
    ) {
      throw new UxAutomationEvidenceError(
        "Playwright и axe созданы для разных установленных выпусков."
      );
    }
  } catch (error) {
    throw new UxAutomationEvidenceError(
      error instanceof Error
        ? error.message
        : "Автоматический отчёт не прошёл строгую проверку."
    );
  }

  const directory = await evidenceDirectory(actPath);
  const [playwrightEvidence, axeEvidence] = await Promise.all([
    contentAddressedEvidence(directory, "playwright", playwrightContent),
    contentAddressedEvidence(directory, "axe", axeContent)
  ]);
  const previousAxeReviews = new Map(
    (
      act.automationEvidence?.find((item) => item?.id === "axe-json-report")
        ?.reviews ?? []
    ).map((review) => [uxAutomationReviewKey(review), review])
  );
  const axeReviews = axeContract.reviewRequirements.map((requirement) => {
    const previous = previousAxeReviews.get(uxAutomationReviewKey(requirement));
    return previous?.reportSha256 === axeEvidence.sha256
      ? previous
      : {
          ...requirement,
          reportSha256: axeEvidence.sha256,
          status: "pending",
          reviewedAt: null,
          reviewerId: null,
          evidence: ""
        };
  });
  const updated = structuredClone(act);
  updated.automationEvidence = [
    {
      id: "playwright-json-report",
      ...playwrightEvidence,
      completedAt: playwrightContract.completedAt,
      reviews: []
    },
    {
      id: "axe-json-report",
      ...axeEvidence,
      completedAt: axeContract.completedAt,
      reviews: axeReviews
    }
  ];
  const updatedValidation = await validateUxAcceptanceFiles(
    updated,
    outputActPath
  );
  if (
    updatedValidation.state === "invalid" ||
    updatedValidation.state === "failed"
  ) {
    throw new UxAutomationEvidenceError(
      "Собранные автоматические свидетельства не прошли проверку акта."
    );
  }
  await atomicCreateAct(outputActPath, updated);
  return {
    actPath: outputActPath,
    state: validateUxAcceptance(updated).state,
    automationEvidence: updated.automationEvidence
  };
}
