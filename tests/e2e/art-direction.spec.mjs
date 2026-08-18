import { test, expect } from "@playwright/test";
import { installОформляторApiMock } from "./fixtures/docomator-api.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";

function parseHexColor(value) {
  const hex = value.replace("#", "");
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16)
  ];
}

function colorDistance(first, second) {
  return Math.sqrt(
    first.reduce((sum, component, index) => {
      const delta = component - second[index];
      return sum + delta * delta;
    }, 0)
  );
}

async function openMockedWorkspace(page, options = {}) {
  await installОформляторApiMock(page, options);
  const app = new ОформляторPage(page);
  await app.open();
  return app;
}

test("оболочка следует направлению документного рабочего стола", async ({
  page
}) => {
  await openMockedWorkspace(page);

  const pathGrid = page.locator(".path-grid");
  await expect(pathGrid).toBeVisible();
  await expect(pathGrid.locator(".path-card")).toHaveCount(4);

  const styles = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const sidebar = getComputedStyle(document.querySelector(".sidebar"));
    const topbar = getComputedStyle(document.querySelector(".topbar"));
    const hero = getComputedStyle(document.querySelector(".home-hero"));
    const primary = getComputedStyle(
      document.querySelector(".home-hero .primary-button")
    );
    const path = getComputedStyle(document.querySelector(".path-grid"));
    return {
      background: root.getPropertyValue("--background").trim(),
      accent: root.getPropertyValue("--accent").trim(),
      bodyBackgroundImage: body.backgroundImage,
      sidebarBackdropFilter: sidebar.backdropFilter,
      topbarBackdropFilter: topbar.backdropFilter,
      heroBackgroundImage: hero.backgroundImage,
      heroShadow: hero.boxShadow,
      heroRadius: Number.parseFloat(hero.borderTopLeftRadius),
      primaryShadow: primary.boxShadow,
      pathDisplay: path.display
    };
  });

  expect(styles.background.toLowerCase()).toBe("#f3f1eb");
  expect(styles.bodyBackgroundImage).toBe("none");
  expect(styles.sidebarBackdropFilter).toBe("none");
  expect(styles.topbarBackdropFilter).toBe("none");
  expect(styles.heroBackgroundImage).toBe("none");
  expect(styles.heroShadow).toBe("none");
  expect(styles.primaryShadow).toBe("none");
  expect(styles.heroRadius).toBeLessThanOrEqual(12);
  expect(styles.pathDisplay).toBe("grid");

  const accent = parseHexColor(styles.accent);
  expect(colorDistance(accent, parseHexColor("#6ea8ff"))).toBeGreaterThan(80);
  expect(colorDistance(accent, parseHexColor("#6f6ce8"))).toBeGreaterThan(60);

  await expect(page.locator(".brand-mark")).toContainText("Оф");
  await expect(page.locator(".home-hero")).not.toContainText("ИИ");
});

test("пространства не возвращают карточный шум и сохраняют крупные цели", async ({
  page
}) => {
  const app = await openMockedWorkspace(page, { employeeCount: 1 });
  await app.openView("spaces");

  await expect(page.locator(".workspace-summary")).toBeVisible();
  await expect(page.locator(".space-pane.is-visible")).toBeVisible();
  await expect(page.locator(".workspace-list-item.is-active")).toBeVisible();
  await expect(page.locator(".workspace-avatar").first()).toBeVisible();
  await expect(page.locator(".member-row").first()).toBeVisible();

  const styles = await page.evaluate(() => {
    const summary = getComputedStyle(document.querySelector(".workspace-summary"));
    const pane = getComputedStyle(document.querySelector(".space-pane.is-visible"));
    const activeWorkspace = getComputedStyle(
      document.querySelector(".workspace-list-item.is-active")
    );
    const avatar = getComputedStyle(document.querySelector(".workspace-avatar"));
    const member = getComputedStyle(document.querySelector(".member-row"));
    const tab = getComputedStyle(document.querySelector(".workspace-tabs button"));
    return {
      summaryShadow: summary.boxShadow,
      summaryRadius: Number.parseFloat(summary.borderTopLeftRadius),
      summaryMarkerWidth: Number.parseFloat(summary.borderInlineStartWidth),
      paneShadow: pane.boxShadow,
      paneRadius: Number.parseFloat(pane.borderTopLeftRadius),
      activeWorkspaceShadow: activeWorkspace.boxShadow,
      avatarBackgroundImage: avatar.backgroundImage,
      avatarRadius: Number.parseFloat(avatar.borderTopLeftRadius),
      memberShadow: member.boxShadow,
      memberRadius: Number.parseFloat(member.borderTopLeftRadius),
      tabShadow: tab.boxShadow,
      tabMinHeight: Number.parseFloat(tab.minHeight)
    };
  });

  expect(styles.summaryShadow).toBe("none");
  expect(styles.paneShadow).toBe("none");
  expect(styles.activeWorkspaceShadow).toBe("none");
  expect(styles.memberShadow).toBe("none");
  expect(styles.tabShadow).toBe("none");
  expect(styles.avatarBackgroundImage).toBe("none");
  expect(styles.summaryRadius).toBeLessThanOrEqual(10);
  expect(styles.summaryMarkerWidth).toBeGreaterThanOrEqual(3);
  expect(styles.paneRadius).toBeLessThanOrEqual(10);
  expect(styles.avatarRadius).toBeLessThanOrEqual(7);
  expect(styles.memberRadius).toBeLessThanOrEqual(7);
  expect(styles.tabMinHeight).toBeGreaterThanOrEqual(44);
});

test("локальное руководство остаётся плоской рабочей поверхностью", async ({
  page
}) => {
  const app = await openMockedWorkspace(page);
  await app.openView("help");

  await expect(page.locator(".help-center-hero")).toBeVisible();
  await expect(page.locator(".help-center-card").first()).toBeVisible();

  const styles = await page.evaluate(() => {
    const hero = getComputedStyle(document.querySelector(".help-center-hero"));
    const card = getComputedStyle(document.querySelector(".help-center-card"));
    const category = getComputedStyle(
      document.querySelector(".help-center-categories button")
    );
    return {
      heroBackgroundImage: hero.backgroundImage,
      heroShadow: hero.boxShadow,
      heroRadius: Number.parseFloat(hero.borderTopLeftRadius),
      cardShadow: card.boxShadow,
      cardRadius: Number.parseFloat(card.borderTopLeftRadius),
      categoryMinHeight: Number.parseFloat(category.minHeight)
    };
  });

  expect(styles.heroBackgroundImage).toBe("none");
  expect(styles.heroShadow).toBe("none");
  expect(styles.cardShadow).toBe("none");
  expect(styles.heroRadius).toBeLessThanOrEqual(10);
  expect(styles.cardRadius).toBeLessThanOrEqual(10);
  expect(styles.categoryMinHeight).toBeGreaterThanOrEqual(44);
});

test("HTML не содержит декоративную маркетинговую иллюстрацию", async ({
  request
}) => {
  const response = await request.get("/");
  expect(response.ok()).toBeTruthy();
  const html = await response.text();
  expect(html).not.toContain('class="hero-visual"');
  expect(html).not.toContain('class="live-sheet"');
  expect(html).not.toContain("fonts.googleapis.com");
  expect(html).not.toContain("fonts.gstatic.com");
});
