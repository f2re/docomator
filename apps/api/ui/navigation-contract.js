{
  if (!document.querySelector('link[data-navigation-contract]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/ui/navigation-contract.css";
    link.dataset.navigationContract = "";
    document.head.append(link);
  }

  const primaryMobileViews = new Set([
    "overview",
    "employees",
    "generation",
    "documents",
    "settings"
  ]);

  const primaryDesktopViews = new Set([
    "overview",
    "employees",
    "templates",
    "generation",
    "documents",
    "automations"
  ]);

  const overflowMetadata = Object.freeze({
    entities: Object.freeze({
      label: "Другие данные",
      description: "Произвольные объекты и их поля внутри выбранного пространства"
    }),
    templates: Object.freeze({
      label: "Шаблоны",
      description: "Загрузка, проверка и настройка DOCX/XLSX"
    }),
    automations: Object.freeze({
      label: "Расписания",
      description: "Повторные выпуски документов по календарю"
    }),
    publications: Object.freeze({
      label: "Публикации",
      description: "Научные статьи, авторы, классификации и отчёты"
    }),
    "gost-formatting": Object.freeze({
      label: "Оформить по ГОСТ",
      description: "Пакетное форматирование DOCX по выбранному профилю"
    })
  });

  function escapedTarget(target) {
    return CSS.escape(String(target || ""));
  }

  function currentView(view) {
    return String(view || location.hash.slice(1) || "overview").trim() || "overview";
  }

  function viewLabel(target) {
    return (
      overflowMetadata[target]?.label ||
      document
        .querySelector(`.nav-list [data-view-target="${escapedTarget(target)}"] span:last-child`)
        ?.textContent?.trim() ||
      "Дополнительный раздел"
    );
  }

  function viewDescription(target) {
    return (
      overflowMetadata[target]?.description ||
      "Дополнительные возможности текущего рабочего пространства"
    );
  }

  function ensureSettingsShortcut(target) {
    const grid = document.querySelector(".settings-grid");
    if (!grid || !target) return;
    if (grid.querySelector(`[data-navigation-overflow="${escapedTarget(target)}"]`)) return;
    if (grid.querySelector(`[data-view-target="${escapedTarget(target)}"]`)) return;

    const button = document.createElement("button");
    button.className = "settings-row";
    button.type = "button";
    button.dataset.viewTarget = target;
    button.dataset.navigationOverflow = target;

    const copy = document.createElement("span");
    const title = document.createElement("strong");
    const description = document.createElement("small");
    const arrow = document.createElement("span");

    title.textContent = viewLabel(target);
    description.textContent = viewDescription(target);
    copy.append(title, description);
    arrow.textContent = "›";
    arrow.setAttribute("aria-hidden", "true");
    button.append(copy, arrow);

    const advanced = grid.querySelector('[data-view-target="knowledge"]');
    if (advanced) advanced.before(button);
    else grid.append(button);
  }

  function createDesktopOverflowGroup(navigation) {
    const details = document.createElement("details");
    details.className = "nav-overflow";
    details.dataset.navigationOverflowGroup = "desktop";

    const summary = document.createElement("summary");
    summary.className = "nav-item nav-overflow-summary";

    const symbol = document.createElement("span");
    symbol.className = "nav-symbol";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = "•••";

    const label = document.createElement("span");
    label.textContent = "Другие задачи";

    const chevron = document.createElement("span");
    chevron.className = "nav-overflow-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "›";

    const content = document.createElement("div");
    content.className = "nav-overflow-content";

    summary.append(symbol, label, chevron);
    details.append(summary, content);
    navigation.append(details);
    return details;
  }

  function moveSettingsToFooter(navigation) {
    const footer = document.querySelector(".sidebar-footer");
    const settings = navigation.querySelector('[data-view-target="settings"]');
    if (!footer || !settings || settings.parentElement === footer) return;
    settings.dataset.navigationPlacement = "footer";
    footer.prepend(settings);
  }

  function normalizeDesktopNavigation(view) {
    const navigation = document.querySelector(".nav-list");
    if (!navigation) return;

    moveSettingsToFooter(navigation);

    const details =
      navigation.querySelector("[data-navigation-overflow-group]") ||
      createDesktopOverflowGroup(navigation);
    const content = details.querySelector(".nav-overflow-content");
    if (!content) return;

    for (const button of [...navigation.querySelectorAll("[data-view-target]")]) {
      const target = String(button.dataset.viewTarget || "").trim();
      if (!target || target === "settings" || primaryDesktopViews.has(target)) continue;
      if (button.dataset.navigationPlacement !== "overflow") {
        button.dataset.navigationPlacement = "overflow";
      }
      if (button.parentElement !== content) content.append(button);
    }

    const hasItems = Boolean(content.querySelector("[data-view-target]"));
    details.hidden = !hasItems;
    syncDesktopOverflowCurrent(view, details);
  }

  function syncDesktopOverflowCurrent(
    view,
    details = document.querySelector("[data-navigation-overflow-group]")
  ) {
    if (!details) return;
    const target = currentView(view);
    const content = details.querySelector(".nav-overflow-content");
    const summary = details.querySelector(".nav-overflow-summary");
    const active = Boolean(
      content?.querySelector(`[data-view-target="${escapedTarget(target)}"]`)
    );

    details.classList.toggle("is-current", active);
    if (active) {
      if (!details.open) {
        details.open = true;
        details.dataset.navigationAutoOpened = "true";
      }
      summary?.setAttribute(
        "aria-label",
        `Другие задачи. Открыт раздел «${viewLabel(target)}»`
      );
      return;
    }

    summary?.removeAttribute("aria-label");
    if (details.dataset.navigationAutoOpened === "true") {
      details.open = false;
      delete details.dataset.navigationAutoOpened;
    }
  }

  function normalizeMobileNavigation() {
    const navigation = document.querySelector(".mobile-nav");
    if (!navigation) return;

    for (const button of [...navigation.querySelectorAll("[data-view-target]")]) {
      const target = String(button.dataset.viewTarget || "").trim();
      if (!target || primaryMobileViews.has(target)) continue;
      ensureSettingsShortcut(target);
      button.remove();
    }
  }

  function syncMobileOverflowCurrent(view) {
    const navigation = document.querySelector(".mobile-nav");
    if (!navigation) return;
    const target = currentView(view);
    if (primaryMobileViews.has(target)) return;

    for (const button of navigation.querySelectorAll("[data-view-target]")) {
      button.classList.remove("is-active");
      button.removeAttribute("aria-current");
    }
    const more = navigation.querySelector('[data-view-target="settings"]');
    more?.classList.add("is-active");
    more?.setAttribute("aria-current", "page");
  }

  function refresh(view) {
    normalizeDesktopNavigation(view);
    normalizeMobileNavigation();
    syncMobileOverflowCurrent(view);
  }

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
}
