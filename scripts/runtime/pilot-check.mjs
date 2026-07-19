#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  bindPilotReleaseIdentity,
  fetchInstalledReleaseIdentity,
  pilotMarkdownReport
} from "./pilot-release-identity.mjs";

const MAXIMUM_COLLECTOR_OUTPUT_BYTES = 1024 * 1024;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const collectorPath = path.join(scriptDirectory, "pilot-readiness.mjs");

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

function optionValue(argumentsList, name, fallback = null) {
  let value = fallback;
  for (let index = 0; index < argumentsList.length; index += 1) {
    if (argumentsList[index] !== name) continue;
    index += 1;
    if (argumentsList[index] === undefined) {
      throw new Error(`Не указано значение после ${name}.`);
    }
    value = argumentsList[index];
  }
  return value;
}

function collectorArguments(argumentsList, stagingDirectory) {
  const result = [];
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--output") {
      index += 1;
      if (argumentsList[index] === undefined) {
        throw new Error("Не указано значение после --output.");
      }
      continue;
    }
    result.push(argument);
  }
  result.push("--output", stagingDirectory);
  if (!result.includes("--json-only")) result.push("--json-only");
  return result;
}

async function finalOutputDirectory(argumentsList) {
  const explicitOutput = optionValue(argumentsList, "--output");
  if (explicitOutput !== null) return path.resolve(explicitOutput);

  const configFile = path.resolve(
    optionValue(argumentsList, "--config", "/etc/docomator/docomator.env")
  );
  let config = {};
  try {
    config = parseEnv(await fs.readFile(configFile, "utf8"));
  } catch (error) {
    if (error === null || typeof error !== "object" || error.code !== "ENOENT") {
      throw error;
    }
  }
  const dataDirectory = path.resolve(
    config.DOCOMATOR_DATA_DIR || process.env.DOCOMATOR_DATA_DIR || "/var/lib/docomator"
  );
  return path.join(dataDirectory, "pilot-reports");
}

function appendLimited(chunks, chunk, currentSize, streamName) {
  const nextSize = currentSize + chunk.length;
  if (nextSize > MAXIMUM_COLLECTOR_OUTPUT_BYTES) {
    throw new Error(`${streamName} сценария пилотной проверки превышает допустимый размер.`);
  }
  chunks.push(chunk);
  return nextSize;
}

function runCollector(argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [collectorPath, ...argumentsList], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failed = null;

    child.stdout.on("data", (chunk) => {
      if (failed !== null) return;
      try {
        stdoutBytes = appendLimited(stdout, chunk, stdoutBytes, "stdout");
      } catch (error) {
        failed = error;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk) => {
      if (failed !== null) return;
      try {
        stderrBytes = appendLimited(stderr, chunk, stderrBytes, "stderr");
      } catch (error) {
        failed = error;
        child.kill("SIGKILL");
      }
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (failed !== null) {
        reject(failed);
        return;
      }
      resolve({
        code: code ?? 2,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

async function atomicWrite(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o750 });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, content, { encoding: "utf8", mode: 0o640 });
  await fs.rename(temporary, filePath);
}

function reportPath(stagingDirectory, candidate, extension) {
  if (typeof candidate !== "string") {
    throw new Error("Сценарий пилотной проверки вернул неполные пути отчётов.");
  }
  const resolved = path.resolve(candidate);
  if (
    path.dirname(resolved) !== stagingDirectory ||
    !new RegExp(`^pilot-[0-9TZ]+\\.${extension}$`, "u").test(path.basename(resolved))
  ) {
    throw new Error("Сценарий пилотной проверки вернул небезопасный путь отчёта.");
  }
  return resolved;
}

function outputResult(result, jsonOnly) {
  if (jsonOnly) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  process.stdout.write(
    `${result.status === "passed" ? "✅" : result.status === "attention" ? "⚠️" : "⛔"} ${
      result.status === "passed"
        ? "Пилотный контур готов."
        : result.status === "attention"
          ? "Пилотный контур работает с предупреждениями."
          : "Пилотный запуск заблокирован."
    }\nJSON: ${result.jsonReport}\nОтчёт: ${result.markdownReport}\n`
  );
}

function exitCode(status) {
  return status === "passed" ? 0 : status === "attention" ? 1 : 2;
}

const originalArguments = process.argv.slice(2);
const jsonOnly = originalArguments.includes("--json-only");
let stagingDirectory = null;
let completed = false;

try {
  const outputDirectory = await finalOutputDirectory(originalArguments);
  await fs.mkdir(outputDirectory, { recursive: true, mode: 0o750 });
  stagingDirectory = await fs.mkdtemp(path.join(outputDirectory, ".pilot-staging-"));
  await fs.chmod(stagingDirectory, 0o700);

  const collected = await runCollector(
    collectorArguments(originalArguments, stagingDirectory)
  );
  if (collected.stderr !== "") process.stderr.write(collected.stderr);
  if (collected.signal !== null) {
    throw new Error(`Сценарий пилотной проверки остановлен сигналом ${collected.signal}.`);
  }

  let collectorResult;
  try {
    collectorResult = JSON.parse(collected.stdout.trim());
  } catch {
    if (collected.stdout !== "") process.stderr.write(collected.stdout);
    throw new Error(
      `Сценарий пилотной проверки не вернул JSON-результат (код ${collected.code}).`
    );
  }

  const stagingJsonPath = reportPath(
    stagingDirectory,
    collectorResult?.jsonReport,
    "json"
  );
  const stagingMarkdownPath = reportPath(
    stagingDirectory,
    collectorResult?.markdownReport,
    "md"
  );
  const report = JSON.parse(await fs.readFile(stagingJsonPath, "utf8"));

  let identity = null;
  let identityError = null;
  try {
    identity = await fetchInstalledReleaseIdentity(report.url, report.version ?? null);
  } catch (error) {
    identityError = error instanceof Error ? error.message : String(error);
  }

  const boundReport = bindPilotReleaseIdentity(report, identity, identityError);
  const jsonContent = `${JSON.stringify(boundReport, null, 2)}\n`;
  const markdownContent = pilotMarkdownReport(boundReport);

  // Даже оставшийся после сбоя staging-каталог не должен содержать успешный
  // акт без привязки к установленному релизу.
  await atomicWrite(stagingJsonPath, jsonContent);
  await atomicWrite(stagingMarkdownPath, markdownContent);

  const jsonReportPath = path.join(outputDirectory, path.basename(stagingJsonPath));
  const markdownReportPath = path.join(
    outputDirectory,
    path.basename(stagingMarkdownPath)
  );
  await atomicWrite(jsonReportPath, jsonContent);
  await atomicWrite(markdownReportPath, markdownContent);

  const result = {
    status: boundReport.status,
    jsonReport: jsonReportPath,
    markdownReport: markdownReportPath,
    summary: boundReport.summary
  };
  completed = true;
  outputResult(result, jsonOnly);
  process.exitCode = exitCode(boundReport.status);
} catch (error) {
  process.stderr.write(
    `Не удалось завершить пилотную проверку: ${
      error instanceof Error ? error.message : String(error)
    }\n`
  );
  process.exitCode = 2;
} finally {
  if (stagingDirectory !== null) {
    try {
      await fs.rm(stagingDirectory, { recursive: true, force: true });
    } catch (error) {
      process.stderr.write(
        `Не удалось удалить временный каталог пилотной проверки ${stagingDirectory}: ${
          error instanceof Error ? error.message : String(error)
        }\n`
      );
      if (!completed) process.exitCode = 2;
    }
  }
}
