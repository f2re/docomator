import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

const peoplePreview = {
  fileName: "employees.xlsx",
  fileFormat: "xlsx",
  sourceSha256: "e2e-normalized-people-source",
  previewToken: "e2e-normalized-people-token",
  headers: ["Табельный номер", "ФИО", "Подразделение"],
  columnCount: 3,
  rowCount: 2,
  rows: [
    {
      "Табельный номер": "EMP-A1",
      "ФИО": "иВАНОВ иВАН иВАНОВИЧ",
      "Подразделение": "НАУЧНЫЙ ОТДЕЛ"
    },
    {
      "Табельный номер": "emp-a2",
      "ФИО": "пЕТРОВ пЁТР пЕТРОВИЧ",
      "Подразделение": "ОПЕРАТИВНЫЙ ОТДЕЛ"
    }
  ],
  sampleRows: [
    {
      "Табельный номер": "EMP-A1",
      "ФИО": "иВАНОВ иВАН иВАНОВИЧ",
      "Подразделение": "НАУЧНЫЙ ОТДЕЛ"
    },
    {
      "Табельный номер": "emp-a2",
      "ФИО": "пЕТРОВ пЁТР пЕТРОВИЧ",
      "Подразделение": "ОПЕРАТИВНЫЙ ОТДЕЛ"
    }
  ]
};

test("оператор включает нечувствительный регистр и разделение ФИО", async ({
  page
}) => {
  const state = await installDocomatorApiMock(page, {
    entityTypes: [
      { key: "person", label: "Человек", description: "Сотрудник" }
    ],
    properties: [],
    importPreview: peoplePreview
  });
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("entities");

  await page.locator('[data-entity-action="import"]').click();
  await page.locator("#entityImportFile").setInputFiles({
    name: "employees.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("e2e-xlsx-placeholder", "utf8")
  });
  await page.locator("#entityImportPreviewButton").click();

  const panel = page.locator(
    '[data-import-normalization-panel="generic"]'
  );
  await expect(panel).toBeVisible();
  await expect(panel.locator("[data-import-identity-ignore-case]")).toBeChecked();
  await panel.locator("[data-import-split-name]").check();
  await panel
    .locator("[data-import-name-order]")
    .selectOption("family-given-patronymic");
  await panel.locator("[data-import-display-case]").selectOption("name");

  const departmentRow = page
    .locator("[data-entity-import-mapping]")
    .filter({ hasText: "Подразделение" });
  await departmentRow
    .locator("[data-import-cell-case]")
    .selectOption("lower");

  await page.locator("#entityImportPlanButton").click();
  await expect(page.locator("#entityImportExecuteButton")).toBeVisible();
  await page.locator("#entityImportExecuteButton").click();
  await expect(page.locator("#entityImportMessage")).toContainText(
    "Импорт завершён"
  );

  expect(state.importBodies).toHaveLength(1);
  const payload = state.importBodies[0];
  expect(payload.identityCaseInsensitive).toBe(true);
  expect(payload.displayNameNormalization.case).toBe("name");
  expect(payload.personNameSplit).toMatchObject({
    enabled: true,
    sourceColumn: "ФИО",
    order: "family-given-patronymic"
  });
  expect(
    payload.mappings.find((mapping) => mapping.column === "Подразделение")
      ?.normalization?.case
  ).toBe("lower");
});
