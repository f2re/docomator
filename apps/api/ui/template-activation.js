const activationView = document.querySelector('[data-view="templates"]');

let activationSpaceSelect = null;
let activationDrafts = [];
let activationVersions = [];
let activationPollTimer = null;
let activationPollToken = 0;
let activationBusy = false;
let activationReloadTimer = null;
let activationSourceMarker = "";

function activationEscape(value) {
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

async function activationFetchJson(url, options = {}) {
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

function activationPanel() {
  return document.querySelector("#templateActivationPanel");
}

function currentActivationSpaceId() {
  return globalThis.docomatorTemplateWizard?.spaceId() || "";
}

function clearActivationPolling() {
  activationPollToken += 1;
  if (activationPollTimer !== null) {
    clearTimeout(activationPollTimer);
    activationPollTimer = null;
  }
}

function clearActivationReload() {
  if (activationReloadTimer !== null) {
    clearTimeout(activationReloadTimer);
    activationReloadTimer = null;
  }
}

function activationFieldCountLabel(value) {
  const count = Number(value) || 0;
  const mod100 = count % 100;
  const mod10 = count % 10;
  const noun =
    mod100 >= 11 && mod100 <= 14
      ? "полей"
      : mod10 === 1
        ? "поле"
        : mod10 >= 2 && mod10 <= 4
          ? "поля"
          : "полей";
  return `${count} ${noun}`;
}

function activationVersionKindLabel(version) {
  return version?.versionKind === "multi"
    ? `полный набор · ${activationFieldCountLabel(version.fieldCount)}`
    : "одно поле";
}

function activationVersionLabel(version) {
  const base = `Версия ${version.versionNumber} · ${String(version.format || "").toUpperCase()}`;
  if (version.versionKind === "multi") {
    return `${base} · ${activationFieldCountLabel(version.fieldCount)}`;
  }
  return `${base} · ${version.renderedValue || "проверено одно поле"}`;
}

function createActivationPanel() {
  if (!activationView || activationPanel()) return;
  const panel = document.createElement("section");
  panel.id = "templateActivationPanel";
  panel.className = "template-activation-panel";
  panel.dataset.templateWizardPanel = "4";
  panel.innerHTML = `
    <article class="panel activation-card">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Готовность шаблона</p>
          <h2>Просмотрите документ и включите шаблон</h2>
          <p>Система создаст PDF в фоне. После просмотра отдельно подтвердите, что шаблон можно использовать.</p>
        </div>
        <span class="template-file-mark" aria-hidden="true">PDF</span>
      </div>
      <div class="activation-guidance">
        <span aria-hidden="true">ⓘ</span>
        <p>Операция сохраняется. Можно перейти в другой раздел или закрыть страницу: состояние останется в журнале и будет доступно после возвращения.</p>
      </div>
      <div id="templateActivationContent" class="activation-content" aria-live="polite">
        <div class="activation-state">
          <span aria-hidden="true">⏳</span>
          <div><strong>Получаем проверенные версии</strong><p>Ищем одно- и многополевые версии выбранного пространства.</p></div>
        </div>
      </div>
      <section class="activation-catalog">
        <div class="activation-catalog-heading">
          <div><p class="eyebrow">Каталог</p><h3>Активные шаблоны пространства</h3></div>
          <button class="secondary-button" id="activeTemplateRefresh" type="button">Обновить</button>
        </div>
        <div id="activeTemplateCatalog" aria-live="polite">
          <div class="activation-catalog-empty">Активные версии ещё не загружены.</div>
        </div>
      </section>
    </article>`;
  (document.querySelector("#templateWizardDynamicStages") || activationView).append(panel);
  panel
    .querySelector("#activeTemplateRefresh")
    ?.addEventListener("click", loadActiveTemplateCatalog);
}

function selectedActivationDraft() {
  const id = document.querySelector("#templateActivationDraft")?.value || "";
  return activationDrafts.find((draft) => draft.id === id) || null;
}

function selectedActivationVersion() {
  const id = document.querySelector("#templateActivationVersion")?.value || "";
  return activationVersions.find((version) => version.id === id) || null;
}

function previewErrorMessage(request) {
  const value = request?.error;
  if (value && typeof value === "object" && typeof value.message === "string") {
    return value.message;
  }
  return "Предварительный просмотр создать не удалось. Повторите действие или обратитесь к администратору.";
}

function previewStage(request) {
  if (request.workerJobState === "running") {
    return {
      title: "LibreOffice создаёт PDF",
      detail:
        "Документ открыт в отдельном временном профиле. После завершения сервер проверит PDF и его контрольную сумму."
    };
  }
  if (request.workerJobState === "retry") {
    return {
      title: "Ожидается следующая попытка",
      detail:
        "Фоновая операция сохранена. Новая попытка начнётся автоматически в указанное сервером время."
    };
  }
  return {
    title: "Задача поставлена в очередь",
    detail:
      "Фоновый обработчик ещё не начал преобразование. Можно продолжать работу в других разделах."
  };
}

function renderPreviewPending(data) {
  const holder = document.querySelector("#templateActivationStatus");
  if (!holder) return;
  const request = data.request;
  const stage = previewStage(request);
  holder.innerHTML = `
    <div class="activation-state is-pending" role="status">
      <span aria-hidden="true">⏳</span>
      <div>
        <strong>${activationEscape(stage.title)}</strong>
        <p>${activationEscape(stage.detail)}</p>
        <small>${activationEscape(activationVersionKindLabel(request))}. Попытка ${request.requestAttempt}. Идентификатор операции: <code>${activationEscape(request.correlationId)}</code>.</small>
      </div>
    </div>`;
}

function renderPreviewFailure(data, versionId) {
  const holder = document.querySelector("#templateActivationStatus");
  if (!holder) return;
  const request = data.request;
  holder.innerHTML = `
    <div class="activation-state is-error">
      <span aria-hidden="true">⚠️</span>
      <div>
        <strong>Предварительный просмотр не создан</strong>
        <p>${activationEscape(previewErrorMessage(request))}</p>
        <small>Пробно заполненная копия сохранена и не изменена. ${activationEscape(activationVersionKindLabel(request))}. Попытка ${request.requestAttempt}. Идентификатор операции: <code>${activationEscape(request.correlationId)}</code>.</small>
        <div class="activation-inline-actions">
          <button class="primary-button" id="templatePreviewRetry" type="button">Повторить создание PDF</button>
          <button class="secondary-button" id="templatePreviewRefresh" type="button">Обновить состояние</button>
        </div>
      </div>
    </div>`;
  holder
    .querySelector("#templatePreviewRetry")
    ?.addEventListener("click", () => requestTemplatePreview(versionId));
  holder
    .querySelector("#templatePreviewRefresh")
    ?.addEventListener("click", () => refreshPreviewState(request.id, versionId));
}

function renderPreviewReady(data) {
  const holder = document.querySelector("#templateActivationStatus");
  if (!holder) return;
  const request = data.request;
  const form = document.querySelector("#templateActivationForm");
  if (form) form.hidden = true;
  holder.innerHTML = `
    <article class="activation-ready">
      <div class="activation-ready-heading">
        <span aria-hidden="true">✅</span>
        <div>
          <strong>Предварительный просмотр готов</strong>
          <p>PDF проверен и сохранён по контрольной сумме. Просмотрите его перед активацией.</p>
        </div>
      </div>
      <iframe class="activation-preview-frame" src="${activationEscape(data.previewUrl)}" title="Предварительный просмотр шаблона"></iframe>
      <div class="activation-preview-actions">
        <a class="secondary-button" href="${activationEscape(data.previewUrl)}" target="_blank" rel="noopener">Открыть PDF отдельно</a>
        <label class="activation-confirmation">
          <input id="templateActivationConfirmed" type="checkbox" />
          <span><strong>Я просмотрел PDF</strong><small>Версия будет доступна пользователям пространства после отдельного подтверждения.</small></span>
        </label>
        <button class="primary-button" id="templateActivateButton" type="button" disabled>Активировать версию</button>
      </div>
      <details class="activation-technical">
        <summary>Технические сведения</summary>
        <dl>
          <div><dt>Состав версии</dt><dd>${activationEscape(activationVersionKindLabel(request))}</dd></div>
          <div><dt>Контрольная сумма PDF</dt><dd><code>${activationEscape(request.previewSha256)}</code></dd></div>
          <div><dt>Преобразователь</dt><dd>${activationEscape(request.converter?.converter || "LibreOffice")}</dd></div>
          <div><dt>Идентификатор операции</dt><dd><code>${activationEscape(request.correlationId)}</code></dd></div>
        </dl>
      </details>
    </article>`;
  const checkbox = holder.querySelector("#templateActivationConfirmed");
  const button = holder.querySelector("#templateActivateButton");
  checkbox?.addEventListener("change", () => {
    button.disabled = !checkbox.checked;
  });
  button?.addEventListener("click", () => activateTemplateVersion(request.id));
}

async function refreshPreviewState(requestId, versionId, token = null) {
  const spaceId = currentActivationSpaceId();
  if (!spaceId || !requestId) return;
  try {
    const body = await activationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-previews/${encodeURIComponent(requestId)}`
    );
    const data = body.data;
    if (data.request.state === "ready") {
      clearActivationPolling();
      renderPreviewReady(data);
      return;
    }
    if (data.request.state === "failed") {
      clearActivationPolling();
      renderPreviewFailure(data, versionId);
      return;
    }
    renderPreviewPending(data);
    const pollToken = token ?? ++activationPollToken;
    activationPollTimer = setTimeout(() => {
      if (pollToken === activationPollToken) {
        void refreshPreviewState(requestId, versionId, pollToken);
      }
    }, 1_500);
  } catch (error) {
    clearActivationPolling();
    const holder = document.querySelector("#templateActivationStatus");
    if (holder) {
      holder.innerHTML = `
        <div class="activation-state is-error">
          <span aria-hidden="true">⚠️</span>
          <div><strong>Состояние получить не удалось</strong><p>${activationEscape(error?.message || "Повторите действие.")}</p>${error?.operationId ? `<small>Идентификатор операции: <code>${activationEscape(error.operationId)}</code>.</small>` : ""}<button class="secondary-button" id="templatePreviewRefresh" type="button">Повторить</button></div>
        </div>`;
      holder
        .querySelector("#templatePreviewRefresh")
        ?.addEventListener("click", () => refreshPreviewState(requestId, versionId));
    }
  }
}

async function requestTemplatePreview(versionId = null) {
  if (activationBusy) return;
  const version =
    versionId === null
      ? selectedActivationVersion()
      : activationVersions.find((candidate) => candidate.id === versionId);
  const spaceId = currentActivationSpaceId();
  const holder = document.querySelector("#templateActivationStatus");
  const button = document.querySelector("#templatePreviewSubmit");
  if (!version || !spaceId || !holder) return;

  clearActivationPolling();
  clearActivationReload();
  activationBusy = true;
  if (button) button.disabled = true;
  holder.innerHTML = `
    <div class="activation-state is-pending" role="status">
      <span aria-hidden="true">⏳</span>
      <div><strong>Ставим задачу в очередь</strong><p>Сохраняем запрос, чтобы результат не потерялся при переходе на другую страницу.</p></div>
    </div>`;
  try {
    const versionCollection =
      version.versionKind === "multi"
        ? "template-multi-test-versions"
        : "template-test-versions";
    const body = await activationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/${versionCollection}/${encodeURIComponent(version.id)}/preview`,
      { method: "POST" }
    );
    await refreshPreviewState(body.data.request.id, version.id);
  } catch (error) {
    holder.innerHTML = `
      <div class="activation-state is-error">
        <span aria-hidden="true">⚠️</span>
        <div><strong>Задачу создать не удалось</strong><p>${activationEscape(error?.message || "Повторите действие.")}</p>${error?.operationId ? `<small>Идентификатор операции: <code>${activationEscape(error.operationId)}</code>.</small>` : ""}</div>
      </div>`;
    if (button) button.textContent = "Повторить создание PDF";
  } finally {
    activationBusy = false;
    if (button) button.disabled = false;
  }
}

async function activateTemplateVersion(requestId) {
  if (activationBusy) return;
  const spaceId = currentActivationSpaceId();
  const holder = document.querySelector("#templateActivationStatus");
  const button = document.querySelector("#templateActivateButton");
  if (!spaceId || !holder) return;
  clearActivationReload();
  activationBusy = true;
  if (button) button.disabled = true;
  const existing = holder.innerHTML;
  holder.insertAdjacentHTML(
    "afterbegin",
    `<div class="activation-state is-pending" id="templateActivationProgress" role="status"><span aria-hidden="true">⏳</span><div><strong>Активируем проверенную версию</strong><p>Фиксируем неизменяемый манифест и обновляем текущий указатель каталога.</p></div></div>`
  );
  try {
    const body = await activationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-previews/${encodeURIComponent(requestId)}/activate`,
      { method: "POST" }
    );
    const active = body.data.active;
    holder.innerHTML = `
      <div class="activation-state is-success">
        <span aria-hidden="true">✅</span>
        <div>
          <strong>Версия ${active.versionNumber} активирована</strong>
          <p>Шаблон «${activationEscape(active.title)}» появился в каталоге выбранного пространства: ${activationEscape(activationVersionKindLabel(active))}.</p>
          <div class="activation-inline-actions">
            <a class="secondary-button" href="${activationEscape(body.data.previewUrl)}">Скачать PDF</a>
            <a class="primary-button" href="${activationEscape(body.data.compiledUrl)}">Скачать активный шаблон</a>
          </div>
          <small>Идентификатор операции: <code>${activationEscape(body.correlationId)}</code>.</small>
        </div>
      </div>`;
    globalThis.docomatorTemplateWizard?.complete(4, {
      activeId: active.id
    });
    await loadActiveTemplateCatalog();
  } catch (error) {
    holder.innerHTML = existing;
    holder.insertAdjacentHTML(
      "afterbegin",
      `<div class="activation-state is-error"><span aria-hidden="true">⚠️</span><div><strong>Активация не выполнена</strong><p>${activationEscape(error?.message || "Повторите действие.")}</p>${error?.operationId ? `<small>Идентификатор операции: <code>${activationEscape(error.operationId)}</code>.</small>` : ""}</div></div>`
    );
    const retryButton = holder.querySelector("#templateActivateButton");
    const confirmation = holder.querySelector("#templateActivationConfirmed");
    if (retryButton && confirmation) retryButton.disabled = !confirmation.checked;
  } finally {
    activationBusy = false;
    document.querySelector("#templateActivationProgress")?.remove();
  }
}

async function loadActivationVersions() {
  clearActivationPolling();
  const content = document.querySelector("#templateActivationContent");
  const spaceId = currentActivationSpaceId();
  if (!content) return;
  if (!spaceId) {
    content.innerHTML = `
      <div class="activation-state"><span aria-hidden="true">🧑‍🤝‍🧑</span><div><strong>Выберите пространство</strong><p>Предварительный просмотр и активный каталог изолированы по пространствам.</p></div></div>`;
    return;
  }
  const existingForm = content.querySelector("#templateActivationForm");
  if (existingForm) {
    content.querySelector("#templateActivationReloadState")?.remove();
    content.insertAdjacentHTML(
      "afterbegin",
      `<div class="activation-state" id="templateActivationReloadState" role="status"><span aria-hidden="true">⏳</span><div><strong>Обновляем проверенные версии</strong><p>Текущий выбор сохранится, если сервер не ответит.</p></div></div>`
    );
  } else {
    content.innerHTML = `
      <div class="activation-state" role="status"><span aria-hidden="true">⏳</span><div><strong>Получаем проверенные версии</strong><p>Можно продолжать работу в других разделах.</p></div></div>`;
  }
  try {
    const draftBody = await activationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts?limit=100`
    );
    activationDrafts = Array.isArray(draftBody.data) ? draftBody.data : [];
    if (activationDrafts.length === 0) {
      content.innerHTML = `
        <div class="activation-state"><span aria-hidden="true">📭</span><div><strong>Нет черновиков</strong><p>Сначала сохраните исходник, поля и выполните пробное заполнение.</p></div></div>`;
      return;
    }
    content.innerHTML = `
      <form class="activation-form" id="templateActivationForm" novalidate>
        <div class="activation-form-grid">
          <label>
            <span>Черновик шаблона</span>
            <select id="templateActivationDraft">${activationDrafts
              .map((draft) => `<option value="${activationEscape(draft.id)}">${activationEscape(draft.title)}</option>`)
              .join("")}</select>
            <small>Показываются только черновики выбранного пространства.</small>
          </label>
          <label>
            <span>Проверенная версия</span>
            <select id="templateActivationVersion"></select>
            <small id="templateActivationVersionHint">Получаем одно- и многополевые версии.</small>
          </label>
        </div>
        <div class="activation-actions">
          <button class="primary-button" id="templatePreviewSubmit" type="submit">Создать предварительный просмотр</button>
          <p>LibreOffice работает в фоновом задании с отдельным временным профилем.</p>
        </div>
      </form>
      <div id="templateActivationStatus" class="activation-status">
        <div class="activation-state"><span aria-hidden="true">👁️</span><div><strong>Выберите проверенную версию</strong><p>После создания PDF здесь появится просмотр и кнопка активации.</p></div></div>
      </div>`;
    content
      .querySelector("#templateActivationDraft")
      ?.addEventListener("change", updateActivationVersionSelect);
    content
      .querySelector("#templateActivationForm")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();
        void requestTemplatePreview();
      });
    await updateActivationVersionSelect();
  } catch (error) {
    content.querySelector("#templateActivationReloadState")?.remove();
    const errorHtml = `<div class="activation-state is-error" id="templateActivationLoadError"><span aria-hidden="true">⚠️</span><div><strong>Проверенные версии получить не удалось</strong><p>${activationEscape(error?.message || "Повторите действие.")} Текущий выбор сохранён.</p>${error?.operationId ? `<small>Идентификатор операции: <code>${activationEscape(error.operationId)}</code>.</small>` : ""}<button class="secondary-button" id="templateActivationReload" type="button">Повторить</button></div></div>`;
    if (existingForm) {
      content.querySelector("#templateActivationLoadError")?.remove();
      content.insertAdjacentHTML("afterbegin", errorHtml);
    } else content.innerHTML = errorHtml;
    content
      .querySelector("#templateActivationReload")
      ?.addEventListener("click", loadActivationVersions);
  }
}

