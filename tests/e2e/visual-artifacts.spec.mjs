import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

const compareWithApprovedBaseline =
  process.env.DOCOMATOR_VISUAL_COMPARE === "1";

test("сохраняет явные снимки светлой и тёмной темы", async ({ page }, testInfo) => {
  await installDocomatorApiMock(page, {
    employeeCount: 3,
    activeTemplate: true
  });
  const app = new DocomatorPage(page);
  await app.open();
  const width = page.viewportSize()?.width || "unknown";

  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      localStorage.setItem("docomator.theme", value);
    }, theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("#connectionBadge")).toContainText(
      "Локальный сервер готов"
    );
    await app.openView("overview");
    await page.evaluate(() => document.fonts.ready);

    const snapshotName = `overview-${theme}-${width}px.png`;
    if (compareWithApprovedBaseline) {
      await expect(page).toHaveScreenshot(snapshotName, {
        animations: "disabled",
        caret: "hide",
        fullPage: true,
        maxDiffPixelRatio: 0.002
      });
    } else {
      await testInfo.attach(snapshotName, {
        body: await page.screenshot({
          animations: "disabled",
          caret: "hide",
          fullPage: true
        }),
        contentType: "image/png"
      });
    }
  }
});
