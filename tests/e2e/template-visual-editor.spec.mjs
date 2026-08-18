import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./fixtures/test.mjs";

import { installОформляторApiMock } from "./fixtures/docomator-api.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";

const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6pQAAAABJRU5ErkJggg==";
const screenshotDirectory = path.resolve(
  "tests/e2e/.tmp/docs-screenshots"
);

const docxTemplate = {
  name: "Личная карточка.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  buffer: Buffer.from("controlled-visual-docx-fixture")
};

function richTextStyle(overrides = {}) {
  return {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    color: null,
    backgroundColor: null,
    fontFamily: null,
    fontSizePt: null,
    verticalAlign: "baseline",
    caps: false,
    smallCaps: false,
    ...overrides
  };
}

function emptyBorders() {
  const side = () => ({ style: null, color: null, widthPt: null });
  return { top: side(), right: side(), bottom: side(), left: side() };
}

function docxVisualLayout(studentRosterTemplate = false) {
  const paragraphs = studentRosterTemplate
    ? [
        ...["№", "ФИО студента", "Тема научной работы", "Научный руководитель"].map(
          (_text, index) => ({
            elementId: `word/document.xml#paragraph:header-${index + 1}`,
            paragraphStyle: {
              alignment: "center",
              marginLeftPt: null,
              marginRightPt: null,
              firstLinePt: null,
              hangingPt: null,
              spaceBeforePt: null,
              spaceAfterPt: null,
              lineHeightPt: null,
              backgroundColor: null
            },
            runs: [richTextStyle({ bold: true, color: "#17365D", fontSizePt: 11 })],
            images: []
          })
        ),
        ...[0, 1, 2, 3].map((index) => ({
          elementId: `word/document.xml#paragraph:data-${index + 1}`,
          paragraphStyle: {
            alignment: "left",
            marginLeftPt: null,
            marginRightPt: null,
            firstLinePt: null,
            hangingPt: null,
            spaceBeforePt: null,
            spaceAfterPt: null,
            lineHeightPt: null,
            backgroundColor: null
          },
          runs: [],
          images: []
        }))
      ]
    : [
        {
          elementId: "word/document.xml#paragraph:1",
          paragraphStyle: {
            alignment: "center",
            marginLeftPt: 18,
            marginRightPt: null,
            firstLinePt: null,
            hangingPt: null,
            spaceBeforePt: 6,
            spaceAfterPt: 6,
            lineHeightPt: 18,
            backgroundColor: null
          },
          runs: [
            richTextStyle({
              bold: true,
              italic: true,
              underline: true,
              color: "#A61B1B",
              backgroundColor: "#FFF2CC",
              fontFamily: "Liberation Serif",
              fontSizePt: 14
            })
          ],
          images: [
            {
              relationshipId: "rIdImage",
              mediaPath: "word/media/logo.png",
              mimeType: "image/png",
              dataUri: ONE_PIXEL_PNG,
              widthPt: 48,
              heightPt: 48,
              altText: "Логотип организации",
              anchor: null
            }
          ]
        }
      ];
  return {
    fileName: "Личная карточка.docx",
    format: "docx",
    sourceSha256: "e2e-docx-source-sha256",
    warnings: [],
    docx: {
      page: {
        widthPt: 595.3,
        heightPt: 841.9,
        orientation: "portrait",
        margins: {
          topPt: 56.7,
          rightPt: 42.5,
          bottomPt: 56.7,
          leftPt: 42.5,
          headerPt: 35.4,
          footerPt: 35.4
        }
      },
      paragraphs,
      tables: studentRosterTemplate
        ? [
            {
              part: "word/document.xml",
              tableIndex: 0,
              widthPt: 480,
              columnWidthsPt: [45, 150, 180, 150],
              cells: [
                ...Array.from({ length: 4 }, (_, columnIndex) => ({
                  rowIndex: 0,
                  columnIndex,
                  columnSpan: 1,
                  verticalMerge: null,
                  style: {
                    backgroundColor: "#D9EAF7",
                    verticalAlign: "center",
                    widthPt: [45, 150, 180, 150][columnIndex],
                    borders: {
                      top: { style: "single", color: "#5B9BD5", widthPt: 0.75 },
                      right: { style: "single", color: "#5B9BD5", widthPt: 0.75 },
                      bottom: { style: "single", color: "#5B9BD5", widthPt: 0.75 },
                      left: { style: "single", color: "#5B9BD5", widthPt: 0.75 }
                    }
                  }
                })),
                ...Array.from({ length: 4 }, (_, columnIndex) => ({
                  rowIndex: 1,
                  columnIndex,
                  columnSpan: 1,
                  verticalMerge: null,
                  style: {
                    backgroundColor: null,
                    verticalAlign: "top",
                    widthPt: [45, 150, 180, 150][columnIndex],
                    borders: emptyBorders()
                  }
                }))
              ]
            }
          ]
        : []
    },
    xlsx: null
  };
}

