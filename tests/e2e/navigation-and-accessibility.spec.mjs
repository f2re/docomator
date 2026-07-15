import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

test.beforeEach(async ({ page }) => {
  await installDocomatorApiMock(page);
});

async function overflowDiagnostics(page) {
  return page.evaluate(() => {
    const items = [...document.querySelectorAll("*")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const rightOverflow = Math.max(0, Math.ceil(rect.right - window.innerWidth));
        const scrollOverflow = Math.max(
          0,
          element.scrollWidth - element.clientWidth
        );
        return {
          element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${[...element.classList]
            .slice(0, 3)
            .map((className) => `.${className}`)
            .join("")}`,
          right: Math.ceil(rect.right),
          rightOverflow,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          scrollOverflow
        };
      })
      .filter((item) => item.rightOverflow > 0 || item.scrollOverflow > 0);
    return {
      beyondViewport: items
        .filter((item) => item.rightOverflow > 0)
        .sort((left, right) => right.rightOverflow - left.rightOverflow)
        .slice(0, 5),
      scrollContainers: items
        .filter((item) => item.scrollOverflow > 0)
        .sort((left, right) => right.scrollOverflow - left.scrollOverflow)
        .slice(0, 5)
    };
  });
}

test("основная навигация работает без горизонтального переполнения", async ({
  page
}) => {
  const app = new DocomatorPage(page);
  await app.open();

  for (const view of [
    "overview",
    "employees",
    "templates",
    "generation",
    "documents"
  ]) {
    await app.openView(view);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    const diagnostics = overflow > 0 ? await overflowDiagnostics(page) : [];
    expect(
      overflow,
      `горизонтальное переполнение в разделе ${view}: ${JSON.stringify(diagnostics)}`
    ).toBeLessThanOrEqual(0);
  }
});

test("светлая и тёмная темы применяются из локальной настройки", async ({
  page
}) => {
  const app = new DocomatorPage(page);
  await app.open();

  await page.evaluate(() => localStorage.setItem("docomator.theme", "light"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const lightBackground = await page.locator("body").evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );

  await page.evaluate(() => localStorage.setItem("docomator.theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const darkBackground = await page.locator("body").evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );

  expect(darkBackground).not.toBe(lightBackground);
});

test("клавиатурный фокус видим и ссылка пропуска переводит к содержимому", async ({
  page
}) => {
  const app = new DocomatorPage(page);
  await app.open();

  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();

  const outlineStyle = await page.locator(".skip-link").evaluate(
    (element) => getComputedStyle(element).outlineStyle
  );
  expect(outlineStyle).not.toBe("none");

  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("режим уменьшения движения отключает длительные переходы", async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const app = new DocomatorPage(page);
  await app.open();

  const result = await page.locator("#homeNextAction").evaluate((element) => ({
    matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
    transitionDuration: getComputedStyle(element).transitionDuration,
    animationDuration: getComputedStyle(element).animationDuration
  }));

  expect(result.matches).toBe(true);
  expect(parseFloat(result.transitionDuration)).toBeLessThanOrEqual(0.001);
  expect(parseFloat(result.animationDuration)).toBeLessThanOrEqual(0.001);
});

test("текст при масштабе 200% не создаёт горизонтальное переполнение", async ({
  page
}) => {
  const width = page.viewportSize()?.width || 0;
  test.skip(width > 768, "Критерий применяется к ширинам 320 и 768 px.");
  const app = new DocomatorPage(page);
  await app.open();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { frameTree } = await cdp.send("Page.getFrameTree");
  const { styleSheetId } = await cdp.send("CSS.createStyleSheet", {
    frameId: frameTree.frame.id
  });
  await cdp.send("CSS.setStyleSheetText", {
    styleSheetId,
    text: "html { font-size: 200% !important; }"
  });

  for (const view of ["overview", "employees", "templates", "generation"]) {
    await app.openView(view);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    const diagnostics = overflow > 0 ? await overflowDiagnostics(page) : [];
    expect(
      overflow,
      `текст в разделе ${view} вышел за viewport ${width}px при 200%: ${JSON.stringify(diagnostics)}`
    ).toBeLessThanOrEqual(0);
  }
});
