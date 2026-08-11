import { expect, test } from "./fixtures/test.mjs";

import { ОформляторPage } from "./pages/docomator-page.mjs";
import {
  CANONICAL_UI_VIEWS,
  installUiRegressionScenario
} from "./ui-regression-inventory.mjs";

test.beforeEach(async ({ page }) => {
  await installUiRegressionScenario(page);
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

async function pageOverflowState(page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  return {
    overflow,
    diagnostics: overflow > 0 ? await overflowDiagnostics(page) : null
  };
}

async function collectOverflowViolations(page, app, suffix = "") {
  const violations = [];
  for (const { view } of CANONICAL_UI_VIEWS) {
    await app.openView(view);
    const state = await pageOverflowState(page);
    if (state.overflow > 0) {
      violations.push({
        view: `${view}${suffix}`,
        overflow: state.overflow,
        diagnostics: state.diagnostics
      });
    }
  }
  return violations;
}

async function interactionViolations(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(
      'button, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, textarea, summary, [role="button"]'
    )]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${[...element.classList]
            .slice(0, 3)
            .map((className) => `.${className}`)
            .join("")}`,
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10
        };
      })
      .filter((item) => item.width < 43.5 || item.height < 43.5)
  );
}

test("inventory охватывает все пользовательские view текущей оболочки", async ({
  page
}) => {
  const app = new ОформляторPage(page);
  await app.open();
  const actual = await page.evaluate(() =>
    [...document.querySelectorAll("[data-view]")]
      .map((element) => element.dataset.view)
      .filter(Boolean)
      .sort()
  );
  const expected = CANONICAL_UI_VIEWS.map(({ view }) => view).sort();
  expect(actual).toEqual(expected);
});

test("все канонические экраны работают без горизонтального переполнения", async ({
  page
}) => {
  const app = new ОформляторPage(page);
  await app.open();

  const violations = await collectOverflowViolations(page, app);
  expect(
    violations,
    `горизонтальное переполнение найдено в канонических разделах: ${JSON.stringify(violations)}`
  ).toEqual([]);
});

test("дополнительные разделы остаются в «Ещё» и не расширяют мобильную панель", async ({
  page
}) => {
  const app = new ОформляторPage(page);
  await app.open();

  const mobileNavigation = page.locator(".mobile-nav");
  await expect(mobileNavigation.locator("button")).toHaveCount(5);
  await expect(
    mobileNavigation.locator('[data-view-target="publications"]')
  ).toHaveCount(0);

  await app.openView("settings");
  const publicationShortcut = page.locator(
    '.settings-grid [data-navigation-overflow="publications"]'
  );
  await expect(publicationShortcut).toBeVisible();
  await expect(publicationShortcut).toContainText("Публикации");
  await publicationShortcut.click();
  await expect(page.locator('[data-view="publications"]')).toHaveClass(/is-visible/);

  if ((page.viewportSize()?.width || 0) <= 820) {
    const more = mobileNavigation.locator('[data-view-target="settings"]');
    await expect(more).toHaveClass(/is-active/);
    await expect(more).toHaveAttribute("aria-current", "page");
  }
});

test("видимые элементы управления сохраняют зону не меньше 44 на 44", async ({
  page
}) => {
  const app = new ОформляторPage(page);
  await app.open();
  await expect(page.locator('link[data-interaction-contract]')).toHaveAttribute(
    "href",
    "/ui/interaction-contract.css"
  );
  await expect(page.locator("#refreshButton")).toHaveCSS("height", "44px");

  for (const { view } of CANONICAL_UI_VIEWS) {
    await app.openView(view);
    const violations = await interactionViolations(page);
    expect(
      violations,
      `слишком маленькие интерактивные зоны в разделе ${view}: ${JSON.stringify(violations)}`
    ).toEqual([]);
  }
});

test("светлая и тёмная темы применяются из локальной настройки", async ({
  page
}) => {
  const app = new ОформляторPage(page);
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
  const app = new ОформляторPage(page);
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
  const app = new ОформляторPage(page);
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
  const app = new ОформляторPage(page);
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

  const violations = await collectOverflowViolations(page, app, " при 200%");
  expect(
    violations,
    `горизонтальное переполнение при масштабе 200% найдено в разделах: ${JSON.stringify(violations)}`
  ).toEqual([]);
});
