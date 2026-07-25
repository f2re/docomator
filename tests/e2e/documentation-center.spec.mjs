import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

test("оператор открывает всю документацию, ищет кейс и переходит по внутренней ссылке", async ({ page }) => {
  await installDocomatorApiMock(page);
  const app = new DocomatorPage(page);
  await app.open();

  const navigation = page.locator("#documentationNavButton");
  await expect(navigation).toBeVisible();
  await expect(navigation).toContainText("Справка");
  await navigation.click();

  const view = page.locator('[data-view="documentation"]');
  await expect(view).toBeVisible();
  await expect(view.locator("#documentationContent")).toContainText(
    "Инструкции, процессы и устройство системы"
  );
  await expect(view.locator("#documentationNavigation")).toContainText(
    "Быстрый старт Docomator"
  );

  const search = view.locator("#documentationSearch");
  await search.fill("паспорт ведущие нули");
  await expect(view.locator(".documentation-search-results")).toContainText(
    /Руководство оператора|Импорт людей/u
  );
  await view
    .locator(".documentation-search-results [data-documentation-open]")
    .filter({ hasText: "Руководство оператора" })
    .first()
    .click();
  await expect(view.locator(".documentation-markdown")).toContainText(
    "Кейс: сотрудники с паспортными данными"
  );

  await view.locator("#documentationBackToIndex").click();
  await view
    .locator('[data-documentation-open]')
    .filter({ hasText: "Быстрый старт Docomator" })
    .first()
    .click();
  const guideLink = view
    .locator('[data-documentation-link]')
    .filter({ hasText: "руководстве оператора" })
    .first();
  await expect(guideLink).toBeVisible();
  await guideLink.click();
  await expect(view.locator(".documentation-markdown h1")).toContainText(
    "Руководство оператора Docomator"
  );
});

test("клавиша F1 открывает справку из рабочего раздела", async ({ page }) => {
  await installDocomatorApiMock(page);
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("employees");

  await page.keyboard.press("F1");
  await expect(page.locator('[data-view="documentation"]')).toBeVisible();
  await expect(page.locator("#documentationSearch")).toBeFocused();
});
