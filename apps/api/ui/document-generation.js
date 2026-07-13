const generationView = document.querySelector('[data-view="templates"]');

let generationSpaceSelect = null;
let generationTemplates = [];
let generationGroups = [];
let generationEntities = [];
let generationJobs = [];
let generationBusy = false;
let generationPollTimer = null;
let generationPollToken = 0;
let generationReloadTimer = null;
let generationReloadMarker = "";

function generationEscape(value) {
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

async function generationFetchJson(url, options = {}) {
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

function generationPanel() {
  return document.querySelector("#documentGenerationPanel");
}

function currentGenerationSpaceId() {
  return generationSpaceSelect?.value || "";
}

function clearGenerationPolling() {
  generationPollToken += 1;
  if (generationPollTimer !== null) {
    clearTimeout(generationPollTimer);
    generationPollTimer = null;
  }
}

function generationModeLabel(mode) {
  return mode === "aggregate"
    ? "Один сводный документ"
    : "Отдельный документ на каждого";
}

function generationStateLabel(state) {
  return (
    {
      pending: "Ожидает выполнения",
      running: "Формируется",
      completed: "Готово",
      partial: "Готово частично",
      failed: "Ошибка"
    }[state] || "Неизвестное состояние"
  );
}

function generationStateClass(state) {
  if (state === "completed") return "is-success";
  if (state === "partial") return "is-warning";
  if (state === "failed") return "is-error";
  return "is-pending";
}

function generationStateEmoji(state) {
  if (state === "completed") return "✅";
  if (state === "partial") return "⚠️";
  if (state === "failed") return "⛔";
  return "⏳";
}

function createGenerationPanel() {
  if (!generationView || generationPanel()) return;
  const panel = document.createElement("section");
  panel.id = "documentGenerationPanel";
  panel.className = "document-generation-panel";
  panel.innerHTML = `
    <article class="panel generation-card">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Шаг 5 · рабочие документы</p>
          <h2>Сформировать документы для участников</h2>
          <p>Выберите активный шаблон и состав. Система создаст либо один сводный файл, либо отдельный файл для каждого участника.</p>
        </div>
        <span class="large-emoji" aria-hidden="true">📄</span>
      </div>
      <div class="generation-guidance">
        <span aria-hidden="true">ⓘ</span>
        <p><strong>Вариативный выпуск.</strong> Индивидуальный режим сохраняет оформление активного шаблона. Сводный режим создаёт одну таблицу, где строки — участники, а столбцы — поля шаблона.</p>
      </div>
      <div id="documentGenerationContent" class="generation-content" aria-live="polite">
        <div class="generation-state"><span aria-hidden="true">⏳</span><div><strong>Получаем данные для запуска</strong><p>Загружаем активные шаблоны, группы и участников выбранного пространства.</p></div></div>
      </div>
      <section class="generation-history">
        <div class="generation-history-heading">
          <div><p class="eyebrow">Результаты</p><h3>Последние задания формирования</h3></div>
          <button class="secondary-button" id="generationHistoryRefresh" type="button">Обновить</button>
        </div>
        <div id="documentGenerationHistory" class="generation-history-list" aria-live="polite">
          <div class="generation-history-empty">История ещё не загружена.</div>
        </div>
      </section>
    </article>`;
  generationView.append(panel);
  panel
    .querySelector("#generationHistoryRefresh")
    ?.addEventListener("click", loadGenerationHistory);
}

function selectedGenerationTemplate() {
  const id = document.querySelector("#generationTemplate")?.value || "";
  return generationTemplates.find((template) => template.id === id) || null;
}

function currentGenerationMode() {
  return (
    document.querySelector('input[name="generationMode"]:checked')?.value ||
    "one_per_member"
  );
}

function currentGenerationSourceKind() {
  return document.querySelector("#generationSourceKind")?.value || "all_space";
}

function selectedEntityIds() {
  const select = document.querySelector("#generationSelectedEntities");
  if (!select) return [];
  return [...select.selectedOptions].map((option) => option.value);
}

function renderGenerationSourceDetails() {
  const holder = document.querySelector("#generationSourceDetails");
  if (!holder) return;
  const kind = currentGenerationSourceKind();
  if (kind === "group") {
    if (generationGroups.length === 0) {
      holder.innerHTML = `
        <span>Сохранённая группа</span>
        <div class="generation-state is-warning"><span aria-hidden="true">⚠️</span><div><strong>Групп пока нет</strong><p>Создайте группу в разделе «Пространства» либо выберите всех активных или отмеченных участников.</p></div></div>`;
      updateGenerationEstimate();
      return;
    }
    holder.innerHTML = `
      <span>Сохранённая группа</span>
      <select id="generationGroup">${generationGroups
        .filter((group) => group.status === "active")
        .map(
          (group) =>
            `<option value="${generationEscape(group.id)}">${generationEscape(group.name)} · ${group.memberCount} участников</option>`
        )
        .join("")}</select>
      <small>Состав будет зафиксирован неизменяемым снимком в момент запуска.</small>`;
    holder
      .querySelector("#generationGroup")
      ?.addEventListener("change", updateGenerationEstimate);
  } else if (kind === "selected") {
    if (generationEntities.length === 0) {
      holder.innerHTML = `
        <span>Отмеченные участники</span>
        <div class="generation-state is-warning"><span aria-hidden="true">⚠️</span><div><strong>Активных участников нет</strong><p>Добавьте участников в выбранное пространство.</p></div></div>`;
      updateGenerationEstimate();
      return;
    }
    holder.innerHTML = `
      <span>Отмеченные участники</span>
      <select id="generationSelectedEntities" multiple aria-describedby="generationSelectedHint">${generationEntities
        .map(
          (entity) =>
            `<option value="${generationEscape(entity.entityId)}">${generationEscape(entity.displayName)} · ${generationEscape(entity.entityTypeLabel || entity.entityTypeKey)}</option>`
        )
        .join("")}</select>
      <div class="generation-selected-count" id="generationSelectedCount">Выбрано: 0</div>
      <small id="generationSelectedHint">Удерживайте Ctrl или Command для выбора нескольких строк.</small>`;
    holder
      .querySelector("#generationSelectedEntities")
      ?.addEventListener("change", () => {
        const counter = document.querySelector("#generationSelectedCount");
        if (counter) counter.textContent = `Выбрано: ${selectedEntityIds().length}`;
        updateGenerationEstimate();
      });
  } else {
    holder.innerHTML = `
      <span>Все активные участники</span>
      <p>В снимок войдут все активные участники пространства в устойчивом порядке по имени.</p>
      <div class="generation-selected-count">Найдено: ${generationEntities.length}</div>`;
  }
  updateGenerationEstimate();
}

function estimatedMemberCount() {
  const kind = currentGenerationSourceKind();
  if (kind === "selected") return selectedEntityIds().length;
  if (kind === "group") {
    const groupId = document.querySelector("#generationGroup")?.value || "";
    return generationGroups.find((group) => group.id === groupId)?.memberCount ?? 0;
  }
  return generationEntities.length;
}

function updateGenerationEstimate() {
  const holder = document.querySelector("#generationEstimate");
  const button = document.querySelector("#generationSubmit");
  if (!holder || !button) return;
  const template = selectedGenerationTemplate();
  const members = estimatedMemberCount();
  const mode = currentGenerationMode();
  const documents = mode === "aggregate" ? (members > 0 ? 1 : 0) : members;
  if (!template) {
    holder.className = "generation-mode-note is-warning";
    holder.innerHTML = `<span aria-hidden="true">⚠️</span><div><strong>Нет активного шаблона</strong><p>Сначала активируйте проверенную версию на шаге выше.</p></div>`;
    button.disabled = true;
    return;
  }
  if (members === 0) {
    holder.className = "generation-mode-note is-warning";
    holder.innerHTML = `<span aria-hidden="true">⚠️</span><div><strong>Состав пуст</strong><p>Выберите хотя бы одного активного участника.</p></div>`;
    button.disabled = true;
    return;
  }
  holder.className = "generation-mode-note";
  holder.innerHTML = `
    <span aria-hidden="true">📋</span>
    <div>
      <strong>Будет сформировано файлов: ${documents}</strong>
      <p>Участников: ${members}. Полей шаблона: ${template.fieldCount}. Режим: ${generationEscape(generationModeLabel(mode))}.</p>
    </div>`;
  button.disabled = false;
}

function renderGenerationWorkspace() {
  const content = document.querySelector("#documentGenerationContent");
  if (!content) return;
  if (generationTemplates.length === 0) {
    content.innerHTML = `
      <div class="generation-state is-warning"><span aria-hidden="true">📭</span><div><strong>Нет активных шаблонов</strong><p>Подготовьте многополевую версию, просмотрите PDF и активируйте её. После этого здесь появится рабочий запуск.</p></div></div>`;
    return;
  }
  content.innerHTML = `
    <form class="generation-form" id="documentGenerationForm" novalidate>
      <div class="generation-form-grid">
        <label class="generation-field">
          <span>Активный шаблон</span>
          <select id="generationTemplate">${generationTemplates
            .map(
              (template) =>
                `<option value="${generationEscape(template.id)}">${generationEscape(template.title)} · ${String(template.format).toUpperCase()} · ${template.fieldCount} полей</option>`
            )
            .join("")}</select>
          <small>Используется текущая активная версия из каталога пространства.</small>
        </label>
        <label class="generation-field">
          <span>Кого включить</span>
          <select id="generationSourceKind">
            <option value="all_space">Всех активных участников</option>
            <option value="group">Сохранённую группу</option>
            <option value="selected">Отмеченных вручную</option>
          </select>
          <small>Состав фиксируется снимком и не меняется вслед за группой.</small>
        </label>
        <div class="generation-source-details" id="generationSourceDetails"></div>
      </div>
      <fieldset class="generation-field">
        <legend>Режим формирования</legend>
        <div class="generation-mode-options">
          <label class="generation-mode-option">
            <input type="radio" name="generationMode" value="one_per_member" checked />
            <span><strong>Отдельный документ на каждого</strong><small>Для каждого участника создаётся собственная копия активного шаблона с его значениями. Результат нескольких файлов скачивается комплектом ZIP.</small></span>
          </label>
          <label class="generation-mode-option">
            <input type="radio" name="generationMode" value="aggregate" />
            <span><strong>Один сводный документ</strong><small>Создаётся один DOCX или XLSX: одна строка на участника, столбцы соответствуют полям активного шаблона.</small></span>
          </label>
        </div>
      </fieldset>
      <div class="generation-mode-note" id="generationEstimate"></div>
      <div class="generation-actions">
        <button class="primary-button" id="generationSubmit" type="submit">Сформировать документы</button>
        <p id="generationFormMessage">Обязательные поля берутся из актуальных данных каждого участника. Ошибка одного участника не блокирует остальные индивидуальные файлы.</p>
      </div>
    </form>
    <div id="documentGenerationStatus" class="generation-status"></div>`;
  content
    .querySelector("#generationSourceKind")
    ?.addEventListener("change", renderGenerationSourceDetails);
  content
    .querySelector("#generationTemplate")
    ?.addEventListener("change", updateGenerationEstimate);
  content.querySelectorAll('input[name="generationMode"]').forEach((radio) =>
    radio.addEventListener("change", updateGenerationEstimate)
  );
  content
    .querySelector("#documentGenerationForm")
    ?.addEventListener("submit", submitGenerationJob);
  renderGenerationSourceDetails();
}

function generationSourcePayload() {
  const kind = currentGenerationSourceKind();
  if (kind === "group") {
    const groupId = document.querySelector("#generationGroup")?.value || "";
    if (!groupId) throw new Error("Выберите сохранённую группу.");
    return { kind: "group", groupId };
  }
  if (kind === "selected") {
    const entityIds = selectedEntityIds();
    if (entityIds.length === 0) throw new Error("Отметьте хотя бы одного участника.");
    return { kind: "selected", entityIds };
  }
  return { kind: "all_space" };
}

function newGenerationKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `generation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function submitGenerationJob(event) {
  event.preventDefault();
  if (generationBusy) return;
  const template = selectedGenerationTemplate();
  const spaceId = currentGenerationSpaceId();
  const status = document.querySelector("#documentGenerationStatus");
  const button = document.querySelector("#generationSubmit");
  const message = document.querySelector("#generationFormMessage");
  if (!template || !spaceId || !status || !button || !message) return;

  let source;
  try {
    source = generationSourcePayload();
  } catch (error) {
    message.textContent = error?.message || "Проверьте состав участников.";
    message.className = "is-error";
    return;
  }

  generationBusy = true;
  button.disabled = true;
  message.className = "is-loading";
  message.textContent = "Фиксируем состав и создаём сохраняемое задание формирования.";
  status.innerHTML = `
    <div class="generation-state is-pending" role="status"><span aria-hidden="true">⏳</span><div><strong>Создаём задание</strong><p>Выбранный состав будет сохранён неизменяемым снимком.</p></div></div>`;
  try {
    const snapshotBody = await generationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/audience-snapshots`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source,
          targetMode: currentGenerationMode()
        })
      }
    );
    const snapshot = snapshotBody.data.snapshot;
    const jobBody = await generationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/document-jobs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activeReleaseId: template.id,
          snapshotId: snapshot.id,
          idempotencyKey: newGenerationKey()
        })
      }
    );
    message.className = "is-success";
    message.textContent = `Задание создано. Участников: ${snapshot.memberCount}; ожидается файлов: ${jobBody.data.job.expectedCount}.`;
    await pollGenerationJob(jobBody.data.job.id);
  } catch (error) {
    message.className = "is-error";
    message.textContent = "Задание не создано. Выбранные параметры остались в форме.";
    status.innerHTML = `
      <div class="generation-state is-error"><span aria-hidden="true">⛔</span><div><strong>Запуск не выполнен</strong><p>${generationEscape(error?.message || "Повторите действие.")}</p>${error?.operationId ? `<small>Идентификатор операции: <code>${generationEscape(error.operationId)}</code>.</small>` : ""}</div></div>`;
  } finally {
    generationBusy = false;
    button.disabled = false;
  }
}

