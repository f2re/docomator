import { expect, test } from "./fixtures/test.mjs";

import { installОформляторApiMock } from "./fixtures/docomator-api.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";

const DOCX = {
  name: "Темы студентов.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  buffer: Buffer.from("controlled-student-roster-recovery-docx")
};

async function openConfiguredRow(page) {
  await page.locator("#documentIntakeFile").setInputFiles(DOCX);
  await page.locator("#documentIntakeButton").click();
  await expect(page.locator("#documentIntakeStatusTitle")).toHaveText(
    "Структура прошла проверку"
  );
  await page.locator("#documentQuarantineButton").click();
  await page.locator("#documentStructureButton").click();
  await page
    .locator(".structure-element")
    .filter({ hasText: "Таблица 1, строка 2, ячейка 1" })
    .click();
  await page.locator("#rowEditorOpen").click();
  await page.locator("#rowEditorSave").click();
  await expect(page.locator("#rowEditorPanel")).toContainText("Строка сохранена");
  await page.locator("#rowEditorContinueTrial").click();
  await expect(page.locator("#templateMultiTrialForm")).toBeVisible();
}

test("общая проверка обновляет изменившийся черновик и сохраняет введённые примеры", async ({
  page
}) => {
  const scenario = await installОформляторApiMock(page, {
    studentRosterTemplate: true
  });
  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("templates");
  await openConfiguredRow(page);

  await expect(page.locator("#templateMultiTrialFields [data-field-id]")).toHaveCount(4);
  await page.locator("#templateMultiTrialFillExamples").click();
  const firstControl = page.locator("#templateMultiTrialFields [data-field-id]").first();
  const firstValue = await firstControl.inputValue();
  expect(firstValue).not.toBe("");

  scenario.primary.drafts[0].fields.push({
    id: "template-field-late-e2e",
    key: "person.department",
    label: "Кафедра",
    valueType: "string",
    required: false,
    elementId: "word/document.xml#paragraph:late-e2e",
    elementKind: "paragraph",
    formatter: { version: 1, kind: "identity" },
    version: 1
  });

  await page.locator("#templateMultiTrialSubmit").click();
  await expect(page.locator("#templateMultiTrialResult")).toContainText(
    "Список полей обновлён"
  );
  await expect(page.locator("#templateMultiTrialFields [data-field-id]")).toHaveCount(5);
  await expect(page.locator("#templateMultiTrialFields [data-field-id]").first()).toHaveValue(
    firstValue
  );
  await expect(page.locator(".multi-trial-field.is-new")).toContainText("Кафедра");
  expect(scenario.multiTrialBodies).toHaveLength(0);

  await page.locator("#templateMultiTrialFillExamples").click();
  await page.locator("#templateMultiTrialSubmit").click();
  await expect(page.locator("#templateMultiTrialResult")).toContainText(
    "Шаблон прошёл общую проверку"
  );
  expect(scenario.multiTrialBodies).toHaveLength(1);
  expect(scenario.multiTrialBodies[0].values).toHaveLength(5);
});
