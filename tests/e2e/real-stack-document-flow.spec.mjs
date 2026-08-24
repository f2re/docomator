import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeOoxmlBuffer } from "@docomator/document-intake";

import { expect, test } from "./fixtures/test.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";

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

async function currentSpaceId(page) {
  return page.evaluate(() =>
    String(
      globalThis.docomatorCurrentSpaceId ||
        localStorage.getItem("docomator.space") ||
        ""
    )
  );
}

async function createSingleMemberGroup(page, displayName, groupName) {
  const spaceId = await currentSpaceId(page);
  expect(spaceId).not.toBe("");

  const employeeResponse = await page.request.get(
    `/api/v1/spaces/${encodeURIComponent(spaceId)}/employees?limit=1000`,
    { headers: { accept: "application/json" } }
  );
  expect(employeeResponse.status()).toBe(200);
  const employees = (await employeeResponse.json())?.data || [];
  const employee = employees.find((item) => item.displayName === displayName);
  expect(employee, "сохранённый сотрудник должен читаться из SQLite через API").toBeTruthy();
  const entityId = employee.entityId || employee.id;
  expect(entityId).toBeTruthy();

  const groupResponse = await page.request.post(
    `/api/v1/spaces/${encodeURIComponent(spaceId)}/groups`,
    {
      headers: { accept: "application/json", "content-type": "application/json" },
      data: {
        name: groupName,
        description: "E2E: пользовательское поле → группа → шаблон → документ"
      }
    }
  );
  expect(groupResponse.status()).toBe(201);
  const group = (await groupResponse.json())?.data;
  expect(group?.id).toBeTruthy();

  const membersResponse = await page.request.put(
    `/api/v1/spaces/${encodeURIComponent(spaceId)}/groups/${encodeURIComponent(group.id)}/members`,
    {
      headers: { accept: "application/json", "content-type": "application/json" },
      data: { entityIds: [entityId] }
    }
  );
  expect(membersResponse.status()).toBe(200);
  return { spaceId, groupId: group.id };
}

