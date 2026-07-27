import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

function property(key, label, uiGroup, aliases = []) {
  return {
    key,
    label,
    valueType: "string",
    sensitivity: "personal",
    appliesTo: ["person"],
    aliases,
    validation: { uiGroup }
  };
}

const properties = [
  property("person.email", "Электронная почта", "common", ["email", "почта"]),
  property("person.phone", "Телефон", "common"),
  ...Array.from({ length: 14 }, (_, index) =>
    property(
      `teacher.department_${index + 1}`,
      `Кафедра преподавателя ${index + 1}`,
      "teacher",
      [`кафедра ${index + 1}`]
    )
  ),
  ...Array.from({ length: 14 }, (_, index) =>
    property(
      `student.group_${index + 1}`,
      `Учебная группа студента ${index + 1}`,
      "student",
      [`группа ${index + 1}`]
    )
  )
];

async function uploadRoster(page) {
  await page.locator("#documentIntakeFile").setInputFiles({
    name: "Реестр студентов.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("controlled-e2e-student-roster")
  });
  await page.locator("#documentIntakeButton").click();
  await expect(page.locator("#documentIntakeStatusTitle")).toHaveText(
    "Структура прошла проверку"
  );
  await page.locator("#documentQuarantineButton").click();
  await page.locator("#documentStructureButton").click();
  await expect(page.locator(".structure-element").first()).toBeVisible();
}

test("поля преподавателя и студента разделены, а большой список имеет поиск", async ({
  page
}) => {
  await installDocomatorApiMock(page, {
    properties,
    studentRosterTemplate: true
  });
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("templates");
  await uploadRoster(page);

  await page
    .locator('[data-structure-id="word/document.xml#paragraph:data-2"]')
    .click();
  await page.locator("#rowEditorOpen").click();
  await expect(page.locator("[data-row-editor-column]")).toHaveCount(4);

  const supervisor = page
    .locator("[data-row-editor-column]")
    .filter({ hasText: "Научный руководитель" });
  const topic = page
    .locator("[data-row-editor-column]")
    .filter({ hasText: "Тема научной работы" });

  await expect(supervisor.locator("[data-row-editor-group]")).toHaveValue("teacher");
  await expect(topic.locator("[data-row-editor-group]")).toHaveValue("student");

  const mode = supervisor.locator("[data-row-editor-mode]");
  const values = await mode.locator("option").evaluateAll((options) =>
    options.map((option) => option.value)
  );
  expect(values).toContain("existing:teacher.department_14");
  expect(values).not.toContain("existing:student.group_14");

  const customSelect = mode.locator("xpath=following-sibling::*[1]");
  await expect(customSelect).toHaveClass(/searchable-select/u);
  await customSelect.locator(".searchable-select-trigger").click();
  await customSelect.locator(".searchable-select-search").fill("кафедра 14");
  await expect(
    customSelect.locator(".searchable-select-option", {
      hasText: "Кафедра преподавателя 14"
    })
  ).toBeVisible();
  await expect(
    customSelect.locator(".searchable-select-option", {
      hasText: "Учебная группа студента 14"
    })
  ).toHaveCount(0);

  await page.keyboard.press("Escape");
  await supervisor.locator("[data-row-editor-group]").selectOption("student");
  const regroupedValues = await mode.locator("option").evaluateAll((options) =>
    options.map((option) => option.value)
  );
  expect(regroupedValues).toContain("existing:student.group_14");
  expect(regroupedValues).not.toContain("existing:teacher.department_14");
});
