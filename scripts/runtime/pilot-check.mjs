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
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, content, { encoding: "utf8", mode: 0o640 });
  await fs.rename(temporary, filePath);
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
const collectorArguments = jsonOnly
  ? originalArguments
  : [...originalArguments, "--json-only"];

try {
  const collected = await runCollector(collectorArguments);
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
  if (
    typeof collectorResult?.jsonReport !== "string" ||
    typeof collectorResult?.markdownReport !== "string"
  ) {
    throw new Error("Сценарий пилотной проверки вернул неполные пути отчётов.");
  }

  const jsonReportPath = path.resolve(collectorResult.jsonReport);
  const markdownReportPath = path.resolve(collectorResult.markdownReport);
  const source = await fs.readFile(jsonReportPath, "utf8");
  const report = JSON.parse(source);

  let identity = null;
  let identityError = null;
  try {
    identity = await fetchInstalledReleaseIdentity(report.url, report.version ?? null);
  } catch (error) {
    identityError = error instanceof Error ? error.message : String(error);
  }

  const boundReport = bindPilotReleaseIdentity(report, identity, identityError);
  await atomicWrite(jsonReportPath, `${JSON.stringify(boundReport, null, 2)}\n`);
  await atomicWrite(markdownReportPath, pilotMarkdownReport(boundReport));

  const result = {
    status: boundReport.status,
    jsonReport: jsonReportPath,
    markdownReport: markdownReportPath,
    summary: boundReport.summary
  };
  outputResult(result, jsonOnly);
  process.exitCode = exitCode(boundReport.status);
} catch (error) {
  process.stderr.write(
    `Не удалось завершить пилотную проверку: ${
      error instanceof Error ? error.message : String(error)
    }\n`
  );
  process.exitCode = 2;
}
