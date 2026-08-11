import { expect, test } from "./fixtures/test.mjs";

import { installОформляторApiMock } from "./fixtures/docomator-api.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";

test("оператор управляет группой из 120 сотрудников без потери выбора между страницами", async ({
  page
}) => {
  const scenario = await installОформляторApiMock(page, { employeeCount: 120 });
  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("employees");

  await page.locator("#operatorGroupsButton").click();
  const dialog = page.locator("#operatorGroupDialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#operatorGroupCounter")).toContainText(
    "Всего сотрудников: 120"
  );
  await expect(dialog.locator("[data-operator-group-member]")).toHaveCount(50);

  await dialog.locator("#operatorGroupPageSize").selectOption("25");
  await expect(dialog.locator("[data-operator-group-member]")).toHaveCount(25);
  await dialog.locator("#operatorGroupSelectFound").click();
  await expect(dialog.locator("#operatorGroupCounter")).toContainText("В группе: 120");

  await dialog.locator("#operatorGroupMembershipFilter").selectOption("selected");
  await expect(dialog.locator(".operator-group-pagination")).toContainText(
    "Страница 1 из 5"
  );
  await dialog.locator('[data-group-page="next"]').click();
  await expect(dialog.locator(".operator-group-pagination")).toContainText(
    "Страница 2 из 5"
  );
  await expect(dialog.locator("[data-operator-group-member]:checked")).toHaveCount(25);

  await dialog.locator("#operatorGroupMembershipFilter").selectOption("all");
  await dialog.locator("#operatorGroupSearch").fill("Сотрудник 100");
  await expect(dialog.locator("[data-operator-group-member]")).toHaveCount(1);
  await dialog.locator("#operatorGroupRemoveFound").click();
  await expect(dialog.locator("#operatorGroupCounter")).toContainText("В группе: 119");

  await dialog.locator("#operatorGroupSearch").fill("");
  await dialog.locator("#operatorGroupName").fill("Все сотрудники кроме № 100");
  await dialog.locator("#operatorGroupDescription").fill(
    "Проверка сохранения выбора при поиске и переходе между страницами"
  );
  await dialog.locator("#operatorGroupSave").click();

  await expect(dialog).toBeHidden();
  expect(scenario.groupMemberRequests).toHaveLength(1);
  expect(scenario.groupMemberRequests[0].entityIds).toHaveLength(119);
  expect(scenario.groupMemberRequests[0].entityIds).not.toContain("employee-e2e-100");
  expect(scenario.primary.groups).toHaveLength(1);
  expect(scenario.primary.groups[0]).toMatchObject({
    name: "Все сотрудники кроме № 100",
    memberCount: 119,
    status: "active"
  });
});
