import { expect, test } from "./fixtures/test.mjs";

import { installОформляторApiMock } from "./fixtures/docomator-api.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";

const structure = {
  fileName: "План.docx",
  format: "docx",
  sourceSha256: "a".repeat(64),
  structureSha256: "b".repeat(64),
  truncated: false,
  summary: {
    partsRead: 1,
    paragraphs: 6,
    runs: 6,
    sheets: 0,
    cells: 0,
    formulas: 0,
    totalElements: 6,
    shownElements: 6
  },
  elements: [
    ["h1", "№", 0, 0],
    ["h2", "Наименование", 0, 1],
    ["h3", "Срок", 0, 2],
    ["d1", "1", 1, 0],
    ["d2", "Подготовить доклад", 1, 1],
    ["d3", "15.09.2026", 1, 2]
  ].map(([id, text, rowIndex, columnIndex], index) => ({
    id,
    kind: "paragraph",
    part: "word/document.xml",
    index,
    text,
    runs: [],
    runsTruncated: false,
    tableLocation: { tableIndex: 0, rowIndex, columnIndex }
  }))
};

const proposal = {
  version: 1,
  format: "docx",
  fields: [],
  repeat: {
    label: "word/document.xml, таблица 1",
    confidence: 0.92,
    reason: "tabular_header",
    columns: [
      { label: "№", elementId: "d1", outputType: "integer", confidence: 0.92 },
      { label: "Наименование", elementId: "d2", outputType: "text", confidence: 0.92 },
      { label: "Срок", elementId: "d3", outputType: "date", confidence: 0.92 }
    ]
  },
  confidence: 0.92,
  warnings: []
};

function envelope(data) {
  return { data, correlationId: "e2e-extraction-correlation" };
}

test("извлечение сначала предлагает структуру и оставляет пользователю только коррекцию", async ({ page }) => {
  await installОформляторApiMock(page);
  await page.route(/\/api\/v1\/spaces\/[^/]+\/data-extraction\/(templates|runs)(?:\?.*)?$/u, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(envelope([])) });
  });
  await page.route(/\/api\/v1\/document-intake\/analyze\?/u, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(envelope(structure)) });
  });
  await page.route(/\/api\/v1\/data-extraction\/propose\?/u, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope({ structure, proposal }))
    });
  });

  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("extraction");
  await expect(page.locator("#data-extraction-heading")).toHaveText("Извлечение данных");
  await expect(page.locator("#extraction-template-title")).toHaveText("Проверьте найденную структуру");

  await page.locator("#extractionSampleFile").setInputFiles({
    name: "План.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("e2e-docx")
  });

  await expect(page.locator("#dataExtractionStatus")).toContainText("Структура предложена автоматически");
  const cards = page.locator("[data-assignment-id]");
  await expect(cards).toHaveCount(3);
  await expect(page.locator('[data-assignment-id="d1"] [data-assignment-label]')).toHaveValue("№");
  await expect(page.locator('[data-assignment-id="d1"] [data-assignment-type]')).toHaveValue("integer");
  await expect(page.locator('[data-assignment-id="d1"] [data-assignment-role]')).toHaveValue("repeat");
  await expect(page.locator('[data-assignment-id="d2"] [data-extraction-auto-badge]')).toContainText("92%");

  const label = page.locator('[data-assignment-id="d2"] [data-assignment-label]');
  await label.fill("Пункт плана");
  await expect(label).toHaveValue("Пункт плана");

  const overflow = await page.evaluate(() => ({
    bodyClient: document.body.clientWidth,
    bodyScroll: document.body.scrollWidth,
    mainClient: document.querySelector("#dataExtractionWorkspace")?.clientWidth ?? 0,
    mainScroll: document.querySelector("#dataExtractionWorkspace")?.scrollWidth ?? 0
  }));
  expect(overflow.bodyScroll).toBeLessThanOrEqual(overflow.bodyClient + 2);
  expect(overflow.mainScroll).toBeLessThanOrEqual(overflow.mainClient + 2);
});
