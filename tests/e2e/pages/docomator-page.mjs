import { expect } from "@playwright/test";

export class DocomatorPage {
  constructor(page) {
    this.page = page;
  }

  async open() {
    await this.page.goto("/");
    await expect(this.page.locator("#connectionBadge")).toContainText(
      "Локальный сервер готов"
    );
  }

  async openView(name) {
    const visibleTarget = this.page
      .locator(`[data-view-target="${name}"]:visible`)
      .first();
    if ((await visibleTarget.count()) > 0) {
      await visibleTarget.click();
    } else {
      await this.page.locator(`[data-view-target="${name}"]`).first().evaluate(
        (element) => element.click()
      );
    }
    await expect(this.page.locator(`[data-view="${name}"]`)).toHaveClass(
      /is-visible/
    );
  }

  async addEmployeeWithField({ displayName, label, value }) {
    await this.openView("employees");
    await this.page
      .locator('[data-employee-action="add"]:visible')
      .first()
      .click();
    await this.page.locator("#employeeDisplayName").fill(displayName);
    await this.page.locator("#employeeAddFieldButton").click();
    await this.page.locator("#employeeFieldSource").selectOption("__new__");
    await this.page.locator("#employeeFieldLabel").fill(label);
    await this.page.locator("#employeeFieldType").selectOption("string");
    await this.page.locator("#employeeFieldValue").fill(value);
    await this.page.locator("#employeeSubmitButton").click();
    await expect(this.page.locator("#employeeFieldConfirmDialog")).toBeVisible();
    await this.page
      .locator('#employeeFieldConfirmDialog button[value="confirm"]')
      .click();
  }
}
