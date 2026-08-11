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
});