async function assertSecondSpaceIsolation(
  page,
  sourceSpaceId,
  propertyKey,
  displayName,
  groupName,
  suffix
) {
  const createResponse = await page.request.post("/api/v1/spaces", {
    headers: { accept: "application/json", "content-type": "application/json" },
    data: {
      name: `Изолированное пространство ${suffix}`,
      description: "E2E negative boundary"
    }
  });
  expect(createResponse.status()).toBe(201);
  const secondSpaceId = (await createResponse.json())?.data?.id;
  expect(secondSpaceId).toBeTruthy();
  expect(secondSpaceId).not.toBe(sourceSpaceId);

  const sourcePropertiesResponse = await page.request.get(
    `/api/v1/knowledge/property-definitions?spaceId=${encodeURIComponent(sourceSpaceId)}&limit=500`,
    { headers: { accept: "application/json" } }
  );
  expect(sourcePropertiesResponse.status()).toBe(200);
  const sourceProperties = (await sourcePropertiesResponse.json())?.data || [];
  expect(sourceProperties.some((item) => item.key === propertyKey)).toBe(true);

  const foreignPropertiesResponse = await page.request.get(
    `/api/v1/knowledge/property-definitions?spaceId=${encodeURIComponent(secondSpaceId)}&limit=500`,
    { headers: { accept: "application/json" } }
  );
  expect(foreignPropertiesResponse.status()).toBe(200);
  const foreignProperties = (await foreignPropertiesResponse.json())?.data || [];
  expect(foreignProperties.some((item) => item.key === propertyKey)).toBe(false);

  const foreignEmployeesResponse = await page.request.get(
    `/api/v1/spaces/${encodeURIComponent(secondSpaceId)}/employees?limit=1000`,
    { headers: { accept: "application/json" } }
  );
  expect(foreignEmployeesResponse.status()).toBe(200);
  const foreignEmployees = (await foreignEmployeesResponse.json())?.data || [];
  expect(foreignEmployees.some((item) => item.displayName === displayName)).toBe(false);

  const foreignGroupsResponse = await page.request.get(
    `/api/v1/spaces/${encodeURIComponent(secondSpaceId)}/groups?limit=1000`,
    { headers: { accept: "application/json" } }
  );
  expect(foreignGroupsResponse.status()).toBe(200);
  const foreignGroups = (await foreignGroupsResponse.json())?.data || [];
  expect(foreignGroups.some((item) => item.name === groupName)).toBe(false);
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

async function bindCustomEmployeeField(page, fieldLabel) {
  await page.locator("#documentStructureButton").click();
  const placeholder = "ФИО сотрудника";
  const fullNameParagraph = page
    .locator(".structure-element")
    .filter({ hasText: placeholder })
    .first();
  await expect(fullNameParagraph).toBeVisible({ timeout: 20_000 });
  await fullNameParagraph.click();

  const textRange = page.locator("#documentFieldTextRange");
  await expect(textRange).toBeVisible();
  await textRange.evaluate((control, selectedText) => {
    const start = control.value.indexOf(selectedText);
    if (start < 0) {
      throw new Error(`В абзаце не найден плейсхолдер «${selectedText}».`);
    }
    control.focus();
    control.setSelectionRange(start, start + selectedText.length);
    control.dispatchEvent(new Event("select", { bubbles: true }));
  }, placeholder);

  const option = page
    .locator("#documentFieldProperty option")
    .filter({ hasText: fieldLabel })
    .first();
  await expect(option).toHaveCount(1);
  const propertyKey = await option.getAttribute("value");
  expect(propertyKey).toBeTruthy();
  await page.locator("#documentFieldProperty").selectOption(propertyKey, {
    force: true
  });
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
  return propertyKey;
}

async function verifyAndActivateTemplate(page, trialValue) {
  await page.locator("#templateTrialValue").fill(trialValue);
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

async function generateAndDownloadByGroup(page, groupName, expectedValue) {
  const app = new ОформляторPage(page);
  await app.openView("generation");
  await expect(page.locator("#generationTemplate option")).toHaveCount(1, {
    timeout: 20_000
  });
  await page.locator("#generationSourceKind").selectOption("group");
  await expect(page.locator("#generationGroup")).toBeVisible({ timeout: 20_000 });
  const groupOption = page
    .locator("#generationGroup option")
    .filter({ hasText: groupName })
    .first();
  await expect(groupOption).toHaveCount(1);
  const groupId = await groupOption.getAttribute("value");
  expect(groupId).toBeTruthy();
  await page.locator("#generationGroup").selectOption(groupId);
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
  const buffer = await fs.readFile(downloadedPath);
  expect(buffer.length, "Сформированный DOCX не должен быть пустым").toBeGreaterThan(0);

  const structure = await analyzeOoxmlBuffer({
    buffer,
    fileName: download.suggestedFilename()
  });
  const renderedText = structure.elements
    .map((element) => (element.kind === "cell" ? element.value : element.text))
    .join("\n");
  expect(renderedText).toContain(expectedValue);
  expect(renderedText).not.toContain("ФИО сотрудника");
}

async function verifyEmployeeInSecondContext(page, displayName, fieldLabel, fieldValue) {
  const app = new ОформляторPage(page);
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
  await expect(page.locator("#sharedDocumentCollectedCount")).toHaveText("1", {
    timeout: 20_000
  });
  await page.getByRole("button", { name: "Забранные" }).click();
  const storedResult = page
    .locator("[data-shared-result-id]")
    .filter({ hasText: "personal-card" })
    .first();
  await expect(storedResult).toBeVisible({ timeout: 20_000 });
  await expect(storedResult).toContainText("Забран");
  await expect(
    storedResult.getByRole("link", { name: "Скачать документ" })
  ).toBeVisible();
}

test("пространство → пользовательское поле → группа → шаблон → настоящий DOCX", async ({
  baseURL,
  browser,
  page
}) => {
  test.skip(
    !realStackEnabled,
    "Сценарий запускается только отдельной командой с настоящими API, SQLite и worker."
  );
  test.setTimeout(180_000);

  await fs.access(personalCardFixture);
  const app = new ОформляторPage(page);
  await app.open();
  await expectWorkerReady(page);

  const suffix = randomUUID().slice(0, 8);
  const displayName = `Иванов Иван ${suffix}`;
  const fieldLabel = `Вероисповедание ${suffix}`;
  const fieldValue = `Тестовое значение ${suffix}`;
  const groupName = `Группа шаблона ${suffix}`;

  await app.addEmployeeWithField({
    displayName,
    label: fieldLabel,
    value: fieldValue
  });
  await expect(page.locator("#employeeWorkspaceStatus")).toContainText(
    "Карточка сохранена",
    { timeout: 20_000 }
  );

  const { spaceId } = await createSingleMemberGroup(page, displayName, groupName);

  await app.openView("templates");
  await uploadAndSaveSource(page);
  const propertyKey = await bindCustomEmployeeField(page, fieldLabel);
  await assertSecondSpaceIsolation(
    page,
    spaceId,
    propertyKey,
    displayName,
    groupName,
    suffix
  );
  await verifyAndActivateTemplate(page, fieldValue);
  await generateAndDownloadByGroup(page, groupName, fieldValue);

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
