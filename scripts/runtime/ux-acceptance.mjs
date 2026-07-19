#!/usr/bin/env node
import { constants } from "node:fs";
import { open, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createUxAcceptanceTemplate,
  validateUxAcceptanceFiles
} from "./ux-acceptance-lib.mjs";
import {
  collectUxAutomationEvidence,
  UxAutomationEvidenceError
} from "./ux-acceptance-automation.mjs";

class UxAcceptanceCliError extends Error {}

function usage() {
  process.stdout.write(
    "Использование:\n  ux-acceptance.mjs init ФАЙЛ\n  ux-acceptance.mjs validate ФАЙЛ [--json]\n  ux-acceptance.mjs collect-automation ВХОДНОЙ_АКТ ВЫХОДНОЙ_АКТ PLAYWRIGHT_JSON AXE_JSON\n"
  );
}

async function readBoundedJson(filePath) {
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new UxAcceptanceCliError(
      "Не удалось открыть акт. Проверьте путь, права и отсутствие символической ссылки."
    );
  }
  try {
    const information = await handle.stat();
    if (!information.isFile()) {
      throw new UxAcceptanceCliError("Акт должен быть обычным файлом.");
    }
    if (information.size < 2 || information.size > 1024 * 1024) {
      throw new UxAcceptanceCliError("Размер акта должен быть от 2 байт до 1 МБ.");
    }
    try {
      return JSON.parse(await handle.readFile("utf8"));
    } catch {
      throw new UxAcceptanceCliError("Акт содержит некорректный JSON.");
    }
  } finally {
    await handle.close();
  }
}

const [command, fileValue, ...rest] = process.argv.slice(2);
if (
  !command ||
  !fileValue ||
  !["init", "validate", "collect-automation"].includes(command)
) {
  usage();
  process.exitCode = 2;
} else {
  const filePath = path.resolve(fileValue);
  try {
    if (command === "init") {
      if (rest.length > 0) {
        throw new UxAcceptanceCliError(
          "Команда init не принимает дополнительные параметры."
        );
      }
      try {
        await writeFile(
          filePath,
          `${JSON.stringify(createUxAcceptanceTemplate(), null, 2)}\n`,
          { encoding: "utf8", mode: 0o600, flag: "wx" }
        );
      } catch (error) {
        if (error && typeof error === "object" && error.code === "EEXIST") {
          throw new UxAcceptanceCliError(
            "Файл акта уже существует; init не перезаписывает данные."
          );
        }
        throw new UxAcceptanceCliError(
          "Не удалось создать акт. Проверьте каталог и права доступа."
        );
      }
      process.stdout.write(`Создан незавершённый акт UX-приёмки: ${filePath}\n`);
    } else if (command === "validate") {
      if (
        rest.some((argument) => argument !== "--json") ||
        rest.filter((argument) => argument === "--json").length > 1
      ) {
        throw new UxAcceptanceCliError(
          "Команда validate поддерживает только один параметр --json."
        );
      }
      const result = await validateUxAcceptanceFiles(
        await readBoundedJson(filePath),
        filePath
      );
      if (rest.includes("--json")) {
        process.stdout.write(`${JSON.stringify(result)}\n`);
      } else if (result.state === "passed") {
        process.stdout.write("UX-приёмка подтверждена полным актом.\n");
      } else {
        process.stdout.write(
          `UX-приёмка не завершена: ${result.state}. Ошибок: ${result.errors.length}; незаполненных свидетельств: ${result.missing.length}.\n`
        );
      }
      process.exitCode =
        result.state === "passed" ? 0 : result.state === "incomplete" ? 1 : 2;
    } else {
      if (rest.length !== 3) {
        throw new UxAcceptanceCliError(
          "Команда collect-automation требует новое имя выходного акта и пути к Playwright JSON и axe JSON."
        );
      }
      const [outputActValue, playwrightReportPath, axeReportPath] = rest;
      const result = await collectUxAutomationEvidence({
        actPath: filePath,
        outputActPath: path.resolve(outputActValue),
        playwrightReportPath: path.resolve(playwrightReportPath),
        axeReportPath: path.resolve(axeReportPath)
      });
      const reviewCount =
        result.automationEvidence.find(
          (item) => item.id === "axe-json-report"
        )?.reviews.length ?? 0;
      process.stdout.write(
        `Создан производный акт с автоматическими свидетельствами: ${result.actPath}. Входной акт не изменён; ручная UX-приёмка остаётся незавершённой.${
          reviewCount === 0
            ? ""
            : ` Требуется вручную разобрать неопределённые результаты axe: ${reviewCount}.`
        }\n`
      );
    }
  } catch (error) {
    process.stderr.write(
      `Не удалось обработать акт UX-приёмки: ${
        error instanceof UxAcceptanceCliError ||
        error instanceof UxAutomationEvidenceError
          ? error.message
          : "внутренняя ошибка валидатора."
      }\n`
    );
    process.exitCode = 2;
  }
}