function xlsxVisualLayout() {
  const blueBorders = {
    top: { style: "thin", color: "#4472C4", widthPt: 0.75 },
    right: { style: "thin", color: "#4472C4", widthPt: 0.75 },
    bottom: { style: "thin", color: "#4472C4", widthPt: 0.75 },
    left: { style: "thin", color: "#4472C4", widthPt: 0.75 }
  };
  return {
    fileName: "Личная карточка.xlsx",
    format: "xlsx",
    sourceSha256: "e2e-xlsx-source-sha256",
    warnings: [],
    docx: null,
    xlsx: {
      sheets: [
        {
          name: "Сотрудники",
          path: "xl/worksheets/sheet1.xml",
          columns: [
            { column: 2, widthChars: 28, hidden: false },
            { column: 3, widthChars: 16, hidden: false },
            { column: 4, widthChars: 18, hidden: false }
          ],
          rows: [{ row: 2, heightPt: 34, hidden: false }],
          merges: ["B2:C2"],
          header: { left: "Отдел", center: "Сотрудники", right: "2026" },
          footer: { left: "", center: "Проверочный лист", right: "" },
          cells: [
            {
              elementId: "xl/worksheets/sheet1.xml#cell:B2",
              address: "B2",
              row: 2,
              column: 2,
              displayValue: "ФИО сотрудника",
              style: {
                font: richTextStyle({
                  bold: true,
                  italic: true,
                  underline: true,
                  color: "#9C0006",
                  fontFamily: "Liberation Sans",
                  fontSizePt: 12
                }),
                fillColor: "#FFC7CE",
                horizontalAlign: "center",
                verticalAlign: "center",
                wrapText: true,
                borders: blueBorders,
                numberFormat: null
              }
            },
            {
              elementId: "xl/worksheets/sheet1.xml#cell:C2",
              address: "C2",
              row: 2,
              column: 3,
              displayValue: "10,00",
              style: {
                font: richTextStyle(),
                fillColor: null,
                horizontalAlign: "right",
                verticalAlign: "center",
                wrapText: false,
                borders: blueBorders,
                numberFormat: "0.00"
              }
            },
            {
              elementId: "xl/worksheets/sheet1.xml#cell:D2",
              address: "D2",
              row: 2,
              column: 4,
              displayValue: "20",
              style: {
                font: richTextStyle({ bold: true }),
                fillColor: "#E2F0D9",
                horizontalAlign: "right",
                verticalAlign: "center",
                wrapText: false,
                borders: blueBorders,
                numberFormat: "0"
              }
            }
          ],
          images: [
            {
              relationshipId: "rIdImage",
              mediaPath: "xl/media/logo.png",
              mimeType: "image/png",
              dataUri: ONE_PIXEL_PNG,
              widthPt: 36,
              heightPt: 36,
              altText: "Эмблема листа",
              anchor: "R2C4"
            }
          ]
        }
      ]
    }
  };
}

async function installVisualLayoutMock(page, layout) {
  await page.route("**/template-drafts/*/visual-layout", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({ data: layout, correlationId: "visual-layout-e2e" })
    });
  });
}

async function openVisualTemplate(page, options = {}) {
  const scenario = await installОформляторApiMock(page, options);
  await installVisualLayoutMock(
    page,
    options.xlsx ? xlsxVisualLayout() : docxVisualLayout(Boolean(options.studentRosterTemplate))
  );
  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("templates");
  await page.locator("#documentIntakeFile").setInputFiles(
    options.xlsx
      ? {
          name: "Личная карточка.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: Buffer.from("controlled-visual-xlsx-fixture")
        }
      : docxTemplate
  );
  await expect(page.locator("#documentIntakeStatusTitle")).toHaveText(
    "Файл готов к проверке"
  );
  await page.locator("#documentIntakeButton").click();
  await expect(page.locator("#documentIntakeStatusTitle")).toHaveText(
    "Структура прошла проверку"
  );
  await page.locator("#documentQuarantineButton").click();
  await expect(page.locator('[data-template-step="2"]')).toHaveAttribute(
    "data-wizard-state",
    "current"
  );
  await page.locator("#documentStructureButton").click();
  await expect(page.locator(".template-visual-editor")).toBeVisible();
  return scenario;
}

