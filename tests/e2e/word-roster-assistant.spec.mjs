import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

const DOCX = {
  name: "Темы студентов.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  buffer: Buffer.from("controlled-student-roster-docx")
};

test("мастер связывает ФИО, тему и руководителя во всей повторяемой строке Word", async ({ page }) => {
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
  await expect(page.locator("#rosterAssistantEntry")).toContainText(
    "Заполнить всю строку как список"
  );
  await page.locator("#rosterAssistantOpen").click();
  await expect(page.locator("#rosterAssistantPanel")).toContainText(
    "ФИО студента"
  );
  await expect(page.locator("#rosterAssistantPanel")).toContainText(
    "Тема научной работы"
  );
  await expect(page.locator("#rosterAssistantPanel")).toContainText(
    "Научный руководитель"
  );

  await page.locator("#rosterAssistantSave").click();
  await expect(page.locator("#rosterAssistantPanel")).toContainText(
    "Строка таблицы настроена"
  );
  expect(scenario.fieldRequests).toHaveLength(3);
  expect(scenario.fieldRequests[0]).toMatchObject({ repeatRow: true });
  expect(scenario.primary.drafts[0].repeatBinding).toMatchObject({
    kind: "docx.repeat-row",
    source: "audience.members",
    tableIndex: 0,
    rowIndex: 1
  });
});
