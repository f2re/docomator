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
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-structure-api-"));
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: dataDir,
      DOCOMATOR_LOG_LEVEL: "fatal"
    })
  );
  return { app, dataDir };
}

function docxWithParagraphs(count: number): Buffer {
  const paragraphs = Array.from(
    { length: count },
    (_, index) => `<w:p><w:r><w:t>Строка ${index + 1}</w:t></w:r></w:p>`
  ).join("");
  return buildZipFixture(
    minimalDocxEntries().map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            content: `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`
          }
        : entry
    )
  );
}

test("structure API returns stable Russian DOCX coordinates", async () => {
  const { app, dataDir } = await testApp();
  try {
    const payload = docxWithParagraphs(2);
    const request = {
      method: "POST" as const,
      url: `/api/v1/document-intake/analyze?fileName=${encodeURIComponent("Письмо.docx")}&limit=20`,
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "x-correlation-id": "corr-structure-docx"
      },
      payload
    };
    const first = await app.inject(request);
    const second = await app.inject(request);

    assert.equal(first.statusCode, 200, first.body);
    assert.equal(second.statusCode, 200, second.body);
    const firstBody = first.json() as {
      data: {
        format: string;
        truncated: boolean;
        elements: Array<{ id: string; kind: string; text: string }>;
      };
      correlationId: string;
    };
    assert.equal(firstBody.data.format, "docx");
    assert.equal(firstBody.data.truncated, false);
    assert.deepEqual(
      firstBody.data.elements.map((element) => element.text),
      ["Строка 1", "Строка 2"]
    );
    assert.deepEqual(
      firstBody.data.elements.map((element) => element.id),
      second.json().data.elements.map((element: { id: string }) => element.id)
    );
    assert.equal(firstBody.correlationId, "corr-structure-docx");
    assert.equal(first.headers["cache-control"], "no-store");
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("structure API reports a bounded result without hiding totals", async () => {
  const { app, dataDir } = await testApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/document-intake/analyze?fileName=many.docx&limit=10",
      headers: { "content-type": "application/octet-stream" },
      payload: docxWithParagraphs(12)
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json() as {
      data: {
        truncated: boolean;
        summary: { totalElements: number; shownElements: number };
        elements: unknown[];
      };
    };
    assert.equal(body.data.truncated, true);
    assert.equal(body.data.summary.totalElements, 12);
    assert.equal(body.data.summary.shownElements, 10);
    assert.equal(body.data.elements.length, 10);
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("structure API rejects unsafe XML with a clear message", async () => {
  const { app, dataDir } = await testApp();
  try {
    const payload = buildZipFixture(
      minimalDocxEntries().map((entry) =>
        entry.name === "word/document.xml"
          ? {
              ...entry,
              content:
                '<!DOCTYPE w:document [<!ENTITY x "опасно">]><w:document xmlns:w="urn:test"><w:body/></w:document>'
            }
          : entry
      )
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/document-intake/analyze?fileName=unsafe.docx&limit=20",
      headers: { "content-type": "application/octet-stream" },
      payload
    });
    assert.equal(response.statusCode, 422, response.body);
    assert.match(response.json().error.message, /запрещённое объявление XML/u);
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
