import { expect, test } from "./fixtures/test.mjs";

import { ОформляторPage } from "./pages/docomator-page.mjs";
import {
  CANONICAL_UI_VIEWS,
  installUiRegressionScenario
} from "./ui-regression-inventory.mjs";

const compareWithApprovedBaseline =
  process.env.DOCOMATOR_VISUAL_COMPARE === "1";

test("сохраняет явные снимки светлой и тёмной темы", async ({ page }, testInfo) => {
  await installUiRegressionScenario(page);
  const app = new ОформляторPage(page);
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

    for (const { view } of CANONICAL_UI_VIEWS) {
      await app.openView(view);
      await page.evaluate(() => document.fonts.ready);
      const snapshotName = `${view}-${theme}-${width}px.png`;
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
  }
});
