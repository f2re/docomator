import { expect, test } from "./fixtures/test.mjs";

import {
  E2E_SECOND_SPACE_ID,
  E2E_SPACE_ID,
  installDocomatorApiMock
} from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

const templateCases = [
  {
    format: "docx",
    fileName: "Личная карточка.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  },
  {
    format: "xlsx",
    fileName: "Личная карточка.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }
];

async function expectWizardUiConstraints(page) {
  const visiblePanels = page.locator(
    "#templateWizard [data-template-wizard-panel]:visible"
  );
  await expect(visiblePanels).toHaveCount(1);
  const primaryCount = await visiblePanels
    .locator(".primary-button:visible")
    .count();
  expect(
    primaryCount,
    "в текущем шаге мастера должна быть не более одной основной кнопки"
  ).toBeLessThanOrEqual(1);

  const targets = page.locator(
    '#templateWizard [data-template-wizard-go]:visible, #templateWizard [data-template-wizard-panel]:visible button:visible'
  );
  for (let index = 0; index < (await targets.count()); index += 1) {
    const target = targets.nth(index);
    const box = await target.boundingBox();
    expect(box, `не удалось измерить touch target ${index + 1}`).not.toBeNull();
    expect(box.height, `высота touch target ${index + 1}`).toBeGreaterThanOrEqual(
      44
    );
    expect(box.width, `ширина touch target ${index + 1}`).toBeGreaterThanOrEqual(
      44
    );
  }
}

async function uploadAndSaveSource(page, templateCase) {
  await page.locator("#documentIntakeFile").setInputFiles({
    name: templateCase.fileName,
    mimeType: templateCase.mimeType,
    buffer: Buffer.from(`controlled-e2e-${templateCase.format}-fixture`)
  });
  await expect(page.locator("#documentIntakeStatusTitle")).toHaveText(
    "Файл готов к проверке"
  );
  await page.locator("#documentIntakeButton").click();
  await expect(page.locator("#documentIntakeStatusTitle")).toHaveText(
    "Структура прошла проверку"
  );
  await page.locator("#documentQuarantineButton").click();

  await expect(page.locator("#documentQuarantineMessage")).toContainText(
    "Следующий этап — выбрать изменяемые поля"
  );
  await expect(page.locator('[data-template-step="2"]')).toHaveAttribute(
    "data-wizard-state",
    "current"
  );
}

async function bindEmployeeField(page, { structureReady = false } = {}) {
  if (!structureReady) {
    await page.locator("#documentStructureButton").click();
    await expect(page.locator(".structure-element").first()).toBeVisible();
  }
  await page.locator(".structure-element").first().click();
  const textRange = page.locator("#documentFieldTextRange");
  if (await textRange.count()) {
    await expect(page.locator("#documentFieldSave")).toBeDisabled();
    await textRange.evaluate((control) => {
      const start = control.value.indexOf("______");
      control.focus();
      control.setSelectionRange(start, start + 6);
      control.dispatchEvent(new Event("select", { bubbles: true }));
    });
    await expect(page.locator("#documentFieldSave")).toBeEnabled();
  }
  await page.locator("#documentFieldProperty").selectOption("__new__");
  await page.locator("#documentFieldLabel").fill("ФИО");
  await page.locator("#documentFieldType").selectOption("string");
  await page.locator("#documentPropertyConfirm").check();
  await page.locator("#documentFieldRequired").check();
  await page.locator("#documentFieldSave").click();
  await expect(page.locator("#documentFieldMessage")).toContainText(
    "Следующий шаг — пробное заполнение"
  );
  await expect(page.locator("#documentFieldsContinue")).toBeVisible();
  await page.locator("#documentFieldsContinue").click();
  await expect(page.locator('[data-template-step="3"]')).toHaveAttribute(
    "data-wizard-state",
    "current"
  );
  await expect(page.locator("#templateTrialForm")).toBeVisible({
    timeout: 12_000
  });
}

async function runTrial(page, { expectFirstError = false } = {}) {
  const value = "Анна Смирнова";
  await page.locator("#templateTrialValue").fill(value);
  await page.locator("#templateTrialSubmit").click();
  if (expectFirstError) {
    await expect(page.locator("#templateTrialResult")).toContainText(
      "Пробное заполнение не прошло"
    );
    await expect(page.locator("#templateTrialResult")).toContainText(
      "e2e-trial-error-id"
    );
    await expect(page.locator("#templateTrialValue")).toHaveValue(value);
    await page.locator("#templateTrialSubmit").click();
  }
  await expect(page.locator("#templateTrialResult")).toContainText(
    "Проверенная версия 1 готова"
  );
  await expect(page.locator('[data-template-step="4"]')).toHaveAttribute(
    "data-wizard-state",
    "current"
  );
}

async function previewAndActivate(page) {
  await expect(page.locator("#templatePreviewSubmit")).toBeEnabled({
    timeout: 12_000
  });
  await page.locator("#templatePreviewSubmit").click();
  await expect(page.locator("#templateActivationStatus")).toContainText(
    "Предварительный просмотр готов"
  );
  await page.locator("#templateActivationConfirmed").check();
  await page.locator("#templateActivateButton").click();
  await expect(page.locator("#templateActivationStatus")).toContainText(
    "активирована"
  );
  await expect(page.locator("#activeTemplateCatalog")).toContainText("Активен");
  await expect(page.locator("#activeTemplateCatalog")).toContainText(
    "Личная карточка"
  );
}

for (const templateCase of templateCases) {
  test(`полный мастер ${templateCase.format.toUpperCase()}: документ → поля → проверка → готово`, async ({
    page
  }) => {
    await installDocomatorApiMock(page);
    const app = new DocomatorPage(page);
    await app.open();
    await app.openView("templates");

    await expect(page.locator(".template-step-rail")).toContainText("Документ");
    await expect(page.locator(".template-step-rail")).toContainText("Поля");
    await expect(page.locator(".template-step-rail")).toContainText("Проверка");
    await expect(page.locator(".template-step-rail")).toContainText("Готово");
    await expectWizardUiConstraints(page);

    await uploadAndSaveSource(page, templateCase);
    await expectWizardUiConstraints(page);
    await bindEmployeeField(page);
    await expectWizardUiConstraints(page);
    await runTrial(page);
    await expectWizardUiConstraints(page);
    await previewAndActivate(page);
    await expectWizardUiConstraints(page);
  });
}

test("мастер сохраняет ограниченные настройки числового форматтера", async ({
  page
}) => {
  const scenario = await installDocomatorApiMock(page);
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("templates");
  await uploadAndSaveSource(page, templateCases[0]);
  await page.locator("#documentStructureButton").click();
  await page.locator(".structure-element").first().click();
  const textRange = page.locator("#documentFieldTextRange");
  await textRange.evaluate((control) => {
    const start = control.value.indexOf("______");
    control.focus();
    control.setSelectionRange(start, start + 6);
    control.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.locator("#documentFieldProperty").selectOption("__new__");
  await page.locator("#documentFieldLabel").fill("Ставка");
  await page.locator("#documentFieldType").selectOption("number");
  await expect(page.locator("#documentFieldDecimalPlaces")).toBeVisible();
  await page.locator("#documentFieldDecimalPlaces").selectOption("2");
  await page.locator("#documentPropertyConfirm").check();
  await page.locator("#documentFieldSave").click();
  await expect(page.locator("#documentFieldMessage")).toContainText(
    "Следующий шаг — пробное заполнение"
  );
  expect(scenario.fieldRequests).toHaveLength(1);
  expect(scenario.fieldRequests[0]).toMatchObject({
    valueType: "number",
    decimalPlaces: 2
  });
});

test("мастер сохраняет повторяемую строку DOCX только по явному выбору", async ({
  page
}) => {
  const scenario = await installDocomatorApiMock(page, {
    repeatTemplate: true
  });
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("templates");
  await uploadAndSaveSource(page, templateCases[0]);
  await page.locator("#documentStructureButton").click();
  await page.locator(".structure-element").first().click();
  await expect(page.locator("#documentFieldRepeatRow")).toBeVisible();
  await page.locator("#documentFieldRepeatRow").check();
  const textRange = page.locator("#documentFieldTextRange");
  await textRange.evaluate((control) => {
    const start = control.value.indexOf("______");
    control.focus();
    control.setSelectionRange(start, start + 6);
    control.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.locator("#documentFieldProperty").selectOption("__new__");
  await page.locator("#documentFieldLabel").fill("ФИО");
  await page.locator("#documentFieldType").selectOption("string");
  await page.locator("#documentPropertyConfirm").check();
  await page.locator("#documentFieldSave").click();
  await expect(page.locator("#documentFieldMessage")).toContainText(
    "Следующий шаг — пробное заполнение"
  );
  expect(scenario.fieldRequests).toHaveLength(1);
  expect(scenario.fieldRequests[0]).toMatchObject({ repeatRow: true });
  expect(scenario.primary.drafts[0].repeatBinding).toMatchObject({
    kind: "docx.repeat-row",
    source: "audience.members",
    tableIndex: 0,
    rowIndex: 1
  });
});

test("ошибка сервера сохраняет пробное значение и показывает идентификатор операции", async ({
  page
}) => {
  await installDocomatorApiMock(page, { failTrialOnce: true });
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("templates");
  await uploadAndSaveSource(page, templateCases[0]);
  await bindEmployeeField(page);
  await runTrial(page, { expectFirstError: true });
});

test("после перезагрузки мастер продолжает с сохранённого исходника без повторного выбора файла", async ({
  page
}) => {
  const scenario = await installDocomatorApiMock(page);
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("templates");
  await uploadAndSaveSource(page, templateCases[0]);

  await page.reload();
  await expect(page.locator("#connectionBadge")).toContainText(
    "Локальный сервер готов"
  );
  await app.openView("templates");
  await expect(page.locator('[data-template-step="2"]')).toHaveAttribute(
    "data-wizard-state",
    "current"
  );
  await expect(page.locator("#templateWizardStatus")).toContainText(
    "повторно выбирать файл не нужно"
  );
  await expect(page.locator("#documentIntakeFile")).toHaveValue("");
  await expect(page.locator("#documentStructureButton")).toBeEnabled();

  await page.locator("#documentStructureButton").click();
  await expect(page.locator(".structure-element").first()).toBeVisible();
  expect(scenario.draftRequests).toHaveLength(1);

  await page.reload();
  await expect(page.locator("#connectionBadge")).toContainText(
    "Локальный сервер готов"
  );
  await app.openView("templates");
  await page.locator("#documentStructureButton").click();
  await expect(page.locator(".structure-element").first()).toBeVisible();
  expect(
    scenario.draftRequests,
    "повторное построение должно читать существующий черновик"
  ).toHaveLength(1);

  await bindEmployeeField(page, { structureReady: true });
  expect(
    scenario.directAnalyzeCalls,
    "структура должна читаться из сохранённой серверной копии"
  ).toBe(0);
  expect(scenario.draftRequests).toHaveLength(1);
  expect(scenario.draftRequests[0]).toMatchObject({
    contentType: "application/json",
    payload: {}
  });
});

test("мастер отклоняет черновик, который не принадлежит сохранённому исходнику", async ({
  page
}) => {
  const scenario = await installDocomatorApiMock(page);
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("templates");
  await uploadAndSaveSource(page, templateCases[0]);
  await bindEmployeeField(page);
  scenario.primary.drafts[0].sourceRecordId = "другой-сохранённый-исходник";

  await page.reload();
  await expect(page.locator("#connectionBadge")).toContainText(
    "Локальный сервер готов"
  );
  await app.openView("templates");
  await expect(page.locator('[data-template-step="2"]')).toHaveAttribute(
    "data-wizard-state",
    "current"
  );
  await expect(page.locator('[data-template-step="3"]')).toHaveAttribute(
    "data-wizard-state",
    "locked"
  );
});

test("активный шаблон переживает перезагрузку и не смешивается при смене раздела", async ({
  page
}) => {
  await installDocomatorApiMock(page, { secondSpace: true });
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("templates");
  await uploadAndSaveSource(page, templateCases[0]);
  await bindEmployeeField(page);
  await runTrial(page);
  await previewAndActivate(page);

  await app.openView("settings");
  await app.openView("spaces");
  await page.locator(`[data-space-id="${E2E_SECOND_SPACE_ID}"]`).click();
  await expect(page.locator("#currentSpaceChipText")).toHaveText(
    "Отдел эксплуатации"
  );
  await app.openView("templates");
  await expect(page.locator("#templateWizardSpace")).toHaveText(
    "Отдел эксплуатации"
  );
  await expect(page.locator("#activeTemplateCatalog")).toContainText(
    "пока нет активных шаблонов"
  );
  await expect(page.locator("#templateActivationContent")).toContainText(
    "Нет черновиков"
  );

  await app.openView("settings");
  await app.openView("spaces");
  await page.locator(`[data-space-id="${E2E_SPACE_ID}"]`).click();
  await expect(page.locator("#currentSpaceChipText")).toHaveText(
    "Отдел разработки"
  );
  await app.openView("templates");
  await expect(page.locator("#activeTemplateCatalog")).toContainText(
    "Личная карточка"
  );

  await page.reload();
  await expect(page.locator("#connectionBadge")).toContainText(
    "Локальный сервер готов"
  );
  await expect(page.locator("#homeTemplateStatus")).toContainText(
    "Готовых шаблонов: 1"
  );
  await app.openView("generation");
  await expect(page.locator("#generationTemplate")).toContainText(
    "Личная карточка"
  );
});

test("выпуск создаёт N личных карточек и показывает их в результатах", async ({
  page
}) => {
  await installDocomatorApiMock(page, {
    employeeCount: 3,
    activeTemplate: true
  });
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("generation");

  await expect(page.locator("#generationEstimate")).toContainText(
    "3 сотрудников → 3 DOCX"
  );
  await page.locator("#generationSubmit").click();

  await expect(page.locator("#documentGenerationStatus")).toContainText(
    "Ожидается файлов"
  );
  await expect(page.locator("#documentGenerationStatus")).toContainText(
    "Готово"
  );
  await expect(page.locator("#documentGenerationStatus")).toContainText(
    "Сотрудник 3.docx"
  );
  await expect(page.locator("#generationOpenResults")).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Скачать комплект ZIP" }).click()
  ]);
  expect(download.suggestedFilename()).toBe("docomator-e2e.zip");
  await page.locator("#generationOpenResults").click();

  await expect(page.locator('[data-view="documents"].is-visible')).toBeVisible();
  await expect(page.locator("#sharedDocumentList")).toContainText(
    "Личная карточка сотрудника"
  );
  await expect(page.locator("#sharedDocumentList")).toContainText(
    "Комплект: 3 файлов"
  );
});

test("repeat-шаблон выбирает один сводный документ и блокирует персональный режим", async ({
  page
}) => {
  await installDocomatorApiMock(page, {
    employeeCount: 3,
    activeTemplate: true,
    activeTemplateRepeat: true
  });
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("generation");

  await expect(
    page.locator('input[name="generationMode"][value="one_per_member"]')
  ).toBeDisabled();
  await expect(
    page.locator('input[name="generationMode"][value="aggregate"]')
  ).toBeChecked();
  await expect(page.locator("#generationModeHint")).toContainText(
    "повторяемую строку сотрудников"
  );
  await expect(page.locator("#generationEstimate")).toContainText(
    "3 сотрудников → 1 DOCX"
  );
});
