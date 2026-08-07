import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

const views = [
  "overview",
  "employees",
  "entities",
  "templates",
  "generation",
  "documents",
  "automations",
  "settings"
];

async function openMockedWorkspace(page) {
  await installDocomatorApiMock(page, {
    employeeCount: 3,
    activeTemplate: true
  });
  const app = new DocomatorPage(page);
  await app.open();
  return app;
}

async function geometryReport(page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const height = window.innerHeight;
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const outsideViewport = [];
    for (const element of document.querySelectorAll(
      ".view.is-visible, .topbar, .status-ribbon, dialog[open], .drawer-panel:not([hidden]), input[type='range'], progress, [role='progressbar']"
    )) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.left < -1 || rect.right > width + 1) {
        outsideViewport.push({
          selector:
            element.id ||
            element.getAttribute("data-view") ||
            element.className ||
            element.tagName,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width)
        });
      }
      if (
        element.matches("dialog[open], .drawer-panel:not([hidden])") &&
        (rect.top < -1 || rect.bottom > height + 1)
      ) {
        outsideViewport.push({
          selector: element.id || element.className || element.tagName,
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          viewportHeight: height
        });
      }
    }
    return {
      documentOverflow: document.documentElement.scrollWidth - width,
      bodyOverflow: document.body.scrollWidth - width,
      outsideViewport
    };
  });
}

test("рабочие экраны не создают горизонтальное переполнение страницы", async ({
  page
}) => {
  const app = await openMockedWorkspace(page);

  for (const view of views) {
    await app.openView(view);
    const report = await geometryReport(page);
    expect(report.documentOverflow, `${view}: document overflow`).toBeLessThanOrEqual(1);
    expect(report.bodyOverflow, `${view}: body overflow`).toBeLessThanOrEqual(1);
    expect(report.outsideViewport, `${view}: elements outside viewport`).toEqual([]);
  }
});

test("диалог сотрудника полностью остаётся внутри viewport", async ({ page }) => {
  const app = await openMockedWorkspace(page);
  await app.openView("employees");
  await page.locator('[data-employee-action="add"]:visible').first().click();

  const dialog = page.locator("dialog[open]").first();
  await expect(dialog).toBeVisible();
  const report = await geometryReport(page);
  expect(report.documentOverflow).toBeLessThanOrEqual(1);
  expect(report.outsideViewport).toEqual([]);

  const accessibility = await dialog.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY
  }));
  if (accessibility.scrollHeight > accessibility.clientHeight + 1) {
    expect(["auto", "scroll"]).toContain(accessibility.overflowY);
  }
});

test("ползунок и прогресс ограничены шириной своего блока", async ({ page }) => {
  await openMockedWorkspace(page);
  const bounds = await page.evaluate(() => {
    const host = document.createElement("div");
    host.style.width = "173px";
    host.style.maxWidth = "173px";
    host.style.padding = "0";
    host.style.position = "fixed";
    host.style.left = "8px";
    host.style.top = "8px";
    host.style.zIndex = "9999";

    const range = document.createElement("input");
    range.type = "range";
    range.min = "0";
    range.max = "100";
    range.value = "50";

    const progress = document.createElement("progress");
    progress.max = 100;
    progress.value = 50;

    host.append(range, progress);
    document.body.append(host);

    const hostBox = host.getBoundingClientRect();
    const rangeBox = range.getBoundingClientRect();
    const progressBox = progress.getBoundingClientRect();
    const result = {
      hostWidth: hostBox.width,
      rangeWidth: rangeBox.width,
      progressWidth: progressBox.width,
      rangeRight: rangeBox.right,
      progressRight: progressBox.right,
      hostRight: hostBox.right
    };
    host.remove();
    return result;
  });

  expect(bounds.rangeWidth).toBeLessThanOrEqual(bounds.hostWidth + 1);
  expect(bounds.progressWidth).toBeLessThanOrEqual(bounds.hostWidth + 1);
  expect(bounds.rangeRight).toBeLessThanOrEqual(bounds.hostRight + 1);
  expect(bounds.progressRight).toBeLessThanOrEqual(bounds.hostRight + 1);
});