async function selectTextInVisualTarget(page, text) {
  await page.locator(".template-visual-target").first().evaluate((target, selectedText) => {
    const content = target.querySelector(".template-visual-text") || target;
    const fullText = content.textContent || "";
    const start = fullText.indexOf(selectedText);
    if (start < 0) throw new Error(`Фрагмент не найден: ${selectedText}`);
    const end = start + selectedText.length;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let position = 0;
    let startNode = null;
    let startOffset = 0;
    let endNode = null;
    let endOffset = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const length = node.textContent?.length || 0;
      if (startNode === null && start >= position && start <= position + length) {
        startNode = node;
        startOffset = start - position;
      }
      if (endNode === null && end >= position && end <= position + length) {
        endNode = node;
        endOffset = end - position;
        break;
      }
      position += length;
    }
    if (!startNode || !endNode) throw new Error("Не удалось построить DOM-диапазон");
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, text);
}

async function saveDocsScreenshot(page, name) {
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: path.join(screenshotDirectory, name),
    fullPage: true
  });
}

test("DOCX показывает исходное оформление, изображение и сохраняет безопасный диапазон привязки", async ({ page }) => {
  const scenario = await openVisualTemplate(page);
  await expect(page.locator(".template-visual-docx .template-visual-page")).toBeVisible();
  await expect(page.locator('[data-visual-region="body"]')).toContainText("ФИО: ______");
  const run = page.locator(".template-visual-run").first();
  await expect(run).toHaveCSS("font-weight", "700");
  await expect(run).toHaveCSS("font-style", "italic");
  await expect(run).toHaveCSS("color", "rgb(166, 27, 27)");
  expect(await run.evaluate((node) => getComputedStyle(node).textDecorationLine)).toContain("underline");
  await expect(page.getByRole("img", { name: "Логотип организации" })).toBeVisible();
  await expect(page.locator(".template-visual-accuracy-note")).toContainText("Привязка остаётся детерминированной");
  await selectTextInVisualTarget(page, "______");
  await expect(page.locator("#documentFieldTextRangeMessage")).toContainText("Будет заменён только фрагмент «______»");
  await saveDocsScreenshot(page, "template-studio-docx.png");
  await page.locator("#documentFieldProperty").selectOption("__new__", { force: true });
  await page.locator("#documentFieldLabel").fill("ФИО");
  await page.locator("#documentFieldType").selectOption("string");
  await page.locator("#documentPropertyConfirm").check();
  await expect(page.locator("#documentFieldSave")).toBeEnabled();
  await page.locator("#documentFieldSave").click();
  await expect(page.locator("#documentFieldMessage")).toContainText("связано с документом");
  await expect.poll(() => scenario.fieldRequests.length).toBe(1);
  expect(scenario.fieldRequests[0]).toMatchObject({
    elementId: "word/document.xml#paragraph:1",
    textRange: { startOffset: 5, endOffset: 11 }
  });
});

test("DOCX-таблица сохраняет геометрию, цвет ячеек и row-flow на 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openVisualTemplate(page, { studentRosterTemplate: true });
  const table = page.locator(".template-visual-table");
  await expect(table).toBeVisible();
  await expect(table.locator("tr")).toHaveCount(2);
  await expect(table.locator("td")).toHaveCount(8);
  await expect(table.locator("td").first()).toHaveCSS("background-color", "rgb(217, 234, 247)");
  await expect(page.locator(".structure-table-row")).toHaveCount(2);
  await expect(page.locator(".structure-table-cell-stack")).toHaveCount(8);
  const overflow = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  expect(overflow.page).toBeLessThanOrEqual(overflow.viewport);
  const firstTarget = page.locator(".template-visual-target").first();
  const box = await firstTarget.boundingBox();
  expect(box).not.toBeNull();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await firstTarget.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#documentStructureSelection")).toBeVisible();
});

test("XLSX показывает лист, объединение, стили, колонтитулы, формулу и изображение", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openVisualTemplate(page, { xlsx: true });
  await expect(page.locator(".template-visual-xlsx")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Сотрудники" })).toHaveAttribute("aria-selected", "true");
  const merged = page.locator('[data-structure-id="xl/worksheets/sheet1.xml#cell:B2"]');
  await expect(merged).toHaveAttribute("colspan", "2");
  await expect(merged).toHaveCSS("font-weight", "700");
  await expect(merged).toHaveCSS("font-style", "italic");
  await expect(merged).toHaveCSS("background-color", "rgb(255, 199, 206)");
  expect(await merged.evaluate((node) => getComputedStyle(node).textDecorationLine)).toContain("underline");
  await expect(page.locator(".template-xlsx-header-footer.is-header")).toContainText("Сотрудники");
  await expect(page.locator(".template-xlsx-formula")).toHaveText("ƒ");
  await expect(page.getByRole("img", { name: "Эмблема листа" })).toBeVisible();
  await merged.click();
  await expect(page.locator("#documentStructureSelection")).toBeVisible();
  await saveDocsScreenshot(page, "template-studio-xlsx.png");
  const overflow = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  expect(overflow.page).toBeLessThanOrEqual(overflow.viewport);
});
