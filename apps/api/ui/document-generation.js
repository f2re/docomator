const generationView =
  document.querySelector('[data-view="generation"]') ||
  document.querySelector('[data-view="templates"]');

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
let generationAutoOpenJobId = null;

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

function setGenerationStep(activeStep) {
  document.querySelectorAll(".generation-step-rail li").forEach((item, index) => {
    const current = index + 1 === activeStep;
    const complete = index + 1 < activeStep;
    item.classList.toggle("is-current", current);
    item.classList.toggle("is-complete", complete);
    if (current) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  });
}

function currentGenerationSpaceId() {
  return globalThis.docomatorCurrentSpaceId || generationSpaceSelect?.value || "";
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
    <article class="generation-card">
      <div class="generation-heading">
        <div>
          <p class="eyebrow">Новый выпуск</p>
          <h2>Создать документы</h2>
          <p>Выберите шаблон и сотрудников. До запуска система покажет точное число файлов и проверит обязательные данные.</p>
        </div>
      </div>
      <ol class="generation-step-rail" aria-label="Этапы создания документов">
        <li class="is-current"><span>1</span><strong>Шаблон</strong></li>
        <li><span>2</span><strong>Сотрудники</strong></li>
        <li><span>3</span><strong>Проверка</strong></li>
        <li><span>4</span><strong>Результат</strong></li>
      </ol>
      <div id="documentGenerationContent" class="generation-content" aria-live="polite">
        <div class="generation-state"><div><strong>Готовим форму выпуска</strong><p>Получаем шаблоны и сотрудников выбранного раздела.</p></div></div>
      </div>
      <section class="generation-history">
        <div class="generation-history-heading">
          <div><p class="eyebrow">Недавние запуски</p><h3>Последние выпуски</h3></div>
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

function generationTemplateHasRepeat(template) {
  return Array.isArray(template?.manifest?.repeats) && template.manifest.repeats.length > 0;
}

function syncGenerationTemplateMode() {
  const template = selectedGenerationTemplate();
  const personal = document.querySelector(
    'input[name="generationMode"][value="one_per_member"]'
  );
  const aggregate = document.querySelector(
    'input[name="generationMode"][value="aggregate"]'
  );
  const hint = document.querySelector("#generationModeHint");
  if (!personal || !aggregate) return;
  const repeat = generationTemplateHasRepeat(template);
  personal.disabled = repeat;
  if (repeat) aggregate.checked = true;
  if (hint) {
    hint.textContent = repeat
      ? "Этот шаблон содержит повторяемую строку сотрудников и создаёт один сводный документ."
      : "Выберите отдельные документы или один сводный результат.";
  }
  updateGenerationEstimate();
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
  return [
    ...document.querySelectorAll(
      '#generationSelectedEntities input[type="checkbox"]:checked'
    )
  ].map((input) => input.value);
}

function renderGenerationSourceDetails() {
  const holder = document.querySelector("#generationSourceDetails");
  if (!holder) return;
  const kind = currentGenerationSourceKind();
  if (kind === "group") {
    if (generationGroups.length === 0) {
      holder.innerHTML = `
        <span>Группа сотрудников</span>
        <div class="generation-state is-warning"><div><strong>Групп пока нет</strong><p>Выберите всех сотрудников или отметьте нужных вручную.</p></div></div>`;
      updateGenerationEstimate();
      return;
    }
    holder.innerHTML = `
      <span>Группа сотрудников</span>
      <select id="generationGroup">${generationGroups
        .filter((group) => group.status === "active")
        .map(
          (group) =>
            `<option value="${generationEscape(group.id)}">${generationEscape(group.name)} · ${group.memberCount} сотрудников</option>`
        )
        .join("")}</select>
      <small>Состав группы сохранится для этого выпуска и не изменится после запуска.</small>`;
    holder
      .querySelector("#generationGroup")
      ?.addEventListener("change", updateGenerationEstimate);
  } else if (kind === "selected") {
    if (generationEntities.length === 0) {
      holder.innerHTML = `
        <span>Отдельные сотрудники</span>
        <div class="generation-state is-warning"><div><strong>Сотрудников пока нет</strong><p>Добавьте сотрудников в выбранный раздел.</p></div></div>`;
      updateGenerationEstimate();
      return;
    }
    holder.innerHTML = `
      <span>Отдельные сотрудники</span>
      <div id="generationSelectedEntities" class="generation-person-picker" role="group" aria-describedby="generationSelectedHint">${generationEntities
        .map(
          (entity) =>
            `<label><input type="checkbox" value="${generationEscape(entity.entityId)}" /><span>${generationEscape(entity.displayName)}</span></label>`
        )
        .join("")}</div>
      <div class="generation-selected-count" id="generationSelectedCount">Выбрано: 0</div>
      <small id="generationSelectedHint">Можно выбрать любое количество сотрудников обычными флажками.</small>`;
    holder
      .querySelector("#generationSelectedEntities")
      ?.addEventListener("change", () => {
        const counter = document.querySelector("#generationSelectedCount");
        if (counter) counter.textContent = `Выбрано: ${selectedEntityIds().length}`;
        updateGenerationEstimate();
      });
  } else {
    holder.innerHTML = `
      <span>Все сотрудники</span>
      <p>В выпуск войдут все активные сотрудники выбранного раздела.</p>
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
    holder.innerHTML = `<div><strong>Нет готового шаблона</strong><p>Подключите и проверьте шаблон в разделе «Шаблоны».</p></div>`;
    button.disabled = true;
    return;
  }
  if (members === 0) {
    holder.className = "generation-mode-note is-warning";
    holder.innerHTML = `<div><strong>Никто не выбран</strong><p>Выберите хотя бы одного сотрудника.</p></div>`;
    button.disabled = true;
    return;
  }
  holder.className = "generation-mode-note";
  const format = String(template.format || "docx").toUpperCase();
  holder.innerHTML = `
    <div>
      <strong>${members} сотрудников → ${documents} ${format}</strong>
      <p>${generationEscape(generationModeLabel(mode))}${documents > 1 ? " · готовые файлы будут собраны в один ZIP-комплект" : ""}.</p>
    </div>`;
  button.disabled = false;
}

function renderGenerationWorkspace() {
  const content = document.querySelector("#documentGenerationContent");
  if (!content) return;
  if (generationTemplates.length === 0) {
    content.innerHTML = `
      <div class="generation-state is-warning"><div><strong>Сначала подключите шаблон</strong><p>Проверьте документ, свяжите его с полями сотрудников и подтвердите предварительный просмотр.</p><button class="primary-button" type="button" data-view-target="templates">Открыть шаблоны</button></div></div>`;
    return;
  }
  const repeatByDefault = generationTemplateHasRepeat(generationTemplates[0]);
  content.innerHTML = `
    <form class="generation-form generation-wizard" id="documentGenerationForm" novalidate>
      <section class="generation-wizard-section" aria-labelledby="generationTemplateLabel">
        <div class="generation-wizard-number" aria-hidden="true">1</div>
        <label class="generation-field">
          <span id="generationTemplateLabel">Какой шаблон заполнить?</span>
          <select id="generationTemplate">${generationTemplates
            .map(
              (template) =>
                `<option value="${generationEscape(template.id)}">${generationEscape(template.title)} · ${String(template.format).toUpperCase()} · ${template.fieldCount} полей</option>`
            )
            .join("")}</select>
          <small>Показываются только проверенные и готовые к работе шаблоны этого раздела.</small>
        </label>
      </section>
      <section class="generation-wizard-section" aria-labelledby="generationPeopleLabel">
        <div class="generation-wizard-number" aria-hidden="true">2</div>
        <label class="generation-field">
          <span id="generationPeopleLabel">Для кого создать документы?</span>
          <select id="generationSourceKind">
            <option value="all_space">Для всех сотрудников</option>
            <option value="group">Для группы сотрудников</option>
            <option value="selected">Для выбранных сотрудников</option>
          </select>
          <small>Перед запуском вы увидите точное число будущих файлов.</small>
        </label>
        <div class="generation-source-details" id="generationSourceDetails"></div>
      </section>
      <section class="generation-wizard-section" aria-labelledby="generationModeLabel">
        <div class="generation-wizard-number" aria-hidden="true">3</div>
      <fieldset class="generation-field">
        <legend id="generationModeLabel">Какой результат нужен?</legend>
        <div class="generation-mode-options">
          <label class="generation-mode-option">
            <input type="radio" name="generationMode" value="one_per_member"${repeatByDefault ? " disabled" : " checked"} />
            <span><strong>По одному документу на каждого</strong><small>Каждый сотрудник получит собственную заполненную копию. Несколько файлов соберутся в ZIP.</small></span>
          </label>
          <label class="generation-mode-option">
            <input type="radio" name="generationMode" value="aggregate"${repeatByDefault ? " checked" : ""} />
            <span><strong>Один сводный документ</strong><small>Система создаст один файл с таблицей сотрудников.</small></span>
          </label>
        </div>
        <small id="generationModeHint">${repeatByDefault ? "Этот шаблон содержит повторяемую строку сотрудников и создаёт один сводный документ." : "Выберите отдельные документы или один сводный результат."}</small>
      </fieldset>
      </section>
      <section class="generation-wizard-section generation-wizard-summary" aria-labelledby="generationSummaryLabel">
        <div class="generation-wizard-number" aria-hidden="true">4</div>
        <div><strong id="generationSummaryLabel">Проверка перед запуском</strong>
      <div class="generation-mode-note" id="generationEstimate"></div>
        </div>
      </section>
      <div class="generation-actions">
        <p id="generationFormMessage">Сначала проверим обязательные данные. Ничего не будет отправлено автоматически.</p>
        <button class="primary-button" id="generationSubmit" type="submit">Проверить данные и продолжить</button>
      </div>
    </form>
    <div id="documentGenerationStatus" class="generation-status"></div>`;
  content
    .querySelector("#generationSourceKind")
    ?.addEventListener("change", renderGenerationSourceDetails);
  content
    .querySelector("#generationTemplate")
    ?.addEventListener("change", syncGenerationTemplateMode);
  content.querySelectorAll('input[name="generationMode"]').forEach((radio) =>
    radio.addEventListener("change", updateGenerationEstimate)
  );
  content
    .querySelector("#documentGenerationForm")
    ?.addEventListener("submit", (event) => event.preventDefault());
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
    if (entityIds.length === 0) throw new Error("Выберите хотя бы одного сотрудника.");
    return { kind: "selected", entityIds };
  }
  return { kind: "all_space" };
}

function newGenerationKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `generation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  setGenerationStep(finished ? 4 : 3);
  holder.innerHTML = `
    <article class="generation-summary ${generationStateClass(job.state)}">
      <span aria-hidden="true">${generationStateEmoji(job.state)}</span>
      <div>
        <span class="generation-state-code">${generationEscape(generationStateLabel(job.state))}</span>
        <strong>${generationEscape(job.templateTitle)}</strong>
        <p>${generationEscape(generationModeLabel(job.targetMode))}. Сотрудников: ${job.memberCount}.</p>
      </div>
    </article>
    <div class="generation-progress-grid">
      <div class="generation-progress-item"><span>Ожидается файлов</span><strong>${job.expectedCount}</strong></div>
      <div class="generation-progress-item"><span>Готово</span><strong>${job.generatedCount}</strong></div>
      <div class="generation-progress-item"><span>С ошибкой</span><strong>${job.failedCount}</strong></div>
      <div class="generation-progress-item"><span>Выполнение</span><strong>${progress}%</strong></div>
    </div>
    <div class="generation-progress-bar" aria-label="Выполнение ${progress}%"><span style="--progress: ${progress}%"></span></div>
    ${payload.downloadUrl ? `<div class="generation-downloads"><a class="primary-button" href="${generationEscape(payload.downloadUrl)}">${job.archiveSha256 ? "Скачать комплект ZIP" : "Скачать готовый документ"}</a>${finished ? '<button class="secondary-button" id="generationOpenResults" type="button">Открыть все результаты</button>' : ""}</div>` : ""}
    ${readyOutputs.length > 0 ? `
      <section class="generation-output-list">
        <div><p class="eyebrow">Готовые файлы</p></div>
        ${readyOutputs
          .slice(0, 100)
          .map(
            (unit) => `
              <article class="generation-output-item">
                <div><strong>${generationEscape(unit.outputName || `Документ ${unit.position + 1}`)}</strong><span>${unit.primaryEntityId ? `Личная карточка № ${unit.position + 1}` : "Сводный результат"}</span></div>
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
    ${!finished ? `<div class="generation-state is-pending"><div><strong>Формирование продолжается</strong><p>Можно перейти в другой раздел. Задание и готовые файлы сохраняются на сервере.</p></div></div>` : ""}`;
  holder.querySelector("#generationOpenResults")?.addEventListener("click", () =>
    document.querySelector('[data-view-target="documents"]')?.click()
  );
}

async function pollGenerationJob(jobId, token = null) {
  const spaceId = currentGenerationSpaceId();
  if (!spaceId || !jobId) return;
  const pollToken = token ?? ++generationPollToken;
  try {
    const body = await generationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/document-jobs/${encodeURIComponent(jobId)}`
    );
    if (pollToken !== generationPollToken) return;
    renderGenerationJob(body.data);
    const state = body.data.job.state;
    if (["completed", "partial", "failed"].includes(state)) {
      const autoOpenResult = generationAutoOpenJobId === jobId;
      if (autoOpenResult) generationAutoOpenJobId = null;
      clearGenerationPolling();
      await loadGenerationHistory();
      if (
        autoOpenResult &&
        ["completed", "partial"].includes(state) &&
        body.data.resultId
      ) {
        window.dispatchEvent(
          new CustomEvent("docomator:open-document-result", {
            detail: { resultId: body.data.resultId }
          })
        );
      }
      return;
    }
    generationPollTimer = setTimeout(() => {
      if (pollToken === generationPollToken) void pollGenerationJob(jobId, pollToken);
    }, 1_500);
  } catch (error) {
    if (pollToken !== generationPollToken) return;
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
    holder.innerHTML = `<div class="generation-history-empty">Выберите раздел данных.</div>`;
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
    content.innerHTML = `<div class="generation-state"><div><strong>Выберите раздел данных</strong><p>Шаблоны и сотрудники будут взяты только из выбранного раздела.</p></div></div>`;
    await loadGenerationHistory();
    return;
  }
  setGenerationStep(1);
  content.innerHTML = `<div class="generation-state" role="status"><div><strong>Готовим новый выпуск</strong><p>Получаем шаблоны, группы и сотрудников выбранного раздела.</p></div></div>`;
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

function handleGenerationSpaceChanged(event) {
  const spaceId = event?.detail?.spaceId || "";
  if (spaceId) globalThis.docomatorCurrentSpaceId = spaceId;
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
  document.addEventListener("docomator:space-changed", handleGenerationSpaceChanged);
  document.querySelectorAll('[data-view-target="generation"]').forEach((button) =>
    button.addEventListener("click", loadGenerationWorkspace)
  );
  if (currentGenerationSpaceId()) void loadGenerationWorkspace();
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
