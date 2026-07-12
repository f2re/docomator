import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadApiConfig } from "@docomator/config";
import {
  buildZipFixture,
  minimalDocxEntries
} from "@docomator/document-intake/testing";

import { buildApp } from "./app.js";

async function testApp() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-intake-api-"));
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: dataDir,
      DOCOMATOR_LOG_LEVEL: "fatal"
    })
  );
  return { app, dataDir };
}

test("document intake API returns a Russian compatibility report", async () => {
  const { app, dataDir } = await testApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/document-intake/inspect?fileName=%D0%A8%D0%B0%D0%B1%D0%BB%D0%BE%D0%BD.docx",
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "x-correlation-id": "corr-intake-docx"
      },
      payload: buildZipFixture(minimalDocxEntries())
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json() as {
      data: {
        fileName: string;
        decision: string;
        summary: { fileCount: number };
        issues: unknown[];
      };
      correlationId: string;
    };
    assert.equal(body.data.fileName, "Шаблон.docx");
    assert.equal(body.data.decision, "accepted");
    assert.equal(body.data.summary.fileCount, 3);
    assert.deepEqual(body.data.issues, []);
    assert.equal(body.correlationId, "corr-intake-docx");
    assert.equal(response.headers["cache-control"], "no-store");
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("document intake API reports macros as a blocked compatibility result", async () => {
  const { app, dataDir } = await testApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/document-intake/inspect?fileName=macro.docx",
      headers: { "content-type": "application/octet-stream" },
      payload: buildZipFixture([
        ...minimalDocxEntries(),
        { name: "word/vbaProject.bin", content: Buffer.from([1, 2, 3]) }
      ])
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json() as {
      data: { decision: string; issues: Array<{ title: string }> };
    };
    assert.equal(body.data.decision, "rejected");
    assert.ok(body.data.issues.some((issue) => /макрос/u.test(issue.title.toLowerCase())));
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("document intake API rejects malformed binary data with a clear Russian error", async () => {
  const { app, dataDir } = await testApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/document-intake/inspect?fileName=broken.docx",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("not a document")
    });

    assert.equal(response.statusCode, 422, response.body);
    const body = response.json() as {
      error: { code: string; message: string };
      correlationId: string;
    };
    assert.equal(body.error.code, "invalid_zip_signature");
    assert.match(body.error.message, /не является корректным/u);
    assert.ok(body.correlationId.length > 0);
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("document intake API requires a file name", async () => {
  const { app, dataDir } = await testApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/document-intake/inspect",
      headers: { "content-type": "application/octet-stream" },
      payload: buildZipFixture(minimalDocxEntries())
    });

    assert.equal(response.statusCode, 400, response.body);
    const body = response.json() as { error: { message: string } };
    assert.match(body.error.message, /Проверьте заполнение формы/u);
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