function outputUrl(job, unit) {
  return `/api/v1/spaces/${encodeURIComponent(job.spaceId)}/document-jobs/${encodeURIComponent(job.id)}/outputs/${encodeURIComponent(unit.id)}`;
}

function unitErrorMessage(unit) {
  const value = unit?.error;
  if (value && typeof value === "object" && typeof value.message === "string") {
    return value.message;
  }
  return "Документ для этой строки сформировать не удалось.";
}

function renderGenerationJob(payload) {
  const holder = document.querySelector("#documentGenerationStatus");
  if (!holder) return;
  const job = payload.job;
  const progress =
    job.expectedCount > 0
      ? Math.min(100, Math.round(((job.generatedCount + job.failedCount) / job.expectedCount) * 100))
      : 0;
  const readyOutputs = job.units.filter((unit) => unit.state === "completed");
  const failedOutputs = job.units.filter((unit) => unit.state === "failed");
  const finished = ["completed", "partial", "failed"].includes(job.state);
  holder.innerHTML = `
    <article class="generation-summary ${generationStateClass(job.state)}">
      <span aria-hidden="true">${generationStateEmoji(job.state)}</span>
      <div>
        <span class="generation-state-code">${generationEscape(generationStateLabel(job.state))}</span>
        <strong>${generationEscape(job.templateTitle)}</strong>
        <p>${generationEscape(generationModeLabel(job.targetMode))}. Участников: ${job.memberCount}.</p>
      </div>
    </article>
    <div class="generation-progress-grid">
      <div class="generation-progress-item"><span>Ожидается файлов</span><strong>${job.expectedCount}</strong></div>
      <div class="generation-progress-item"><span>Готово</span><strong>${job.generatedCount}</strong></div>
      <div class="generation-progress-item"><span>С ошибкой</span><strong>${job.failedCount}</strong></div>
      <div class="generation-progress-item"><span>Выполнение</span><strong>${progress}%</strong></div>
    </div>
    <div class="generation-progress-bar" aria-label="Выполнение ${progress}%"><span style="--progress: ${progress}%"></span></div>
    ${payload.downloadUrl ? `<div class="generation-downloads"><a class="primary-button" href="${generationEscape(payload.downloadUrl)}">${job.archiveSha256 ? "Скачать комплект ZIP" : "Скачать готовый документ"}</a></div>` : ""}
    ${readyOutputs.length > 0 ? `
      <section class="generation-output-list">
        <div><p class="eyebrow">Готовые файлы</p></div>
        ${readyOutputs
          .slice(0, 100)
          .map(
            (unit) => `
              <article class="generation-output-item">
                <div><strong>${generationEscape(unit.outputName || `Документ ${unit.position + 1}`)}</strong><span>${unit.primaryEntityId ? `Участник ${generationEscape(unit.primaryEntityId)}` : "Сводный результат"}</span></div>
                <div class="generation-output-actions"><a href="${generationEscape(outputUrl(job, unit))}">Скачать</a></div>
              </article>`
          )
          .join("")}
        ${readyOutputs.length > 100 ? `<div class="generation-history-empty">Показаны первые 100 файлов. Полный комплект доступен по кнопке выше.</div>` : ""}
      </section>` : ""}
    ${failedOutputs.length > 0 ? `
      <section class="generation-error-list">
        <div><p class="eyebrow">Требуют внимания</p></div>
        ${failedOutputs
          .slice(0, 100)
          .map(
            (unit) => `
              <article class="generation-error-item"><div><strong>Строка ${unit.position + 1}</strong><span>${generationEscape(unitErrorMessage(unit))}</span></div></article>`
          )
          .join("")}
      </section>` : ""}
    ${!finished ? `<div class="generation-state is-pending"><span aria-hidden="true">⏳</span><div><strong>Фоновое формирование продолжается</strong><p>Можно уйти со страницы. Задание и готовые файлы сохраняются в системе.</p></div></div>` : ""}`;
}

