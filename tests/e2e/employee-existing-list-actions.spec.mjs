import { expect, test } from "./fixtures/test.mjs";

import { DocomatorPage } from "./pages/docomator-page.mjs";
import { installUiRegressionScenario } from "./ui-regression-inventory.mjs";

test("из непустого списка можно добавить ещё одного сотрудника", async ({ page }) => {
  await installUiRegressionScenario(page);
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("employees");

  await expect(page.locator("#employeeList .employee-row")).toHaveCount(3);
  const addButton = page.locator('[data-employee-action="add"]:visible').first();
  await expect(addButton).toBeVisible();
  await addButton.click();
  await expect(page.locator("#employeeDialog")).toBeVisible();
});
