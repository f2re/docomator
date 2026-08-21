import AxeBuilder from "@axe-core/playwright";

import {
  CANONICAL_UI_STATES,
  CANONICAL_UI_VIEWS,
  expect,
  installUiRegressionScenario,
  test
} from "./fixtures/test.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const EVIDENCE_CONTRACT_VERSION = 3;
const criticalStates = CANONICAL_UI_STATES.filter(
  (state) => state.runner === "critical-state"
);

test.beforeEach(async ({ page }) => {
  await installUiRegressionScenario(page);
});

async function overflowDiagnostics(page) {
  return page.evaluate(() => {
    const items = [...document.querySelectorAll("*")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const rightOverflow = Math.max(0, Math.ceil(rect.right - window.innerWidth));
        const scrollOverflow = Math.max(0, element.scrollWidth - element.clientWidth);
        return {
          element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${[...element.classList]
            .slice(0, 3)
            .map((className) => `.${className}`)
            .join("")}`,
          rightOverflow,
          scrollOverflow
        };
      })
      .filter((item) => item.rightOverflow > 0 || item.scrollOverflow > 0);
    return {
      beyondViewport: items.filter((item) => item.rightOverflow > 0).slice(0, 5),
      scrollContainers: items.filter((item) => item.scrollOverflow > 0).slice(0, 5)
    };
  });
}

async function pageOverflowState(page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  return { overflow, diagnostics: overflow > 0 ? await overflowDiagnostics(page) : null };
}

async function collectOverflowViolations(page, app, suffix = "") {
  const violations = [];
  for (const { view } of CANONICAL_UI_VIEWS) {
    await app.openView(view);
    const state = await pageOverflowState(page);
    if (state.overflow > 0) {
      violations.push({ view: `${view}${suffix}`, ...state });
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
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { id: element.id || element.tagName.toLowerCase(), width: rect.width, height: rect.height };
      })
      .filter((item) => item.width < 43.5 || item.height < 43.5)
  );
}

test("inventory охватывает все пользовательские view текущей оболочки", async ({ page }) => {
  const app = new ОформляторPage(page);
  await app.open();
  const actual = await page.evaluate(() =>
    [...document.querySelectorAll("[data-view]")]
      .map((element) => element.dataset.view)
      .filter(Boolean)
      .sort()
  );
  expect(actual).toEqual(CANONICAL_UI_VIEWS.map(({ view }) => view).sort());
});

test("все канонические экраны работают без горизонтального переполнения", async ({ page }) => {
  const app = new ОформляторPage(page);
  await app.open();
  const violations = await collectOverflowViolations(page, app);
  expect(violations, `горизонтальное переполнение: ${JSON.stringify(violations)}`).toEqual([]);
});

test("дополнительные разделы остаются в «Ещё» и не расширяют мобильную панель", async ({ page }) => {
  const app = new ОформляторPage(page);
  await app.open();
  const mobileNavigation = page.locator(".mobile-nav");
  await expect(mobileNavigation.locator("button")).toHaveCount(5);
  await expect(mobileNavigation.locator('[data-view-target="publications"]')).toHaveCount(0);
  await app.openView("settings");
  const publicationShortcut = page.locator('.settings-grid [data-navigation-overflow="publications"]');
  await expect(publicationShortcut).toBeVisible();
  await publicationShortcut.click();
  await expect(page.locator('[data-view="publications"]')).toHaveClass(/is-visible/);
});

test("видимые элементы управления сохраняют зону не меньше 44 на 44", async ({ page }) => {
  const app = new ОформляторPage(page);
  await app.open();
  for (const { view } of CANONICAL_UI_VIEWS) {
    await app.openView(view);
    expect(await interactionViolations(page), `маленькие controls в ${view}`).toEqual([]);
  }
});

test("светлая и тёмная темы применяются из локальной настройки", async ({ page }) => {
  const app = new ОформляторPage(page);
  await app.open();
  await page.evaluate(() => localStorage.setItem("docomator.theme", "light"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const lightBackground = await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.evaluate(() => localStorage.setItem("docomator.theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const darkBackground = await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(darkBackground).not.toBe(lightBackground);
});

test("клавиатурный фокус видим и ссылка пропуска переводит к содержимому", async ({ page }) => {
  const app = new ОформляторPage(page);
  await app.open();
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("режим уменьшения движения отключает длительные переходы", async ({ page }) => {
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

test("текст при масштабе 200% не создаёт горизонтальное переполнение", async ({ page }) => {
  test.skip((page.viewportSize()?.width || 0) > 768, "Критерий применяется к ширинам 320 и 768 px.");
  const app = new ОформляторPage(page);
  await app.open();
  await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
  const violations = await collectOverflowViolations(page, app, " при 200%");
  expect(violations, `overflow при 200%: ${JSON.stringify(violations)}`).toEqual([]);
});

async function setupGenerationPreflight(page) {
  await page.route(/\/document-jobs\/preflight(?:\?.*)?$/u, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          targetMode: "one_per_member",
          memberCount: 3,
          readyMemberCount: 2,
          missingMemberCount: 1,
          missingValueCount: 1,
          canStart: true,
          members: [
            { position: 0, displayName: "Сотрудник 1", ready: true, missingRequired: [] },
            { position: 1, displayName: "Сотрудник 2", ready: true, missingRequired: [] },
            { position: 2, displayName: "Сотрудник 3", ready: false, missingRequired: [{ label: "Должность" }] }
          ]
        },
        correlationId: "ui-regression-preflight"
      })
    })
  );
}

async function setupTemplateTrialError(page) {
  await page.locator("#documentIntakeFile").setInputFiles({
    name: "ui-state-template.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("controlled-ui-state-docx", "utf8")
  });
  await page.locator("#documentIntakeButton").click();
  await expect(page.locator("#documentIntakeStatusTitle")).toHaveText("Структура прошла проверку");
  await page.locator("#documentQuarantineButton").click();
  await page.locator("#documentStructureButton").click();
  await page.locator(".structure-element").first().click();
  const textRange = page.locator("#documentFieldTextRange");
  await textRange.evaluate((control) => {
    const start = control.value.indexOf("______");
    control.focus();
    control.setSelectionRange(start, start + 6);
    control.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.locator("#documentFieldProperty").selectOption("__system_display_name__", { force: true });
  await page.locator("#documentFieldTextPresentation").selectOption("full");
  const required = page.locator("#documentFieldRequired");
  if (!(await required.isChecked())) await required.check();
  await page.locator("#documentFieldSave").click();
  await page.locator("#documentFieldsContinue").click();
  await page.locator("#templateTrialValue").fill("Анна Смирнова");
  await page.locator("#templateTrialSubmit").click();
  await expect(page.locator("#templateTrialResult")).toContainText("Пробное заполнение не прошло");
  await expect(page.locator("#templateTrialValue")).toHaveValue("Анна Смирнова");
  await expect(page.locator("#templateTrialResult")).toContainText("e2e-trial-error-id");
}

async function setupCriticalState(page, state) {
  const options = {};
  if (state.id === "template-trial-error") Object.assign(options, { activeTemplate: false, employeeCount: 0, failTrialOnce: true });
  if (state.id === "operation-error") options.failOperationsOnce = true;
  await installUiRegressionScenario(page, options);
  if (state.id === "generation-preflight") await setupGenerationPreflight(page);
  const app = new ОформляторPage(page);
  await app.open();
  await app.openView(state.view);
  if (state.id === "employee-card") await page.locator('[data-employee-action="add"]:visible').first().click();
  else if (state.id === "employee-import") await page.locator("[data-bulk-import-open]:visible").first().click();
  else if (state.id === "entity-import") await page.locator('[data-entity-action="import"]:visible').first().click();
  else if (state.id === "publication-relations") await page.locator(state.selector).evaluate((element) => element.showModal());
  else if (state.id === "template-trial-error") await setupTemplateTrialError(page);
  else if (state.id === "generation-preflight") await page.locator("#generationSubmit").click();
  const root = page.locator(state.selector);
  await expect(root).toBeVisible({ timeout: 20_000 });
  await expect(root).toContainText(state.expectedText);
  return root;
}

async function verifyStateRecovery(page, state) {
  if (!state.checks.includes("recovery")) return;
  if (state.id === "template-trial-error") {
    await page.locator("#templateTrialSubmit").click();
    await expect(page.locator("#templateTrialResult")).toContainText("Проверенная версия 1 готова");
  } else if (state.id === "generation-preflight") {
    await page.locator("#generationPreflightRefresh").click();
    await expect(page.locator(state.selector)).toContainText(state.expectedText);
  } else if (state.id === "operation-error") {
    await page.locator("#operationCenterRetry").click();
    await expect(page.locator("#operationCenterList")).toContainText("Операций пока нет");
  }
}

for (const state of criticalStates) {
  test(`критическое состояние «${state.label}» входит в общую regression-матрицу`, async ({ page }, testInfo) => {
    const theme = testInfo.project.name === "chromium-1440" ? "dark" : "light";
    await page.addInitScript((value) => localStorage.setItem("docomator.theme", value), theme);
    const root = await setupCriticalState(page, state);
    expect((await pageOverflowState(page)).overflow, `overflow в ${state.id}`).toBeLessThanOrEqual(0);
    if (state.checks.includes("touch")) {
      const violations = await root.evaluate((element) =>
        [...element.querySelectorAll('button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), summary')]
          .filter((control) => {
            const rect = control.getBoundingClientRect();
            const style = getComputedStyle(control);
            return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
          })
          .map((control) => ({ id: control.id || control.tagName, ...control.getBoundingClientRect().toJSON() }))
          .filter((control) => control.width < 43.5 || control.height < 43.5)
      );
      expect(violations, `маленькие controls в ${state.id}`).toEqual([]);
    }
    if (state.checks.includes("keyboard")) {
      const focusable = root.locator('button:not(:disabled):visible, input:not([type="hidden"]):not(:disabled):visible, select:not(:disabled):visible, textarea:not(:disabled):visible').first();
      if ((await focusable.count()) > 0) {
        await focusable.focus();
        await expect(focusable).toBeFocused();
      }
    }
    if (state.checks.includes("axe") && ["chromium-320", "chromium-1440"].includes(testInfo.project.name)) {
      const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      await testInfo.attach("docomator-axe-result", {
        body: Buffer.from(JSON.stringify({
          version: 1,
          kind: "docomator.axe-result",
          contractVersion: EVIDENCE_CONTRACT_VERSION,
          project: testInfo.project.name,
          title: testInfo.title,
          label: state.label,
          theme,
          viewport: page.viewportSize(),
          wcagTags: WCAG_TAGS,
          axe: result
        }), "utf8"),
        contentType: "application/json"
      });
      expect(result.violations, `axe в ${state.id}`).toEqual([]);
    }
    if (state.checks.includes("zoom") && (page.viewportSize()?.width || 0) <= 768) {
      await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));
      expect((await pageOverflowState(page)).overflow, `overflow 200% в ${state.id}`).toBeLessThanOrEqual(0);
    }
    if (["chromium-320", "chromium-1440"].includes(testInfo.project.name)) {
      await testInfo.attach(`ui-state-${state.id}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    }
    await verifyStateRecovery(page, state);
  });
}
