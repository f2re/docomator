{
  const interfaceWorkflowSteps = Object.freeze([
    { key: "data", view: "employees", number: 1, label: "Данные" },
    { key: "template", view: "templates", number: 2, label: "Шаблон" },
    { key: "generation", view: "generation", number: 3, label: "Выпуск" },
    { key: "results", view: "documents", number: 4, label: "Результат" }
  ]);

  let interfaceStatusExpanded = false;
  let interfaceStatusSignature = "";
  let interfaceResultsSignature = "";
  let interfaceSyncScheduled = false;

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
      healthIcon.textContent = kind === "error" || kind === "warning" ? "!" : kind === "loading" ? "…" : "✓";
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
      resultStatus.textContent = hasAttention
        ? `${resultCounts.attention} ${interfacePlural(resultCounts.attention, "операция требует", "операции требуют", "операций требуют")} внимания`
        : hasResult
          ? `${resultCounts.files} ${interfacePlural(resultCounts.files, "готовый результат", "готовых результата", "готовых результатов")}`
          : hasActiveResult
            ? "Формирование продолжается"
            : "Готовые файлы и ошибки";
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

  function interfaceSyncThemeControls() {
    document.querySelectorAll("[data-management-theme]").forEach((button) => {
      const active = button.dataset.managementTheme === state.theme;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
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

    const title = failed > 0 ? `Требуют исправления: ${failed}` : partial > 0 ? `Частично готовы: ${partial}` : "Повтор уже запланирован";
    const details = [];
    if (partial > 0) details.push(`частичных результатов: ${partial}`);
    if (retry > 0) details.push(`автоматических повторов: ${retry}`);
    summary.hidden = false;
    summary.dataset.tone = failed > 0 ? "danger" : "warning";
    summary.innerHTML = `
      <span class="result-attention-icon" aria-hidden="true">${failed > 0 ? "!" : "↻"}</span>
      <div><strong>${title}</strong><p>Готовые файлы сохранены. ${details.length > 0 ? `${details.join(" · ")}. ` : ""}Повторяйте только неуспешную часть.</p></div>
      <button class="secondary-button" type="button" data-scroll-result-attention>Показать</button>`;
  }

  function interfaceSyncView() {
    const current = document.querySelector(".view.is-visible")?.dataset.view || state.view || "overview";
    document.body.dataset.currentView = current;
    interfaceSyncWorkflow();
    interfaceSyncManagement();
    interfaceSyncResultSummary();
  }

  function interfaceScheduleSync() {
    if (interfaceSyncScheduled) return;
    interfaceSyncScheduled = true;
    requestAnimationFrame(() => {
      interfaceSyncScheduled = false;
      interfaceSyncStatus();
      interfaceSyncView();
    });
  }

  const statusRibbon = interfaceQuery("#statusRibbon");
  if (statusRibbon) new MutationObserver(interfaceSyncStatus).observe(statusRibbon, { attributes: true, childList: true, subtree: true });
  const documentsView = interfaceQuery('[data-view="documents"]');
  if (documentsView) new MutationObserver(interfaceScheduleSync).observe(documentsView, { childList: true, subtree: true });
  const connectionBadge = interfaceQuery("#connectionBadge");
  if (connectionBadge) new MutationObserver(interfaceSyncManagement).observe(connectionBadge, { attributes: true, childList: true, subtree: true });
  new MutationObserver(interfaceSyncThemeControls).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

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
      interfaceQuery(".operation-row.is-failed, .operation-row.is-partial, .operation-row.is-retry", interfaceQuery('[data-view="documents"]') || document)?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "center"
      });
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "F1") {
      event.preventDefault();
      if (typeof openHelp === "function") openHelp();
    }
  });

  window.addEventListener("docomator:view-changed", interfaceScheduleSync);
  document.addEventListener("docomator:space-changed", interfaceScheduleSync);
  window.addEventListener("docomator:employees-changed", interfaceScheduleSync);
  document.addEventListener("docomator:template-wizard-step-completed", interfaceScheduleSync);
  window.addEventListener("hashchange", interfaceScheduleSync);
  window.addEventListener("online", interfaceScheduleSync);
  window.addEventListener("offline", interfaceScheduleSync);

  interfaceScheduleSync();
}
