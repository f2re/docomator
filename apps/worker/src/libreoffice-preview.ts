import { spawn, type ChildProcessByStdio } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

export type PreviewSourceFormat = "docx" | "xlsx";

export interface LibreOfficePreviewOptions {
  binary: string;
  input: Uint8Array;
  format: PreviewSourceFormat;
  temporaryRoot: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal: AbortSignal;
}

export interface LibreOfficePreviewResult {
  pdf: Buffer;
  metadata: {
    converter: "LibreOffice";
    binaryName: string;
    exitCode: 0;
    durationMs: number;
    outputBytes: number;
    stdout: string;
    stderr: string;
  };
}

export class LibreOfficePreviewError extends Error {
  override readonly name = "LibreOfficePreviewError";

  constructor(
    readonly code: string,
    readonly userMessage: string,
    readonly technicalMessage: string = userMessage
  ) {
    super(technicalMessage);
  }
}

type PreviewChild = ChildProcessByStdio<null, Readable, Readable>;

const MAX_CAPTURE_BYTES = 64 * 1024;
const MAX_INPUT_BYTES = 64 * 1024 * 1024;

function validateOptions(options: LibreOfficePreviewOptions): void {
  if (options.input.byteLength === 0) {
    throw new LibreOfficePreviewError(
      "preview_input_empty",
      "Проверяемая копия документа пуста."
    );
  }
  if (options.input.byteLength > MAX_INPUT_BYTES) {
    throw new LibreOfficePreviewError(
      "preview_input_too_large",
      "Проверяемая копия превышает предел 64 МБ."
    );
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 5_000) {
    throw new TypeError("timeoutMs must be an integer of at least 5000");
  }
  if (!Number.isInteger(options.maxOutputBytes) || options.maxOutputBytes < 1_024) {
    throw new TypeError("maxOutputBytes must be an integer of at least 1024");
  }
  if (options.signal.aborted) {
    throw new LibreOfficePreviewError(
      "preview_cancelled",
      "Создание предварительного просмотра отменено."
    );
  }
}

function capture(
  chunks: Buffer[],
  currentBytes: number,
  chunkValue: Buffer | Uint8Array | string
): number {
  if (currentBytes >= MAX_CAPTURE_BYTES) return currentBytes;
  const chunk = Buffer.isBuffer(chunkValue)
    ? chunkValue
    : typeof chunkValue === "string"
      ? Buffer.from(chunkValue)
      : Buffer.from(chunkValue);
  const remaining = MAX_CAPTURE_BYTES - currentBytes;
  const accepted = chunk.subarray(0, remaining);
  chunks.push(accepted);
  return currentBytes + accepted.byteLength;
}

function terminateProcess(child: PreviewChild): void {
  if (child.pid === undefined || child.killed) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const forceTimer = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, 2_000);
  forceTimer.unref();
}

interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}

function runLibreOffice(
  binary: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
  signal: AbortSignal
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    let child: PreviewChild;
    try {
      child = spawn(binary, [...args], {
        cwd,
        env: environment,
        detached: true,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      reject(error);
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let aborted = false;
    let settled = false;

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes = capture(stdoutChunks, stdoutBytes, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes = capture(stderrChunks, stderrBytes, chunk);
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcess(child);
    }, timeoutMs);
    timeout.unref();

    const onAbort = (): void => {
      aborted = true;
      terminateProcess(child);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    const cleanup = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
    };

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        exitCode: code ?? -1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8").trim(),
        stderr: Buffer.concat(stderrChunks).toString("utf8").trim(),
        timedOut,
        aborted
      });
    });
  });
}

function safeTechnicalText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/gu, " ").trim().slice(0, 4_000);
}

