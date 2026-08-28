{
  const primaryDesktopViews = new Set([
    "overview",
    "employees",
    "templates",
    "generation",
    "documents",
    "automations",
    "settings"
  ]);
  const primaryMobileViews = new Set([
    "overview",
    "employees",
    "generation",
    "documents",
    "settings"
  ]);

  const overflowMetadata = Object.freeze({
    entities: Object.freeze({
      label: "Объекты и импорт",
      description: "Дополнительные типы записей и массовая загрузка данных",
      icon: "◇"
    }),
    publications: Object.freeze({
      label: "Публикации",
      description: "Научные статьи, авторы, классификации и отчёты",
      icon: "◫"
    }),
    "gost-formatting": Object.freeze({
      label: "Форматирование по ГОСТ",
      description: "Оформление готовых DOCX по выбранному профилю",
      icon: "§"
    }),
    help: Object.freeze({
      label: "Руководство",
      description: "Рабочие сценарии, подсказки и восстановление после ошибок",
      icon: "?"
    })
  });

  function viewLabel(target) {
    return (
      overflowMetadata[target]?.label ||
      document
        .querySelector(`.nav-list [data-view-target="${CSS.escape(target)}"] span:last-child`)
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

  function viewIcon(target) {
    return overflowMetadata[target]?.icon || "·";
  }

  function ensureSettingsShortcut(target) {
    const grid = document.querySelector(".settings-grid");
    if (!grid || !target) return;
    if (grid.querySelector(`[data-navigation-overflow="${CSS.escape(target)}"]`)) return;
    if (grid.querySelector(`[data-view-target="${CSS.escape(target)}"]`)) return;

    const management = Boolean(grid.closest(".management-view"));
    const button = document.createElement("button");
    button.className = management ? "settings-row management-tile" : "settings-row";
    button.type = "button";
    button.dataset.viewTarget = target;
    button.dataset.navigationOverflow = target;

    const copy = document.createElement("span");
    const title = document.createElement("strong");
    const description = document.createElement("small");
    const arrow = document.createElement("span");

    if (management) {
      const icon = document.createElement("span");
      icon.className = "management-tile-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = viewIcon(target);
      button.append(icon);
      copy.className = "management-tile-copy";
      arrow.className = "management-chevron";
    }

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

  function removeDuplicateManagementPrimaryActions() {
    const grid = document.querySelector(".settings-grid");
    if (!grid?.closest(".management-view")) return;
    for (const button of [...grid.querySelectorAll("[data-view-target]")]) {
      const target = String(button.dataset.viewTarget || "").trim();
      if (target === "automations") button.remove();
    }
  }

  function normalizeDesktopNavigation() {
    const navigation = document.querySelector(".nav-list");
    if (navigation) {
      for (const button of [...navigation.querySelectorAll("[data-view-target]")]) {
        const target = String(button.dataset.viewTarget || "").trim();
        if (!target || primaryDesktopViews.has(target)) continue;
        ensureSettingsShortcut(target);
        button.remove();
      }
    }

    removeDuplicateManagementPrimaryActions();
    for (const target of Object.keys(overflowMetadata)) {
      if (document.querySelector(`[data-view="${CSS.escape(target)}"]`)) {
        ensureSettingsShortcut(target);
      }
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

  function syncOverflowCurrent(view) {
    const navigation = document.querySelector(".mobile-nav");
    if (!navigation) return;
    const target = String(view || location.hash.slice(1) || "overview");
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
    normalizeDesktopNavigation();
    normalizeMobileNavigation();
    syncOverflowCurrent(view);
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

  if (!document.querySelector('link[data-data-extraction-style]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/ui/data-extraction.css";
    link.dataset.dataExtractionStyle = "";
    document.head.append(link);
  }
  void import("/ui/data-extraction.js").catch((error) => {
    console.error("Не удалось загрузить модуль извлечения данных.", error);
  });
}
