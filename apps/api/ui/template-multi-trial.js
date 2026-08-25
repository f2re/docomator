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
  return globalThis.docomatorTemplateWizard?.spaceId() || "";
}

function currentMultiTrialDraftId() {
  const value = globalThis.docomatorTemplateWizard?.artifacts?.()?.draftId;
  return typeof value === "string" ? value : "";
}

function createMultiTrialPanel() {
  if (!multiTrialView || multiTrialPanel()) return;
  const panel = document.createElement("section");
  panel.id = "templateMultiTrialPanel";
  panel.className = "template-multi-trial-panel";
  panel.dataset.templateWizardPanel = "3";
  panel.innerHTML = `
    <article class="panel multi-trial-card">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Пробное заполнение</p>
          <h2>Проверить все настроенные поля на тестовых примерах</h2>
          <p>Создайте одну пробную копию шаблона. Система вставит примеры и проверит, что каждое значение можно считать обратно без ошибок.</p>
        </div>
        <span class="template-file-mark" aria-hidden="true">✓</span>
      </div>
      <div class="multi-trial-guidance">
        <span aria-hidden="true">ⓘ</span>
        <p>Примеры не являются данными сотрудников. Если после настройки строки добавились поля, форма обновит их автоматически и сохранит уже введённые примеры.</p>
      </div>
      <div id="templateMultiTrialContent" class="multi-trial-content" aria-live="polite">
        <div class="multi-trial-state"><span aria-hidden="true">⏳</span><div><strong>Получаем черновики</strong><p>Ищем в выбранном пространстве документы с несколькими сохранёнными полями.</p></div></div>
      </div>
    </article>`;
  (document.querySelector("#templateWizardDynamicStages") || multiTrialView).append(panel);
}

function multiTrialFieldTypeLabel(type) {
  return (
    {
      string: "Короткая строка",
      text: "Длинный текст",
      enum: "Список вариантов",
      number: "Число",
      integer: "Целое число",
      boolean: "Да / нет",
      date: "Дата",
      "date-time": "Дата и время"
    }[type] || "Значение"
  );
}

const multiTrialDraftValues = new Map();
const multiTrialKnownFieldIdsByDraft = new Map();

function multiTrialDraftValueKey(draftId, field) {
  return `${draftId}:${field.key || field.id}`;
}

function multiTrialRememberValues() {
  const draft = selectedMultiTrialDraft();
  const form = document.querySelector("#templateMultiTrialForm");
  if (!draft || !form) return;
  for (const field of draft.fields || []) {
    const control = form.querySelector(`[data-field-id="${CSS.escape(field.id)}"]`);
    if (control) {
      multiTrialDraftValues.set(
        multiTrialDraftValueKey(draft.id, field),
        control.value
      );
    }
  }
}

function multiTrialSample(field) {
  const text = `${field.label || ""} ${field.key || ""}`.toLocaleLowerCase("ru-RU");
  if (field.valueType === "boolean") return "true";
  if (field.valueType === "number") return "1.5";
  if (field.valueType === "integer") return /номер строки|position/u.test(text) ? "1" : "10";
  if (field.valueType === "date") return "2026-01-15";
  if (field.valueType === "date-time") return "2026-01-15T10:30";
  if (/фио|фамил|display_name|full_name/u.test(text)) return "Иванов Иван Иванович";
  if (/тем.*работ|научн.*тем/u.test(text)) return "Тестовая тема научной работы";
  if (/руковод|научрук/u.test(text)) return "Петров Пётр Петрович";
  if (/зачет|зачёт/u.test(text)) return "ЗК-001";
  if (/должност/u.test(text)) return "Инженер";
  if (/подраздел|кафедр|отдел/u.test(text)) return "Учебный отдел";
  if (field.valueType === "enum") {
    const definition = structurePropertyDefinitions.find(
      (candidate) => candidate.key === field.key
    );
    const configured = Array.isArray(definition?.validation?.enum)
      ? definition.validation.enum[0]
      : null;
    return configured || "Тестовое значение";
  }
  return "Тестовое значение";
}