async function pollGenerationJob(jobId, token = null) {
  const spaceId = currentGenerationSpaceId();
  if (!spaceId || !jobId) return;
  const pollToken = token ?? ++generationPollToken;
  try {
    const body = await generationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/document-jobs/${encodeURIComponent(jobId)}`
    );
    renderGenerationJob(body.data);
    const state = body.data.job.state;
    if (["completed", "partial", "failed"].includes(state)) {
      clearGenerationPolling();
      await loadGenerationHistory();
      return;
    }
    generationPollTimer = setTimeout(() => {
      if (pollToken === generationPollToken) void pollGenerationJob(jobId, pollToken);
    }, 1_500);
  } catch (error) {
    clearGenerationPolling();
    const holder = document.querySelector("#documentGenerationStatus");
    if (holder) {
      holder.innerHTML = `
        <div class="generation-state is-error"><span aria-hidden="true">⚠️</span><div><strong>Состояние задания получить не удалось</strong><p>${generationEscape(error?.message || "Повторите действие.")}</p><button class="secondary-button" id="generationPollRetry" type="button">Повторить</button></div></div>`;
      holder
        .querySelector("#generationPollRetry")
        ?.addEventListener("click", () => pollGenerationJob(jobId));
    }
  }
}

function renderGenerationHistory(items) {
  const holder = document.querySelector("#documentGenerationHistory");
  if (!holder) return;
  if (!Array.isArray(items) || items.length === 0) {
    holder.innerHTML = `<div class="generation-history-empty">Заданий формирования пока нет.</div>`;
    return;
  }
  holder.innerHTML = items
    .map(({ job, downloadUrl }) => `
      <article class="generation-history-item">
        <div>
          <span class="generation-state-code">${generationEscape(generationStateLabel(job.state))}</span>
          <strong>${generationEscape(job.templateTitle)}</strong>
          <span>${generationEscape(generationModeLabel(job.targetMode))} · готово ${job.generatedCount} из ${job.expectedCount} · ${generationEscape(new Date(job.createdAt).toLocaleString("ru-RU"))}</span>
        </div>
        <div class="generation-history-actions">
          <button class="secondary-button" type="button" data-open-generation-job="${generationEscape(job.id)}">Открыть</button>
          ${downloadUrl ? `<a href="${generationEscape(downloadUrl)}">Скачать</a>` : ""}
        </div>
      </article>`)
    .join("");
  holder.querySelectorAll("[data-open-generation-job]").forEach((button) =>
    button.addEventListener("click", () => {
      const jobId = button.dataset.openGenerationJob;
      if (jobId) {
        generationPanel()?.scrollIntoView({ behavior: "smooth", block: "start" });
        void pollGenerationJob(jobId);
      }
    })
  );
}

async function loadGenerationHistory() {
  const holder = document.querySelector("#documentGenerationHistory");
  const spaceId = currentGenerationSpaceId();
  if (!holder) return;
  if (!spaceId) {
    holder.innerHTML = `<div class="generation-history-empty">Выберите пространство.</div>`;
    return;
  }
  holder.innerHTML = `<div class="generation-history-empty">Получаем историю…</div>`;
  try {
    const body = await generationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/document-jobs?limit=50`
    );
    generationJobs = Array.isArray(body.data) ? body.data : [];
    renderGenerationHistory(generationJobs);
  } catch (error) {
    holder.innerHTML = `<div class="generation-history-empty is-error">${generationEscape(error?.message || "Историю получить не удалось.")}</div>`;
  }
}

