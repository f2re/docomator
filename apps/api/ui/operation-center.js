const operationCenterView = document.querySelector('[data-view="documents"]');
let operationCenterItems = [];
let operationCenterBusy = false;
let operationCenterTimer = null;
let operationCenterRequestToken = 0;

function operationCenterEscape(value) {
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

async function operationCenterFetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" }
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

function operationCenterKindLabel(kind) {
  return (
    {
      template_preview: "Предварительный просмотр",
      document_generation: "Формирование документов",
      network_delivery: "Доставка в сетевую папку",
      email_delivery: "Отправка по электронной почте"
    }[kind] || "Операция с документом"
  );
}

function operationCenterStateLabel(state) {
  return (
    {
      pending: "Ожидает запуска",
      running: "Выполняется",
      retry: "Повтор запланирован",
      completed: "Готово",
      partial: "Готово частично",
      failed: "Нужно внимание"
    }[state] || "Состояние уточняется"
  );
}

function operationCenterStateOrder(state) {
  return (
    {
      failed: 0,
      partial: 1,
      retry: 2,
      running: 3,
      pending: 4,
      completed: 5
    }[state] ?? 6
  );
}

function operationCenterSortedItems() {
  return [...operationCenterItems].sort((left, right) => {
    const stateDifference =
      operationCenterStateOrder(left.state) -
      operationCenterStateOrder(right.state);
    if (stateDifference !== 0) return stateDifference;
    return String(right.updatedAt).localeCompare(String(left.updatedAt));
  });
}

function operationCenterProgressText(operation) {
  const progress = operation.progress || {};
  const expected = Number(progress.expected || 0);
  const completed = Number(progress.completed || 0);
  const failed = Number(progress.failed || 0);
  if (operation.kind !== "document_generation" || expected < 1) return "";
  return `Готово ${completed} из ${expected}${failed > 0 ? ` · с ошибкой ${failed}` : ""}`;
}

function operationCenterDescription(operation) {
  const progress = operationCenterProgressText(operation);
  if (operation.state === "failed") {
    return `${operation.failureReason || "Операция завершилась с ошибкой."} Данные и готовые файлы сохранены.`;
  }
  if (operation.state === "retry") {
    const attempt =
      operation.attempts === null || operation.maxAttempts === null
        ? ""
        : ` Попытка ${operation.attempts + 1} из ${operation.maxAttempts}.`;
    const next = operation.nextAttemptAt
      ? ` Следующий запуск — ${new Date(operation.nextAttemptAt).toLocaleString("ru-RU")}.`
      : "";
    return `Сервер повторит операцию автоматически.${attempt}${next} Можно перейти в другой раздел.`;
  }
  if (operation.state === "running") {
    return `${progress ? `${progress}. ` : ""}Работа продолжается на локальном сервере. Можно перейти в другой раздел.`;
  }
  if (operation.state === "pending") {
    return "Запрос сохранён на локальном сервере и ожидает обработки. Можно перейти в другой раздел.";
  }
  if (operation.state === "partial") {
    return `${progress || "Часть документов готова"}. Готовые файлы доступны, ошибки можно повторить отдельно.`;
  }
  if (operation.kind === "template_preview") {
    return "PDF готов к просмотру. После проверки шаблон можно активировать.";
  }
  if (operation.kind === "document_generation") {
    return `${progress || "Документы готовы"}. Результат сохранён в общем хранилище.`;
  }
  return "Доставка завершена. Результат сохранён в истории.";
}

function operationCenterAction(operation) {
  if (operation.state === "completed") return null;
  if (operation.kind === "template_preview") {
    return { view: "templates", label: "Открыть шаблон" };
  }
  return {
    view: "generation",
    label:
      operation.state === "running" || operation.state === "retry"
        ? "Смотреть ход"
        : "Открыть выпуск"
  };
}

function operationCenterProgress(operation) {
  if (operation.kind !== "document_generation") return "";
  const expected = Number(operation.progress?.expected || 0);
  if (expected < 1) return "";
  const completed = Number(operation.progress?.completed || 0);
  const failed = Number(operation.progress?.failed || 0);
  const percent = Math.min(100, Math.round(((completed + failed) / expected) * 100));
  return `<div class="operation-progress" role="progressbar" aria-label="Выполнение ${percent}%" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="--operation-progress: ${percent}%"></span></div>`;
}

function operationCenterCard(operation) {
  const action = operationCenterAction(operation);
  return `
    <article class="operation-row is-${operationCenterEscape(operation.state)}">
      <span class="operation-rail" aria-hidden="true"><i></i></span>
      <div class="operation-copy">
        <div class="operation-title-row">
          <span>${operationCenterEscape(operationCenterKindLabel(operation.kind))}</span>
          <span class="operation-state-label">${operationCenterEscape(operationCenterStateLabel(operation.state))}</span>
        </div>
        <strong>${operationCenterEscape(operation.title)}</strong>
        <p>${operationCenterEscape(operationCenterDescription(operation))}</p>
        ${operationCenterProgress(operation)}
        <small>Обновлено ${operationCenterEscape(new Date(operation.updatedAt).toLocaleString("ru-RU"))}</small>
        <details class="technical-details operation-technical-details">
          <summary>Технические сведения</summary>
          <dl><div><dt>Операция</dt><dd><code>${operationCenterEscape(operation.id)}</code></dd></div><div><dt>Идентификатор</dt><dd><code>${operationCenterEscape(operation.correlationId)}</code></dd></div></dl>
        </details>
      </div>
      ${action ? `<button class="secondary-button operation-action" type="button" data-operation-view="${operationCenterEscape(action.view)}">${operationCenterEscape(action.label)}</button>` : ""}
    </article>`;
}

function operationCenterRoot() {
  return document.querySelector("#operationCenter");
}

function initializeOperationCenter() {
  if (!operationCenterView || operationCenterRoot()) return;
  const root = document.createElement("article");
  root.id = "operationCenter";
  root.className = "panel operation-center";
  root.setAttribute("aria-labelledby", "operationCenterTitle");
  root.innerHTML = `
    <div class="operation-heading">
      <div><p class="eyebrow">Выбранный раздел данных</p><h3 id="operationCenterTitle">Ход работы</h3><p id="operationCenterSummary">Здесь появятся формирование, предпросмотр и доставка.</p></div>
      <button class="quiet-button compact" id="operationCenterRefresh" type="button">Обновить</button>
    </div>
    <div id="operationCenterList" class="operation-list" aria-live="polite" aria-busy="false"></div>`;
  const metrics = operationCenterView.querySelector(".shared-result-metrics");
  operationCenterView.insertBefore(root, metrics || operationCenterView.firstChild);
  root.querySelector("#operationCenterRefresh")?.addEventListener("click", () =>
    loadOperationCenter(true)
  );
  root.addEventListener("click", (event) => {
    const action = event.target.closest("[data-operation-view]");
    if (!action) return;
    globalThis.docomatorSelectView?.(action.dataset.operationView);
  });
}

function renderOperationCenter() {
  initializeOperationCenter();
  const root = document.querySelector("#operationCenterList");
  const summary = document.querySelector("#operationCenterSummary");
  if (!root || !summary) return;
  if (operationCenterItems.length === 0) {
    summary.textContent = "Запущенных и завершённых операций в выбранном разделе пока нет.";
    root.innerHTML = `
      <div class="operation-empty">
        <span class="operation-empty-mark" aria-hidden="true">＋</span>
        <div><strong>Операций пока нет</strong><p>Создайте первый комплект документов — ход работы и результат сохранятся здесь.</p></div>
        <button class="primary-button" type="button" data-operation-view="generation">Создать документы</button>
      </div>`;
    return;
  }
  const attention = operationCenterItems.filter((item) =>
    ["failed", "partial"].includes(item.state)
  ).length;
  const active = operationCenterItems.filter((item) =>
    ["pending", "running", "retry"].includes(item.state)
  ).length;
  const parts = [];
  if (attention > 0) parts.push(`требуют внимания: ${attention}`);
  if (active > 0) parts.push(`выполняются: ${active}`);
  if (parts.length === 0) parts.push(`завершено: ${operationCenterItems.length}`);
  summary.textContent = `Операции выбранного раздела · ${parts.join(" · ")}.`;
  root.innerHTML = operationCenterSortedItems().map(operationCenterCard).join("");
}

function renderOperationCenterLoading() {
  initializeOperationCenter();
  const root = document.querySelector("#operationCenterList");
  const summary = document.querySelector("#operationCenterSummary");
  if (summary) {
    summary.textContent = "Получаем сохранённые операции. Запущенная работа продолжается на сервере.";
  }
  if (root) {
    root.setAttribute("aria-busy", "true");
    root.innerHTML = `
      <div class="operation-loading" role="status">
        <span class="operation-loading-mark" aria-hidden="true"></span>
        <div><strong>Получаем операции</strong><p>Предпросмотр, формирование и доставка появятся после ответа локального сервера.</p></div>
      </div>`;
  }
}

function renderOperationCenterError(error) {
  const root = document.querySelector("#operationCenterList");
  const summary = document.querySelector("#operationCenterSummary");
  if (summary) summary.textContent = "Состояние операций не обновлено. Запущенная работа не остановлена.";
  if (!root) return;
  root.innerHTML = `
    <div class="operation-error" role="alert">
      <span class="operation-error-mark" aria-hidden="true">!</span>
      <div><strong>Не удалось получить операции</strong><p>${operationCenterEscape(error?.message || "Повторите обновление.")}</p>${error?.operationId ? `<details class="technical-details"><summary>Технические сведения</summary><p><code>${operationCenterEscape(error.operationId)}</code></p></details>` : ""}</div>
      <button class="secondary-button" id="operationCenterRetry" type="button">Повторить</button>
    </div>`;
  root.querySelector("#operationCenterRetry")?.addEventListener("click", () =>
    loadOperationCenter(true)
  );
}

async function loadOperationCenter(showLoading = false) {
  if (!operationCenterView || operationCenterBusy) return;
  initializeOperationCenter();
  const spaceId = String(globalThis.docomatorCurrentSpaceId || "");
  if (spaceId === "") {
    operationCenterItems = [];
    renderOperationCenter();
    return;
  }
  operationCenterBusy = true;
  const requestToken = ++operationCenterRequestToken;
  const root = document.querySelector("#operationCenterList");
  if (showLoading || operationCenterItems.length === 0) renderOperationCenterLoading();
  else root?.setAttribute("aria-busy", "true");
  try {
    const body = await operationCenterFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/operations?limit=50`
    );
    if (
      requestToken !== operationCenterRequestToken ||
      spaceId !== String(globalThis.docomatorCurrentSpaceId || "")
    ) {
      return;
    }
    operationCenterItems = Array.isArray(body.data) ? body.data : [];
    renderOperationCenter();
  } catch (error) {
    if (requestToken !== operationCenterRequestToken) return;
    renderOperationCenterError(error);
  } finally {
    if (requestToken === operationCenterRequestToken) {
      operationCenterBusy = false;
      document.querySelector("#operationCenterList")?.setAttribute("aria-busy", "false");
    }
  }
}

function operationCenterVisible() {
  return Boolean(operationCenterView?.classList.contains("is-visible"));
}

if (operationCenterView) {
  initializeOperationCenter();
  document.querySelectorAll('[data-view-target="documents"]').forEach((button) =>
    button.addEventListener("click", () => void loadOperationCenter(false))
  );
  document.addEventListener("docomator:space-changed", () => {
    operationCenterRequestToken += 1;
    operationCenterBusy = false;
    operationCenterItems = [];
    if (operationCenterVisible()) void loadOperationCenter(true);
  });
  if (operationCenterVisible()) void loadOperationCenter(true);
  operationCenterTimer = setInterval(() => {
    if (operationCenterVisible()) void loadOperationCenter(false);
  }, 15_000);
  window.addEventListener("beforeunload", () => {
    if (operationCenterTimer !== null) clearInterval(operationCenterTimer);
  });
}
