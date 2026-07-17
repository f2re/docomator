const structureElements = {
  input: document.querySelector("#documentIntakeFile"),
  statusTitle: document.querySelector("#documentIntakeStatusTitle"),
  templatesView: document.querySelector('[data-view="templates"]')
};

let structureBusy = false;
let structureRequestVersion = 0;
let fieldBusy = false;
let structureReport = null;
let structureDraft = null;
let structureSource = null;
let selectedStructureElement = null;
let selectedStructureTextRange = null;
let structurePropertyDefinitions = [];

function structureEscape(value) {
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

async function structureFetchJson(url, options = {}) {
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

function currentStructureFile() {
  return structureElements.input?.files?.[0] ?? null;
}

function structurePanel() {
  return document.querySelector("#documentStructurePanel");
}

function structureAllowed() {
  return Boolean(globalThis.docomatorTemplateWizard?.isComplete(1));
}

function structureWizardArtifacts() {
  return globalThis.docomatorTemplateWizard?.artifacts?.() || {};
}

function createStructurePanel() {
  if (!structureElements.templatesView || structurePanel()) return;
  const panel = document.createElement("section");
  panel.id = "documentStructurePanel";
  panel.className = "structure-panel";
  panel.dataset.templateWizardPanel = "2";
  panel.hidden = true;
  panel.innerHTML = `
    <article class="panel structure-card">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Поля шаблона</p>
          <h2>Выберите место для первого поля</h2>
          <p>Система покажет текст и ячейки документа. Нажмите на нужное место и выберите поле карточки сотрудника.</p>
        </div>
        <span class="template-file-mark" aria-hidden="true">Aa</span>
      </div>
      <div class="structure-actions">
        <button class="primary-button" id="documentStructureButton" type="button">Построить структуру</button>
        <p id="documentStructureHint">После анализа выберите абзац DOCX и выделите в нём изменяемый текст либо выберите ячейку XLSX.</p>
      </div>
      <div id="documentStructureResult" class="structure-result" aria-live="polite">
        <div class="structure-empty"><span aria-hidden="true">🧱</span><div><strong>Структура ещё не построена</strong><p>Сначала завершите проверку документа, затем нажмите кнопку выше.</p></div></div>
      </div>
    </article>`;
  (document.querySelector("#templateWizardDynamicStages") || structureElements.templatesView).append(panel);
  panel.querySelector("#documentStructureButton")?.addEventListener("click", analyzeStructure);
}

function resetStructurePanel() {
  structureRequestVersion += 1;
  structureBusy = false;
  structureReport = null;
  structureDraft = null;
  structureSource = null;
  selectedStructureElement = null;
  selectedStructureTextRange = null;
  const panel = structurePanel();
  if (!panel) return;
  panel.hidden = true;
  const button = panel.querySelector("#documentStructureButton");
  const result = panel.querySelector("#documentStructureResult");
  if (button) {
    button.disabled = false;
    button.hidden = false;
    button.textContent = "Построить структуру";
  }
  if (result) {
    result.innerHTML = `
      <div class="structure-empty"><span aria-hidden="true">🧱</span><div><strong>Структура ещё не построена</strong><p>Сначала завершите проверку документа, затем нажмите кнопку выше.</p></div></div>`;
  }
}

function refreshStructureAvailability() {
  createStructurePanel();
  const panel = structurePanel();
  if (!panel) return;
  const file = currentStructureFile();
  const sourceId = structureWizardArtifacts().sourceId;
  const isReady = Boolean(structureAllowed() && typeof sourceId === "string" && sourceId !== "");
  panel.dataset.ready = String(isReady);
  const button = panel.querySelector("#documentStructureButton");
  if (button && structureReport === null) button.disabled = !isReady;
  if (isReady && structureReport === null) {
    const result = panel.querySelector("#documentStructureResult");
    if (result) {
      result.innerHTML = `
        <div class="structure-empty"><span aria-hidden="true">✅</span><div><strong>Проверенный исходник готов</strong><p>${file ? "Теперь можно безопасно получить абзацы, текстовые фрагменты и ячейки." : "Система продолжит с сохранённой копии. Повторно выбирать локальный файл не нужно."}</p></div></div>`;
    }
  } else if (!isReady && structureReport === null) {
    const result = panel.querySelector("#documentStructureResult");
    if (result) {
      result.innerHTML = `
        <div class="structure-empty"><span aria-hidden="true">↶</span><div><strong>Сначала сохраните исходник</strong><p>Вернитесь к шагу «Документ», проверьте файл и подтвердите его сохранение.</p></div></div>`;
    }
  }
  globalThis.docomatorTemplateWizard?.render();
}

function structureLocation(element) {
  if (element.kind === "cell") {
    return `${element.sheetName} · ${element.address}`;
  }
  if (element.tableLocation) {
    const location = element.tableLocation;
    return `Таблица ${location.tableIndex + 1}, строка ${location.rowIndex + 1}, ячейка ${location.columnIndex + 1}`;
  }
  if (element.part === "word/document.xml") return `Основной текст · абзац ${element.index + 1}`;
  if (String(element.part).includes("header")) return `Верхний колонтитул · абзац ${element.index + 1}`;
  if (String(element.part).includes("footer")) return `Нижний колонтитул · абзац ${element.index + 1}`;
  if (String(element.part).includes("footnote")) return `Сноски · абзац ${element.index + 1}`;
  return `Дополнительная область · абзац ${element.index + 1}`;
}

function structurePreview(element) {
  if (element.kind === "cell") {
    if (element.formula) return `Формула: ${element.formula} · значение: ${element.value || "пусто"}`;
    return element.value || "Пустая ячейка";
  }
  return element.text || "Пустой абзац";
}

function fieldTypeOptions() {
  return [
    ["string", "Короткая строка"],
    ["text", "Длинный текст"],
    ["number", "Число"],
    ["integer", "Целое число"],
    ["boolean", "Да / нет"],
    ["date", "Дата"],
    ["date-time", "Дата и время"]
  ]
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
}

function structureFieldTypeLabel(valueType) {
  return (
    {
      string: "Короткая строка",
      text: "Длинный текст",
      number: "Число",
      integer: "Целое число",
      boolean: "Да / нет",
      date: "Дата",
      "date-time": "Дата и время"
    }[valueType] || "Значение"
  );
}

function structurePropertyOptions() {
  const applicable = structurePropertyDefinitions.filter((definition) => {
    const appliesTo = Array.isArray(definition.appliesTo) ? definition.appliesTo : [];
    return appliesTo.length === 0 || appliesTo.includes("person");
  });
  return [
    ...applicable.map(
      (definition) =>
        `<option value="${structureEscape(definition.key)}">${structureEscape(definition.label)} · ${structureEscape(structureFieldTypeLabel(definition.valueType))}</option>`
    ),
    '<option value="__new__">Добавить новое поле сотрудника…</option>'
  ].join("");
}

async function loadStructurePropertyDefinitions() {
  const body = await structureFetchJson(
    "/api/v1/knowledge/property-definitions?limit=500"
  );
  structurePropertyDefinitions = Array.isArray(body.data) ? body.data : [];
}

function renderNewStructurePropertyFields() {
  const select = document.querySelector("#documentFieldProperty");
  const fields = document.querySelector("#documentNewPropertyFields");
  if (!select || !fields) return;
  fields.hidden = select.value !== "__new__";
  renderStructureFormatterFields();
}

function selectedStructureValueType() {
  const propertyKey = document.querySelector("#documentFieldProperty")?.value || "";
  if (propertyKey === "__new__") {
    return document.querySelector("#documentFieldType")?.value || "string";
  }
  return (
    structurePropertyDefinitions.find((definition) => definition.key === propertyKey)
      ?.valueType || "string"
  );
}

function renderStructureFormatterFields() {
  const container = document.querySelector("#documentFieldFormatter");
  if (!container) return;
  const valueType = selectedStructureValueType();
  if (valueType === "number") {
    const options = [
      '<option value="">Без фиксированного количества</option>',
      ...Array.from(
        { length: 7 },
        (_, digits) => `<option value="${digits}">${digits}</option>`
      )
    ].join("");
    container.innerHTML = `
      <label>
        <span>Знаков после запятой</span>
        <select id="documentFieldDecimalPlaces">${options}</select>
        <small>В документе используется запятая. Без фиксации лишние нули не добавляются.</small>
      </label>`;
    return;
  }
  if (valueType === "date-time") {
    const detectedTimeZone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow";
    container.innerHTML = `
      <label>
        <span>Часовой пояс документа</span>
        <input id="documentFieldTimeZone" type="text" maxlength="100" value="${structureEscape(detectedTimeZone)}" placeholder="Europe/Moscow" />
        <small>Дата и время будут зафиксированы в этом часовом поясе, например 16.07.2026 12:30.</small>
      </label>`;
    return;
  }
  container.innerHTML = "";
}

function structureTextRangeControl(element) {
  if (element.kind !== "paragraph") return "";
  const unavailable = element.runsTruncated || !element.text;
  return `
    <label class="structure-text-range-field" for="documentFieldTextRange">
      <span>Какой текст заменить значением?</span>
      <textarea id="documentFieldTextRange" readonly${unavailable ? " disabled" : ""}>${structureEscape(element.text || "")}</textarea>
      <small id="documentFieldTextRangeMessage">${
        element.runsTruncated
          ? "В этом абзаце слишком много фрагментов для безопасного выделения. Выберите другой абзац."
          : element.text
            ? "Выделите плейсхолдер или другой изменяемый текст. Подпись до и после выделения останется без изменений."
            : "В пустом абзаце нельзя выделить место для поля. Выберите абзац с текстом."
      }</small>
    </label>`;
}

function structureRepeatRowControl(element) {
  if (element.kind !== "paragraph" || !element.tableLocation) return "";
  const current = structureDraft?.repeatBinding;
  const selected =
    current &&
    current.part === element.part &&
    current.tableIndex === element.tableLocation.tableIndex &&
    current.rowIndex === element.tableLocation.rowIndex;
  return `
    <label class="structure-required-field">
      <input id="documentFieldRepeatRow" type="checkbox"${selected ? " checked" : ""} />
      <span><strong>Повторять эту строку для сотрудников</strong><small>В сводном документе строка будет скопирована по одному разу для каждого участника. Все изменяемые поля такого шаблона должны находиться в этой строке.</small></span>
    </label>`;
}

function captureStructureTextRange() {
  const control = document.querySelector("#documentFieldTextRange");
  const message = document.querySelector("#documentFieldTextRangeMessage");
  const save = document.querySelector("#documentFieldSave");
  if (!control || !message || !selectedStructureElement) return;
  const startOffset = control.selectionStart;
  const endOffset = control.selectionEnd;
  if (endOffset <= startOffset) {
    selectedStructureTextRange = null;
    if (save) save.disabled = true;
    message.textContent =
      "Выделите плейсхолдер или другой изменяемый текст. Подпись до и после выделения останется без изменений.";
    return;
  }
  selectedStructureTextRange = { startOffset, endOffset };
  if (save) save.disabled = false;
  const selected = selectedStructureElement.text.slice(startOffset, endOffset);
  message.textContent = `Будет заменён только фрагмент «${selected}». Остальной текст абзаца сохранится.`;
}

function renderStructureSelection(element) {
  selectedStructureElement = element;
  selectedStructureTextRange = null;
  document.querySelectorAll(".structure-element.is-selected").forEach((item) => {
    item.classList.remove("is-selected");
    item.setAttribute("aria-pressed", "false");
  });
  const selected = document.querySelector(`[data-structure-id="${CSS.escape(element.id)}"]`);
  selected?.classList.add("is-selected");
  selected?.setAttribute("aria-pressed", "true");

  const detail = document.querySelector("#documentStructureSelection");
  if (!detail) return;
  detail.innerHTML = `
    <div class="structure-selection-content">
      <strong>${structureEscape(structureLocation(element))}</strong>
      <p>${structureEscape(structurePreview(element))}</p>
      <form class="structure-field-form" id="documentFieldForm" novalidate>
        <div class="structure-field-grid">
          ${structureTextRangeControl(element)}
          ${structureRepeatRowControl(element)}
          <label>
            <span>Какое поле сотрудника поставить сюда?</span>
            <select id="documentFieldProperty" name="propertyKey">${structurePropertyOptions()}</select>
            <small>Выберите понятное поле карточки. Техническую связь система создаст сама.</small>
          </label>
          <div id="documentNewPropertyFields" class="structure-new-property" hidden>
            <label>
              <span>Название нового поля</span>
              <input id="documentFieldLabel" name="label" type="text" maxlength="500" placeholder="Например, Должность" />
            </label>
            <label>
              <span>Тип значения</span>
              <select id="documentFieldType" name="valueType">${fieldTypeOptions()}</select>
            </label>
            <label class="structure-required-field">
              <input id="documentPropertyConfirm" type="checkbox" />
              <span><strong>Добавить поле всем сотрудникам</strong><small>Поле появится в карточках и будет доступно другим шаблонам.</small></span>
            </label>
          </div>
          <div id="documentFieldFormatter" class="structure-new-property"></div>
          <label class="structure-required-field">
            <input id="documentFieldRequired" name="required" type="checkbox" />
            <span><strong>Обязательное поле</strong><small>Без значения документ нельзя будет завершить.</small></span>
          </label>
        </div>
        <details class="intake-technical">
          <summary>Технические сведения</summary>
          <p>Координата: <code>${structureEscape(element.id)}</code>. Часть пакета: <code>${structureEscape(element.part || element.sheetName || "не указана")}</code>. Сервер повторно проверит её по сохранённой структуре.</p>
        </details>
        <div class="structure-field-actions">
          <button class="primary-button" id="documentFieldSave" type="submit"${element.kind === "paragraph" ? " disabled" : ""}>Связать с документом</button>
          <p id="documentFieldMessage">Исходник должен быть сохранён в выбранном разделе данных.</p>
        </div>
      </form>
    </div>`;
  detail.hidden = false;
  detail
    .querySelector("#documentFieldProperty")
    ?.addEventListener("change", renderNewStructurePropertyFields);
  detail
    .querySelector("#documentFieldType")
    ?.addEventListener("change", renderStructureFormatterFields);
  const textRange = detail.querySelector("#documentFieldTextRange");
  for (const eventName of ["select", "mouseup", "keyup", "touchend"]) {
    textRange?.addEventListener(eventName, captureStructureTextRange);
  }
  renderNewStructurePropertyFields();
  detail.querySelector("#documentFieldForm")?.addEventListener("submit", saveSelectedField);
}

async function loadStructureDraft() {
  const spaceId = globalThis.docomatorTemplateWizard?.spaceId() || "";
  if (!spaceId) {
    throw { message: "Сначала выберите раздел данных." };
  }
  if (structureDraft?.id && structureSource?.id) {
    structureReportFromDraft(structureDraft, structureSource, spaceId);
    return { spaceId, draft: structureDraft };
  }
  const artifacts = structureWizardArtifacts();
  const sourceId = artifacts.sourceId;
  const draftId = artifacts.draftId;
  if (typeof sourceId !== "string" || sourceId === "") {
    throw { message: "Сохранённый исходник не найден. Вернитесь к первому шагу." };
  }
  if (typeof draftId !== "string" || draftId === "") {
    throw {
      message: "Сначала постройте структуру сохранённого исходника."
    };
  }
  const [sourceBody, draftBody] = await Promise.all([
    structureFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/document-sources/${encodeURIComponent(sourceId)}`
    ),
    structureFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draftId)}`
    )
  ]);
  structureSource = sourceBody.data;
  structureDraft = draftBody.data;
  structureReportFromDraft(structureDraft, structureSource, spaceId);
  return { spaceId, draft: structureDraft };
}

async function saveSelectedField(event) {
  event.preventDefault();
  if (fieldBusy || !selectedStructureElement || !structureReport) return;
  const form = event.currentTarget;
  const button = form.querySelector("#documentFieldSave");
  const message = form.querySelector("#documentFieldMessage");
  const propertyKey = form.querySelector("#documentFieldProperty")?.value || "";
  let definition = structurePropertyDefinitions.find(
    (candidate) => candidate.key === propertyKey
  );
  const label = form.querySelector("#documentFieldLabel")?.value?.trim() || "";
  const valueType = form.querySelector("#documentFieldType")?.value || "string";
  const required = Boolean(form.querySelector("#documentFieldRequired")?.checked);
  const repeatRow = Boolean(form.querySelector("#documentFieldRepeatRow")?.checked);
  const creatingProperty = propertyKey === "__new__";
  const propertyConfirmed = Boolean(form.querySelector("#documentPropertyConfirm")?.checked);
  if (
    selectedStructureElement.kind === "paragraph" &&
    selectedStructureTextRange === null
  ) {
    message.className = "is-error";
    message.textContent =
      "Выделите в абзаце плейсхолдер или другой текст, который нужно заменять.";
    return;
  }
  if (!propertyKey || (creatingProperty && (!label || !propertyConfirmed))) {
    message.className = "is-error";
    message.textContent = creatingProperty
      ? "Укажите название и подтвердите добавление поля всем сотрудникам."
      : "Выберите поле сотрудника.";
    return;
  }

  fieldBusy = true;
  button.disabled = true;
  message.className = "is-loading";
  message.textContent =
    "Проверяем сохранённый исходник, заново строим структуру и сверяем выбранную координату.";

  try {
    const { spaceId, draft } = await loadStructureDraft();
    if (creatingProperty) {
      const labelMatches = structurePropertyDefinitions.filter(
        (candidate) =>
          candidate.label.trim().toLocaleLowerCase("ru-RU") ===
          label.toLocaleLowerCase("ru-RU")
      );
      if (labelMatches.length > 1) {
        throw { message: `Найдено несколько полей «${label}». Выберите нужное из списка.` };
      }
      const labelMatch = labelMatches[0];
      if (labelMatch && labelMatch.valueType !== valueType) {
        throw { message: `Поле «${label}» уже существует с другим типом значения.` };
      }
      if (labelMatch) {
        definition = labelMatch;
      } else {
        const definitionBody = await structureFetchJson(
          "/api/v1/knowledge/property-definitions",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              label,
              valueType,
              appliesTo: ["person"],
              sensitivity: "personal"
            })
          }
        );
        definition = definitionBody.data;
        structurePropertyDefinitions = [
          ...structurePropertyDefinitions,
          definition
        ];
      }
    }
    if (!definition) throw { message: "Выбранное поле сотрудника не найдено." };
    const decimalPlacesValue =
      form.querySelector("#documentFieldDecimalPlaces")?.value ?? "";
    const timeZone =
      form.querySelector("#documentFieldTimeZone")?.value?.trim() || "";
    const fieldBody = await structureFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draft.id)}/fields`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: definition.key,
          label: definition.label,
          valueType: definition.valueType,
          required,
          elementId: selectedStructureElement.id,
          ...(repeatRow ? { repeatRow: true } : {}),
          ...(definition.valueType === "number" && decimalPlacesValue !== ""
            ? { decimalPlaces: Number(decimalPlacesValue) }
            : {}),
          ...(definition.valueType === "date-time" && timeZone
            ? { timeZone }
            : {}),
          ...(selectedStructureElement.kind === "paragraph"
            ? { textRange: selectedStructureTextRange }
            : {})
        })
      }
    );
    message.className = "is-success";
    message.innerHTML = `Поле «${structureEscape(fieldBody.data.field.label)}» связано с документом. Следующий шаг — пробное заполнение.`;
    button.textContent = "Связано";
    button.hidden = true;
    structureDraft.repeatBinding = fieldBody.data.repeatBinding;
    structureDraft.fields = [
      ...(Array.isArray(structureDraft.fields) ? structureDraft.fields : []),
      fieldBody.data.field
    ];
    form.querySelectorAll("input, select").forEach((control) => {
      control.disabled = true;
    });
    const actions = form.querySelector(".structure-field-actions");
    actions?.insertAdjacentHTML(
      "beforeend",
      `<div class="structure-field-next">
        <button class="secondary-button" id="documentFieldAddAnother" type="button">Добавить ещё поле</button>
        <button class="primary-button" id="documentFieldsContinue" type="button">Перейти к проверке</button>
      </div>`
    );
    actions
      ?.querySelector("#documentFieldAddAnother")
      ?.addEventListener("click", () => {
        const next = document.querySelector(".structure-element:not(.is-selected)");
        next?.focus();
        next?.scrollIntoView({
          block: "center",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth"
        });
      });
    actions
      ?.querySelector("#documentFieldsContinue")
      ?.addEventListener("click", () => {
        globalThis.docomatorTemplateWizard?.complete(2, {
          sourceId: draft.sourceRecordId || structureWizardArtifacts().sourceId,
          draftId: draft.id
        });
      });
  } catch (error) {
    const operationId = error?.operationId || "";
    message.className = "is-error";
    message.innerHTML = `${structureEscape(error?.message || "Сохранить поле не удалось.")}${operationId ? ` Идентификатор операции: <code>${structureEscape(operationId)}</code>.` : ""}`;
    button.disabled = false;
  } finally {
    fieldBusy = false;
  }
}

function renderStructure(report, operationId) {
  structureReport = report;
  selectedStructureElement = null;
  const result = document.querySelector("#documentStructureResult");
  const analyzeButton = document.querySelector("#documentStructureButton");
  if (!result) return;
  if (analyzeButton) analyzeButton.hidden = true;

  const summary = report.summary;
  const metrics =
    report.format === "docx"
      ? [
          [summary.paragraphs, "абзацев"],
          [summary.runs, "текстовых фрагментов"],
          [summary.partsRead, "прочитанных частей"]
        ]
      : [
          [summary.sheets, "листов"],
          [summary.cells, "ячеек"],
          [summary.formulas, "формул"]
        ];

  const items = report.elements
    .map(
      (element) => `
        <button class="structure-element" type="button" data-structure-id="${structureEscape(element.id)}" aria-pressed="false">
          <span class="structure-element-kind" aria-hidden="true">${element.kind === "cell" ? "▦" : "¶"}</span>
          <span class="structure-element-copy">
            <strong>${structureEscape(structureLocation(element))}</strong>
            <span>${structureEscape(structurePreview(element))}</span>
            ${element.kind === "paragraph" && element.runsTruncated ? "<small>Показана только часть текстовых фрагментов этого абзаца.</small>" : ""}
          </span>
        </button>`
    )
    .join("");

  result.innerHTML = `
    <article class="structure-report">
      <header>
        <div><p class="eyebrow">Поля документа</p><h3>${structureEscape(report.fileName)}</h3><p>В DOCX выберите абзац, затем выделите только изменяемый текст. В XLSX выберите нужную ячейку.</p></div>
        <span class="pill pill-success">Готово</span>
      </header>
      <div class="structure-metrics">${metrics
        .map(([value, label]) => `<div><strong>${value}</strong><span>${label}</span></div>`)
        .join("")}</div>
      ${report.truncated ? '<div class="structure-warning"><span aria-hidden="true">ℹ️</span><p><strong>Показана ограниченная выборка.</strong> Полные количества сохранены в сводке, а страница не перегружена.</p></div>' : ""}
      <div class="structure-element-list" role="list">${items || '<div class="structure-empty"><span aria-hidden="true">📭</span><div><strong>Элементы не найдены</strong><p>Документ не содержит доступных абзацев или ячеек.</p></div></div>'}</div>
      <div class="structure-selection" id="documentStructureSelection" hidden></div>
      <details class="intake-technical">
        <summary>Технические сведения</summary>
        <dl>
          <div><dt>Контрольная сумма исходника</dt><dd><code>${structureEscape(report.sourceSha256)}</code></dd></div>
          <div><dt>Контрольная сумма структуры</dt><dd><code>${structureEscape(report.structureSha256)}</code></dd></div>
          <div><dt>Показано элементов</dt><dd>${summary.shownElements} из ${summary.totalElements}</dd></div>
          <div><dt>Идентификатор операции</dt><dd><code>${structureEscape(operationId || "не указан")}</code></dd></div>
        </dl>
      </details>
    </article>`;

  result.querySelectorAll(".structure-element").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-structure-id");
      const element = report.elements.find((candidate) => candidate.id === id);
      if (element) renderStructureSelection(element);
    });
  });
}

function structureReportFromDraft(draft, source, spaceId) {
  const report = draft?.structure;
  if (
    !source ||
    typeof source.id !== "string" ||
    source.spaceId !== spaceId ||
    typeof source.sha256 !== "string" ||
    !draft ||
    typeof draft.id !== "string" ||
    draft.spaceId !== spaceId ||
    draft.sourceRecordId !== source.id ||
    draft.sourceSha256 !== source.sha256 ||
    !report ||
    typeof report !== "object" ||
    typeof report.fileName !== "string" ||
    typeof report.format !== "string" ||
    report.sourceSha256 !== source.sha256 ||
    !report.summary ||
    typeof report.summary !== "object" ||
    !Array.isArray(report.elements)
  ) {
    throw {
      message: "Структура не соответствует сохранённому исходнику. Данные не изменены; постройте её заново."
    };
  }
  return report;
}

async function analyzeStructure() {
  if (structureBusy) return;
  const requestVersion = ++structureRequestVersion;
  const file = currentStructureFile();
  const sourceId = structureWizardArtifacts().sourceId;
  const spaceId = globalThis.docomatorTemplateWizard?.spaceId() || "";
  const button = document.querySelector("#documentStructureButton");
  const result = document.querySelector("#documentStructureResult");
  if (
    !spaceId ||
    typeof sourceId !== "string" ||
    sourceId === "" ||
    !button ||
    !result
  ) return;

  structureBusy = true;
  button.disabled = true;
  button.textContent = "Читаем структуру…";
  result.innerHTML = `
    <div class="structure-loading" role="status">
      <span aria-hidden="true">⏳</span>
      <div><strong>Читаем сохранённый исходник</strong><p>Повторно проверяем контрольную сумму и XML, затем показываем доступные места для полей.</p></div>
    </div>`;

  try {
    const title = file?.name?.replace(/\.(docx|xlsx)$/iu, "") || "";
    const draftId = structureWizardArtifacts().draftId;
    const draftRequest =
      typeof draftId === "string" && draftId !== ""
        ? structureFetchJson(
            `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draftId)}`
          )
        : structureFetchJson(
            `/api/v1/spaces/${encodeURIComponent(spaceId)}/document-sources/${encodeURIComponent(sourceId)}/draft`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(title ? { title } : {})
            }
          );
    const [, sourceBody, draftBody] = await Promise.all([
      loadStructurePropertyDefinitions(),
      structureFetchJson(
        `/api/v1/spaces/${encodeURIComponent(spaceId)}/document-sources/${encodeURIComponent(sourceId)}`
      ),
      draftRequest
    ]);
    if (
      requestVersion !== structureRequestVersion ||
      globalThis.docomatorTemplateWizard?.spaceId() !== spaceId
    ) return;
    structureSource = sourceBody.data;
    structureDraft = draftBody.data;
    const report = structureReportFromDraft(
      structureDraft,
      structureSource,
      spaceId
    );
    globalThis.docomatorTemplateWizard?.remember?.({
      sourceId,
      draftId: structureDraft.id
    });
    renderStructure(report, draftBody.correlationId);
    button.textContent = "Построить заново";
  } catch (error) {
    if (requestVersion !== structureRequestVersion) return;
    const message = error?.message || "Структуру построить не удалось.";
    const operationId = error?.operationId || "";
    result.innerHTML = `
      <div class="structure-error">
        <span aria-hidden="true">⚠️</span>
        <div><strong>Структура не построена</strong><p>${structureEscape(message)}</p><small>Файл не изменён.${operationId ? ` Идентификатор операции: <code>${structureEscape(operationId)}</code>.` : ""}</small></div>
      </div>`;
    button.textContent = "Повторить анализ";
  } finally {
    if (requestVersion !== structureRequestVersion) return;
    structureBusy = false;
    button.disabled = false;
  }
}

if (structureElements.input && structureElements.statusTitle && structureElements.templatesView) {
  createStructurePanel();
  structureElements.input.addEventListener("change", resetStructurePanel);
  new MutationObserver(refreshStructureAvailability).observe(
    structureElements.statusTitle,
    { childList: true, characterData: true, subtree: true }
  );
  document.addEventListener(
    "docomator:template-wizard-step-completed",
    (event) => {
      if (event.detail?.step === 1) refreshStructureAvailability();
    }
  );
  document.addEventListener("docomator:space-changed", () => {
    resetStructurePanel();
    refreshStructureAvailability();
  });
  refreshStructureAvailability();
}
