import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

const DOCX = {
  name: "Темы студентов.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  buffer: Buffer.from("controlled-student-roster-docx")
};

test("повторяемую строку Word можно сохранить, повторно открыть и изменить", async ({
  page
}) => {
  const scenario = await installDocomatorApiMock(page, {
    studentRosterTemplate: true
  });
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("templates");

  await page.locator("#documentIntakeFile").setInputFiles(DOCX);
  await page.locator("#documentIntakeButton").click();
  await expect(page.locator("#documentIntakeStatusTitle")).toHaveText(
    "Структура прошла проверку"
  );
  await page.locator("#documentQuarantineButton").click();
  await page.locator("#documentStructureButton").click();

  const sampleCell = page.locator(".structure-element").filter({
    hasText: "Таблица 1, строка 2, ячейка 1"
  });
  await sampleCell.click();
  await expect(page.locator(".placement-guidance-card")).toContainText(
    "Выбрана пустая ячейка таблицы"
  );
  await expect(page.locator("#rowEditorEntry")).toContainText(
    "Заполнить всю строку как список участников"
  );
  await page.locator("#rowEditorOpen").click();

  const panel = page.locator("#rowEditorPanel");
  await expect(panel).toBeVisible();
  await expect(page.locator("#documentFieldForm")).toBeHidden();
  await expect(panel.locator("[data-row-editor-column]")).toHaveCount(4);
  await expect(
    panel.locator("[data-row-editor-column]").nth(0).locator("[data-row-editor-mode]")
  ).toHaveValue("system:position");
  await expect(
    panel.locator("[data-row-editor-column]").nth(1).locator("[data-row-editor-mode]")
  ).toHaveValue("system:name");

  await panel.locator("#rowEditorSave").click();
  await expect(panel).toContainText("Строка сохранена");
  expect(scenario.fieldRequests).toHaveLength(4);
  expect(scenario.fieldRequests[0]).toMatchObject({
    key: "subject.position",
    repeatRow: true
  });
  expect(scenario.primary.drafts[0].repeatBinding).toMatchObject({
    kind: "docx.repeat-row",
    source: "audience.members",
    tableIndex: 0,
    rowIndex: 1
  });

  await panel.locator("#rowEditorContinueEditing").click();
  await expect(panel.locator("#rowEditorSave")).toBeEnabled();
  const nameCard = panel.locator("[data-row-editor-column]").nth(1);
  await nameCard
    .locator("[data-row-name-presentation]")
    .selectOption("family-initials");
  const supervisorCard = panel.locator("[data-row-editor-column]").nth(3);
  await supervisorCard.locator("[data-row-editor-mode]").selectOption("skip");
  await panel.locator("#rowEditorSave").click();

  await expect(panel).toContainText("Строка сохранена");
  expect(scenario.fieldUpdateRequests).toHaveLength(3);
  expect(scenario.fieldDeleteRequests).toHaveLength(1);
  expect(
    scenario.fieldUpdateRequests.find((request) => request.personName)
  ).toMatchObject({
    personName: {
      sourceOrder: "family-given-patronymic",
      pattern: "{Фамилия} {И}.{О}."
    }
  });
  expect(scenario.primary.drafts[0].fields).toHaveLength(3);
  expect(scenario.primary.drafts[0].repeatBinding).not.toBeNull();
});
