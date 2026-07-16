import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./fixtures/test.mjs";
import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa"
];

const primaryViews = [
  ["overview", "Главная"],
  ["employees", "Сотрудники"],
  ["templates", "Шаблоны"],
  ["generation", "Создать документы"],
  ["documents", "Результаты"]
];

const projectThemes = new Map([
  ["chromium-320", "light"],
  ["chromium-1440", "dark"]
]);

test.beforeEach(async ({ page }, testInfo) => {
  const theme = projectThemes.get(testInfo.project.name);
  test.skip(
    theme === undefined,
    "Axe проверяет крайние ширины; адаптивная матрица 768 px покрыта отдельными E2E-сценариями."
  );
  await page.addInitScript((selectedTheme) => {
    localStorage.setItem("docomator.theme", selectedTheme);
  }, theme);
});

function violationReport(violations) {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .map(
          (node) =>
            `  ${node.target.join(" ")} — ${node.failureSummary || "причина не указана"}`
        )
        .join("\n");
      return `${violation.id} [${violation.impact || "impact unknown"}]: ${violation.help}\n${nodes}`;
    })
    .join("\n\n");
}

async function expectNoDetectableViolations(page, label) {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    result.violations.length,
    `машинно-выявляемые нарушения доступности в состоянии «${label}»:\n${violationReport(result.violations)}`
  ).toBe(0);
}

for (const [view, label] of primaryViews) {
  test(`экран «${label}» не содержит машинно-выявляемых нарушений WCAG`, async ({
    page
  }) => {
    await installDocomatorApiMock(page, {
      employeeCount: 3,
      activeTemplate: true
    });
    const app = new DocomatorPage(page);
    await app.open();
    await app.openView(view);

    await expectNoDetectableViolations(page, label);
  });
}

test("диалог сотрудника не содержит машинно-выявляемых нарушений WCAG", async ({
  page
}) => {
  await installDocomatorApiMock(page);
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("employees");
  await page.locator('[data-employee-action="add"]:visible').first().click();
  await expect(page.locator("#employeeDialog")).toBeVisible();
  await page.locator("#employeeAddFieldButton").click();
  await expect(page.locator("#employeeNewField")).toBeVisible();

  await expectNoDetectableViolations(page, "Добавление сотрудника и поля");
});
