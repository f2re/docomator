import { randomUUID } from "node:crypto";

import { expect, test } from "./fixtures/test.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";

const realStackEnabled = process.env.DOCOMATOR_E2E_REAL_STACK === "1";

async function openImport(page) {
  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("employees");
  await page.locator("[data-bulk-import-open]:visible").first().click();
  await expect(page.locator("#bulkDataImportPanel")).toBeVisible();
  return app;
}

async function disableNameNormalization(page) {
  const control = page.locator("#bulkImportNormalizePersonName");
  if (await control.isChecked()) await control.uncheck();
}

async function planAndExecute(page, expectedFragment) {
  await page.locator("#bulkImportPlanButton").click();
  await expect(page.locator("#bulkImportExecute")).toBeEnabled({ timeout: 20_000 });
  await page.locator("#bulkImportExecute").click();
  await expect(page.locator("#bulkImportMessage")).toContainText(
    expectedFragment,
    { timeout: 20_000 }
  );
}

async function readEmployeeProfile(page, row) {
  const employeeId = await row.getAttribute("data-employee-id");
  expect(employeeId).toBeTruthy();
  const spaceId = await page.evaluate(() =>
    String(globalThis.docomatorCurrentSpaceId || "").trim()
  );
  expect(spaceId).not.toBe("");
  const response = await page.request.get(
    `/api/v1/spaces/${encodeURIComponent(spaceId)}/employees/${encodeURIComponent(employeeId)}`
  );
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data;
}

function employeeFieldValue(profile, label) {
  return profile.fields.find((field) => field.definition.label === label)?.value;
}

test("вставленная TSV-таблица реально импортируется, а CSV-файл обновляет тех же людей", async ({
  page
}) => {
  test.skip(
    !realStackEnabled,
    "Сценарий запускается только на настоящих API и SQLite."
  );
  test.setTimeout(90_000);

  const suffix = randomUUID().slice(0, 8);
  const firstName = `Иванов Иван ${suffix}`;
  const secondName = `Петрова Анна ${suffix}`;
  const firstKey = `P-${suffix}-1`;
  const secondKey = `P-${suffix}-2`;
  const positionLabel = `Должность ${suffix}`;
  const departmentLabel = `Подразделение ${suffix}`;
  const headers = [
    "ФИО",
    "Номер кабинета",
    "Табельный номер",
    positionLabel,
    departmentLabel
  ];

  await openImport(page);
  await page.locator('[data-bulk-import-source="paste"]').click();
  await page.locator("#bulkImportPaste").fill(
    [
      headers.join("\t"),
      [firstName, "412", firstKey, "Инженер", "Научный отдел"].join("\t"),
      [secondName, "412", secondKey, "Аналитик", "Оперативный отдел"].join("\t")
    ].join("\n")
  );
  await page.locator("#bulkImportPastePreview").click();

  await expect(page.locator("#bulkImportMessage")).toContainText(
    "Таблица прочитана: 2 строк"
  );
  await expect(page.locator("#bulkImportPreview")).toContainText(
    "Разделитель CSV: табуляция"
  );
  await expect(page.locator("[data-bulk-paste-source-note]")).toContainText(
    "Отдельный файл не нужен"
  );
  const identity = page.locator("#bulkImportIdentityColumn");
  await expect(identity).toHaveValue("Табельный номер");
  await expect(page.locator("#bulkImportIdentityQuality")).toContainText(
    "все значения заполнены и уникальны (2)"
  );

  await identity.selectOption("Номер кабинета");
  await expect(identity).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#bulkImportIdentityQuality")).toContainText(
    "строк с повторяющимся значением: 2"
  );
  await page.locator("#bulkImportPlanButton").click();
  await expect(page.locator("#bulkImportMessage")).toContainText(
    "Проверка не запущена",
    { timeout: 20_000 }
  );
  await expect(page.locator("#bulkImportMessage")).toContainText("Номер кабинета");
  await expect(page.locator("#bulkImportMessage")).toContainText("«412» — 2 строки");
  await expect(page.locator("#bulkImportMessage")).toContainText("Ничего не импортировано");
  await expect(page.locator("#bulkImportExecute")).toHaveCount(0);

  await identity.selectOption("Табельный номер");
  await expect(identity).not.toHaveAttribute("aria-invalid", "true");
  await disableNameNormalization(page);
  await planAndExecute(page, "Импорт завершён: добавлено 2");

  const firstRow = page.locator("[data-employee-id]").filter({ hasText: firstName });
  const secondRow = page.locator("[data-employee-id]").filter({ hasText: secondName });
  await expect(firstRow).toHaveCount(1, { timeout: 20_000 });
  await expect(secondRow).toHaveCount(1, { timeout: 20_000 });
  const firstProfileAfterPaste = await readEmployeeProfile(page, firstRow);
  const secondProfileAfterPaste = await readEmployeeProfile(page, secondRow);
  expect(employeeFieldValue(firstProfileAfterPaste, positionLabel)).toBe("Инженер");
  expect(employeeFieldValue(firstProfileAfterPaste, departmentLabel)).toBe("Научный отдел");
  expect(employeeFieldValue(secondProfileAfterPaste, positionLabel)).toBe("Аналитик");
  expect(employeeFieldValue(secondProfileAfterPaste, departmentLabel)).toBe("Оперативный отдел");

  await page.locator("#bulkImportAnother").click();
  await page.locator('[data-bulk-import-source="file"]').click();
  const csv = [
    headers.join(","),
    [firstName, "412", firstKey, "Ведущий инженер", "Научный отдел"].join(","),
    [secondName, "412", secondKey, "Старший аналитик", "Оперативный отдел"].join(",")
  ].join("\n");
  await page.locator("#bulkImportFile").setInputFiles({
    name: `Сотрудники-${suffix}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8")
  });
  await page.locator("#bulkImportPreviewButton").click();
  await expect(page.locator("#bulkImportMessage")).toContainText(
    "Файл прочитан: 2 строк"
  );
  await expect(page.locator("#bulkImportIdentityColumn")).toHaveValue(
    "Табельный номер"
  );
  await disableNameNormalization(page);
  await planAndExecute(page, "Импорт завершён: добавлено 0, обновлено 2");

  await expect(firstRow).toHaveCount(1, { timeout: 20_000 });
  await expect(secondRow).toHaveCount(1, { timeout: 20_000 });
  const firstProfileAfterFile = await readEmployeeProfile(page, firstRow);
  const secondProfileAfterFile = await readEmployeeProfile(page, secondRow);
  expect(employeeFieldValue(firstProfileAfterFile, positionLabel)).toBe("Ведущий инженер");
  expect(employeeFieldValue(firstProfileAfterFile, departmentLabel)).toBe("Научный отдел");
  expect(employeeFieldValue(secondProfileAfterFile, positionLabel)).toBe("Старший аналитик");
  expect(employeeFieldValue(secondProfileAfterFile, departmentLabel)).toBe("Оперативный отдел");
});
