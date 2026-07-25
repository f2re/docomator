import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

async function openHelpCenter(page) {
  await page.locator("#helpButton").click();
  await expect(page.locator("#helpDrawer")).toHaveClass(/is-open/u);
  await page.locator("#helpDrawer [data-help-center-open]").click();
  await expect(page.locator("#helpCenterView")).toHaveClass(/is-visible/u);
}

test("встроенное руководство открывается, ищет кейсы и ведёт к рабочему разделу", async ({
  page
}) => {
  await installDocomatorApiMock(page);
  const app = new DocomatorPage(page);
  await app.open();

  await openHelpCenter(page);
  await expect(page.locator("#viewTitle")).toHaveText("Руководство");
  await expect(page.locator("#helpCenterHeading")).toContainText(
    "Руководство по всем рабочим потокам"
  );

  await page.locator("#helpCenterSearch").fill("студенты");
  const studentCard = page
    .locator("[data-help-article]")
    .filter({ hasText: "студенты, темы работ" })
    .first();
  await expect(studentCard).toBeVisible();
  await studentCard.click();

  await expect(page.locator("#helpCenterArticlePane")).toContainText(
    "Номер зачётной книжки"
  );
  await expect(page.locator("#helpCenterArticlePane")).toContainText(
    "Один сводный документ"
  );

  await page.locator('[data-help-go-view="employees"]').click();
  await expect(page.locator('[data-view="employees"]')).toHaveClass(/is-visible/u);
  await expect(page.locator("#viewTitle")).toHaveText("Сотрудники");
});

test("контекстная помощь содержит переход к полному локальному руководству", async ({
  page
}) => {
  await installDocomatorApiMock(page);
  const app = new DocomatorPage(page);
  await app.open();

  await openHelpCenter(page);
  await expect(page).toHaveURL(/#help$/u);

  await page.reload();
  await expect(page.locator("#helpCenterView")).toHaveClass(/is-visible/u);
  await expect(page.locator("#helpCenterNavButton")).toHaveAttribute(
    "aria-current",
    "page"
  );
});

test("полный каталог Markdown-документов открывается и отображается локально", async ({
  page
}) => {
  await installDocomatorApiMock(page);
  const app = new DocomatorPage(page);
  await app.open();
  await openHelpCenter(page);

  await expect(page.locator("#helpProjectDocumentsEntry")).toBeVisible();
  await page.locator("[data-help-project-open]").click();
  await expect(page.locator("#helpProjectHeading")).toHaveText(
    "Все документы проекта"
  );
  await expect(page.locator("#helpProjectStatus")).toContainText(
    "Доступно документов: 2"
  );

  await page.locator("#helpProjectSearch").fill("руководство оператора");
  const guide = page
    .locator("[data-help-project-document]")
    .filter({ hasText: "Руководство оператора Docomator" });
  await expect(guide).toHaveCount(1);
  await guide.click();

  await expect(page.locator(".help-project-markdown")).toContainText(
    "Массовый импорт"
  );
  await expect(page.locator(".help-project-markdown")).toContainText(
    "Проверьте сопоставление"
  );
  await expect(page.locator(".help-project-markdown")).not.toContainText(
    "/home/"
  );
});