function multiTrialDraftFieldInput(field, value) {
  const identifier = `multiValue_${field.id}`;
  const common = `id="${multiTrialEscape(identifier)}" data-field-id="${multiTrialEscape(field.id)}" data-field-key="${multiTrialEscape(field.key || "")}" data-value-type="${multiTrialEscape(field.valueType)}"`;
  if (field.valueType === "text") {
    return `<textarea ${common} rows="4" maxlength="20000" ${field.required ? "required" : ""} placeholder="Введите тестовый текст">${multiTrialEscape(value)}</textarea>`;
  }
  if (field.valueType === "boolean") {
    return `<select ${common}><option value="true"${String(value) === "true" ? " selected" : ""}>Да</option><option value="false"${String(value) === "false" ? " selected" : ""}>Нет</option></select>`;
  }
  if (field.valueType === "number" || field.valueType === "integer") {
    return `<input ${common} type="number" ${field.valueType === "integer" ? 'step="1"' : 'step="any"'} value="${multiTrialEscape(value)}" ${field.required ? "required" : ""} placeholder="Введите тестовое число" />`;
  }
  if (field.valueType === "date") {
    return `<input ${common} type="date" value="${multiTrialEscape(value)}" ${field.required ? "required" : ""} />`;
  }
  if (field.valueType === "date-time") {
    return `<input ${common} type="datetime-local" value="${multiTrialEscape(value)}" ${field.required ? "required" : ""} />`;
  }
  return `<input ${common} type="text" maxlength="4000" value="${multiTrialEscape(value)}" ${field.required ? "required" : ""} placeholder="Введите тестовое значение" />`;
}

function multiTrialUpdateProgress() {
  const draft = selectedMultiTrialDraft();
  const form = document.querySelector("#templateMultiTrialForm");
  if (!draft || !form) return;
  const filled = draft.fields.filter((field) => {
    const control = form.querySelector(`[data-field-id="${CSS.escape(field.id)}"]`);
    return control && String(control.value).trim() !== "";
  }).length;
  const progress = document.querySelector("#templateMultiTrialProgress");
  if (progress) {
    progress.textContent = `Заполнено тестовых примеров: ${filled} из ${draft.fields.length}.`;
    progress.className = filled === draft.fields.length ? "is-ready" : "";
  }
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
  multiTrialRememberValues();
  const draft = selectedMultiTrialDraft();
  const holder = document.querySelector("#templateMultiTrialFields");
  const count = document.querySelector("#templateMultiTrialCount");
  if (!draft || !holder || !count) return;
  const currentIds = new Set(draft.fields.map((field) => field.id));
  const knownIds = multiTrialKnownFieldIdsByDraft.get(draft.id) || new Set();
  const newIds = new Set(
    [...currentIds].filter((fieldId) => !knownIds.has(fieldId))
  );
  if (knownIds.size === 0) newIds.clear();
  multiTrialKnownFieldIdsByDraft.set(draft.id, currentIds);
  count.textContent = `${draft.fields.length} полей будут одновременно вставлены в одну пробную копию и считаны обратно.`;
  holder.innerHTML = `
    <section class="multi-trial-explanation">
      <div><strong>Зачем вводить примеры?</strong><p>Это временные тестовые значения для проверки самого шаблона. Они не записываются в карточки сотрудников и не попадут в рабочие документы.</p></div>
      <ol><li>Заполните каждое поле любым узнаваемым примером.</li><li>Нажмите «Создать и проверить пробную копию».</li><li>Система вставит значения, затем сама прочитает готовый файл и сравнит результат.</li></ol>
      <div class="multi-trial-example-actions"><button class="secondary-button" id="templateMultiTrialFillExamples" type="button">Заполнить безопасными примерами</button><button class="text-button" id="templateMultiTrialClearExamples" type="button">Очистить примеры</button><span id="templateMultiTrialProgress"></span></div>
    </section>
    <div class="multi-trial-fields-grid">${draft.fields
      .map((field, index) => {
        const saved = multiTrialDraftValues.get(
          multiTrialDraftValueKey(draft.id, field)
        );
        const value = saved === undefined ? "" : saved;
        return `
          <label class="multi-trial-field${newIds.has(field.id) ? " is-new" : ""}">
            <span><strong>${index + 1}. ${multiTrialEscape(field.label)}</strong>${field.required ? '<em>Нужно для рабочих документов</em>' : '<em>Необязательное рабочее поле</em>'}</span>
            ${newIds.has(field.id) ? '<b class="multi-trial-new-mark">Добавлено после настройки строки</b>' : ""}
            ${multiTrialDraftFieldInput(field, value)}
            <small>${multiTrialEscape(multiTrialFieldTypeLabel(field.valueType))} · здесь нужен только тестовый пример</small>
          </label>`;
      })
      .join("")}</div>`;
  holder.querySelectorAll("[data-field-id]").forEach((control) => {
    const field = draft.fields.find((candidate) => candidate.id === control.dataset.fieldId);
    const remember = () => {
      if (field) {
        multiTrialDraftValues.set(
          multiTrialDraftValueKey(draft.id, field),
          control.value
        );
      }
      multiTrialUpdateProgress();
    };
    control.addEventListener("input", remember);
    control.addEventListener("change", remember);
  });
  holder.querySelector("#templateMultiTrialFillExamples")?.addEventListener("click", () => {
    for (const field of draft.fields) {
      const control = holder.querySelector(`[data-field-id="${CSS.escape(field.id)}"]`);
      if (!control || String(control.value).trim() !== "") continue;
      control.value = multiTrialSample(field);
      control.dispatchEvent(new Event("change", { bubbles: true }));
    }
    multiTrialUpdateProgress();
  });
  holder.querySelector("#templateMultiTrialClearExamples")?.addEventListener("click", () => {
    holder.querySelectorAll("[data-field-id]").forEach((control) => {
      control.value = control.dataset.valueType === "boolean" ? "true" : "";
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
    multiTrialUpdateProgress();
  });
  multiTrialUpdateProgress();
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
            <a href="/api/v1/spaces/${encodeURIComponent(spaceId)}/template-multi-test-versions/${encodeURIComponent(version.id)}/files/compiled">Копия для настройки</a>
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
      holder.innerHTML = `<div class="multi-trial-history-empty is-error"><p>${multiTrialEscape(error?.message || "Историю получить не удалось.")}</p>${error?.operationId ? `<small>Идентификатор операции: <code>${multiTrialEscape(error.operationId)}</code>.</small>` : ""}<button class="secondary-button" id="templateMultiTrialHistoryRetry" type="button">Повторить</button></div>`;
      holder
        .querySelector("#templateMultiTrialHistoryRetry")
        ?.addEventListener("click", loadMultiTrialHistory);
    }
  }
}

