const multiTrialView = document.querySelector('[data-view="templates"]');

let multiTrialSpaceSelect = null;
let multiTrialDrafts = [];
let multiTrialBusy = false;
let multiTrialReloadMarker = "";
let multiTrialReloadTimer = null;

function multiTrialEscape(value) {
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

async function multiTrialFetchJson(url, options = {}) {
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

function multiTrialPanel() {
  return document.querySelector("#templateMultiTrialPanel");
}

function currentMultiTrialSpaceId() {
  return multiTrialSpaceSelect?.value || "";
}

function createMultiTrialPanel() {
  if (!multiTrialView || multiTrialPanel()) return;
  const panel = document.createElement("section");
  panel.id = "templateMultiTrialPanel";
  panel.className = "template-multi-trial-panel";
  panel.innerHTML = `
    <article class="panel multi-trial-card">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Шаг 3.1 · полный набор полей</p>
          <h2>Проверить все поля одной копией</h2>
          <p>Система создаст все технические привязки в устойчивом порядке, заполнит каждое поле и повторно считает значения уже из окончательного файла.</p>
        </div>
        <span class="large-emoji" aria-hidden="true">🧩</span>
      </div>
      <div class="multi-trial-guidance">
        <span aria-hidden="true">ⓘ</span>
        <p>Этот шаг доступен для черновика с двумя или более полями. Требуется заполнить весь набор: неполная версия не сохраняется.</p>
      </div>
      <div id="templateMultiTrialContent" class="multi-trial-content" aria-live="polite">
        <div class="multi-trial-state"><span aria-hidden="true">⏳</span><div><strong>Получаем черновики</strong><p>Ищем в выбранном пространстве документы с несколькими сохранёнными полями.</p></div></div>
      </div>
    </article>`;
  multiTrialView.append(panel);
}

function fieldTypeLabel(type) {
  return (
    {
      string: "Короткая строка",
      text: "Длинный текст",
      number: "Число",
      integer: "Целое число",
      boolean: "Да / нет",
      date: "Дата",
      "date-time": "Дата и время"
    }[type] || "Значение"
  );
}

function fieldInput(field) {
  const identifier = `multiValue_${field.id}`;
  if (field.valueType === "text") {
    return `<textarea id="${multiTrialEscape(identifier)}" data-field-id="${multiTrialEscape(field.id)}" data-value-type="text" rows="4" maxlength="20000" ${field.required ? "required" : ""} placeholder="Введите текст"></textarea>`;
  }
  if (field.valueType === "boolean") {
    return `<select id="${multiTrialEscape(identifier)}" data-field-id="${multiTrialEscape(field.id)}" data-value-type="boolean"><option value="true">Да</option><option value="false">Нет</option></select>`;
  }
  if (field.valueType === "number" || field.valueType === "integer") {
    return `<input id="${multiTrialEscape(identifier)}" data-field-id="${multiTrialEscape(field.id)}" data-value-type="${multiTrialEscape(field.valueType)}" type="number" ${field.valueType === "integer" ? 'step="1"' : 'step="any"'} ${field.required ? "required" : ""} placeholder="Введите число" />`;
  }
  if (field.valueType === "date") {
    return `<input id="${multiTrialEscape(identifier)}" data-field-id="${multiTrialEscape(field.id)}" data-value-type="date" type="date" ${field.required ? "required" : ""} />`;
  }
  if (field.valueType === "date-time") {
    return `<input id="${multiTrialEscape(identifier)}" data-field-id="${multiTrialEscape(field.id)}" data-value-type="date-time" type="datetime-local" ${field.required ? "required" : ""} />`;
  }
  return `<input id="${multiTrialEscape(identifier)}" data-field-id="${multiTrialEscape(field.id)}" data-value-type="string" type="text" maxlength="4000" ${field.required ? "required" : ""} placeholder="Введите значение" />`;
}

function selectedMultiTrialDraft() {
  const id = document.querySelector("#templateMultiTrialDraft")?.value || "";
  return multiTrialDrafts.find((draft) => draft.id === id) || null;
}

function parseFieldValue(control, field) {
  const raw = control.value;
  if (field.valueType === "boolean") return raw === "true";
  if (field.valueType === "number" || field.valueType === "integer") {
    const normalized = String(raw).trim().replace(",", ".");
    if (normalized === "" && !field.required) return "";
    const value = Number(normalized);
    if (!Number.isFinite(value)) {
      throw new Error(`Поле «${field.label}» должно содержать число.`);
    }
    if (field.valueType === "integer" && !Number.isInteger(value)) {
      throw new Error(`Поле «${field.label}» должно содержать целое число.`);
    }
    return value;
  }
  if (field.valueType === "date-time") {
    const text = String(raw).trim();
    if (text === "" && !field.required) return "";
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Поле «${field.label}» содержит недопустимые дату и время.`);
    }
    return date.toISOString();
  }
  const text = String(raw);
  if (field.required && text.length === 0) {
    throw new Error(`Заполните обязательное поле «${field.label}».`);
  }
  return text;
}

function renderMultiTrialFields() {
  const draft = selectedMultiTrialDraft();
  const holder = document.querySelector("#templateMultiTrialFields");
  const count = document.querySelector("#templateMultiTrialCount");
  if (!draft || !holder || !count) return;
  count.textContent = `${draft.fields.length} полей будут проверены одной окончательной копией.`;
  holder.innerHTML = draft.fields
    .map(
      (field, index) => `
        <label class="multi-trial-field">
          <span><strong>${index + 1}. ${multiTrialEscape(field.label)}</strong>${field.required ? '<em>Обязательно</em>' : '<em>Необязательно</em>'}</span>
          ${fieldInput(field)}
          <small>${multiTrialEscape(fieldTypeLabel(field.valueType))} · ключ <code>${multiTrialEscape(field.key)}</code></small>
        </label>`
    )
    .join("");
  void loadMultiTrialHistory();
}

function renderMultiTrialHistory(versions) {
  const holder = document.querySelector("#templateMultiTrialHistory");
  if (!holder) return;
  if (!Array.isArray(versions) || versions.length === 0) {
    holder.innerHTML = `<div class="multi-trial-history-empty">Многополевых проверенных версий пока нет.</div>`;
    return;
  }
  const spaceId = currentMultiTrialSpaceId();
  holder.innerHTML = versions
    .map(
      (version) => `
        <article class="multi-trial-history-item">
          <div><strong>Версия ${version.versionNumber}</strong><span>${version.fieldCount} полей · ${multiTrialEscape(version.format.toUpperCase())}</span></div>
          <div class="multi-trial-history-actions">
            <a href="/api/v1/spaces/${encodeURIComponent(spaceId)}/template-multi-test-versions/${encodeURIComponent(version.id)}/files/compiled">Техническая копия</a>
            <a href="/api/v1/spaces/${encodeURIComponent(spaceId)}/template-multi-test-versions/${encodeURIComponent(version.id)}/files/trial">Проверенная копия</a>
          </div>
        </article>`
    )
    .join("");
}

async function loadMultiTrialHistory() {
  const draft = selectedMultiTrialDraft();
  if (!draft) return renderMultiTrialHistory([]);
  try {
    const body = await multiTrialFetchJson(
      `/api/v1/spaces/${encodeURIComponent(currentMultiTrialSpaceId())}/template-drafts/${encodeURIComponent(draft.id)}/multi-test-versions?limit=20`
    );
    renderMultiTrialHistory(body.data);
  } catch (error) {
    const holder = document.querySelector("#templateMultiTrialHistory");
    if (holder) {
      holder.innerHTML = `<div class="multi-trial-history-empty is-error">${multiTrialEscape(error?.message || "Историю получить не удалось.")}</div>`;
    }
  }
}

function renderMultiTrialWorkspace() {
  const content = document.querySelector("#templateMultiTrialContent");
  if (!content) return;
  const usable = multiTrialDrafts.filter(
    (draft) => draft.status === "draft" && Array.isArray(draft.fields) && draft.fields.length >= 2
  );
  if (usable.length === 0) {
    content.innerHTML = `
      <div class="multi-trial-state"><span aria-hidden="true">📭</span><div><strong>Нет черновика с несколькими полями</strong><p>Сохраните не менее двух разных полей одного DOCX/XLSX. После этого форма появится автоматически.</p></div></div>`;
    return;
  }
  multiTrialDrafts = usable;
  content.innerHTML = `
    <form class="multi-trial-form" id="templateMultiTrialForm" novalidate>
      <label class="multi-trial-draft-select">
        <span>Черновик шаблона</span>
        <select id="templateMultiTrialDraft">${usable
          .map((draft) => `<option value="${multiTrialEscape(draft.id)}">${multiTrialEscape(draft.title)} · ${draft.fields.length} полей</option>`)
          .join("")}</select>
        <small id="templateMultiTrialCount"></small>
      </label>
      <div id="templateMultiTrialFields" class="multi-trial-fields"></div>
      <div class="multi-trial-actions">
        <button class="primary-button" id="templateMultiTrialSubmit" type="submit">Проверить все поля</button>
        <p id="templateMultiTrialMessage">Версия сохранится только если каждое значение будет считано обратно без расхождений.</p>
      </div>
    </form>
    <div id="templateMultiTrialResult" class="multi-trial-result"></div>
    <section class="multi-trial-history">
      <div><p class="eyebrow">История</p><h3>Многополевые проверенные версии</h3></div>
      <div id="templateMultiTrialHistory"></div>
    </section>`;
  content
    .querySelector("#templateMultiTrialDraft")
    ?.addEventListener("change", renderMultiTrialFields);
  content
    .querySelector("#templateMultiTrialForm")
    ?.addEventListener("submit", submitMultiTrial);
  renderMultiTrialFields();
}

async function loadMultiTrialDrafts() {
  createMultiTrialPanel();
  const content = document.querySelector("#templateMultiTrialContent");
  const spaceId = currentMultiTrialSpaceId();
  if (!content) return;
  if (!spaceId) {
    content.innerHTML = `<div class="multi-trial-state"><span aria-hidden="true">🧑‍🤝‍🧑</span><div><strong>Выберите пространство</strong><p>Черновики и проверенные версии изолированы по пространствам.</p></div></div>`;
    return;
  }
  content.innerHTML = `<div class="multi-trial-state" role="status"><span aria-hidden="true">⏳</span><div><strong>Получаем черновики</strong><p>Можно продолжать работу в других разделах.</p></div></div>`;
  try {
    const body = await multiTrialFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts?limit=100`
    );
    multiTrialDrafts = Array.isArray(body.data) ? body.data : [];
    renderMultiTrialWorkspace();
  } catch (error) {
    content.innerHTML = `
      <div class="multi-trial-state is-error"><span aria-hidden="true">⚠️</span><div><strong>Черновики получить не удалось</strong><p>${multiTrialEscape(error?.message || "Повторите действие.")}</p><button class="secondary-button" id="templateMultiTrialRetry" type="button">Повторить</button></div></div>`;
    content
      .querySelector("#templateMultiTrialRetry")
      ?.addEventListener("click", loadMultiTrialDrafts);
  }
}

async function submitMultiTrial(event) {
  event.preventDefault();
  if (multiTrialBusy) return;
  const draft = selectedMultiTrialDraft();
  const form = event.currentTarget;
  const button = form.querySelector("#templateMultiTrialSubmit");
  const message = form.querySelector("#templateMultiTrialMessage");
  const result = document.querySelector("#templateMultiTrialResult");
  if (!draft || !button || !message || !result) return;

  let values;
  try {
    values = draft.fields.map((field) => {
      const control = form.querySelector(`[data-field-id="${CSS.escape(field.id)}"]`);
      if (!control) throw new Error(`Не найдено поле «${field.label}». Обновите страницу.`);
      return { fieldId: field.id, value: parseFieldValue(control, field) };
    });
  } catch (error) {
    message.className = "is-error";
    message.textContent = error?.message || "Проверьте значения полей.";
    return;
  }

  multiTrialBusy = true;
  button.disabled = true;
  message.className = "is-loading";
  message.textContent =
    "Создаём технические привязки в устойчивом порядке и проверяем каждое значение в окончательном файле.";
  result.innerHTML = `
    <div class="multi-trial-state is-pending" role="status"><span aria-hidden="true">⏳</span><div><strong>Проверяем полный набор</strong><p>Исходник не изменяется. Неполная или расходящаяся версия не будет сохранена.</p></div></div>`;
  try {
    const body = await multiTrialFetchJson(
      `/api/v1/spaces/${encodeURIComponent(currentMultiTrialSpaceId())}/template-drafts/${encodeURIComponent(draft.id)}/trial-all`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values })
      }
    );
    const data = body.data;
    message.className = "is-success";
    message.textContent = `Все поля проверены: ${data.version.fieldCount}. Версия сохранена.`;
    result.innerHTML = `
      <article class="multi-trial-success">
        <div class="multi-trial-success-heading"><span aria-hidden="true">✅</span><div><strong>Многополевая версия ${data.version.versionNumber} готова</strong><p>Итоговое обратное чтение не обнаружило расхождений.</p></div></div>
        <div class="multi-trial-check-list">${data.version.fields
          .map(
            (field) => `<div><span>${multiTrialEscape(field.fieldLabel)}</span><strong>${multiTrialEscape(field.readBackValue)}</strong><small><code>${multiTrialEscape(field.fieldKey)}</code></small></div>`
          )
          .join("")}</div>
        <div class="multi-trial-downloads">
          <a class="secondary-button" href="${multiTrialEscape(data.downloads.compiled)}">Скачать техническую копию</a>
          <a class="primary-button" href="${multiTrialEscape(data.downloads.trial)}">Скачать проверенную копию</a>
        </div>
        <details><summary>Технические сведения</summary><dl>
          <div><dt>Контрольная сумма технической копии</dt><dd><code>${multiTrialEscape(data.version.compiledSha256)}</code></dd></div>
          <div><dt>Контрольная сумма проверенной копии</dt><dd><code>${multiTrialEscape(data.version.trialSha256)}</code></dd></div>
          <div><dt>Идентификатор операции</dt><dd><code>${multiTrialEscape(body.correlationId || "не указан")}</code></dd></div>
        </dl></details>
      </article>`;
    await loadMultiTrialHistory();
  } catch (error) {
    message.className = "is-error";
    message.textContent = "Версия не сохранена. Введённые значения остались в форме.";
    result.innerHTML = `
      <div class="multi-trial-state is-error"><span aria-hidden="true">⚠️</span><div><strong>Общая проверка не завершена</strong><p>${multiTrialEscape(error?.message || "Исправьте значения и повторите действие.")}</p>${error?.operationId ? `<small>Идентификатор операции: <code>${multiTrialEscape(error.operationId)}</code>.</small>` : ""}</div></div>`;
  } finally {
    multiTrialBusy = false;
    button.disabled = false;
  }
}

