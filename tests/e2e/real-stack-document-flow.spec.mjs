import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "./fixtures/test.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

const realStackEnabled = process.env.DOCOMATOR_E2E_REAL_STACK === "1";
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, "../..");
const personalCardFixture = path.join(
  repositoryRoot,
  "examples",
  "templates",
  "personal-card.docx"
);

async function expectWorkerReady(page) {
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/v1/operations/readiness", {
          headers: { accept: "application/json" }
        });
        if (!response.ok()) return `http-${response.status()}`;
        const payload = await response.json();
        return payload?.data?.checks?.find((item) => item.id === "worker")?.state;
      },
      {
        message: "фоновый обработчик должен опубликовать рабочее состояние",
        timeout: 30_000
      }
    )
    .toBe("ok");
}

async function uploadAndSaveSource(page) {
  await page.locator("#documentIntakeFile").setInputFiles(personalCardFixture);
  await expect(page.locator("#documentIntakeStatusTitle")).toHaveText(
    "Файл готов к проверке"
  );
  await page.locator("#documentIntakeButton").click();
  await expect(page.locator("#documentIntakeStatusTitle")).toHaveText(
    "Структура прошла проверку",
    { timeout: 20_000 }
  );
  await page.locator("#documentQuarantineButton").click();
  await expect(page.locator("#documentQuarantineMessage")).toContainText(
    "Следующий этап — выбрать изменяемые поля",
    { timeout: 20_000 }
  );
  await expect(page.locator('[data-template-step="2"]')).toHaveAttribute(
    "data-wizard-state",
    "current"
  );
}

async function bindDisplayNameField(page) {
  await page.locator("#documentStructureButton").click();
  const fullNameParagraph = page
    .locator(".structure-element")
    .filter({ hasText: "ФИО сотрудника" })
    .first();
  await expect(fullNameParagraph).toBeVisible({ timeout: 20_000 });
  await fullNameParagraph.click();

  const textRange = page.locator("#documentFieldTextRange");
  await expect(textRange).toBeVisible();
  await textRange.evaluate((control) => {
    const placeholder = "ФИО сотрудника";
    const start = control.value.indexOf(placeholder);
    if (start < 0) {
      throw new Error(`В абзаце не найден плейсхолдер «${placeholder}».`);
    }
    control.focus();
    control.setSelectionRange(start, start + placeholder.length);
    control.dispatchEvent(new Event("select", { bubbles: true }));
  });

  await page
    .locator("#documentFieldProperty")
    .selectOption("__system_display_name__", { force: true });
  await page.locator("#documentFieldTextPresentation").selectOption("full");
  const required = page.locator("#documentFieldRequired");
  if (!(await required.isChecked())) await required.check();
  await expect(page.locator("#documentFieldSave")).toBeEnabled();
  await page.locator("#documentFieldSave").click();
  await expect(page.locator("#documentFieldMessage")).toContainText(
    "Следующий шаг — пробное заполнение",
    { timeout: 20_000 }
  );
  await page.locator("#documentFieldsContinue").click();
  await expect(page.locator("#templateTrialForm")).toBeVisible({ timeout: 20_000 });
}

async function verifyAndActivateTemplate(page, displayName) {
  await page.locator("#templateTrialValue").fill(displayName);
  await page.locator("#templateTrialSubmit").click();
  await expect(page.locator("#templateTrialResult")).toContainText(
    "Проверенная версия 1 готова",
    { timeout: 30_000 }
  );
  await expect(page.locator("#templateActivateDirect")).toBeEnabled({
    timeout: 20_000
  });
  await page.locator("#templateActivateDirect").click();
  await expect(page.locator("#templateActivationStatus")).toContainText(
    "сохранена",
    { timeout: 30_000 }
  );
  await expect(page.locator("#activeTemplateCatalog")).toContainText("Активен");
}

async function generateAndDownload(page) {
  const app = new DocomatorPage(page);
  await app.openView("generation");
  await expect(page.locator("#generationTemplate option")).toHaveCount(1, {
    timeout: 20_000
  });
  await expect(page.locator("#generationEstimate")).toContainText(
    "1 сотрудников → 1 DOCX",
    { timeout: 20_000 }
  );
  await expect(page.locator("#generationSubmit")).toBeEnabled();
  await page.locator("#generationSubmit").click();
  await expect(page.locator("#documentGenerationStatus")).toContainText(
    "Готово",
    { timeout: 90_000 }
  );
  await expect(page.locator('[data-view="documents"].is-visible')).toBeVisible({
    timeout: 20_000
  });
  const downloadLink = page.getByRole("link", { name: "Скачать документ" }).first();
  await expect(downloadLink).toBeVisible({ timeout: 20_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    downloadLink.click()
  ]);
  expect(download.suggestedFilename()).toMatch(/\.docx$/iu);
  const downloadedPath = await download.path();
  expect(downloadedPath, "Playwright должен сохранить сформированный DOCX").not.toBeNull();
  const info = await fs.stat(downloadedPath);
  expect(info.size, "Сформированный DOCX не должен быть пустым").toBeGreaterThan(0);
}

async function verifyEmployeeInSecondContext(page, displayName, fieldLabel, fieldValue) {
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("employees");

  const employeeRow = page
    .locator("[data-employee-id]")
    .filter({ hasText: displayName })
    .first();
  await expect(employeeRow).toBeVisible({ timeout: 20_000 });
  await expect(employeeRow).toContainText("Заполнено дополнительных полей: 1");
  await employeeRow.click();

  const dialog = page.getByRole("dialog", { name: "Карточка сотрудника" });
  await expect(dialog).toBeVisible();
  const fieldControl = dialog.getByRole("combobox", { name: fieldLabel });
  await expect(fieldControl).toBeVisible({ timeout: 20_000 });
  await expect(fieldControl).toHaveValue(fieldValue);
  await dialog.getByRole("button", { name: "Закрыть" }).click();
  await expect(dialog).not.toBeVisible();

  await app.openView("documents");
  await expect(
    page.getByRole("link", { name: "Скачать документ" }).first()
  ).toBeVisible({ timeout: 20_000 });
}

test("настоящий UI → API → SQLite → worker формирует и сохраняет DOCX", async ({
  baseURL,
  browser,
  page
}) => {
  test.skip(
    !realStackEnabled,
    "Сценарий запускается только отдельной командой с настоящими API, SQLite и worker."
  );
  test.setTimeout(150_000);

  await fs.access(personalCardFixture);
  const app = new DocomatorPage(page);
  await app.open();
  await expectWorkerReady(page);

  const suffix = randomUUID().slice(0, 8);
  const displayName = `Иванов Иван ${suffix}`;
  const fieldLabel = `Должность ${suffix}`;
  const fieldValue = "Инженер";

  await app.addEmployeeWithField({
    displayName,
    label: fieldLabel,
    value: fieldValue
  });
  await expect(page.locator("#employeeWorkspaceStatus")).toContainText(
    "Карточка сохранена",
    { timeout: 20_000 }
  );

  await app.openView("templates");
  await uploadAndSaveSource(page);
  await bindDisplayNameField(page);
  await verifyAndActivateTemplate(page, displayName);
  await generateAndDownload(page);

  const secondContext = await browser.newContext({
    baseURL,
    locale: "ru-RU",
    reducedMotion: "reduce",
    timezoneId: "Europe/Moscow",
    viewport: { width: 1440, height: 1000 }
  });
  try {
    const secondPage = await secondContext.newPage();
    await verifyEmployeeInSecondContext(
      secondPage,
      displayName,
      fieldLabel,
      fieldValue
    );
  } finally {
    await secondContext.close();
  }
});