export async function convertOfficeToPdf(
  options: LibreOfficePreviewOptions
): Promise<LibreOfficePreviewResult> {
  validateOptions(options);
  const startedAt = Date.now();
  const temporaryRoot = path.resolve(options.temporaryRoot);
  await mkdir(temporaryRoot, { recursive: true, mode: 0o750 });
  const workDirectory = await mkdtemp(path.join(temporaryRoot, "preview-"));
  const outputDirectory = path.join(workDirectory, "output");
  const profileDirectory = path.join(workDirectory, "profile");
  const homeDirectory = path.join(workDirectory, "home");
  const inputPath = path.join(workDirectory, `input.${options.format}`);

  try {
    await Promise.all([
      mkdir(outputDirectory, { mode: 0o700 }),
      mkdir(profileDirectory, { mode: 0o700 }),
      mkdir(homeDirectory, { mode: 0o700 })
    ]);
    await writeFile(inputPath, Buffer.from(options.input), { mode: 0o600 });

    let processResult: ProcessResult;
    try {
      processResult = await runLibreOffice(
        options.binary,
        [
          "--headless",
          "--nologo",
          "--nodefault",
          "--nofirststartwizard",
          "--nolockcheck",
          `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
          "--convert-to",
          "pdf",
          "--outdir",
          outputDirectory,
          inputPath
        ],
        workDirectory,
        {
          PATH: process.env.PATH,
          LANG: process.env.LANG ?? "C.UTF-8",
          LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
          HOME: homeDirectory,
          XDG_CACHE_HOME: path.join(homeDirectory, ".cache"),
          XDG_CONFIG_HOME: path.join(homeDirectory, ".config"),
          XDG_DATA_HOME: path.join(homeDirectory, ".local", "share"),
          TMPDIR: workDirectory
        },
        options.timeoutMs,
        options.signal
      );
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code ?? "")
          : "";
      if (code === "ENOENT") {
        throw new LibreOfficePreviewError(
          "libreoffice_not_found",
          "LibreOffice не найден на сервере. Обратитесь к администратору.",
          `LibreOffice executable was not found: ${options.binary}`
        );
      }
      throw new LibreOfficePreviewError(
        "libreoffice_start_failed",
        "LibreOffice не удалось запустить. Повторите действие или обратитесь к администратору.",
        error instanceof Error ? error.message : String(error)
      );
    }

    if (processResult.aborted) {
      throw new LibreOfficePreviewError(
        "preview_cancelled",
        "Создание предварительного просмотра отменено."
      );
    }
    if (processResult.timedOut) {
      throw new LibreOfficePreviewError(
        "preview_timeout",
        "LibreOffice не завершил создание PDF за отведённое время.",
        `LibreOffice timed out after ${options.timeoutMs} ms`
      );
    }
    if (processResult.exitCode !== 0) {
      throw new LibreOfficePreviewError(
        "preview_conversion_failed",
        "LibreOffice не смог создать PDF. Проверьте документ и повторите действие.",
        `LibreOffice exited with ${processResult.exitCode}: ${safeTechnicalText(processResult.stderr)}`
      );
    }

    const outputNames = (await readdir(outputDirectory)).filter((name) =>
      name.toLowerCase().endsWith(".pdf")
    );
    if (outputNames.length !== 1) {
      throw new LibreOfficePreviewError(
        "preview_pdf_missing",
        "LibreOffice завершил работу, но проверяемый PDF не найден.",
        `Expected one PDF, found ${outputNames.length}`
      );
    }
    const pdfPath = path.join(outputDirectory, outputNames[0] ?? "");
    const fileInfo = await lstat(pdfPath);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
      throw new LibreOfficePreviewError(
        "preview_pdf_invalid_file",
        "LibreOffice создал недопустимый файл предварительного просмотра."
      );
    }
    if (fileInfo.size < 8 || fileInfo.size > options.maxOutputBytes) {
      throw new LibreOfficePreviewError(
        "preview_pdf_invalid_size",
        fileInfo.size > options.maxOutputBytes
          ? "PDF предварительного просмотра превышает установленный предел размера."
          : "LibreOffice создал пустой или повреждённый PDF."
      );
    }
    const pdf = await readFile(pdfPath);
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new LibreOfficePreviewError(
        "preview_pdf_invalid_signature",
        "Созданный файл не является допустимым PDF."
      );
    }

    return {
      pdf,
      metadata: {
        converter: "LibreOffice",
        binaryName: path.basename(options.binary),
        exitCode: 0,
        durationMs: Math.max(0, Date.now() - startedAt),
        outputBytes: pdf.byteLength,
        stdout: safeTechnicalText(processResult.stdout),
        stderr: safeTechnicalText(processResult.stderr)
      }
    };
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}