function scheduleMultiTrialReload() {
  if (multiTrialReloadTimer !== null) clearTimeout(multiTrialReloadTimer);
  multiTrialReloadTimer = setTimeout(() => {
    multiTrialReloadTimer = null;
    void loadMultiTrialDrafts();
  }, 500);
}

function bindMultiTrialSpaceSelect() {
  const candidate = document.querySelector("#documentQuarantineSpace");
  if (!candidate || candidate === multiTrialSpaceSelect) return;
  multiTrialSpaceSelect = candidate;
  multiTrialSpaceSelect.addEventListener("change", loadMultiTrialDrafts);
  void loadMultiTrialDrafts();
}

function multiTrialSourceMarker() {
  const fieldMessage = document.querySelector("#documentFieldMessage");
  return fieldMessage?.classList.contains("is-success")
    ? fieldMessage.textContent?.trim() || ""
    : "";
}

if (multiTrialView) {
  createMultiTrialPanel();
  bindMultiTrialSpaceSelect();
  new MutationObserver(() => {
    bindMultiTrialSpaceSelect();
    const marker = multiTrialSourceMarker();
    if (marker === "") {
      multiTrialReloadMarker = "";
    } else if (marker !== multiTrialReloadMarker) {
      multiTrialReloadMarker = marker;
      scheduleMultiTrialReload();
    }
  }).observe(multiTrialView, { childList: true, subtree: true, attributes: true });
}