async function loadGenerationWorkspace() {
  createGenerationPanel();
  clearGenerationPolling();
  const content = document.querySelector("#documentGenerationContent");
  const spaceId = currentGenerationSpaceId();
  if (!content) return;
  if (!spaceId) {
    content.innerHTML = `<div class="generation-state"><span aria-hidden="true">🧑‍🤝‍🧑</span><div><strong>Выберите пространство</strong><p>Шаблоны, участники и задания изолированы по пространствам.</p></div></div>`;
    await loadGenerationHistory();
    return;
  }
  content.innerHTML = `<div class="generation-state" role="status"><span aria-hidden="true">⏳</span><div><strong>Получаем данные для запуска</strong><p>Можно продолжать работу в других разделах.</p></div></div>`;
  try {
    const [templatesBody, groupsBody, entitiesBody] = await Promise.all([
      generationFetchJson(
        `/api/v1/spaces/${encodeURIComponent(spaceId)}/active-templates`
      ),
      generationFetchJson(
        `/api/v1/spaces/${encodeURIComponent(spaceId)}/groups?limit=200`
      ),
      generationFetchJson(
        `/api/v1/spaces/${encodeURIComponent(spaceId)}/entities?status=active&limit=1000`
      )
    ]);
    generationTemplates = Array.isArray(templatesBody.data)
      ? templatesBody.data
      : [];
    generationGroups = Array.isArray(groupsBody.data) ? groupsBody.data : [];
    generationEntities = Array.isArray(entitiesBody.data)
      ? entitiesBody.data
      : [];
    renderGenerationWorkspace();
  } catch (error) {
    content.innerHTML = `
      <div class="generation-state is-error"><span aria-hidden="true">⚠️</span><div><strong>Данные для запуска получить не удалось</strong><p>${generationEscape(error?.message || "Повторите действие.")}</p><button class="secondary-button" id="generationWorkspaceRetry" type="button">Повторить</button></div></div>`;
    content
      .querySelector("#generationWorkspaceRetry")
      ?.addEventListener("click", loadGenerationWorkspace);
  }
  await loadGenerationHistory();
}

