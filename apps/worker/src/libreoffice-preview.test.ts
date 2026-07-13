import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  convertOfficeToPdf,
  LibreOfficePreviewError
} from "./libreoffice-preview.js";

async function fakeConverter(
  directory: string,
  body: string
): Promise<string> {
  const scriptPath = path.join(directory, "fake-libreoffice.mjs");
  await writeFile(
    scriptPath,
    `#!/usr/bin/env node\n${body}\n`,
    { mode: 0o750 }
  );
  await chmod(scriptPath, 0o750);
  return scriptPath;
}

test("converter uses an isolated profile and returns a bounded PDF", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "docomator-lo-success-"));
  try {
    const binary = await fakeConverter(
      directory,
      `
        import fs from "node:fs";
        import path from "node:path";
        const args = process.argv.slice(2);
        const outIndex = args.indexOf("--outdir");
        const output = args[outIndex + 1];
        const input = args.at(-1);
        fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(path.join(output, "input.pdf"), Buffer.from("%PDF-1.4\\n% test\\n%%EOF\\n"));
        process.stdout.write(JSON.stringify({ args, home: process.env.HOME, input }));
      `
    );
    const controller = new AbortController();
    const result = await convertOfficeToPdf({
      binary,
      input: Buffer.from("test-docx"),
      format: "docx",
      temporaryRoot: path.join(directory, "temporary"),
      timeoutMs: 5_000,
      maxOutputBytes: 1024 * 1024,
      signal: controller.signal
    });

    assert.equal(result.pdf.subarray(0, 5).toString(), "%PDF-");
    assert.equal(result.metadata.exitCode, 0);
    assert.equal(result.metadata.outputBytes, result.pdf.byteLength);
    assert.match(result.metadata.stdout, /UserInstallation=file:/u);
    assert.match(result.metadata.stdout, /preview-/u);
    assert.doesNotMatch(result.metadata.stdout, /\/root/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("converter rejects a non-PDF output", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "docomator-lo-invalid-"));
  try {
    const binary = await fakeConverter(
      directory,
      `
        import fs from "node:fs";
        import path from "node:path";
        const args = process.argv.slice(2);
        const output = args[args.indexOf("--outdir") + 1];
        fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(path.join(output, "input.pdf"), "not a pdf");
      `
    );
    await assert.rejects(
      convertOfficeToPdf({
        binary,
        input: Buffer.from("test-xlsx"),
        format: "xlsx",
        temporaryRoot: path.join(directory, "temporary"),
        timeoutMs: 5_000,
        maxOutputBytes: 1024 * 1024,
        signal: new AbortController().signal
      }),
      (error: unknown) =>
        error instanceof LibreOfficePreviewError &&
        error.code === "preview_pdf_invalid_signature"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("converter terminates an aborted process", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "docomator-lo-abort-"));
  try {
    const binary = await fakeConverter(
      directory,
      `
        setInterval(() => undefined, 1000);
      `
    );
    const controller = new AbortController();
    const pending = convertOfficeToPdf({
      binary,
      input: Buffer.from("test-docx"),
      format: "docx",
      temporaryRoot: path.join(directory, "temporary"),
      timeoutMs: 30_000,
      maxOutputBytes: 1024 * 1024,
      signal: controller.signal
    });
    setTimeout(() => controller.abort(), 50).unref();
    await assert.rejects(
      pending,
      (error: unknown) =>
        error instanceof LibreOfficePreviewError &&
        error.code === "preview_cancelled"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("converter explains a missing LibreOffice binary", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "docomator-lo-missing-"));
  try {
    await assert.rejects(
      convertOfficeToPdf({
        binary: path.join(directory, "missing-libreoffice"),
        input: Buffer.from("test-docx"),
        format: "docx",
        temporaryRoot: path.join(directory, "temporary"),
        timeoutMs: 5_000,
        maxOutputBytes: 1024 * 1024,
        signal: new AbortController().signal
      }),
      (error: unknown) =>
        error instanceof LibreOfficePreviewError &&
        error.code === "libreoffice_not_found" &&
        /LibreOffice не найден/u.test(error.userMessage)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