function renderMultiTrialWorkspace() {
  const content = document.querySelector("#templateMultiTrialContent");
  if (!content) return;
  const currentDraftId = currentMultiTrialDraftId();
  const usable = multiTrialDrafts.filter(
    (draft) =>
      (!currentDraftId || draft.id === currentDraftId) &&
      draft.status === "draft" &&
      Array.isArray(draft.fields) &&
      (draft.fields.length >= 2 ||
        (draft.repeatBinding && draft.fields.length >= 1))
  );
  multiTrialDrafts = usable;
  if (usable.length === 0) {
    content.innerHTML = `
      <div class="multi-trial-state"><span aria-hidden="true">📭</span><div><strong>Нет черновика для полной проверки</strong><p>Сохраните не менее двух разных полей или одно поле в повторяемой строке DOCX. После этого форма появится автоматически.</p></div></div>`;
    globalThis.docomatorTemplateWizard?.render?.();
    return;
  }
  content.innerHTML = `
    <form class="multi-trial-form" id="templateMultiTrialForm" novalidate data-draft-id="${multiTrialEscape(usable[0].id)}">
      <label class="multi-trial-draft-select">
        <span>Черновик шаблона</span>
        <select id="templateMultiTrialDraft">${usable
          .map((draft) => `<option value="${multiTrialEscape(draft.id)}">${multiTrialEscape(draft.title)} · ${draft.fields.length} полей</option>`)
          .join("")}</select>
        <small id="templateMultiTrialCount"></small>
      </label>
      <div id="templateMultiTrialFields" class="multi-trial-fields"></div>
      <div class="multi-trial-actions">
        <button class="primary-button" id="templateMultiTrialSubmit" type="submit">Создать и проверить пробную копию</button>
        <p id="templateMultiTrialMessage">Пробная версия сохранится только если каждое тестовое значение будет считано обратно без расхождений.</p>
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
  globalThis.docomatorTemplateWizard?.render?.();
}

async function loadMultiTrialDrafts() {
  createMultiTrialPanel();
  const content = document.querySelector("#templateMultiTrialContent");
  const spaceId = currentMultiTrialSpaceId();
  if (!content) return;
  if (!spaceId) {
    content.innerHTML = `<div class="multi-trial-state"><span aria-hidden="true">🧑‍🤝‍🧑</span><div><strong>Выберите пространство</strong><p>Черновики и проверенные версии относятся к выбранному пространству.</p></div></div>`;
    return false;
  }
  const existingForm = content.querySelector("#templateMultiTrialForm");
  if (existingForm) {
    content.querySelector("#templateMultiTrialReloadState")?.remove();
    content.insertAdjacentHTML("afterbegin", `<div class="multi-trial-state" id="templateMultiTrialReloadState" role="status"><span aria-hidden="true">⏳</span><div><strong>Обновляем поля</strong><p>Введённые значения останутся в форме, если сервер не ответит.</p></div></div>`);
  } else {
    content.innerHTML = `<div class="multi-trial-state" role="status"><span aria-hidden="true">⏳</span><div><strong>Получаем черновики</strong><p>Можно продолжать работу в других разделах.</p></div></div>`;
  }
  try {
    const body = await multiTrialFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts?limit=100`
    );
    multiTrialDrafts = Array.isArray(body.data) ? body.data : [];
    renderMultiTrialWorkspace();
    return globalThis.docomatorMultiTrial?.hasForm?.() === true;
  } catch (error) {
    content.querySelector("#templateMultiTrialReloadState")?.remove();
    const errorHtml = `<div class="multi-trial-state is-error" id="templateMultiTrialLoadError"><span aria-hidden="true">⚠️</span><div><strong>Черновики получить не удалось</strong><p>${multiTrialEscape(error?.message || "Повторите действие.")} Введённые значения сохранены.</p>${error?.operationId ? `<small>Идентификатор операции: <code>${multiTrialEscape(error.operationId)}</code>.</small>` : ""}<button class="secondary-button" id="templateMultiTrialRetry" type="button">Повторить</button></div></div>`;
    if (existingForm) {
      content.querySelector("#templateMultiTrialLoadError")?.remove();
      content.insertAdjacentHTML("afterbegin", errorHtml);
    } else content.innerHTML = errorHtml;
    content
      .querySelector("#templateMultiTrialRetry")
      ?.addEventListener("click", loadMultiTrialDrafts);
    return false;
  }
}