function scheduleGenerationReload() {
  if (generationReloadTimer !== null) clearTimeout(generationReloadTimer);
  generationReloadTimer = setTimeout(() => {
    generationReloadTimer = null;
    void loadGenerationWorkspace();
  }, 500);
}

function bindGenerationSpaceSelect() {
  const candidate = document.querySelector("#documentQuarantineSpace");
  if (!candidate || candidate === generationSpaceSelect) return;
  generationSpaceSelect = candidate;
  generationSpaceSelect.addEventListener("change", loadGenerationWorkspace);
  void loadGenerationWorkspace();
}

function generationSourceMarker() {
  return [
    document.querySelector("#templateActivationStatus")?.textContent?.includes("активирована")
      ? document.querySelector("#templateActivationStatus")?.textContent?.trim() || ""
      : "",
    document.querySelector("#spaceAudienceMessage")?.classList.contains("is-success")
      ? document.querySelector("#spaceAudienceMessage")?.textContent?.trim() || ""
      : ""
  ]
    .filter(Boolean)
    .join("|");
}

if (generationView) {
  createGenerationPanel();
  bindGenerationSpaceSelect();
  new MutationObserver(() => {
    bindGenerationSpaceSelect();
    const marker = generationSourceMarker();
    if (marker === "") {
      generationReloadMarker = "";
    } else if (marker !== generationReloadMarker) {
      generationReloadMarker = marker;
      scheduleGenerationReload();
    }
  }).observe(generationView, { childList: true, subtree: true, attributes: true });
  window.addEventListener("beforeunload", clearGenerationPolling);
}
