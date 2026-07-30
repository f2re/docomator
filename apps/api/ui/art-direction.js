{
  const ART_DIRECTION_VERSION = 1;

  const icons = Object.freeze({
    overview: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5"/><path d="M6.5 9.5v9h11v-9"/><path d="M9.5 18.5v-5h5v5"/></svg>',
    employees: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.8 18c.4-3.1 2.1-4.8 5.2-4.8s4.8 1.7 5.2 4.8"/><circle cx="17" cy="9" r="2.2"/><path d="M15.4 14.3c2.9-.6 4.5.7 4.8 3.2"/></svg>',
    entities: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.8 7.2 4.1v8.2L12 20.2l-7.2-4.1V7.9z"/><path d="m4.8 7.9 7.2 4.2 7.2-4.2M12 12.1v8.1"/></svg>',
    templates: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.8h8.2L18 7.6v12.6H6z"/><path d="M14 3.8v4h4M9 12h6M9 15.5h6"/></svg>',
    generation: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h7.8L18 8.2V20H6z"/><path d="M13.8 4v4.2H18M12 11v6M9 14h6"/></svg>',
    documents: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.8h8.2L18 7.6v12.6H6z"/><path d="M14 3.8v4h4M8.8 14.2l2 2 4.4-4.5"/></svg>',
    automations: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.2"/><path d="M12 7.5v5l3.5 2M8 3.8 6 5.6M16 3.8l2 1.8"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 17h14M8 4v6M16 14v6"/><circle cx="8" cy="7" r="1.5"/><circle cx="16" cy="17" r="1.5"/></svg>',
    spaces: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>',
    knowledge: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5h14M5 12h14M5 17.5h14"/><circle cx="8" cy="6.5" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="10" cy="17.5" r="1.3"/></svg>',
    help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.2"/><path d="M9.8 9.2a2.4 2.4 0 0 1 4.7.7c0 1.9-2.5 2.2-2.5 4M12 17.6h.01"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 7.5V4.2l-2.1 2.1A7.2 7.2 0 1 0 19 12"/></svg>'
  });

  function setIcon(host, key) {
    const markup = icons[key];
    if (!host || !markup) return;
    host.innerHTML = markup;
  }

  function applyNavigationIcons() {
    document.querySelectorAll(".nav-item[data-view-target]").forEach((button) => {
      setIcon(button.querySelector(".nav-symbol"), button.dataset.viewTarget);
    });
    document.querySelectorAll(".mobile-nav [data-view-target]").forEach((button) => {
      setIcon(button.querySelector("span[aria-hidden='true']"), button.dataset.viewTarget);
    });
  }

  function applyShellCopy() {
    const brandSubtitle = document.querySelector(".brand small");
    if (brandSubtitle) brandSubtitle.textContent = "Документы и данные";

    const currentTask = document.querySelector(".home-hero .pill-accent");
    if (currentTask) currentTask.textContent = "Текущая задача";

    const helpIcon = document.querySelector("#helpButton span[aria-hidden='true']");
    setIcon(helpIcon, "help");

    const refresh = document.querySelector("#refreshButton");
    if (refresh) setIcon(refresh, "refresh");
  }

  function applyArtDirection() {
    document.documentElement.dataset.artDirection = "document-workbench";
    applyNavigationIcons();
    applyShellCopy();
  }

  globalThis.docomatorArtDirection = Object.freeze({
    version: ART_DIRECTION_VERSION,
    name: "document-workbench",
    apply: applyArtDirection
  });

  applyArtDirection();
}
