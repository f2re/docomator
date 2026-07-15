const trialView = document.querySelector('[data-view="templates"]');

let trialBusy = false;
let trialDrafts = [];
let trialSpaceSelect = null;
let trialFieldSaveWatch = 0;

function trialEscape(value) {
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

async function trialFetchJson(url, options = {}) {
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

function trialPanel() {
  return document.querySelector("#templateTrialPanel");
}

function createTrialPanel() {
  if (!trialView || trialPanel()) return;
  const panel = document.createElement("section");
  panel.id = "templateTrialPanel";
  panel.className = "template-trial-panel";
  panel.dataset.templateWizardPanel = "3";
  panel.innerHTML = `
    <article class="panel trial-card">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Пробное заполнение</p>
          <h2>Введите пример значения</h2>
          <p>Система заполнит безопасную копию, сама считает результат обратно и сообщит о расхождениях.</p>
        </div>
        <span class="template-file-mark" aria-hidden="true">✓</span>
      </div>
      <div class="trial-guidance">
        <span aria-hidden="true">ⓘ</span>
        <p>Исходный файл не изменяется. Если проверка завершится ошибкой, версия не будет сохранена и введённое значение останется в форме.</p>
      </div>
      <div id="templateTrialContent" class="trial-content" aria-live="polite">
        <div class="trial-empty">
          <span aria-hidden="true">🧭</span>
          <div><strong>Получаем черновики выбранного пространства</strong><p>Сначала нужен сохранённый исходник и хотя бы одно проверяемое поле.</p></div>
        </div>
      </div>
    </article>`;
  (document.querySelector("#templateWizardDynamicStages") || trialView).append(panel);
}

function currentTrialSpaceId() {
  return globalThis.docomatorTemplateWizard?.spaceId() || "";
}

function fieldTypeLabel(valueType) {
  const labels = {
    string: "Короткая строка",
    text: "Длинный текст",
    number: "Число",
    integer: "Целое число",
    boolean: "Да / нет",
    date: "Дата",
    "date-time": "Дата и время"
  };
  return labels[valueType] || "Значение";
}

function selectedTrialDraft() {
  const id = document.querySelector("#templateTrialDraft")?.value || "";
  return trialDrafts.find((draft) => draft.id === id) || null;
}

function selectedTrialField() {
  const draft = selectedTrialDraft();
  const id = document.querySelector("#templateTrialField")?.value || "";
  return draft?.fields?.find((field) => field.id === id) || null;
}

function sampleControl(field) {
  if (!field) return "";
  if (field.valueType === "text") {
    return `<textarea id="templateTrialValue" rows="4" maxlength="20000" required placeholder="Введите пробный текст"></textarea>`;
  }
  if (field.valueType === "boolean") {
    return `<select id="templateTrialValue"><option value="true">Да</option><option value="false">Нет</option></select>`;
  }
  if (field.valueType === "number" || field.valueType === "integer") {
    return `<input id="templateTrialValue" type="number" ${field.valueType === "integer" ? 'step="1"' : 'step="any"'} required placeholder="Например, 12,5" />`;
  }
  if (field.valueType === "date") {
    return `<input id="templateTrialValue" type="date" required />`;
  }
  if (field.valueType === "date-time") {
    return `<input id="templateTrialValue" type="datetime-local" required />`;
  }
  return `<input id="templateTrialValue" type="text" maxlength="4000" required placeholder="Введите пробное значение" />`;
}

function parseSampleValue(field, raw) {
  if (field.valueType === "boolean") return raw === "true";
  if (field.valueType === "number" || field.valueType === "integer") {
    const normalized = String(raw).trim().replace(",", ".");
    if (normalized.length === 0) throw new Error("Введите пробное число.");
    const number = Number(normalized);
    if (!Number.isFinite(number)) throw new Error("Введите допустимое число.");
    if (field.valueType === "integer" && !Number.isInteger(number)) {
      throw new Error("Введите целое число без дробной части.");
    }
    return number;
  }
  if (field.valueType === "date-time") {
    const text = String(raw).trim();
    if (text.length === 0) throw new Error("Введите пробные дату и время.");
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) throw new Error("Введите допустимые дату и время.");
    return date.toISOString();
  }
  const text = String(raw);
  if (text.length === 0) throw new Error("Введите пробное значение.");
  return text;
}

function renderTrialFieldControl() {
  const field = selectedTrialField();
  const holder = document.querySelector("#templateTrialValueHolder");
  const detail = document.querySelector("#templateTrialFieldDetail");
  if (!holder || !detail) return;
  if (!field) {
    holder.innerHTML = "";
    detail.textContent = "Выберите поле для проверки.";
    return;
  }
  holder.innerHTML = `
    <label>
      <span>Пробное значение</span>
      ${sampleControl(field)}
      <small>Тип: ${trialEscape(fieldTypeLabel(field.valueType))}. Значение записывается только в проверяемую копию.</small>
    </label>`;
  detail.innerHTML = `<strong>${trialEscape(field.label)}</strong><span>${trialEscape(fieldTypeLabel(field.valueType))}</span>`;
}

function renderTrialVersions(versions) {
  const holder = document.querySelector("#templateTrialVersions");
  if (!holder) return;
  if (!Array.isArray(versions) || versions.length === 0) {
    holder.innerHTML = `<div class="trial-history-empty">Проверенных версий этого черновика пока нет.</div>`;
    return;
  }
  const spaceId = currentTrialSpaceId();
  holder.innerHTML = versions
    .map(
      (version) => `
        <article class="trial-history-item">
          <div><strong>Проверенная версия ${version.versionNumber}</strong><span>${trialEscape(version.renderedValue)}</span></div>
          <div class="trial-history-actions">
            <a href="/api/v1/spaces/${encodeURIComponent(spaceId)}/template-test-versions/${encodeURIComponent(version.id)}/files/compiled">Копия для настройки</a>
            <a href="/api/v1/spaces/${encodeURIComponent(spaceId)}/template-test-versions/${encodeURIComponent(version.id)}/files/trial">Проверенная копия</a>
          </div>
        </article>`
    )
    .join("");
}

async function loadTrialVersions() {
  const draft = selectedTrialDraft();
  if (!draft) return renderTrialVersions([]);
  try {
    const body = await trialFetchJson(
      `/api/v1/spaces/${encodeURIComponent(currentTrialSpaceId())}/template-drafts/${encodeURIComponent(draft.id)}/test-versions?limit=20`
    );
    renderTrialVersions(body.data);
  } catch (error) {
    const holder = document.querySelector("#templateTrialVersions");
    if (holder) {
      holder.innerHTML = `<div class="trial-history-empty is-error"><p>${trialEscape(error?.message || "Историю получить не удалось.")}</p>${error?.operationId ? `<small>Идентификатор операции: <code>${trialEscape(error.operationId)}</code>.</small>` : ""}<button class="secondary-button" id="templateTrialHistoryRetry" type="button">Повторить</button></div>`;
      holder
        .querySelector("#templateTrialHistoryRetry")
        ?.addEventListener("click", loadTrialVersions);
    }
  }
}

function updateTrialFields() {
  const draft = selectedTrialDraft();
  const fieldSelect = document.querySelector("#templateTrialField");
  if (!draft || !fieldSelect) return;
  fieldSelect.innerHTML = (draft.fields || [])
    .map(
      (field) => `<option value="${trialEscape(field.id)}">${trialEscape(field.label)} · ${trialEscape(fieldTypeLabel(field.valueType))}</option>`
    )
    .join("");
  renderTrialFieldControl();
  void loadTrialVersions();
}

function renderTrialWorkspace() {
  const content = document.querySelector("#templateTrialContent");
  if (!content) return;
  const usable = trialDrafts.filter(
    (draft) => draft.status === "draft" && Array.isArray(draft.fields) && draft.fields.length > 0
  );
  if (usable.length === 0) {
    content.innerHTML = `
      <div class="trial-empty">
        <span aria-hidden="true">📭</span>
        <div><strong>Нет полей для пробного заполнения</strong><p>Сохраните исходник, постройте структуру, выберите абзац или ячейку и сохраните поле. После этого проверка станет доступна здесь.</p></div>
      </div>`;
    return;
  }
  trialDrafts = usable;
  content.innerHTML = `
    <form id="templateTrialForm" class="trial-form" novalidate>
      <div class="trial-form-grid">
        <label>
          <span>Черновик шаблона</span>
          <select id="templateTrialDraft">${usable
            .map((draft) => `<option value="${trialEscape(draft.id)}">${trialEscape(draft.title)}</option>`)
            .join("")}</select>
          <small>Черновик и все его поля принадлежат выбранному пространству.</small>
        </label>
        <label>
          <span>Проверяемое поле</span>
          <select id="templateTrialField"></select>
          <small id="templateTrialFieldDetail">Выберите поле для проверки.</small>
        </label>
        <div id="templateTrialValueHolder"></div>
      </div>
      <div class="trial-actions">
        <button class="primary-button" id="templateTrialSubmit" type="submit">Проверить заполнение</button>
        <p id="templateTrialMessage">Система создаст две новые неизменяемые копии. Исходный документ останется без изменений.</p>
      </div>
    </form>
    <div id="templateTrialResult" class="trial-result"></div>
    <section class="trial-history">
      <div><p class="eyebrow">История</p><h3>Проверенные версии</h3></div>
      <div id="templateTrialVersions"></div>
    </section>`;
  content
    .querySelector("#templateTrialDraft")
    ?.addEventListener("change", updateTrialFields);
  content
    .querySelector("#templateTrialField")
    ?.addEventListener("change", renderTrialFieldControl);
  content
    .querySelector("#templateTrialForm")
    ?.addEventListener("submit", submitTrialVersion);
  updateTrialFields();
}

async function loadTrialDrafts() {
  createTrialPanel();
  const content = document.querySelector("#templateTrialContent");
  const spaceId = currentTrialSpaceId();
  if (!content) return;
  if (!spaceId) {
    content.innerHTML = `
      <div class="trial-empty"><span aria-hidden="true">🧑‍🤝‍🧑</span><div><strong>Выберите пространство</strong><p>Проверенные версии не могут смешивать данные и черновики разных пространств.</p></div></div>`;
    return;
  }
  const existingForm = content.querySelector("#templateTrialForm");
  if (existingForm) {
    content.querySelector("#templateTrialReloadState")?.remove();
    content.insertAdjacentHTML(
      "afterbegin",
      `<div class="trial-loading" id="templateTrialReloadState" role="status"><span aria-hidden="true">⏳</span><div><strong>Обновляем поля</strong><p>Введённые значения останутся в форме, если сервер не ответит.</p></div></div>`
    );
  } else {
    content.innerHTML = `
      <div class="trial-loading" role="status"><span aria-hidden="true">⏳</span><div><strong>Получаем черновики и поля</strong><p>Проверяем выбранное пространство. Можно продолжать работу в других разделах.</p></div></div>`;
  }
  try {
    const body = await trialFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts?limit=100`
    );
    trialDrafts = Array.isArray(body.data) ? body.data : [];
    renderTrialWorkspace();
  } catch (error) {
    const operationId = error?.operationId || "";
    content.querySelector("#templateTrialReloadState")?.remove();
    const errorHtml = `<div class="trial-empty is-error" id="templateTrialLoadError"><span aria-hidden="true">⚠️</span><div><strong>Черновики получить не удалось</strong><p>${trialEscape(error?.message || "Повторите действие позже.")} Введённые значения сохранены.</p>${operationId ? `<small>Идентификатор операции: <code>${trialEscape(operationId)}</code>.</small>` : ""}<button class="secondary-button" id="templateTrialRetry" type="button">Повторить</button></div></div>`;
    if (existingForm) {
      content.querySelector("#templateTrialLoadError")?.remove();
      content.insertAdjacentHTML("afterbegin", errorHtml);
    } else content.innerHTML = errorHtml;
    content.querySelector("#templateTrialRetry")?.addEventListener("click", loadTrialDrafts);
  }
}

async function submitTrialVersion(event) {
  event.preventDefault();
  if (trialBusy) return;
  const draft = selectedTrialDraft();
  const field = selectedTrialField();
  const valueControl = document.querySelector("#templateTrialValue");
  const button = document.querySelector("#templateTrialSubmit");
  const message = document.querySelector("#templateTrialMessage");
  const result = document.querySelector("#templateTrialResult");
  if (!draft || !field || !valueControl || !button || !message || !result) return;

  let value;
  try {
    value = parseSampleValue(field, valueControl.value);
  } catch (error) {
    message.className = "is-error";
    message.textContent = error?.message || "Проверьте пробное значение.";
    valueControl.focus();
    return;
  }

  trialBusy = true;
  button.disabled = true;
  message.className = "is-loading";
  message.textContent =
    "Создаём техническую привязку, записываем значение и считываем его обратно. Не закрывайте страницу до завершения.";
  result.innerHTML = `
    <div class="trial-loading" role="status"><span aria-hidden="true">⏳</span><div><strong>Выполняем обратную проверку</strong><p>Исходник не изменяется. Версия сохранится только при точном совпадении значения.</p></div></div>`;

  try {
    const body = await trialFetchJson(
      `/api/v1/spaces/${encodeURIComponent(currentTrialSpaceId())}/template-drafts/${encodeURIComponent(draft.id)}/trial`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fieldId: field.id, value })
      }
    );
    const data = body.data;
    message.className = "is-success";
    message.textContent =
      "Пробное значение записано и считано обратно без расхождений. Обе копии сохранены.";
    result.innerHTML = `
      <article class="trial-success">
        <span aria-hidden="true">✅</span>
        <div>
          <strong>Проверенная версия ${data.version.versionNumber} готова</strong>
          <p>Записано: «${trialEscape(data.verification.renderedValue)}». Считано обратно: «${trialEscape(data.verification.readBackValue)}».</p>
          <div class="trial-downloads">
            <a class="secondary-button" href="${trialEscape(data.downloads.compiled)}">Скачать копию для настройки</a>
            <a class="primary-button" href="${trialEscape(data.downloads.trial)}">Скачать пробно заполненную копию</a>
          </div>
          <details><summary>Технические сведения</summary><dl>
            <div><dt>Контрольная сумма привязки</dt><dd><code>${trialEscape(data.version.compiledSha256)}</code></dd></div>
            <div><dt>Контрольная сумма пробной копии</dt><dd><code>${trialEscape(data.version.trialSha256)}</code></dd></div>
            <div><dt>Идентификатор операции</dt><dd><code>${trialEscape(body.correlationId || "не указан")}</code></dd></div>
          </dl></details>
        </div>
      </article>`;
    globalThis.docomatorTemplateWizard?.complete(3, {
      draftId: draft.id,
      versionId: data.version.id,
      versionKind: "single"
    });
    await loadTrialVersions();
  } catch (error) {
    const operationId = error?.operationId || "";
    message.className = "is-error";
    message.textContent = "Проверка не завершена. Введённое значение сохранено в форме.";
    result.innerHTML = `
      <div class="trial-empty is-error"><span aria-hidden="true">⚠️</span><div><strong>Пробное заполнение не прошло</strong><p>${trialEscape(error?.message || "Повторите действие после исправления значения или шаблона.")}</p>${operationId ? `<small>Идентификатор операции: <code>${trialEscape(operationId)}</code>.</small>` : ""}</div></div>`;
  } finally {
    trialBusy = false;
    button.disabled = false;
  }
}

function bindTrialSpaceSelect() {
  const candidate = document.querySelector("#documentQuarantineSpace");
  if (!candidate || candidate === trialSpaceSelect) return;
  trialSpaceSelect = candidate;
  trialSpaceSelect.addEventListener("change", loadTrialDrafts);
  void loadTrialDrafts();
}

async function watchFieldSave() {
  trialFieldSaveWatch += 1;
  const watch = trialFieldSaveWatch;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (watch !== trialFieldSaveWatch) return;
    const message = document.querySelector("#documentFieldMessage");
    if (message?.classList.contains("is-success")) {
      await loadTrialDrafts();
      return;
    }
    if (message?.classList.contains("is-error")) return;
  }
}

if (trialView) {
  createTrialPanel();
  bindTrialSpaceSelect();
  new MutationObserver(bindTrialSpaceSelect).observe(trialView, {
    childList: true,
    subtree: true
  });
  document.addEventListener("click", (event) => {
    if (event.target?.id === "documentFieldSave") void watchFieldSave();
  });
}
