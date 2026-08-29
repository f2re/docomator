import { expect, test } from "./fixtures/test.mjs";

import { installОформляторApiMock } from "./fixtures/docomator-api.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";

function preflightEnvelope(data) {
  return JSON.stringify({ data, correlationId: "e2e-generation-ux" });
}

function generationCurrentStep(page) {
  return page.locator('.generation-step-rail [aria-current="step"] strong');
}

test("выпуск показывает одну шкалу этапов и не держит два основных действия после проверки", async ({
  page
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const scenario = await installОформляторApiMock(page, {
    employeeCount: 3,
    activeTemplate: true
  });
  await page.route("**/document-jobs/preflight", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: preflightEnvelope({
        targetMode: "one_per_member",
        memberCount: 3,
        readyMemberCount: 2,
        missingMemberCount: 1,
        missingValueCount: 1,
        canStart: true,
        members: [
          {
            position: 0,
            displayName: "Сотрудник 1",
            ready: true,
            missingRequired: []
          },
          {
            position: 1,
            displayName: "Сотрудник 2",
            ready: true,
            missingRequired: []
          },
          {
            position: 2,
            displayName: "Сотрудник 3",
            ready: false,
            missingRequired: [{ label: "Должность" }]
          }
        ]
      })
    });
  });

  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("generation");

  const rail = page.locator(".generation-step-rail");
  await expect(rail.locator("li")).toHaveCount(4);
  await expect(rail).toContainText("Шаблон");
  await expect(rail).toContainText("Сотрудники");
  await expect(rail).toContainText("Проверка");
  await expect(rail).toContainText("Результат");
  await expect(page.locator(".generation-wizard-number svg")).toHaveCount(4);
  await expect(page.locator(".generation-wizard-number").nth(0)).not.toHaveText("1");
  await expect(page.locator("#generationSubmit")).toHaveText(
    "Проверить и сформировать"
  );
  await expect(page.locator("#generationFormMessage")).toContainText(
    "формирование начнётся сразу"
  );

  const templateTrigger = page
    .locator("#generationTemplate")
    .locator("xpath=following-sibling::*[1]")
    .locator(".searchable-select-trigger");
  await expect(templateTrigger).toBeVisible();
  await templateTrigger.click();
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  await page.keyboard.press("Escape");

  await page.locator("#generationSubmit").click();
  await expect(generationCurrentStep(page)).toHaveText("Проверка");
  await expect(page.locator("#documentGenerationStatus")).toContainText(
    "Найдены незаполненные обязательные поля"
  );
  await expect(page.locator("#documentGenerationStatus")).toContainText(
    "Должность"
  );
  expect(scenario.primary.generationCreated).toBe(false);

  await expect(page.locator("#generationSubmit")).toBeHidden();
  await expect(
    page.locator("#documentGenerationContent .primary-button:visible")
  ).toHaveCount(1);
  await expect(page.locator("#generationStartPrepared")).toHaveText(
    "Сформировать готовые документы (2)"
  );

  await page.locator("#generationSourceKind").selectOption("selected");
  await expect(generationCurrentStep(page)).toHaveText("Шаблон");
  await expect(page.locator("#documentGenerationStatus")).toBeEmpty();
  await expect(page.locator("#generationSubmit")).toBeVisible();
  await expect(page.locator("#generationFormMessage")).toContainText(
    "Настройки изменены"
  );
});

test("явная кнопка проверки запускает готовый выпуск без скрытого дополнительного шага", async ({
  page
}) => {
  const scenario = await installОформляторApiMock(page, {
    employeeCount: 2,
    activeTemplate: true
  });
  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("generation");

  await expect(page.locator("#generationEstimate")).toContainText(
    "2 сотрудников → 2 DOCX"
  );
  await page.locator("#generationSubmit").click();

  await expect.poll(() => scenario.primary.generationCreated).toBe(true);
  await expect(page.locator("#documentGenerationStatus")).toContainText("Готово");
  await expect(generationCurrentStep(page)).toHaveText("Результат");
});

test("ошибка запуска сохраняет проверенный состав и даёт безопасный повтор", async ({
  page
}) => {
  const scenario = await installОформляторApiMock(page, {
    employeeCount: 2,
    activeTemplate: true
  });
  let failOnce = true;
  await page.route("**/document-jobs", async (route) => {
    if (route.request().method() === "POST" && failOnce) {
      failOnce = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          error: { message: "Временная ошибка запуска." },
          correlationId: "e2e-generation-start-error"
        })
      });
      return;
    }
    await route.fallback();
  });

  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("generation");
  await page.locator("#generationSubmit").click();

  await expect(page.locator("#documentGenerationStatus")).toContainText(
    "Запуск не выполнен"
  );
  await expect(page.locator("#generationFormMessage")).toContainText(
    "Подготовленный состав сохранён"
  );
  await expect(page.locator("#generationStartPreparedRetry")).toBeVisible();
  expect(scenario.primary.generationCreated).toBe(false);

  await page.locator("#generationStartPreparedRetry").click();
  await expect.poll(() => scenario.primary.generationCreated).toBe(true);
  await expect(page.locator("#documentGenerationStatus")).toContainText("Готово");
  await expect(generationCurrentStep(page)).toHaveText("Результат");
});

test("UX выпуска сохраняет терминологию произвольных объектов", async ({ page }) => {
  const scenario = await installОформляторApiMock(page, {
    employeeCount: 1,
    activeTemplate: true,
    entityTypes: [
      { key: "person", label: "Человек", description: "Сотрудник" },
      { key: "room", label: "Аудитория", description: "Учебное помещение" }
    ]
  });
  scenario.primary.entities.push({
    entityId: "room-e2e-1",
    displayName: "Аудитория 101",
    entityTypeKey: "room",
    entityTypeLabel: "Аудитория",
    status: "active"
  });

  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("generation");

  const nativeTypeSelect = page.locator("#generationEntityType");
  await expect(nativeTypeSelect).toBeAttached();
  await expect(
    nativeTypeSelect
      .locator("xpath=following-sibling::*[1]")
      .locator(".searchable-select-trigger")
  ).toBeVisible();
  await nativeTypeSelect.selectOption("room", { force: true });
  await expect(page.locator("#generationEntityType")).toHaveValue("room");
  await expect
    .poll(() =>
      page.evaluate(() => globalThis.docomatorGenerationEntityTypeKey || "")
    )
    .toBe("room");
  await expect(page.locator("#generationPeopleLabel")).toHaveText("Объекты");
  await expect(page.locator("#generationSourceKind option")).toHaveText([
    "Для всех объектов выбранного типа",
    "Для сохранённой группы",
    "Для выбранных объектов"
  ]);
});
