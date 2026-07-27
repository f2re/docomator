{
  const interfaceWorkflowSteps = [
    { key: "data", view: "employees", number: 1, label: "Данные" },
    { key: "template", view: "templates", number: 2, label: "Шаблон" },
    { key: "generation", view: "generation", number: 3, label: "Выпуск" },
    { key: "results", view: "documents", number: 4, label: "Результат" }
  ];

  let interfaceStatusExpanded = false;
  let interfaceStatusSignature = "";
  let interfaceResultsSignature = "";
  let interfaceSyncScheduled = false;
  let interfaceHelpSearch = "";

  function interfaceQuery(selector, root = document) {
    return root?.querySelector?.(selector) || null;
  }

  function interfacePlural(value, one, few, many) {
    const absolute = Math.abs(Number(value) || 0);
    const lastTwo = absolute % 100;
    const last = absolute % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  function interfaceButtonMarkup({ view, tone = "blue", icon, title, detail, badgeId, badge }) {
    const target = view ? ` data-view-target="${view}"` : "";
    const help = view === "help" ? " data-help-center-open" : "";
    return `<button class="settings-row management-tile" type="button"${target}${help} data-management-tone="${tone}">
      <span class="management-tile-icon" aria-hidden="true">${icon}</span>
      <span class="management-tile-copy"><strong>${title}</strong><small>${detail}</small><em${badgeId ? ` id="${badgeId}"` : ""}>${badge}</em></span>
      <span class="management-chevron" aria-hidden="true">›</span>
    </button>`;
  }

  function interfaceEnsureTopbarControls() {
    const actions = interfaceQuery(".topbar-actions");
    if (!actions) return;

    let mobileHelp = interfaceQuery("#mobileHelpButton");
    if (!mobileHelp) {
      mobileHelp = document.createElement("button");
      mobileHelp.id = "mobileHelpButton";
      mobileHelp.className = "icon-button mobile-guide-button";
      mobileHelp.type = "button";
      mobileHelp.setAttribute("aria-label", "Открыть контекстную помощь");
      mobileHelp.title = "Контекстная помощь";
      mobileHelp.textContent = "?";
      actions.prepend(mobileHelp);
    }

    let control = interfaceQuery("#systemStatusControl");
    if (!control) {
      control = document.createElement("button");
      control.id = "systemStatusControl";
      control.className = "system-status-control";
      control.type = "button";
      control.setAttribute("aria-controls", "statusRibbon");
      control.setAttribute("aria-expanded", "false");
      control.innerHTML = '<span class="system-status-dot" aria-hidden="true"></span><span id="systemStatusLabel">Проверяем систему…</span>';
      const refresh = interfaceQuery("#refreshButton", actions);
      actions.insertBefore(control, refresh || null);
    }

    const context = interfaceQuery("#currentSpaceChip");
    if (context && !context.matches("button") && !context.hasAttribute("data-workspace-switcher")) {
      context.setAttribute("role", "button");
      context.setAttribute("tabindex", "0");
      context.setAttribute("aria-label", "Открыть разделы данных");
      context.title = "Открыть разделы данных";
    }

    let stage = interfaceQuery("#workflowStageChip");
    if (!stage) {
      stage = document.createElement("span");
      stage.id = "workflowStageChip";
      stage.className = "workflow-stage-chip";
      stage.hidden = true;
      const context = interfaceQuery("#currentSpaceChip", actions);
      const contextHost = context?.closest(".workspace-switcher-host");
      const anchor =
        contextHost?.parentElement === actions
          ? contextHost
          : context?.parentElement === actions
            ? context
            : control?.parentElement === actions
              ? control
              : null;
      actions.insertBefore(stage, anchor);
    }
  }

  function interfaceEnsureWorkflow() {
    const grid = interfaceQuery('.path-grid[aria-label="Готовность к созданию документов"]');
    if (!grid) return;
    const byView = new Map(
      [...grid.querySelectorAll(".path-card[data-view-target]")].map((card) => [card.dataset.viewTarget, card])
    );
    const copy = {
      employees: ["Данные", "Карточки или импорт"],
      templates: ["Шаблон", "Поля и проверка"],
      generation: ["Выпуск", "Состав и запуск"],
      documents: ["Результат", "Готовые файлы и ошибки"]
    };

    for (const step of interfaceWorkflowSteps) {
      let card = byView.get(step.view);
      if (!card) {
        card = document.createElement("button");
        card.className = "path-card";
        card.type = "button";
        card.dataset.viewTarget = step.view;
        card.innerHTML = `<span class="path-index">${step.number}</span><span><strong>${copy[step.view][0]}</strong><small id="homeResultStatus">${copy[step.view][1]}</small></span><span aria-hidden="true">›</span>`;
        grid.append(card);
      }
      card.dataset.workflowStep = step.key;
      const index = card.querySelector(".path-index");
      if (index) index.textContent = String(step.number);
      const title = card.querySelector("strong");
      if (title) title.textContent = copy[step.view][0];
      if (step.view !== "documents") {
        const status = card.querySelector("small");
        if (status && !status.id) status.textContent = copy[step.view][1];
      }
    }
  }

  function interfaceEnsureManagement() {
    const view = interfaceQuery('[data-view="settings"]');
    if (!view || view.dataset.interfaceReady === "true") return;
    view.dataset.interfaceReady = "true";
    view.classList.add("management-view");
    view.innerHTML = `
      <h2 class="visually-hidden" id="settings-heading">Управление</h2>
      <section class="management-overview" aria-label="Текущий контекст и состояние системы">
        <article class="management-context-card">
          <div>
            <p class="eyebrow">Текущий раздел данных</p>
            <h2 id="managementCurrentSpace">Определяем…</h2>
            <p id="managementCurrentSpaceDescription">Получаем сведения о выбранном разделе.</p>
            <div class="management-context-metrics" aria-label="Состав выбранного раздела">
              <div><strong id="managementEmployeeCount">0</strong><span>сотрудников</span></div>
              <div><strong id="managementGroupCount">0</strong><span>групп</span></div>
              <div><strong id="managementTemplateCount">0</strong><span>шаблонов</span></div>
            </div>
          </div>
          <button class="secondary-button" type="button" data-view-target="spaces">Управлять разделом</button>
        </article>
        <article class="management-health-card">
          <span class="management-health-icon" aria-hidden="true">✓</span>
          <div><p class="eyebrow">Локальный контур</p><h3 id="managementSystemStatus">Проверяем систему…</h3><p id="managementSystemDetail">Получаем состояние локального сервера.</p></div>
          <button class="secondary-button" type="button" data-management-refresh>Обновить состояние</button>
        </article>
      </section>

      <section class="management-section" aria-labelledby="managementMainHeading">
        <div class="management-section-heading"><div><h3 id="managementMainHeading">Организация работы</h3><p>Расширенные правила собраны здесь и не мешают ежедневному пути к готовым документам.</p></div></div>
        <div class="settings-grid management-grid">
          ${interfaceButtonMarkup({ view: "spaces", icon: "▦", title: "Разделы данных и группы", detail: "Подразделения, проекты, составы и разовый выбор людей.", badgeId: "managementDataBadge", badge: "Состав" })}
          ${interfaceButtonMarkup({ view: "automations", tone: "purple", icon: "◷", title: "Расписания и доставка", detail: "Повторные выпуски, почта и разрешённые сетевые папки.", badgeId: "managementAutomationBadge", badge: "Правила и доставка" })}
          ${interfaceButtonMarkup({ view: "knowledge", icon: "≡", title: "Поля и справочники", detail: "Дополнительные типы записей, перечни вариантов и общие поля.", badgeId: "managementFieldsBadge", badge: "Поля" })}
          ${interfaceButtonMarkup({ view: "help", tone: "purple", icon: "?", title: "Руководство и рабочие кейсы", detail: "Импорт, шаблоны, выпуск, расписания и восстановление после ошибок.", badge: "Доступно без Интернета" })}
        </div>
      </section>

      <section class="management-section" aria-labelledby="managementAppearanceHeading">
        <div class="management-section-heading"><div><h3 id="managementAppearanceHeading">Оформление</h3><p>Выбор сохраняется в этом браузере. Системный режим следует настройке операционной системы.</p></div></div>
        <div class="theme-choice" role="group" aria-label="Тема оформления">
          <button type="button" data-management-theme="system" aria-pressed="false"><span aria-hidden="true">◐</span><strong>Системная</strong><small>Как в системе</small></button>
          <button type="button" data-management-theme="light" aria-pressed="false"><span aria-hidden="true">☀</span><strong>Светлая</strong><small>Светлый фон</small></button>
          <button type="button" data-management-theme="dark" aria-pressed="false"><span aria-hidden="true">☾</span><strong>Тёмная</strong><small>Тёмный фон</small></button>
        </div>
      </section>

      <details class="management-diagnostics">
        <summary><span>Диагностика и техническое состояние</span><span aria-hidden="true">›</span></summary>
        <div class="management-diagnostics-body">
          <div><strong>Соединение</strong><span id="managementConnectionLabel">Проверяем локальный сервер…</span></div>
          <div><strong>Общие поля</strong><span><b id="managementPropertyCount">0</b> определений</span></div>
        </div>
        <div class="management-readiness-mount" id="managementReadinessMount"></div>
      </details>`;
  }

  function interfaceMoveReadiness() {
    const panel = interfaceQuery("#operationsReadinessPanel");
    const mount = interfaceQuery("#managementReadinessMount");
    if (panel && mount && panel.parentElement !== mount) mount.append(panel);
  }

  function interfaceRenameNavigation() {
    document.querySelectorAll('[data-view-target="settings"] span:not(.nav-symbol), [data-view-target="settings"] small').forEach((label) => {
      if (label.closest(".mobile-nav")) label.textContent = "Ещё";
      else label.textContent = "Управление";
    });
    if (views?.settings) {
      views.settings = ["Расширенные правила", "Управление", "Разделы данных, оформление, справочники и диагностика.", null, null];
    }
  }

  function interfaceStatusKind(ribbon) {
    if (ribbon.classList.contains("is-error")) return "error";
    if (ribbon.classList.contains("is-warning")) return "warning";
    if (ribbon.classList.contains("is-success")) return "success";
    return "loading";
  }

  function interfaceSyncStatus() {
    const ribbon = interfaceQuery("#statusRibbon");
    const control = interfaceQuery("#systemStatusControl");
    const label = interfaceQuery("#systemStatusLabel");
    if (!ribbon || !control || !label) return;

    const title = interfaceQuery("#statusRibbonTitle")?.textContent?.trim() || "Состояние системы";
    const detail = interfaceQuery("#statusRibbonDetail")?.textContent?.trim() || "";
    const kind = interfaceStatusKind(ribbon);
    const routine = kind === "success" && title === "Данные актуальны";
    const signature = `${kind}:${title}:${detail}`;

    if (signature !== interfaceStatusSignature) {
      interfaceStatusSignature = signature;
      interfaceStatusExpanded = false;
    }

    ribbon.dataset.interfaceState = kind;
    ribbon.classList.toggle("is-routine", routine);
    ribbon.classList.toggle("is-user-expanded", routine && interfaceStatusExpanded);
    control.dataset.state = kind;
    control.setAttribute("aria-expanded", String(routine && interfaceStatusExpanded));
    control.title = routine ? `${title}. ${detail}` : title;
    label.textContent = routine
      ? "Система готова"
      : kind === "loading"
        ? title
        : title.length > 34
          ? kind === "error"
            ? "Есть ошибка"
            : kind === "warning"
              ? "Нужно внимание"
              : "Изменение сохранено"
          : title;

    const managementStatus = interfaceQuery("#managementSystemStatus");
    const managementDetail = interfaceQuery("#managementSystemDetail");
    const healthIcon = interfaceQuery(".management-health-icon");
    if (managementStatus) managementStatus.textContent = label.textContent;
    if (managementDetail) managementDetail.textContent = detail || "Локальный сервер отвечает.";
    if (healthIcon) {
      healthIcon.dataset.state = kind;
      healthIcon.textContent = kind === "error" ? "!" : kind === "warning" ? "!" : kind === "loading" ? "…" : "✓";
    }
  }

  function interfaceSetStepState(card, value, number) {
    if (!card) return;
    card.dataset.state = value;
    const index = card.querySelector(".path-index");
    if (index) index.textContent = value === "complete" ? "✓" : String(number);
    if (value === "current") card.setAttribute("aria-current", "step");
    else card.removeAttribute("aria-current");
  }

  function interfaceResultCounts() {
    const view = interfaceQuery('[data-view="documents"]');
    if (!view) return { files: 0, attention: 0, active: 0 };
    return {
      files: view.querySelectorAll(".shared-result-card").length,
      attention: view.querySelectorAll(".operation-row.is-failed, .operation-row.is-partial").length,
      active: view.querySelectorAll(".operation-row.is-running, .operation-row.is-pending, .operation-row.is-retry").length
    };
  }

  function interfaceSyncWorkflow() {
    const employeeCount = state.data.employees.length;
    const templateCount = state.data.activeTemplates.length;
    const dataReady = Boolean(state.employee.loaded && employeeCount > 0);
    const templateReady = Boolean(state.templateCatalog.loaded && templateCount > 0);
    const resultCounts = interfaceResultCounts();
    const hasResult = resultCounts.files > 0;
    const hasActiveResult = resultCounts.active > 0;
    const hasAttention = resultCounts.attention > 0;

    const statuses = {
      data: dataReady ? "complete" : "current",
      template: dataReady ? (templateReady ? "complete" : "current") : "upcoming",
      generation: templateReady ? (hasResult || hasActiveResult || hasAttention ? "complete" : "current") : "upcoming",
      results: hasAttention ? "attention" : hasResult ? "complete" : hasActiveResult ? "current" : "upcoming"
    };

    for (const step of interfaceWorkflowSteps) {
      interfaceSetStepState(interfaceQuery(`[data-workflow-step="${step.key}"]`), statuses[step.key], step.number);
      document.querySelectorAll(`[data-view-target="${step.view}"]`).forEach((nav) => {
        nav.classList.toggle("has-complete-step", statuses[step.key] === "complete");
        nav.classList.toggle("has-attention-step", step.key === "results" && hasAttention);
      });
    }

    const resultStatus = interfaceQuery("#homeResultStatus");
    if (resultStatus) {
      if (hasAttention) {
        resultStatus.textContent = `${resultCounts.attention} ${interfacePlural(resultCounts.attention, "операция требует", "операции требуют", "операций требуют")} внимания`;
      } else if (hasResult) {
        resultStatus.textContent = `${resultCounts.files} ${interfacePlural(resultCounts.files, "готовый результат", "готовых результата", "готовых результатов")}`;
      } else if (hasActiveResult) {
        resultStatus.textContent = "Формирование продолжается";
      } else {
        resultStatus.textContent = "Готовые файлы и ошибки";
      }
    }

    const currentView = document.querySelector(".view.is-visible")?.dataset.view || state.view;
    const stage = interfaceQuery("#workflowStageChip");
    const step = interfaceWorkflowSteps.find((item) => item.view === currentView);
    if (stage) {
      stage.hidden = !step;
      if (step) stage.textContent = `Этап ${step.number} из 4 · ${step.label}`;
    }
    document.body.dataset.workflowView = step ? currentView : "other";
  }

  function interfaceSyncManagement() {
    const space = currentSpace();
    const employeeCount = state.data.employees.length;
    const groupCount = state.data.groups.length;
    const templateCount = state.data.activeTemplates.length;
    const propertyCount = state.data.properties.length;

    const values = {
      managementCurrentSpace: space?.name || "Раздел не выбран",
      managementCurrentSpaceDescription: space?.description || "Выберите или создайте раздел данных для ежедневной работы.",
      managementEmployeeCount: String(employeeCount),
      managementGroupCount: String(groupCount),
      managementTemplateCount: String(templateCount),
      managementPropertyCount: String(propertyCount)
    };
    for (const [id, value] of Object.entries(values)) {
      const element = interfaceQuery(`#${id}`);
      if (element) element.textContent = value;
    }

    const connection = interfaceQuery("#connectionBadge span:last-child")?.textContent?.trim();
    const connectionLabel = interfaceQuery("#managementConnectionLabel");
    if (connectionLabel) connectionLabel.textContent = connection || "Проверяем локальный сервер…";

    const dataBadge = interfaceQuery("#managementDataBadge");
    if (dataBadge) dataBadge.textContent = `${employeeCount} ${interfacePlural(employeeCount, "сотрудник", "сотрудника", "сотрудников")}`;
    const fieldsBadge = interfaceQuery("#managementFieldsBadge");
    if (fieldsBadge) fieldsBadge.textContent = `${propertyCount} ${interfacePlural(propertyCount, "поле", "поля", "полей")}`;
    interfaceSyncThemeControls();
    interfaceMoveReadiness();
  }

  function interfaceSyncThemeControls() {
    document.querySelectorAll("[data-management-theme]").forEach((button) => {
      const active = button.dataset.managementTheme === state.theme;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function interfaceEnsureResultSummary() {
    const view = interfaceQuery('[data-view="documents"]');
    if (!view) return null;
    let summary = interfaceQuery("#resultAttentionSummary", view);
    if (summary) return summary;
    summary = document.createElement("section");
    summary.id = "resultAttentionSummary";
    summary.className = "result-attention-summary";
    summary.hidden = true;
    summary.setAttribute("role", "status");
    summary.setAttribute("aria-live", "polite");
    const intro = view.querySelector(".shared-result-intro");
    if (intro) intro.insertAdjacentElement("afterend", summary);
    else view.prepend(summary);
    return summary;
  }

  function interfaceSyncResultBadges(attention) {
    document.querySelectorAll('[data-view-target="documents"]').forEach((button) => {
      let badge = button.querySelector("[data-interface-attention-badge]");
      if (!badge && attention > 0) {
        badge = document.createElement("span");
        badge.className = "nav-badge is-alert";
        badge.dataset.interfaceAttentionBadge = "";
        button.append(badge);
      }
      if (badge) {
        badge.hidden = attention === 0;
        badge.textContent = String(attention);
        badge.setAttribute("aria-label", `${attention} операций требуют внимания`);
      }
    });
  }

  function interfaceSyncResultSummary() {
    const view = interfaceQuery('[data-view="documents"]');
    const summary = interfaceEnsureResultSummary();
    if (!view || !summary) return;
    const failed = view.querySelectorAll(".operation-row.is-failed").length;
    const partial = view.querySelectorAll(".operation-row.is-partial").length;
    const retry = view.querySelectorAll(".operation-row.is-retry").length;
    const attention = failed + partial;
    interfaceSyncResultBadges(attention);
    const signature = `${failed}:${partial}:${retry}`;
    if (signature === interfaceResultsSignature) return;
    interfaceResultsSignature = signature;

    if (attention === 0 && retry === 0) {
      summary.hidden = true;
      summary.innerHTML = "";
      return;
    }

    const tone = failed > 0 ? "danger" : "warning";
    const title = failed > 0
      ? `Требуют исправления: ${failed}`
      : partial > 0
        ? `Частично готовы: ${partial}`
        : "Повтор уже запланирован";
    const details = [];
    if (partial > 0) details.push(`частичных результатов: ${partial}`);
    if (retry > 0) details.push(`автоматических повторов: ${retry}`);

    summary.hidden = false;
    summary.dataset.tone = tone;
    summary.innerHTML = `
      <span class="result-attention-icon" aria-hidden="true">${failed > 0 ? "!" : "↻"}</span>
      <div><strong>${title}</strong><p>Готовые файлы сохранены. ${details.length > 0 ? `${details.join(" · ")}. ` : ""}Повторяйте только неуспешную часть.</p></div>
      <button class="secondary-button" type="button" data-scroll-result-attention>Показать</button>`;
  }

  function interfaceSyncPrimaryAction() {
    const current = document.querySelector(".view.is-visible")?.dataset.view || state.view;
    const primary = interfaceQuery("#primaryAction");
    if (!primary) return;
    if (current === "employees") {
      primary.hidden = false;
      primary.dataset.employeeAction = "add";
      delete primary.dataset.create;
      const label = primary.querySelector("span:last-child");
      if (label) label.textContent = "Добавить сотрудника";
      const icon = primary.querySelector("span:first-child");
      if (icon) icon.textContent = "＋";
      const headerButton = interfaceQuery("#employeeAddButtonHeader");
      if (headerButton) headerButton.hidden = true;
    }
  }

  function interfaceSyncDuplicateIntros() {
    const current = document.querySelector(".view.is-visible")?.dataset.view || state.view;
    document.querySelectorAll(".section-intro.is-duplicate-heading").forEach((intro) => intro.classList.remove("is-duplicate-heading"));
    const view = interfaceQuery(`[data-view="${current}"]`);
    if (!view) return;
    if (["employees", "spaces", "templates", "automations"].includes(current)) {
      const intro = view.querySelector(":scope > .section-intro");
      intro?.classList.add("is-duplicate-heading");
    }
    const resultIntro = view.querySelector(":scope > .shared-result-intro");
    resultIntro?.classList.add("is-duplicate-heading");
  }

  function interfaceHelpCategoryKey(label) {
    const normalized = String(label || "").toLocaleLowerCase("ru-RU");
    if (normalized.includes("начало")) return "start";
    if (normalized.includes("люди") || normalized.includes("данные")) return "data";
    if (normalized.includes("шаблон")) return "templates";
    if (normalized.includes("выпуск")) return "generation";
    if (normalized.includes("распис") || normalized.includes("достав")) return "automation";
    if (normalized.includes("кейс")) return "cases";
    if (normalized.includes("админист")) return "admin";
    return "technical";
  }

  function interfaceApplyHelpSearch() {
    const input = interfaceQuery("#helpCenterSearch");
    const list = interfaceQuery("#helpCenterArticleList");
    const count = interfaceQuery("#helpCenterCount");
    const empty = interfaceQuery("#helpCenterEmpty");
    if (!input || !list || !count || !empty) return;
    const tokens = interfaceHelpSearch.trim().toLocaleLowerCase("ru-RU").split(/\s+/u).filter(Boolean);
    let visible = 0;
    list.querySelectorAll(".help-center-card").forEach((card) => {
      const text = card.textContent?.toLocaleLowerCase("ru-RU") || "";
      const match = tokens.every((token) => text.includes(token));
      card.hidden = !match;
      if (match) visible += 1;
      const category = card.querySelector(".help-center-card-category")?.textContent;
      card.dataset.helpCategoryCard = interfaceHelpCategoryKey(category);
    });
    count.textContent = `${visible} ${interfacePlural(visible, "раздел", "раздела", "разделов")}`;
    empty.hidden = visible > 0;
  }

  function interfaceEnsureHelpLayout() {
    const hero = interfaceQuery(".help-center-hero");
    const search = interfaceQuery(".help-center-search");
    if (hero && search && search.parentElement !== hero.querySelector("div:first-child")) {
      hero.querySelector("div:first-child")?.append(search);
      const tools = interfaceQuery(".help-center-tools");
      tools?.classList.add("is-search-moved");
    }
    interfaceApplyHelpSearch();
  }

  function interfaceSyncView() {
    const current = document.querySelector(".view.is-visible")?.dataset.view || state.view || "overview";
    document.body.dataset.currentView = current;
    interfaceSyncPrimaryAction();
    interfaceSyncDuplicateIntros();
    interfaceSyncWorkflow();
    interfaceSyncManagement();
    interfaceSyncResultSummary();
    interfaceEnsureHelpLayout();
    if (current === "settings") {
      const title = interfaceQuery("#viewTitle");
      const eyebrow = interfaceQuery("#viewEyebrow");
      const description = interfaceQuery("#viewDescription");
      if (title) title.textContent = "Управление";
      if (eyebrow) eyebrow.textContent = "Расширенные правила";
      if (description) description.textContent = "Разделы данных, оформление, справочники и диагностика.";
    }
  }

  function interfaceScheduleSync() {
    if (interfaceSyncScheduled) return;
    interfaceSyncScheduled = true;
    requestAnimationFrame(() => {
      interfaceSyncScheduled = false;
      interfaceEnsureTopbarControls();
      interfaceEnsureWorkflow();
      interfaceEnsureManagement();
      interfaceMoveReadiness();
      interfaceSyncStatus();
      interfaceSyncView();
    });
  }

  interfaceEnsureTopbarControls();
  interfaceEnsureWorkflow();
  interfaceEnsureManagement();
  interfaceRenameNavigation();
  interfaceMoveReadiness();

  const statusRibbon = interfaceQuery("#statusRibbon");
  if (statusRibbon) {
    new MutationObserver(interfaceScheduleSync).observe(statusRibbon, { attributes: true, childList: true, subtree: true });
  }

  const documentsView = interfaceQuery('[data-view="documents"]');
  if (documentsView) {
    new MutationObserver(interfaceScheduleSync).observe(documentsView, { childList: true, subtree: true });
  }

  const overviewView = interfaceQuery('[data-view="overview"]');
  if (overviewView) {
    new MutationObserver(interfaceScheduleSync).observe(overviewView, { childList: true });
  }

  const connectionBadge = interfaceQuery("#connectionBadge");
  if (connectionBadge) {
    new MutationObserver(interfaceScheduleSync).observe(connectionBadge, { attributes: true, childList: true, subtree: true });
  }

  const helpList = interfaceQuery("#helpCenterArticleList");
  if (helpList) {
    new MutationObserver(() => requestAnimationFrame(interfaceApplyHelpSearch)).observe(helpList, { childList: true });
  }

  const helpSearch = interfaceQuery("#helpCenterSearch");
  if (helpSearch) {
    helpSearch.addEventListener("input", (event) => {
      event.stopPropagation();
      interfaceHelpSearch = event.currentTarget.value;
      interfaceApplyHelpSearch();
    }, { capture: true });
  }

  new MutationObserver(interfaceSyncThemeControls).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"]
  });

  document.addEventListener("click", (event) => {
    const statusControl = event.target.closest("#systemStatusControl");
    if (statusControl) {
      const ribbon = interfaceQuery("#statusRibbon");
      if (ribbon?.classList.contains("is-routine")) {
        interfaceStatusExpanded = !interfaceStatusExpanded;
        interfaceSyncStatus();
        if (interfaceStatusExpanded) ribbon.scrollIntoView({ block: "nearest" });
      } else {
        ribbon?.scrollIntoView({ block: "nearest" });
      }
      return;
    }

    if (event.target.closest("#mobileHelpButton")) {
      if (typeof openHelp === "function") openHelp();
      return;
    }

    const context = event.target.closest("#currentSpaceChip");
    if (context && !context.hasAttribute("data-workspace-switcher")) {
      globalThis.docomatorSelectView?.("spaces");
      return;
    }

    const theme = event.target.closest("[data-management-theme]");
    if (theme) {
      applyTheme(theme.dataset.managementTheme || "system");
      interfaceSyncThemeControls();
      return;
    }

    if (event.target.closest("[data-management-refresh]")) {
      void loadData();
      return;
    }

    if (event.target.closest("[data-scroll-result-attention]")) {
      interfaceQuery(
        ".operation-row.is-failed, .operation-row.is-partial, .operation-row.is-retry",
        interfaceQuery('[data-view="documents"]') || document
      )?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "center"
      });
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "F1") {
      event.preventDefault();
      if (typeof openHelp === "function") openHelp();
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && event.target?.id === "currentSpaceChip") {
      event.preventDefault();
      globalThis.docomatorSelectView?.("spaces");
    }
  });

  window.addEventListener("docomator:view-changed", interfaceScheduleSync);
  document.addEventListener("docomator:space-changed", interfaceScheduleSync);
  window.addEventListener("docomator:employees-changed", interfaceScheduleSync);
  document.addEventListener("docomator:template-wizard-step-completed", () => {
    interfaceScheduleSync();
    setTimeout(interfaceScheduleSync, 800);
  });
  window.addEventListener("docomator:help-opened", interfaceScheduleSync);
  window.addEventListener("hashchange", interfaceScheduleSync);
  window.addEventListener("online", interfaceScheduleSync);
  window.addEventListener("offline", interfaceScheduleSync);

  interfaceScheduleSync();
}
