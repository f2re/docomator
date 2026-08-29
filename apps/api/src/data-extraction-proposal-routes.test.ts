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
import { registerDataExtractionProposalRoutes } from "./data-extraction-proposal-routes.js";

async function testApp() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-extraction-proposal-api-"));
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: dataDir,
      DOCOMATOR_LOG_LEVEL: "fatal"
    })
  );
  registerDataExtractionProposalRoutes(app);
  return { app, dataDir };
}

function docxWithTable(): Buffer {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>
    <w:tr><w:tc><w:p><w:r><w:t>№</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Наименование</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Срок</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Подготовить доклад</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>15.09.2026</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Провести исследование</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>01.12.2026</w:t></w:r></w:p></w:tc></w:tr>
  </w:tbl></w:body></w:document>`;
  return buildZipFixture(
    minimalDocxEntries().map((entry) =>
      entry.name === "word/document.xml" ? { ...entry, content: xml } : entry
    )
  );
}

test("auto-proposal API returns safe Document IR coordinates without persisting the source", async () => {
  const { app, dataDir } = await testApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/data-extraction/propose?fileName=${encodeURIComponent("План.docx")}&limit=2000`,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "x-correlation-id": "corr-extraction-proposal"
      },
      payload: docxWithTable()
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers["cache-control"], "no-store");
    const body = response.json() as {
      data: {
        structure: {
          format: string;
          truncated: boolean;
          elements: Array<{ id: string; kind: string }>;
        };
        proposal: {
          confidence: number;
          repeat: {
            columns: Array<{
              label: string;
              elementId: string;
              outputType: string;
            }>;
          } | null;
        };
      };
      correlationId: string;
    };
    assert.equal(body.correlationId, "corr-extraction-proposal");
    assert.equal(body.data.structure.format, "docx");
    assert.equal(body.data.structure.truncated, false);
    assert.deepEqual(
      body.data.proposal.repeat?.columns.map((column) => [column.label, column.outputType]),
      [["№", "integer"], ["Наименование", "text"], ["Срок", "date"]]
    );
    const ids = new Set(body.data.structure.elements.map((element) => element.id));
    for (const column of body.data.proposal.repeat?.columns ?? []) {
      assert.equal(ids.has(column.elementId), true, column.elementId);
    }
    assert.ok(body.data.proposal.confidence >= 0.8);
    await assert.rejects(fs.access(path.join(dataDir, "objects")));
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
