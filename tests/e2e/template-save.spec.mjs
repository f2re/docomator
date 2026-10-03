import { expect, test } from "./fixtures/test.mjs";
import { installОформляторApiMock } from "./fixtures/docomator-api.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";

async function configured(page, { format = "docx", repeat = false, fail = false } = {}) {
  const scenario = await installОформляторApiMock(page, { repeatTemplate: repeat, failTrialOnce: fail, secondSpace: true });
  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("templates");
  await page.locator("#documentIntakeFile").setInputFiles({ name: `Сохранение.${format}`,
    mimeType: format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(`controlled-${format}-fixture`) });
  await expect(page.locator("#documentIntakeStatusTitle")).toHaveText("Структура прошла проверку");
  await page.locator("#documentQuarantineButton").click();
  await expect(page.locator(".structure-element:visible").first()).toBeVisible();
  await page.locator(".structure-element:visible").first().click();
  if (repeat) { await page.locator(".studio-repeat-options > summary").click(); await page.locator("#documentFieldRepeatRow").check(); }
  const range = page.locator("#documentFieldTextRange");
  if (await range.count()) await range.evaluate((control) => {
    const start = control.value.indexOf("______");
    control.focus(); control.setSelectionRange(start, start + 6);
    control.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.locator("#documentFieldSave").click();
  await expect(page.locator("#documentTemplateSave")).toBeVisible();
  return { app, scenario };
}

for (const format of ["docx", "xlsx"]) {
  test(`сохранение ${format.toUpperCase()} не требует ручного ввода пробных значений`, async ({ page }) => {
    const { app, scenario } = await configured(page, { format });
    await page.locator("#documentTemplateSave").click();
    await expect(page.locator("#configuredTemplateSaveStatus")).toContainText("Шаблон сохранён");
    await expect(page.locator('[data-template-step="4"]')).toHaveAttribute("data-wizard-state", "current");
    expect(scenario.primary.activeTemplates).toHaveLength(1);
    expect(scenario.primary.trialVersions).toHaveLength(1);
    await app.openView("generation");
    await expect(page.locator("#generationTemplate")).toContainText("Сохранение");
  });
}

test("повторяемая строка сохраняется через общую сборку без ввода примеров", async ({ page }) => {
  const { scenario } = await configured(page, { repeat: true });
  await page.locator("#documentTemplateSave").click();
  await expect(page.locator("#configuredTemplateSaveStatus")).toContainText("Шаблон сохранён");
  expect(scenario.primary.multiTrialVersions).toHaveLength(1);
  expect(scenario.primary.trialVersions).toHaveLength(0);
  expect(scenario.multiTrialBodies[0].values).toHaveLength(1);
  expect(scenario.primary.activeTemplates).toHaveLength(1);
});

test("ошибка сборки не активирует шаблон и повтор использует сохранённую разметку", async ({ page }) => {
  const { scenario } = await configured(page, { fail: true });
  const fieldCount = scenario.fieldRequests.length;
  await page.locator("#documentTemplateSave").click();
  await expect(page.locator("#configuredTemplateSaveStatus")).toContainText("e2e-trial-error-id");
  await expect(page.locator("#configuredTemplateSaveStatus")).toContainText("настроенные поля сохранены");
  expect(scenario.primary.activeTemplates).toHaveLength(0);
  await expect(page.locator("#documentTemplateSave")).toBeEnabled();
  await page.locator("#documentTemplateSave").click();
  await expect(page.locator("#configuredTemplateSaveStatus")).toContainText("Шаблон сохранён");
  expect(scenario.fieldRequests).toHaveLength(fieldCount);
});

test("изменённая во время сборки разметка не активирует устаревшую версию", async ({ page }) => {
  const { scenario } = await configured(page);
  let draftReads = 0;
  await page.route("**/template-drafts/*", async (route) => {
    if (route.request().method() === "GET" && /\/template-drafts\/[^/]+$/.test(new URL(route.request().url()).pathname)) {
      draftReads += 1;
      if (draftReads === 2) scenario.primary.drafts[0].fields[0].label = "Изменённое поле";
    }
    await route.fallback();
  });
  await page.locator("#documentTemplateSave").click();
  await expect(page.locator("#configuredTemplateSaveStatus")).toContainText("изменились во время сохранения");
  expect(scenario.primary.activeTemplates).toHaveLength(0);
  await expect(page.locator("#documentTemplateSave")).toBeEnabled();
});

test("двойное нажатие сохраняет одну рабочую версию", async ({ page }) => {
  const { scenario } = await configured(page);
  await page.locator("#documentTemplateSave").evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect(page.locator("#configuredTemplateSaveStatus")).toContainText("Шаблон сохранён");
  expect(scenario.primary.trialVersions).toHaveLength(1);
  expect(scenario.primary.activeTemplates).toHaveLength(1);
});


test("смена пространства во время сборки не активирует старый шаблон и не возвращает его ошибку", async ({ page }) => {
  const { scenario } = await configured(page);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let started = false;
  await page.route("**/template-drafts/*/trial", async (route) => {
    started = true;
    await held;
    await route.fallback();
  });
  try {
    await page.locator("#documentTemplateSave").click();
    await expect.poll(() => started).toBe(true);
    await page.locator("#currentSpaceChip").click();
    await page.locator('[data-workspace-switcher-space="00000000-0000-4000-8000-000000000002"]').click();
    await expect(page.locator("#currentSpaceChipText")).toHaveText("Отдел эксплуатации");
    release();
    await expect.poll(() => scenario.primary.trialVersions.length).toBe(1);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(scenario.primary.activeTemplates).toHaveLength(0);
    expect(scenario.secondary.activeTemplates).toHaveLength(0);
    await expect(page.locator("#configuredTemplateSaveStatus")).toHaveCount(0);
  } finally { release(); }
});
