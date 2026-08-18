import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./fixtures/test.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";
import {
  CANONICAL_UI_STATES,
  installUiRegressionScenario,
  openCanonicalUiState
} from "./ui-regression-inventory.mjs";

const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa"
];

const mockedStates = CANONICAL_UI_STATES.filter((state) => state.mode === "mock");

function violationReport(violations) {
  return violations
    .map((violation) => {
      const targets = violation.nodes
        .flatMap((node) => node.target)
        .slice(0, 5)
        .join(", ");
      return `${violation.id}: ${violation.help}${targets ? ` — ${targets}` : ""}`;
    })
    .join("\n");
}

async function pageOverflow(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
}

async function interactionViolations(page, rootSelector) {
  return page.locator(rootSelector).evaluate((root) =>
    [...root.querySelectorAll(
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
          element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`,
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10
        };
      })
      .filter((item) => item.width < 43.5 || item.height < 43.5)
  );
}

async function injectTextZoom(page) {
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
}

for (const state of mockedStates) {
  test(`состояние «${state.label}» входит в единую UI regression matrix`, async ({
    page
  }, testInfo) => {
    await page.addInitScript((theme) => {
      localStorage.setItem("docomator.theme", theme);
    }, testInfo.project.name === "chromium-1440" ? "dark" : "light");

    await installUiRegressionScenario(page, state.options || {});
    const app = new ОформляторPage(page);
    await app.open();
    await openCanonicalUiState(page, app, state);

    const root = page.locator(state.root);
    await expect(root).toBeVisible();

    const overflow = await pageOverflow(page);
    expect(
      overflow,
      `page-level horizontal overflow в состоянии «${state.label}»`
    ).toBeLessThanOrEqual(0);

    const smallTargets = await interactionViolations(page, state.root);
    expect(
      smallTargets,
      `слишком маленькие интерактивные зоны в состоянии «${state.label}»: ${JSON.stringify(smallTargets)}`
    ).toEqual([]);

    const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(
      axe.violations,
      `нарушения WCAG в состоянии «${state.label}»:\n${violationReport(axe.violations)}`
    ).toEqual([]);

    if (state.focusWithin) {
      const focusInside = await root.evaluate(
        (element) => element.contains(document.activeElement)
      );
      expect(
        focusInside,
        `после открытия «${state.label}» клавиатурный фокус должен находиться внутри рабочей поверхности`
      ).toBe(true);
    }

    const width = page.viewportSize()?.width || 0;
    if (width <= 768) {
      await injectTextZoom(page);
      expect(
        await pageOverflow(page),
        `200% text zoom создаёт horizontal overflow в состоянии «${state.label}»`
      ).toBeLessThanOrEqual(0);
    }

    if (width === 320 || width === 1440) {
      await testInfo.attach(`${state.id}-${width}px.png`, {
        body: await page.screenshot({
          animations: "disabled",
          caret: "hide",
          fullPage: true
        }),
        contentType: "image/png"
      });
    }

    if (state.closeWithEscape) {
      await page.keyboard.press("Escape");
      await expect(root).not.toBeVisible();
      if (state.returnFocus) {
        const focusReturned = await page.evaluate(
          (selector) => document.activeElement?.matches(selector) === true,
          state.returnFocus
        );
        expect(
          focusReturned,
          `после закрытия «${state.label}» фокус должен вернуться на фактическую кнопку открытия`
        ).toBe(true);
      }
    }
  });
}
