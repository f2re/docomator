import { expect } from "@playwright/test";

export class ОформляторPage {
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
    if (name === "help") {
      const sidebarButton = this.page.locator("#helpCenterNavButton:visible");
      if ((await sidebarButton.count()) > 0) {
        await sidebarButton.click();
      } else {
        await this.openView("settings");
        await this.page
          .locator('[data-view="settings"] [data-help-center-open]:visible')
          .first()
          .click();
      }
    } else {
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

    await this.page.locator("#operatorEmployeeAddField").click();
    await expect(this.page.locator("#operatorEmployeeNewField")).toBeVisible();
    await this.page.locator("#operatorNewFieldLabel").fill(label);
    await this.page.locator("#operatorNewFieldType").selectOption("string");
    await this.page.locator("#operatorNewFieldValue").fill(value);
    await this.page.locator("#operatorStageNewField").click();

    await expect(
      this.page.locator("[data-operator-field-card]").filter({ hasText: label })
    ).toBeVisible();
    await this.page.locator("#employeeSubmitButton").click();
    await expect(this.page.locator("#employeeFieldConfirmDialog")).toBeVisible();
    await this.page
      .locator('#employeeFieldConfirmDialog button[value="confirm"]')
      .click();
  }
}
