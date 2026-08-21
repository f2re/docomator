import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./fixtures/test.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";
import {
  CANONICAL_UI_STATES,
  installUiRegressionScenario
} from "./ui-regression-inventory.mjs";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const criticalStates = CANONICAL_UI_STATES.filter(
  (state) => state.runner === "critical-state"
);

function themeForProject(projectName) {
  if (projectName === "chromium-1440") return "dark";
  return "light";
}

async function setupGenerationPreflight(page) {
  await page.route(/\/document-jobs\/preflight(?:\?.*)?$/u, async (route) => {
    await route.fulfill({
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
            {
              position: 2,
              displayName: "Сотрудник 3",
              ready: false,
              missingRequired: [{ label: "Должность" }]
            }
          ]
        },
        correlationId: "ui-regression-preflight"
      })
    });
  });
}

async function setupTemplateTrialError(page) {
  await page.locator("#documentIntakeFile").setInputFiles({
    name: "ui-state-template.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("controlled-ui-state-docx", "utf8")
  });
  await expect(page.locator("#documentIntakeStatusTitle")).toHaveText(
    "Файл готов к проверке"
  );
  await page.locator("#documentIntakeButton").click();
  await expect(page.locator("#documentIntakeStatusTitle")).toHaveText(
    "Структура прошла проверку"
  );
  await page.locator("#documentQuarantineButton").click();
  await page.locator("#documentStructureButton").click();
  await expect(page.locator(".structure-element").first()).toBeVisible();
  await page.locator(".structure-element").first().click();

  const textRange = page.locator("#documentFieldTextRange");
  await textRange.evaluate((control) => {
    const start = control.value.indexOf("______");
    control.focus();
    control.setSelectionRange(start, start + 6);
    control.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page
    .locator("#documentFieldProperty")
    .selectOption("__system_display_name__", { force: true });
  await page.locator("#documentFieldTextPresentation").selectOption("full");
  const required = page.locator("#documentFieldRequired");
  if (!(await required.isChecked())) await required.check();
  await page.locator("#documentFieldSave").click();
  await expect(page.locator("#documentFieldsContinue")).toBeVisible();
  await page.locator("#documentFieldsContinue").click();
  await expect(page.locator("#templateTrialForm")).toBeVisible();
  await page.locator("#templateTrialValue").fill("Анна Смирнова");
  await page.locator("#templateTrialSubmit").click();
  await expect(page.locator("#templateTrialResult")).toContainText(
    "Пробное заполнение не прошло"
  );
  await expect(page.locator("#templateTrialValue")).toHaveValue("Анна Смирнова");
  await expect(page.locator("#templateTrialResult")).toContainText("e2e-trial-error-id");
}

async function setupCriticalState(page, state) {
  const options = {};
  if (state.id === "template-trial-error") {
    options.activeTemplate = false;
    options.employeeCount = 0;
    options.failTrialOnce = true;
  }
  if (state.id === "operation-error") options.failOperationsOnce = true;
  await installUiRegressionScenario(page, options);
  if (state.id === "generation-preflight") await setupGenerationPreflight(page);

  const app = new ОформляторPage(page);
  await app.open();
  await app.openView(state.view);

  switch (state.id) {
    case "employee-card":
      await page.locator('[data-employee-action="add"]:visible').first().click();
      break;
    case "employee-import":
      await page.locator("[data-bulk-import-open]:visible").first().click();
      break;
    case "entity-import":
      await page.locator('[data-entity-action="import"]:visible').first().click();
      break;
    case "publication-relations": {
      const dialog = page.locator(state.selector);
      await expect(dialog).toHaveCount(1);
      await dialog.evaluate((element) => element.showModal());
      break;
    }
    case "template-trial-error":
      await setupTemplateTrialError(page);
      break;
    case "generation-preflight":
      await page.locator("#generationSubmit").click();
      break;
    case "operation-error":
      break;
    default:
      throw new Error(`Не описана подготовка критического состояния ${state.id}`);
  }

  const root = page.locator(state.selector);
  await expect(root).toBeVisible({ timeout: 20_000 });
  await expect(root).toContainText(state.expectedText);
  return root;
}

async function pageOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function visibleControlViolations(root) {
  return root.evaluate((element) =>
    [...element.querySelectorAll(
      'button:not(:disabled), input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [role="button"]'
    )]
      .filter((control) => {
        const style = getComputedStyle(control);
        const rect = control.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .map((control) => {
        const rect = control.getBoundingClientRect();
        return {
          tag: control.tagName.toLowerCase(),
          id: control.id || null,
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10
        };
      })
      .filter((control) => control.width < 43.5 || control.height < 43.5)
  );
}

async function verifyKeyboardRoute(page, root) {
  const focusable = root.locator(
    'button:not(:disabled):visible, input:not([type="hidden"]):not(:disabled):visible, select:not(:disabled):visible, textarea:not(:disabled):visible, summary:visible, [tabindex]:not([tabindex="-1"]):visible'
  ).first();
  if ((await focusable.count()) === 0) return;
  await focusable.focus();
  await expect(focusable).toBeFocused();
  await page.keyboard.press("Tab");
  const activeVisible = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    const rect = active.getBoundingClientRect();
    const style = getComputedStyle(active);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
  });
  expect(activeVisible).toBe(true);
}

async function verifyRecovery(page, state) {
  if (!state.checks.includes("recovery")) return;
  if (state.id === "template-trial-error") {
    await page.locator("#templateTrialSubmit").click();
    await expect(page.locator("#templateTrialResult")).toContainText(
      "Проверенная версия 1 готова"
    );
    return;
  }
  if (state.id === "generation-preflight") {
    await page.locator("#generationPreflightRefresh").click();
    await expect(page.locator(state.selector)).toContainText(state.expectedText);
    return;
  }
  if (state.id === "operation-error") {
    await page.locator("#operationCenterRetry").click();
    await expect(page.locator("#operationCenterList .operation-row")).toHaveCount(0);
    await expect(page.locator("#operationCenterList")).toContainText("Операций пока нет");
  }
}

for (const state of criticalStates) {
  test(`критическое состояние «${state.label}» входит в общую regression-матрицу`, async ({
    page
  }, testInfo) => {
    const theme = themeForProject(testInfo.project.name);
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem("docomator.theme", selectedTheme);
    }, theme);

    const root = await setupCriticalState(page, state);

    if (state.checks.includes("overflow")) {
      expect(await pageOverflow(page), `overflow в состоянии ${state.id}`).toBeLessThanOrEqual(0);
    }

    if (state.checks.includes("touch")) {
      const violations = await visibleControlViolations(root);
      expect(
        violations,
        `слишком маленькие controls в состоянии ${state.id}: ${JSON.stringify(violations)}`
      ).toEqual([]);
    }

    if (state.checks.includes("keyboard")) {
      await verifyKeyboardRoute(page, root);
    }

    if (
      state.checks.includes("axe") &&
      ["chromium-320", "chromium-1440"].includes(testInfo.project.name)
    ) {
      const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(
        result.violations.map(({ id, impact }) => ({ id, impact })),
        `axe-нарушения в состоянии ${state.id}`
      ).toEqual([]);
    }

    if (state.checks.includes("zoom") && (page.viewportSize()?.width || 0) <= 768) {
      await page.evaluate(() => {
        document.documentElement.style.setProperty("font-size", "200%", "important");
      });
      await expect(root).toBeVisible();
      expect(
        await pageOverflow(page),
        `overflow при 200% в состоянии ${state.id}`
      ).toBeLessThanOrEqual(0);
    }

    if (["chromium-320", "chromium-1440"].includes(testInfo.project.name)) {
      await testInfo.attach(`ui-state-${state.id}-${theme}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png"
      });
    }

    await verifyRecovery(page, state);
  });
}

test("inventory критических состояний не содержит дублей и имеет исполнимое покрытие", async () => {
  const ids = CANONICAL_UI_STATES.map((state) => state.id);
  expect(new Set(ids).size).toBe(ids.length);

  const allowedRunners = new Set(["critical-state", "password-gate"]);
  for (const state of CANONICAL_UI_STATES) {
    expect(state.id).not.toBe("");
    expect(state.label).not.toBe("");
    expect(state.selector).not.toBe("");
    expect(state.expectedText).not.toBe("");
    expect(allowedRunners.has(state.runner)).toBe(true);
    expect(state.checks.length).toBeGreaterThan(0);
  }
});