async function updateActivationVersionSelect() {
  clearActivationPolling();
  const draft = selectedActivationDraft();
  const versionSelect = document.querySelector("#templateActivationVersion");
  const hint = document.querySelector("#templateActivationVersionHint");
  const button = document.querySelector("#templatePreviewSubmit");
  if (!draft || !versionSelect || !hint || !button) return;
  versionSelect.disabled = true;
  button.disabled = true;
  hint.textContent = "Получаем одно- и многополевые проверенные версии…";
  try {
    const base = `/api/v1/spaces/${encodeURIComponent(currentActivationSpaceId())}/template-drafts/${encodeURIComponent(draft.id)}`;
    const [singleBody, multiBody] = await Promise.all([
      activationFetchJson(`${base}/test-versions?limit=100`),
      activationFetchJson(`${base}/multi-test-versions?limit=100`)
    ]);
    const singleVersions = Array.isArray(singleBody.data)
      ? singleBody.data.map((version) => ({
          ...version,
          versionKind: "single",
          fieldCount: 1
        }))
      : [];
    const multiVersions = Array.isArray(multiBody.data)
      ? multiBody.data.map((version) => ({
          ...version,
          versionKind: "multi"
        }))
      : [];
    activationVersions = [...singleVersions, ...multiVersions].sort(
      (left, right) =>
        Number(right.versionNumber) - Number(left.versionNumber) ||
        String(left.versionKind).localeCompare(String(right.versionKind), "ru")
    );
    versionSelect.innerHTML = activationVersions
      .map(
        (version) =>
          `<option value="${activationEscape(version.id)}">${activationEscape(activationVersionLabel(version))}</option>`
      )
      .join("");
    if (activationVersions.length === 0) {
      hint.textContent =
        "У этого черновика нет проверенных версий. Выполните пробное заполнение одного поля или полного набора.";
      return;
    }
    const multiCount = multiVersions.length;
    hint.textContent =
      multiCount > 0
        ? `Доступно многополевых версий: ${multiCount}. Можно также выбрать прежнюю одно-полевую проверку.`
        : "Доступны одно-полевые версии. Для обычного документа проверьте полный набор полей на шаге выше.";
    versionSelect.disabled = false;
    button.disabled = false;
  } catch (error) {
    activationVersions = [];
    versionSelect.innerHTML = "";
    hint.innerHTML = `${activationEscape(error?.message || "Историю получить не удалось.")}${error?.operationId ? ` Идентификатор операции: <code>${activationEscape(error.operationId)}</code>.` : ""} <button class="quiet-button compact" id="templateActivationVersionRetry" type="button">Повторить</button>`;
    hint
      .querySelector("#templateActivationVersionRetry")
      ?.addEventListener("click", updateActivationVersionSelect);
  }
}

