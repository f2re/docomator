import { expect, test } from "./fixtures/test.mjs";
import { E2E_SPACE_ID as A, E2E_SECOND_SPACE_ID as B, installОформляторApiMock } from "./fixtures/docomator-api.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function switchSpace(page, spaceId) {
  await page.locator("#currentSpaceChip").click();
  await page.locator(`[data-workspace-switcher-space="${spaceId}"]`).click();
  await expect(page.locator("#currentSpaceChipText")).toHaveText("Отдел эксплуатации");
}

async function flushRender(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test("поздние сотрудники и шаблоны не заменяют выбранное пространство", async ({ page }) => {
  const scenario = await installОформляторApiMock(page, { secondSpace: true, employeeCount: 1, secondaryEmployeeCount: 1, activeTemplate: true, secondaryActiveTemplate: true });
  scenario.secondary.employees[0].displayName = "Сотрудник второго раздела";
  scenario.secondary.entities[0].displayName = "Сотрудник второго раздела";
  scenario.secondary.activeTemplates[0].title = "Шаблон второго раздела";
  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("employees");
  const held = deferred();
  let requests = 0;
  const completed = [];
  await page.route(`**/api/v1/spaces/${A}/{employees?*,active-templates}`, async (route) => {
    requests += 1;
    const done = deferred();
    completed.push(done.promise);
    await held.promise;
    await route.fallback();
    done.resolve();
  });
  try {
    await page.locator("#refreshButton").click();
    await expect.poll(() => requests).toBe(2);
    await switchSpace(page, B);
    await expect(page.locator("#employeeList")).toContainText("Сотрудник второго раздела");
    held.resolve();
    await Promise.all(completed);
    await flushRender(page);
    await expect(page.locator("#employeeList")).toContainText("Сотрудник второго раздела");
    await expect(page.locator("#employeeList")).not.toContainText("Сотрудник 1");
    await app.openView("generation");
    await expect(page.locator("#generationTemplate")).toContainText("Шаблон второго раздела");
  } finally { held.resolve(); }
});

test("закрытая карточка не перезаписывает новый ввод запоздалым ответом", async ({ page }) => {
  await installОформляторApiMock(page, { employeeCount: 1 });
  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("employees");
  const held = deferred();
  const started = deferred();
  const finished = deferred();
  await page.route(`**/api/v1/spaces/${A}/employees/employee-e2e-1`, async (route) => {
    started.resolve();
    await held.promise;
    await route.fallback();
    finished.resolve();
  });
  try {
    await page.locator('[data-employee-id="employee-e2e-1"]').click();
    await started.promise;
    await expect(page.locator("#employeeSubmitButton")).toBeDisabled();
    await page.locator('#employeeDialog [data-employee-action="close"]').first().click();
    await page.locator('[data-employee-action="add"]:visible').first().click();
    await expect(page.locator("#employeeDisplayName")).toBeEnabled();
    await page.locator("#employeeDisplayName").fill("Новая несохранённая карточка");
    held.resolve();
    await finished.promise;
    await flushRender(page);
    await expect(page.locator("#employeeDisplayName")).toHaveValue("Новая несохранённая карточка");
    await expect(page.locator("#employeeDialogTitle")).toHaveText("Новый сотрудник");
  } finally { held.resolve(); }
});

async function pendingVisual(page) {
  await installОформляторApiMock(page, { secondSpace: true });
  const held = deferred();
  const started = deferred();
  const finished = deferred();
  await page.route("**/api/v1/spaces/*/template-drafts/*/visual-layout", async (route) => {
    started.resolve();
    await held.promise;
    await route.fulfill({ json: { data: { format: "docx", sourceSha256: "e2e-docx-source-sha256", warnings: [], docx: { page: {}, paragraphs: [], tables: [] } } } });
    finished.resolve();
  });
  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("templates");
  await page.locator("#documentIntakeFile").setInputFiles({ name: "Личная карточка.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("controlled-visual-fixture") });
  await expect(page.locator("#documentIntakeStatusTitle")).toHaveText("Структура прошла проверку");
  await page.locator("#documentQuarantineButton").click();
  await expect(page.locator(".structure-element").first()).toBeVisible();
  await started.promise;
  return { held, finished };
}

test("позднее оформление сохраняет выбранное место и настройки поля", async ({ page }) => {
  const { held, finished } = await pendingVisual(page);
  try {
    await page.locator(".structure-element").first().click();
    await page.locator("#documentFieldProperty").selectOption("__new__", { force: true });
    await page.locator("#documentFieldLabel").fill("Сохраняем выбранное поле");
    await page.locator(".studio-output-options > summary").click();
    await page.locator("#documentFieldRequired").check();
    held.resolve();
    await finished.promise;
    await flushRender(page);
    await expect(page.locator("#documentFieldLabel")).toHaveValue("Сохраняем выбранное поле");
    await expect(page.locator("#documentFieldRequired")).toBeChecked();
    await expect(page.locator(".structure-element.is-selected")).toHaveCount(1);
  } finally { held.resolve(); }
});

test("позднее оформление предыдущего пространства не возвращает его документ", async ({ page }) => {
  const { held, finished } = await pendingVisual(page);
  try {
    await switchSpace(page, B);
    await expect(page.locator("#documentStructureResult .structure-report")).toHaveCount(0);
    held.resolve();
    await finished.promise;
    await flushRender(page);
    await expect(page.locator("#documentStructureResult .structure-report")).toHaveCount(0);
    await expect(page.locator("#documentFieldForm")).toHaveCount(0);
  } finally { held.resolve(); }
});

test("выбор CSV вызывает одну проверку даже при медленном каталоге полей", async ({ page }) => {
  await installОформляторApiMock(page);
  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("employees");
  await page.locator("[data-bulk-import-open]:visible").first().click();
  let previews = 0;
  page.on("request", (request) => { if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/data-import/preview")) previews += 1; });
  const held = deferred();
  await page.route("**/api/v1/knowledge/property-definitions?*", async (route) => { await held.promise; await route.fallback(); });
  try {
    await page.locator("#bulkImportFile").setInputFiles({ name: "Сотрудники.csv", mimeType: "text/csv", buffer: Buffer.from("ФИО;Должность\nИванов;Инженер\n") });
    held.resolve();
    await expect(page.locator("#bulkImportMessage")).toContainText("Файл прочитан");
    await flushRender(page);
    expect(previews).toBe(1);
  } finally { held.resolve(); }
});