function multiTrialFieldSignature(field) {
  return JSON.stringify({
    id: field.id,
    version: field.version || 1,
    key: field.key,
    label: field.label,
    valueType: field.valueType,
    required: Boolean(field.required),
    formatter: field.formatter || null
  });
}

function multiTrialSameFields(left, right) {
  const leftFields = (left?.fields || [])
    .map(multiTrialFieldSignature)
    .sort();
  const rightFields = (right?.fields || [])
    .map(multiTrialFieldSignature)
    .sort();
  return (
    leftFields.length === rightFields.length &&
    leftFields.every((signature, index) => signature === rightFields[index])
  );
}

async function multiTrialRefreshChangedDraft(cached, result, reason) {
  const latestBody = await multiTrialFetchJson(
    `/api/v1/spaces/${encodeURIComponent(currentMultiTrialSpaceId())}/template-drafts/${encodeURIComponent(cached.id)}`
  );
  const latest = latestBody.data;
  const index = multiTrialDrafts.findIndex((draft) => draft.id === cached.id);
  if (index >= 0) multiTrialDrafts[index] = latest;
  multiTrialRememberValues();
  renderMultiTrialFields();
  result.innerHTML = `
    <div class="multi-trial-state is-warning" role="status"><span aria-hidden="true">↻</span><div><strong>Список полей обновлён</strong><p>${multiTrialEscape(reason)} Было полей: ${cached.fields.length}, сейчас: ${latest.fields.length}. Уже введённые примеры сохранены; заполните подсвеченные новые поля и повторите проверку.</p></div></div>`;
  document.querySelector("#templateMultiTrialMessage").className = "is-warning";
  document.querySelector("#templateMultiTrialMessage").textContent =
    "Ничего не сохранено: сначала проверьте обновлённый список тестовых полей.";
}

