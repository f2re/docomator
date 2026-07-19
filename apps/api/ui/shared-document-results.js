const sharedDocumentsView = document.querySelector('[data-view="documents"]');
let sharedDocumentFilter = "available";
let sharedDocumentSummary = null;
let sharedDocumentItems = [];
let sharedDocumentBusy = false;
let sharedDocumentPollTimer = null;
let sharedDocumentInitialized = false;
let sharedDocumentLastNewCount = null;
let sharedDocumentTargetId = null;
let sharedDocumentReloadRequested = false;

function sharedDocumentEscape(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;"
      })[character]
  );
}

async function sharedDocumentFetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { accept: "application/json", ...(options.headers || {}) },
    ...options
  });
  const body = await response.json();
  if (!response.ok) {
    throw {
      message: body?.error?.message || `Сервер вернул код ${response.status}.`,
      operationId:
        body?.correlationId || response.headers.get("x-correlation-id") || ""
    };
  }
  return body;
}

function sharedDocumentNotify(title, detail) {
  const region = document.querySelector("#toastRegion");
  if (!region) return;
  const toast = document.createElement("article");
  toast.className = "toast shared-result-toast";
  toast.innerHTML = `
    <span aria-hidden="true">📥</span>
    <div><strong>${sharedDocumentEscape(title)}</strong><p>${sharedDocumentEscape(detail)}</p></div>
    <button type="button" aria-label="Закрыть">×</button>`;
  toast.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    document
      .querySelector('[data-view-target="documents"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  toast.querySelector("button")?.addEventListener("click", () => toast.remove());
  region.append(toast);
  setTimeout(() => toast.remove(), 10_000);
}

function sharedDocumentStateLabel(state) {
  return (
    {
      new: "Новый",
      viewed: "Просмотрен",
      collected: "Забран"
    }[state] || "Готов"
  );
}

function sharedDocumentModeLabel(mode) {
  return mode === "aggregate"
    ? "Один сводный документ"
    : "Документы на каждого";
}

function sharedDocumentOriginLabel(item) {
  if (item.origin === "schedule") {
    return item.scheduleName
      ? `Автоматически · ${item.scheduleName}`
      : "Автоматически по расписанию";
  }
  return "Создан вручную";
}

function sharedDocumentCountLabel(item) {
  if (item.targetMode === "aggregate") return "1 файл";
  return item.archiveSha256
    ? `Комплект: ${item.generatedCount} файлов`
    : `${item.generatedCount} файл`;
}

function renderSharedDocumentSummary() {
  const summary = sharedDocumentSummary;
  if (!summary) return;
  const values = {
    sharedDocumentNewCount: summary.newCount,
    sharedDocumentAvailableCount: summary.availableCount,
    sharedDocumentCollectedCount: summary.collectedCount,
    sharedDocumentAutomaticCount: summary.automaticNewCount,
    overviewNewDocumentCount: summary.newCount
  };
  for (const [id, value] of Object.entries(values)) {
    const element = document.querySelector(`#${id}`);
    if (element) element.textContent = String(value);
  }
  document.querySelectorAll("[data-shared-new-badge]").forEach((badge) => {
    badge.textContent = String(summary.newCount);
    badge.hidden = summary.newCount === 0;
    badge.classList.toggle("is-alert", summary.newCount > 0);
  });
}

function renderSharedDocumentItems() {
  const root = document.querySelector("#sharedDocumentList");
  if (!root) return;
  if (sharedDocumentItems.length === 0) {
    root.innerHTML = `
      <div class="empty-state shared-result-empty">
        <div><span class="empty-emoji" aria-hidden="true">📭</span><h3>В этом разделе пока пусто</h3><p>${
          sharedDocumentFilter === "new"
            ? "Новых документов нет. Автоматические результаты появятся здесь сразу после формирования."
            : sharedDocumentFilter === "collected"
              ? "Забранных документов пока нет."
              : "Сформируйте документ вручную или создайте расписание. Результат сохранится в общем хранилище."
        }</p></div>
      </div>`;
    return;
  }
  root.innerHTML = sharedDocumentItems
    .map(
      (item) => `
        <article class="shared-result-card ${item.state === "new" ? "is-new" : ""}" data-shared-result-id="${sharedDocumentEscape(item.id)}">
          <div class="shared-result-main">
            <div class="shared-result-icon" aria-hidden="true">${item.archiveSha256 ? "🗜️" : item.format === "xlsx" ? "📊" : "📄"}</div>
            <div class="shared-result-copy">
              <div class="shared-result-title-row">
                <h3>${sharedDocumentEscape(item.templateTitle)}</h3>
                <span class="generation-state-code ${item.state === "new" ? "is-new" : ""}">${sharedDocumentEscape(sharedDocumentStateLabel(item.state))}</span>
              </div>
              <p>${sharedDocumentEscape(sharedDocumentOriginLabel(item))}</p>
              <div class="shared-result-meta">
                <span>${sharedDocumentEscape(item.spaceName)}</span>
                <span>${sharedDocumentEscape(sharedDocumentModeLabel(item.targetMode))}</span>
                <span>${sharedDocumentEscape(sharedDocumentCountLabel(item))}</span>
                <span>${sharedDocumentEscape(new Date(item.availableAt).toLocaleString("ru-RU"))}</span>
              </div>
              ${item.failedCount > 0 ? `<div class="shared-result-warning">⚠️ Готово: ${item.generatedCount}; с ошибкой: ${item.failedCount}</div>` : ""}
              ${item.schedulePeriodKey ? `<small>Период: <code>${sharedDocumentEscape(item.schedulePeriodKey)}</code></small>` : ""}
            </div>
          </div>
          <div class="shared-result-actions">
            ${item.state === "new" ? `<button class="secondary-button compact-button" type="button" data-shared-view="${sharedDocumentEscape(item.id)}">Отметить просмотренным</button>` : ""}
            <a class="primary-button compact-button" href="/api/v1/document-results/${encodeURIComponent(item.id)}/download" data-shared-download="${sharedDocumentEscape(item.id)}">${item.archiveSha256 ? "Скачать комплект" : "Скачать документ"}</a>
            <button class="quiet-button compact" type="button" data-shared-delete="${sharedDocumentEscape(item.id)}">Удалить</button>
          </div>
        </article>`
    )
    .join("");
  if (sharedDocumentTargetId !== null) {
    const target = [...root.querySelectorAll("[data-shared-result-id]")].find(
      (item) => item.dataset.sharedResultId === sharedDocumentTargetId
    );
    if (target) {
      target.tabIndex = -1;
      target.focus();
      target.scrollIntoView({ block: "center" });
      sharedDocumentTargetId = null;
    }
  }
}

function renderSharedDocumentFilters() {
  document.querySelectorAll("[data-shared-filter]").forEach((button) => {
    const active = button.dataset.sharedFilter === sharedDocumentFilter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function initializeSharedDocumentsView() {
  if (!sharedDocumentsView || sharedDocumentInitialized) return;
  sharedDocumentInitialized = true;
  sharedDocumentsView.innerHTML = `
    <div class="section-intro shared-result-intro">
      <div>
        <p class="eyebrow">Общее корпоративное хранилище</p>
        <h2 id="documents-heading">Результаты и операции</h2>
        <p>Следите за формированием и доставкой, затем скачивайте готовые ручные и автоматические документы.</p>
      </div>
      <div class="shared-result-heading-actions">
        <button class="secondary-button" id="sharedDocumentMarkAll" type="button">Отметить новые просмотренными</button>
        <button class="primary-button" id="sharedDocumentRefresh" type="button">Обновить</button>
      </div>
    </div>
    <div class="metric-grid shared-result-metrics" aria-label="Состояние общего хранилища">
      <article class="metric-card"><span class="metric-icon" aria-hidden="true">🔔</span><div><strong id="sharedDocumentNewCount">0</strong><span>новых</span></div></article>
      <article class="metric-card"><span class="metric-icon" aria-hidden="true">📥</span><div><strong id="sharedDocumentAvailableCount">0</strong><span>ожидают работы</span></div></article>
      <article class="metric-card"><span class="metric-icon" aria-hidden="true">✅</span><div><strong id="sharedDocumentCollectedCount">0</strong><span>забрано</span></div></article>
      <article class="metric-card"><span class="metric-icon" aria-hidden="true">⏱️</span><div><strong id="sharedDocumentAutomaticCount">0</strong><span>новых автоматически</span></div></article>
    </div>
    <article class="panel shared-result-panel">
      <div class="shared-result-toolbar">
        <div class="segmented-control" role="group" aria-label="Фильтр документов">
          <button type="button" data-shared-filter="available" aria-pressed="true">Ожидают</button>
          <button type="button" data-shared-filter="new" aria-pressed="false">Новые</button>
          <button type="button" data-shared-filter="collected" aria-pressed="false">Забранные</button>
          <button type="button" data-shared-filter="all" aria-pressed="false">Все</button>
        </div>
        <p id="sharedDocumentMessage">Общее хранилище не зависит от выбранного пространства.</p>
      </div>
      <div id="sharedDocumentList" class="shared-result-list" aria-live="polite">
        <div class="generation-history-empty">Получаем документы…</div>
      </div>
    </article>`;

  document.querySelector("#sharedDocumentRefresh")?.addEventListener("click", () =>
    loadSharedDocuments(true)
  );
  document.querySelector("#sharedDocumentMarkAll")?.addEventListener("click", markAllSharedDocumentsViewed);
  sharedDocumentsView.querySelectorAll("[data-shared-filter]").forEach((button) =>
    button.addEventListener("click", () => {
      sharedDocumentFilter = button.dataset.sharedFilter || "available";
      renderSharedDocumentFilters();
      void loadSharedDocuments(false);
    })
  );
  sharedDocumentsView.addEventListener("click", handleSharedDocumentAction);
  renderSharedDocumentFilters();
}

function initializeSharedDocumentNavigation() {
  document.querySelectorAll('[data-view-target="documents"]').forEach((button) => {
    const existing = button.querySelector(".nav-badge");
    if (existing) {
      existing.textContent = "0";
      existing.hidden = true;
      existing.dataset.sharedNewBadge = "";
    } else if (!button.querySelector("[data-shared-new-badge]")) {
      const badge = document.createElement("span");
      badge.className = "nav-badge";
      badge.dataset.sharedNewBadge = "";
      badge.hidden = true;
      button.append(badge);
    }
    button.addEventListener("click", () => void loadSharedDocuments(false));
  });
  document.querySelectorAll('[data-view-target="automations"] .nav-badge').forEach((badge) => {
    badge.textContent = "Работают";
  });
  const metricGrid = document.querySelector("[data-view=overview] .metric-grid");
  if (metricGrid && !document.querySelector("#overviewNewDocumentCount")) {
    const card = document.createElement("article");
    card.className = "metric-card is-clickable";
    card.tabIndex = 0;
    card.innerHTML = `<span class="metric-icon" aria-hidden="true">📥</span><div><strong id="overviewNewDocumentCount">0</strong><span>новых документов</span></div>`;
    card.addEventListener("click", () =>
      document.querySelector('[data-view-target="documents"]')?.click()
    );
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        document.querySelector('[data-view-target="documents"]')?.click();
      }
    });
    metricGrid.append(card);
  }
}

async function loadSharedDocumentSummary(showNotification = true) {
  try {
    const body = await sharedDocumentFetchJson("/api/v1/document-results/summary");
    const summary = body.data;
    const previousNewCount = sharedDocumentLastNewCount;
    sharedDocumentSummary = summary;
    sharedDocumentLastNewCount = summary.newCount;
    renderSharedDocumentSummary();
    if (
      showNotification &&
      previousNewCount !== null &&
      summary.newCount > previousNewCount
    ) {
      const added = summary.newCount - previousNewCount;
      sharedDocumentNotify(
        "Появились новые документы",
        `В общем хранилище новых результатов: ${added}.`
      );
    }
    if (
      showNotification &&
      previousNewCount === null &&
      summary.automaticNewCount > 0 &&
      sessionStorage.getItem("docomator.shared-results.initial-notice") !== summary.latestAvailableAt
    ) {
      sessionStorage.setItem(
        "docomator.shared-results.initial-notice",
        summary.latestAvailableAt || "shown"
      );
      sharedDocumentNotify(
        "Есть автоматические документы",
        `По расписаниям создано новых результатов: ${summary.automaticNewCount}.`
      );
    }
  } catch {
    // The persistent badge will be refreshed on the next poll.
  }
}

async function loadSharedDocuments(showMessage) {
  initializeSharedDocumentsView();
  if (!sharedDocumentsView) return;
  if (sharedDocumentBusy) {
    sharedDocumentReloadRequested = true;
    return;
  }
  sharedDocumentBusy = true;
  const root = document.querySelector("#sharedDocumentList");
  const message = document.querySelector("#sharedDocumentMessage");
  if (root) root.setAttribute("aria-busy", "true");
  if (showMessage && message) message.textContent = "Обновляем общее хранилище…";
  try {
    const [summaryBody, listBody] = await Promise.all([
      sharedDocumentFetchJson("/api/v1/document-results/summary"),
      sharedDocumentFetchJson(
        `/api/v1/document-results?state=${encodeURIComponent(sharedDocumentFilter)}&limit=300`
      )
    ]);
    sharedDocumentSummary = summaryBody.data;
    sharedDocumentItems = Array.isArray(listBody.data) ? listBody.data : [];
    sharedDocumentLastNewCount = sharedDocumentSummary.newCount;
    renderSharedDocumentSummary();
    renderSharedDocumentItems();
    if (message) {
      message.textContent = `Показано документов: ${sharedDocumentItems.length}. Новых: ${sharedDocumentSummary.newCount}.`;
    }
  } catch (error) {
    if (root) {
      root.innerHTML = `<div class="generation-state is-error"><span aria-hidden="true">⚠️</span><div><strong>Общее хранилище недоступно</strong><p>${sharedDocumentEscape(error?.message || "Повторите обновление.")}</p></div></div>`;
    }
    if (message) message.textContent = "Данные не обновлены.";
  } finally {
    sharedDocumentBusy = false;
    if (root) root.setAttribute("aria-busy", "false");
    if (sharedDocumentReloadRequested) {
      sharedDocumentReloadRequested = false;
      void loadSharedDocuments(false);
    }
  }
}

async function markAllSharedDocumentsViewed() {
  if (sharedDocumentBusy) return;
  sharedDocumentBusy = true;
  const message = document.querySelector("#sharedDocumentMessage");
  try {
    const body = await sharedDocumentFetchJson("/api/v1/document-results/view-all", {
      method: "POST"
    });
    if (message) message.textContent = `Отмечено просмотренными: ${body.data.changed}.`;
  } catch (error) {
    if (message) message.textContent = error?.message || "Действие не выполнено.";
  } finally {
    sharedDocumentBusy = false;
    await loadSharedDocuments(false);
  }
}

async function handleSharedDocumentAction(event) {
  const viewButton = event.target.closest("[data-shared-view]");
  if (viewButton) {
    await sharedDocumentFetchJson(
      `/api/v1/document-results/${encodeURIComponent(viewButton.dataset.sharedView)}/view`,
      { method: "POST" }
    );
    await loadSharedDocuments(false);
    return;
  }
  const deleteButton = event.target.closest("[data-shared-delete]");
  if (deleteButton) {
    const item = sharedDocumentItems.find(
      (candidate) => candidate.id === deleteButton.dataset.sharedDelete
    );
    const label = item?.templateTitle || "этот результат";
    if (!globalThis.confirm(`Удалить «${label}» из общего хранилища? Скачивание после удаления будет недоступно.`)) {
      return;
    }
    deleteButton.disabled = true;
    try {
      await sharedDocumentFetchJson(
        `/api/v1/document-results/${encodeURIComponent(deleteButton.dataset.sharedDelete)}`,
        { method: "DELETE" }
      );
      await loadSharedDocuments(false);
    } catch (error) {
      deleteButton.disabled = false;
      sharedDocumentNotify("Удаление не выполнено", error?.message || "Повторите действие.");
    }
    return;
  }
  const download = event.target.closest("[data-shared-download]");
  if (download) {
    setTimeout(() => void loadSharedDocuments(false), 1_000);
  }
}

function scheduleSharedDocumentPolling() {
  if (sharedDocumentPollTimer !== null) clearInterval(sharedDocumentPollTimer);
  sharedDocumentPollTimer = setInterval(() => {
    void loadSharedDocumentSummary(true);
    if (document.querySelector('[data-view="documents"]')?.classList.contains("is-visible")) {
      void loadSharedDocuments(false);
    }
  }, 15_000);
}

if (sharedDocumentsView) {
  window.addEventListener("docomator:open-document-result", (event) => {
    const resultId = event.detail?.resultId;
    sharedDocumentTargetId = typeof resultId === "string" ? resultId : null;
    sharedDocumentFilter = "available";
    renderSharedDocumentFilters();
    document.querySelector('[data-view-target="documents"]')?.click();
  });
  initializeSharedDocumentsView();
  initializeSharedDocumentNavigation();
  void loadSharedDocumentSummary(true);
  scheduleSharedDocumentPolling();
  window.addEventListener("beforeunload", () => {
    if (sharedDocumentPollTimer !== null) clearInterval(sharedDocumentPollTimer);
  });
}