async function loadActiveTemplateCatalog() {
  const holder = document.querySelector("#activeTemplateCatalog");
  const spaceId = currentActivationSpaceId();
  if (!holder) return;
  if (!spaceId) {
    holder.innerHTML = `<div class="activation-catalog-empty">Выберите пространство.</div>`;
    return;
  }
  holder.innerHTML = `<div class="activation-catalog-empty">Получаем активные шаблоны…</div>`;
  try {
    const body = await activationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/active-templates`
    );
    const templates = Array.isArray(body.data) ? body.data : [];
    if (templates.length === 0) {
      holder.innerHTML = `<div class="activation-catalog-empty">В этом пространстве пока нет активных шаблонов.</div>`;
      return;
    }
    holder.innerHTML = templates
      .map(
        (template) => `
          <article class="activation-catalog-item">
            <div>
              <span class="pill pill-success">Активен</span>
              <strong>${activationEscape(template.title)}</strong>
              <p>Версия ${template.versionNumber} · ${template.format.toUpperCase()} · ${activationEscape(activationVersionKindLabel(template))} · активирована ${activationEscape(new Date(template.activatedAt).toLocaleString("ru-RU"))}</p>
            </div>
            <div class="activation-catalog-actions">
              <a href="/api/v1/spaces/${encodeURIComponent(spaceId)}/active-templates/${encodeURIComponent(template.id)}/files/preview">PDF</a>
              <a href="/api/v1/spaces/${encodeURIComponent(spaceId)}/active-templates/${encodeURIComponent(template.id)}/files/compiled">Шаблон</a>
            </div>
          </article>`
      )
      .join("");
  } catch (error) {
    holder.innerHTML = `<div class="activation-catalog-empty is-error"><p>${activationEscape(error?.message || "Каталог получить не удалось.")}</p>${error?.operationId ? `<small>Идентификатор операции: <code>${activationEscape(error.operationId)}</code>.</small>` : ""}<button class="secondary-button" id="activeTemplateCatalogRetry" type="button">Повторить</button></div>`;
    holder
      .querySelector("#activeTemplateCatalogRetry")
      ?.addEventListener("click", loadActiveTemplateCatalog);
  }
}

function scheduleActivationReload() {
  clearActivationReload();
  activationReloadTimer = setTimeout(() => {
    activationReloadTimer = null;
    if (activationBusy) {
      scheduleActivationReload();
      return;
    }
    if (!globalThis.docomatorTemplateWizard?.isComplete(4)) {
      void loadActivationVersions();
    }
    void loadActiveTemplateCatalog();
  }, 500);
}

function bindActivationSpaceSelect() {
  const candidate = document.querySelector("#documentQuarantineSpace");
  if (!candidate || candidate === activationSpaceSelect) return;
  activationSpaceSelect = candidate;
  activationSpaceSelect.addEventListener("change", () => {
    clearActivationPolling();
    void loadActivationVersions();
    void loadActiveTemplateCatalog();
  });
  void loadActivationVersions();
  void loadActiveTemplateCatalog();
}

function activationSuccessMarker() {
  return [
    document.querySelector("#templateTrialMessage")?.classList.contains("is-success")
      ? document.querySelector("#templateTrialMessage")?.textContent?.trim() || ""
      : "",
    document
      .querySelector("#templateMultiTrialMessage")
      ?.classList.contains("is-success")
      ? document.querySelector("#templateMultiTrialMessage")?.textContent?.trim() || ""
      : "",
    document.querySelector("#documentFieldMessage")?.classList.contains("is-success")
      ? document.querySelector("#documentFieldMessage")?.textContent?.trim() || ""
      : ""
  ]
    .filter(Boolean)
    .join("|");
}

if (activationView) {
  createActivationPanel();
  bindActivationSpaceSelect();
  new MutationObserver(() => {
    bindActivationSpaceSelect();
    const marker = activationSuccessMarker();
    if (marker === "") {
      activationSourceMarker = "";
      return;
    }
    if (marker !== activationSourceMarker) {
      activationSourceMarker = marker;
      scheduleActivationReload();
    }
  }).observe(activationView, { childList: true, subtree: true, attributes: true });
  window.addEventListener("beforeunload", () => {
    clearActivationPolling();
    clearActivationReload();
  });
}
