{
  const primaryDesktopViews = new Set([
    "overview",
    "employees",
    "templates",
    "gost-formatting",
    "generation",
    "documents",
    "settings"
  ]);

  const primaryMobileViews = new Set([
    "overview",
    "employees",
    "generation",
    "documents",
    "settings"
  ]);

  const mobileManagementViews = new Set(["gost-formatting"]);

  const managementMetadata = Object.freeze({
    entities: Object.freeze({
      label: "Объекты и импорт",
      description: "Произвольные записи, таблицы и массовая загрузка данных.",
      icon: "◇",
      badge: "Данные",
      tone: "blue"
    }),
    "gost-formatting": Object.freeze({
      label: "Оформить документ по ГОСТ",
      description: "Проверка и безопасное форматирование существующих DOCX.",
      icon: "¶",
      badge: "DOCX",
      tone: "purple"
    }),
    automations: Object.freeze({
      label: "Расписания и доставка",
      description: "Повторные выпуски, почта и разрешённые сетевые папки.",
      icon: "◷",
      badge: "Правила",
      tone: "purple"
    }),
    publications: Object.freeze({
      label: "Публикации",
      description: "Научные статьи, авторы, классификации и годовые отчёты.",
      icon: "◫",
      badge: "Отчёты",
      tone: "blue"
    }),
    database: Object.freeze({
      label: "База данных",
      description: "Проверка структуры и техническое обслуживание локального хранилища.",
      icon: "▤",
      badge: "Диагностика",
      tone: "warning"
    }),
    help: Object.freeze({
      label: "Руководство и рабочие кейсы",
      description: "Импорт, шаблоны, выпуск, восстановление после ошибок и эксплуатация.",
      icon: "?",
      badge: "Без Интернета",
      tone: "purple"
    })
  });

  function navigationQuery(selector, root = document) {
    return root?.querySelector?.(selector) || null;
  }

  function navigationEnsureStylesheet() {
    if (navigationQuery('link[data-navigation-hierarchy-contract]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/ui/navigation-contract.css";
    link.dataset.navigationHierarchyContract = "";
    document.head.append(link);
  }

  function viewLabel(target) {
    return (
      managementMetadata[target]?.label ||
      navigationQuery(
        `.nav-list [data-view-target="${CSS.escape(target)}"] span:last-child`
      )?.textContent?.trim() ||
      navigationQuery(`[data-view="${CSS.escape(target)}"] [aria-labelledby]`)
        ?.textContent?.trim() ||
      "Дополнительный раздел"
    );
  }

  function viewDescription(target) {
    return (
      managementMetadata[target]?.description ||
      "Дополнительные возможности выбранного раздела данных."
    );
  }

  function managementShortcutMarkup(target, managementGrid) {
    const metadata = managementMetadata[target] || {};
    const button = document.createElement("button");
    button.className = managementGrid
      ? "settings-row management-tile navigation-overflow-shortcut"
      : "settings-row navigation-overflow-shortcut";
    button.type = "button";
    button.dataset.viewTarget = target;
    button.dataset.navigationOverflow = target;
    if (metadata.tone) button.dataset.managementTone = metadata.tone;

    const copy = document.createElement("span");
    const title = document.createElement("strong");
    const description = document.createElement("small");
    const arrow = document.createElement("span");
    title.textContent = viewLabel(target);
    description.textContent = viewDescription(target);
    arrow.textContent = "›";
    arrow.setAttribute("aria-hidden", "true");

    if (managementGrid) {
      const icon = document.createElement("span");
      const badge = document.createElement("em");
      icon.className = "management-tile-icon";
      icon.textContent = metadata.icon || "◇";
      icon.setAttribute("aria-hidden", "true");
      copy.className = "management-tile-copy";
      badge.textContent = metadata.badge || "Дополнительно";
      arrow.className = "management-chevron";
      copy.append(title, description, badge);
      button.append(icon, copy, arrow);
    } else {
      copy.append(title, description);
      button.append(copy, arrow);
    }
    return button;
  }

  function ensureSettingsShortcut(target) {
    const grid =
      navigationQuery(".settings-grid.management-grid") ||
      navigationQuery(".settings-grid");
    if (!grid || !target || target === "settings") return;
    if (navigationQuery(`[data-view-target="${CSS.escape(target)}"]`, grid)) return;

    const button = managementShortcutMarkup(
      target,
      grid.classList.contains("management-grid")
    );
    const help = navigationQuery("[data-help-center-open]", grid);
    const knowledge = navigationQuery('[data-view-target="knowledge"]', grid);
    const anchor = knowledge || help;
    if (anchor) anchor.before(button);
    else grid.append(button);
  }

  function setOverflowState(button, overflow, target) {
    const nextTier = overflow ? "overflow" : "primary";
    if (button.dataset.navigationTier !== nextTier) {
      button.dataset.navigationTier = nextTier;
    }
    if (overflow) {
      if (!button.hidden) button.hidden = true;
      if (button.getAttribute("aria-hidden") !== "true") {
        button.setAttribute("aria-hidden", "true");
      }
      if (button.tabIndex !== -1) button.tabIndex = -1;
      if (target) ensureSettingsShortcut(target);
      return;
    }
    if (button.hidden) button.hidden = false;
    button.removeAttribute("aria-hidden");
    if (button.getAttribute("tabindex") === "-1") button.removeAttribute("tabindex");
  }

  function normalizeDesktopNavigation() {
    const navigation = navigationQuery(".nav-list");
    if (!navigation) return;

    for (const button of navigation.querySelectorAll("[data-view-target]")) {
      const target = String(button.dataset.viewTarget || "").trim();
      if (!target) continue;
      const overflow = !primaryDesktopViews.has(target);
      setOverflowState(button, overflow, target);
      if (mobileManagementViews.has(target)) ensureSettingsShortcut(target);
    }

    const helpButton = navigationQuery("#helpCenterNavButton", navigation);
    if (helpButton) setOverflowState(helpButton, true, "help");
  }

  function normalizeMobileNavigation() {
    const navigation = navigationQuery(".mobile-nav");
    if (!navigation) return;

    for (const button of [...navigation.querySelectorAll("[data-view-target]")]) {
      const target = String(button.dataset.viewTarget || "").trim();
      if (!target || primaryMobileViews.has(target)) continue;
      ensureSettingsShortcut(target);
      button.remove();
    }
  }

  function visibleView() {
    return (
      navigationQuery(".view.is-visible")?.dataset.view ||
      location.hash.slice(1) ||
      "overview"
    );
  }

  function syncNavigationCurrent(navigation, target) {
    if (!navigation) return;
    navigation.querySelectorAll("[data-view-target]").forEach((button) => {
      button.classList.remove("is-active");
      button.removeAttribute("aria-current");
    });
    const current = navigationQuery(
      `[data-view-target="${CSS.escape(target)}"]`,
      navigation
    );
    current?.classList.add("is-active");
    current?.setAttribute("aria-current", "page");
  }

  function syncCurrentView(view) {
    const target = String(view || visibleView() || "overview");
    const desktopTarget = primaryDesktopViews.has(target) ? target : "settings";
    const mobileTarget = primaryMobileViews.has(target) ? target : "settings";
    syncNavigationCurrent(navigationQuery(".nav-list"), desktopTarget);
    syncNavigationCurrent(navigationQuery(".mobile-nav"), mobileTarget);

    const helpButton = navigationQuery("#helpCenterNavButton");
    if (helpButton) {
      helpButton.classList.toggle("is-active", target === "help");
      if (target === "help") helpButton.setAttribute("aria-current", "page");
      else helpButton.removeAttribute("aria-current");
    }
  }

  function normalizedHeading(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/gu, "е")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  function normalizeDuplicateIntro(view) {
    document
      .querySelectorAll('[data-navigation-duplicate-intro="true"]')
      .forEach((intro) => {
        delete intro.dataset.navigationDuplicateIntro;
        delete intro.dataset.navigationHeadingOnly;
      });

    const target = String(view || visibleView() || "overview");
    const root = navigationQuery(`[data-view="${CSS.escape(target)}"]`);
    const title = normalizedHeading(navigationQuery("#viewTitle")?.textContent);
    if (!root || !title) return;

    const intro = navigationQuery(".section-intro", root);
    const heading = normalizedHeading(
      navigationQuery("h1, h2, h3", intro)?.textContent
    );
    if (!intro || !heading || heading !== title) return;

    intro.dataset.navigationDuplicateIntro = "true";
    const visibleSecondaryChildren = [...intro.children]
      .slice(1)
      .some((child) => {
        if (child.hidden) return false;
        const style = getComputedStyle(child);
        return style.display !== "none" && style.visibility !== "hidden";
      });
    if (!visibleSecondaryChildren) intro.dataset.navigationHeadingOnly = "true";
  }

  function refresh(view) {
    normalizeDesktopNavigation();
    normalizeMobileNavigation();
    syncCurrentView(view);
    normalizeDuplicateIntro(view);
  }

  navigationEnsureStylesheet();
  const observer = new MutationObserver(() => refresh());
  const start = () => {
    refresh();
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.addEventListener("docomator:view-changed", (event) => {
    refresh(event.detail?.view);
  });
  window.addEventListener("docomator:help-opened", () => refresh("help"));
  window.addEventListener("hashchange", () => refresh());
}
