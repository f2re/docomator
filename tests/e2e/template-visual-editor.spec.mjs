import { expect, test } from "./fixtures/test.mjs";

import { installОформляторApiMock } from "./fixtures/docomator-api.mjs";
import { installVisualLayoutApiMock } from "./fixtures/visual-layout-api.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";

const docxTemplate = {
  name: "Личная карточка.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  buffer: Buffer.from("controlled-visual-docx-fixture")
};

async function openVisualTemplate(page, options = {}) {
  const scenario = await installОформляторApiMock(page, options);
  await installVisualLayoutApiMock(page);
  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("templates");
  await page.locator("#documentIntakeFile").setInputFiles(docxTemplate);
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

test("DOCX показывается как документ и прямое выделение сохраняет безопасный текстовый диапазон", async ({
  page
}) => {
  const scenario = await openVisualTemplate(page);

  await expect(page.locator(".template-visual-page")).toBeVisible();
  await expect(page.locator('[data-visual-region="body"]')).toContainText(
    "ФИО: ______"
  );
  await expect(page.locator(".template-visual-accuracy-note")).toContainText(
    "Верстка не подменяет Word"
  );

  await selectTextInVisualTarget(page, "______");
  await expect(page.locator("#documentStructureSelection")).toBeVisible();
  await expect(page.locator("#documentFieldTextRangeMessage")).toContainText(
    "Будет заменён только фрагмент «______»"
  );

  await page.locator("#documentFieldProperty").selectOption("__new__", {
    force: true
  });
  await page.locator("#documentFieldLabel").fill("ФИО");
  await page.locator("#documentFieldType").selectOption("string");
  await page.locator("#documentPropertyConfirm").check();
  await expect(page.locator("#documentFieldSave")).toBeEnabled();
  await page.locator("#documentFieldSave").click();
  await expect(page.locator("#documentFieldMessage")).toContainText(
    "связано с документом"
  );

  expect(scenario.fieldRequests).toHaveLength(1);
  expect(scenario.fieldRequests[0]).toMatchObject({
    elementId: "word/document.xml#paragraph:1",
    textRange: { startOffset: 5, endOffset: 11 }
  });
});

test("шаблонизатор не скрывает поля пространства по роли, а список выбирается без поиска", async ({
  page
}) => {
  const customProperties = [
    {
      key: "employee.faith",
      label: "Вероисповедание",
      valueType: "string",
      sensitivity: "personal",
      appliesTo: ["person"],
      aliases: [],
      validation: { uiGroup: "unassigned" }
    },
    {
      key: "employee.age",
      label: "Возраст",
      valueType: "integer",
      sensitivity: "personal",
      appliesTo: ["person"],
      aliases: [],
      validation: { uiGroup: "common" }
    },
    {
      key: "teacher.department",
      label: "Кафедра преподавателя",
      valueType: "string",
      sensitivity: "personal",
      appliesTo: ["person"],
      aliases: [],
      validation: { uiGroup: "teacher" }
    },
    {
      key: "student.group",
      label: "Учебная группа студента",
      valueType: "string",
      sensitivity: "personal",
      appliesTo: ["person"],
      aliases: [],
      validation: { uiGroup: "student" }
    }
  ];
  await openVisualTemplate(page, { properties: customProperties });

  await page.locator(".template-visual-target").first().click();
  await expect(page.locator("#documentStructureSelection")).toBeVisible();
  await page.locator("#documentFieldGroup").selectOption("student");

  const values = await page.locator("#documentFieldProperty option").evaluateAll((options) =>
    options.map((option) => option.value)
  );
  expect(values).toContain("employee.faith");
  expect(values).toContain("employee.age");
  expect(values).toContain("teacher.department");
  expect(values).toContain("student.group");

  const customSelect = page
    .locator("#documentFieldProperty")
    .locator("xpath=following-sibling::*[1]");
  const trigger = customSelect.locator(".searchable-select-trigger");
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(customSelect).toHaveClass(/is-open/u);
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowUp");
  await expect(customSelect.locator(".searchable-select-option:focus")).toContainText(
    "Вероисповедание"
  );
  await page.keyboard.press("Enter");
  await expect(page.locator("#documentFieldProperty")).toHaveValue("employee.faith");
});

test("рабочая область разделяет документ и сопоставление по горизонтали без наложения списка", async ({
  page
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await openVisualTemplate(page, {
    properties: [
      {
        key: "employee.long-field",
        label: "Очень длинное название пользовательского поля для проверки границ выпадающего списка",
        valueType: "string",
        sensitivity: "personal",
        appliesTo: ["person"],
        aliases: [],
        validation: { uiGroup: "common" }
      }
    ]
  });

  await page.locator(".template-visual-target").first().click();
  await expect(page.locator("#documentStructureSelection")).toBeVisible();

  const canvas = page.locator(".template-visual-canvas");
  const inspector = page.locator(".template-visual-inspector");
  const canvasBox = await canvas.boundingBox();
  const inspectorBox = await inspector.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(inspectorBox).not.toBeNull();
  expect(inspectorBox.y).toBeGreaterThan(canvasBox.y + canvasBox.height - 2);
  expect(inspectorBox.width).toBeGreaterThanOrEqual(canvasBox.width - 2);

  const customSelect = page
    .locator("#documentFieldProperty")
    .locator("xpath=following-sibling::*[1]");
  await customSelect.locator(".searchable-select-trigger").click();
  const panel = customSelect.locator(".searchable-select-panel");
  await expect(panel).toBeVisible();

  const panelBox = await panel.boundingBox();
  const selectBox = await customSelect.boundingBox();
  const openInspectorBox = await inspector.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(selectBox).not.toBeNull();
  expect(openInspectorBox).not.toBeNull();
  expect(panelBox.x).toBeGreaterThanOrEqual(openInspectorBox.x - 1);
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(
    openInspectorBox.x + openInspectorBox.width + 1
  );
  expect(panelBox.width).toBeLessThanOrEqual(selectBox.width + 2);
});

test("DOCX-таблица остаётся таблицей в визуальной разметке и помещается на узком экране", async ({
  page
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openVisualTemplate(page, { studentRosterTemplate: true });

  const table = page.locator(".template-visual-table");
  await expect(table).toBeVisible();
  await expect(table.locator("tr")).toHaveCount(2);
  await expect(table.locator("td")).toHaveCount(8);
  await expect(table).toContainText("ФИО студента");
  await expect(table).toContainText("Научный руководитель");

  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth
  }));
  expect(overflow.page).toBeLessThanOrEqual(overflow.viewport);

  const firstTarget = page.locator(".template-visual-target").first();
  const box = await firstTarget.boundingBox();
  expect(box).not.toBeNull();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await firstTarget.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#documentStructureSelection")).toBeVisible();
});

test("XLSX продолжает использовать проверенный выбор ячеек без ложного WYSIWYG", async ({
  page
}) => {
  await installОформляторApiMock(page);
  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("templates");
  await page.locator("#documentIntakeFile").setInputFiles({
    name: "Личная карточка.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("controlled-visual-xlsx-fixture")
  });
  await page.locator("#documentIntakeButton").click();
  await page.locator("#documentQuarantineButton").click();
  await page.locator("#documentStructureButton").click();

  await expect(page.locator(".template-visual-editor")).toHaveCount(0);
  await expect(page.locator(".structure-element").first()).toBeVisible();
  await expect(page.locator(".structure-element").first()).toContainText(
    "Сотрудники · B2"
  );
});
