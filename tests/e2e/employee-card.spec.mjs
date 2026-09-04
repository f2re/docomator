import { expect, test } from "./fixtures/test.mjs";

import { installОформляторApiMock } from "./fixtures/docomator-api.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";

test("пользователь добавляет сотрудника и понятное общее поле", async ({
  page
}) => {
  const state = await installОформляторApiMock(page);
  const app = new ОформляторPage(page);
  await app.open();

  await app.addEmployeeWithField({
    displayName: "Анна Смирнова",
    label: "Должность",
    value: "Ведущий инженер"
  });

  await expect(page.locator("#employeeWorkspaceStatus")).toContainText(
    "Карточка сохранена"
  );
  await expect(page.locator("#employeeList")).toContainText("Анна Смирнова");
  await expect(page.locator("#employeeList")).toContainText(
    "Должность: Ведущий инженер"
  );
  expect(state.properties).toHaveLength(1);
  expect(state.properties[0].label).toBe("Должность");
  expect(state.properties[0].validation?.uiGroup).toBe("common");

  const propertyKey = state.properties[0].key;
  const editRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === "PUT" &&
      new URL(request.url()).pathname ===
        `/api/v1/knowledge/property-definitions/${propertyKey}`
  );
  const edited = await page.evaluate(async (key) => {
    const url = globalThis.docomatorPropertyDefinitionsUrl(
      `/${encodeURIComponent(key)}`
    );
    const response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: "Должность сотрудника",
        validation: { allowCustom: true }
      })
    });
    return response.json();
  }, propertyKey);
  const editRequest = await editRequestPromise;
  const editUrl = new URL(editRequest.url());
  expect(editUrl.searchParams.get("spaceId")).toBe(
    "00000000-0000-4000-8000-000000000001"
  );
  expect(editRequest.postDataJSON().validation.uiGroup).toBeUndefined();
  expect(edited.data.validation.uiGroup).toBe("common");
  expect(edited.data.validation.allowCustom).toBe(true);
  expect(state.properties[0].validation?.uiGroup).toBe("common");
});