async function submitMultiTrial(event) {
  event.preventDefault();
  if (multiTrialBusy) return;
  const cachedDraft = selectedMultiTrialDraft();
  const form = event.currentTarget;
  const button = form.querySelector("#templateMultiTrialSubmit");
  const message = form.querySelector("#templateMultiTrialMessage");
  const result = document.querySelector("#templateMultiTrialResult");
  if (!cachedDraft || !button || !message || !result) return;
  multiTrialRememberValues();

  multiTrialBusy = true;
  button.disabled = true;
  button.textContent = "Сверяем список полей…";
  message.className = "is-loading";
  message.textContent = "Сначала проверяем, что после настройки строки состав полей не изменился.";
  try {
    const latestBody = await multiTrialFetchJson(
      `/api/v1/spaces/${encodeURIComponent(currentMultiTrialSpaceId())}/template-drafts/${encodeURIComponent(cachedDraft.id)}`
    );
    const latestDraft = latestBody.data;
    if (!multiTrialSameFields(cachedDraft, latestDraft)) {
      await multiTrialRefreshChangedDraft(
        cachedDraft,
        result,
        "После открытия этой формы настройки строки были изменены."
      );
      return;
    }
    const values = latestDraft.fields.map((field) => {
      const control = form.querySelector(`[data-field-id="${CSS.escape(field.id)}"]`);
      if (!control) {
        throw new Error(
          `Поле «${field.label}» появилось после открытия формы. Список будет обновлён.`
        );
      }
      const raw = String(control.value);
      if (raw.trim() === "") {
        throw new Error(
          `Введите тестовый пример для поля «${field.label}» или нажмите «Заполнить безопасными примерами».`
        );
      }
      return { fieldId: field.id, value: parseFieldValue(control, field) };
    });

    button.textContent = "Проверяем пробную копию…";
    message.textContent =
      "Вставляем все тестовые значения в одну копию и считываем их обратно. Исходный файл не изменяется.";
    result.innerHTML = `
      <div class="multi-trial-state is-pending" role="status"><span aria-hidden="true">⏳</span><div><strong>Проверяем шаблон</strong><p>Версия будет сохранена только при совпадении всех записанных и считанных значений.</p></div></div>`;
    const body = await multiTrialFetchJson(
      `/api/v1/spaces/${encodeURIComponent(currentMultiTrialSpaceId())}/template-drafts/${encodeURIComponent(latestDraft.id)}/trial-all`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values })
      }
    );
    const data = body.data;
    message.className = "is-success";
    message.textContent = `Проверено полей: ${data.version.fieldCount}. Пробная версия сохранена.`;
    result.innerHTML = `
      <article class="multi-trial-success">
        <div class="multi-trial-success-heading"><span aria-hidden="true">✓</span><div><strong>Шаблон прошёл общую проверку</strong><p>Система записала и успешно считала обратно каждое тестовое значение.</p></div></div>
        <div class="multi-trial-check-list">${data.version.fields
          .map(
            (field) => `<div><span>${multiTrialEscape(field.fieldLabel)}</span><strong>${multiTrialEscape(field.readBackValue)}</strong></div>`
          )
          .join("")}</div>
        <div class="multi-trial-downloads"><a class="secondary-button" href="${multiTrialEscape(data.downloads.compiled)}">Скачать копию для настройки</a><a class="primary-button" href="${multiTrialEscape(data.downloads.trial)}">Скачать проверенную копию</a></div>
        <details><summary>Технические сведения</summary><dl><div><dt>Идентификатор операции</dt><dd><code>${multiTrialEscape(body.correlationId || "не указан")}</code></dd></div></dl></details>
      </article>`;
    globalThis.docomatorTemplateWizard?.complete(3, {
      draftId: latestDraft.id,
      versionId: data.version.id,
      versionKind: "multi"
    });
    await loadMultiTrialHistory();
  } catch (error) {
    if (
      /состав полей|все поля текущего черновика|появилось после открытия|not found in this draft/iu.test(
        error?.message || ""
      )
    ) {
      try {
        await multiTrialRefreshChangedDraft(
          cachedDraft,
          result,
          "Сервер обнаружил более новую настройку шаблона."
        );
        return;
      } catch {
        // Ниже показывается исходная ошибка, если обновление тоже не удалось.
      }
    }
    message.className = "is-error";
    message.textContent = "Пробная версия не сохранена. Введённые примеры остались в форме.";
    result.innerHTML = `
      <div class="multi-trial-state is-error"><span aria-hidden="true">!</span><div><strong>Проверка шаблона не завершена</strong><p>${multiTrialEscape(error?.message || "Исправьте тестовые примеры и повторите действие.")}</p>${error?.operationId ? `<small>Идентификатор операции: <code>${multiTrialEscape(error.operationId)}</code>.</small>` : ""}</div></div>`;
  } finally {
    multiTrialBusy = false;
    button.disabled = false;
    button.textContent = "Создать и проверить пробную копию";
  }
}

window.addEventListener("docomator:template-draft-changed", (event) => {
  const currentDraftId = currentMultiTrialDraftId();
  if (
    event.detail?.spaceId === currentMultiTrialSpaceId() &&
    (!currentDraftId || event.detail?.draftId === currentDraftId)
  ) {
    multiTrialRememberValues();
    void loadMultiTrialDrafts();
  }
});

document.addEventListener("docomator:template-wizard-step-completed", (event) => {
  if (event.detail?.step === 2 && event.detail?.spaceId === currentMultiTrialSpaceId()) {
    multiTrialRememberValues();
    void loadMultiTrialDrafts();
  }
});

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

globalThis.docomatorMultiTrial = {
  reload: loadMultiTrialDrafts,
  hasForm: () => {
    const form = document.querySelector("#templateMultiTrialForm");
    const currentDraftId = currentMultiTrialDraftId();
    return Boolean(
      form &&
        (!currentDraftId || form.dataset.draftId === currentDraftId)
    );
  }
};

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
