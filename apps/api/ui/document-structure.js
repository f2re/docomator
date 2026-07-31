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
    ["enum", "Список вариантов"],
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
      enum: "Список вариантов",
      number: "Число",
      integer: "Целое число",
      boolean: "Да / нет",
      date: "Дата",
      "date-time": "Дата и время"
    }[valueType] || "Значение"
  );
}

const structureSystemPropertyDefinitions = [
  {
    key: "__system_display_name__",
    label: "ФИО сотрудника",
    valueType: "string",
    systemSource: "display-name",
    appliesTo: ["person"]
  }
];

const structureNamePatterns = {
  identity: null,
  full: "{Фамилия} {Имя} {Отчество}",
  "family-initials": "{Фамилия} {И}.{О}.",
  "initials-family": "{И}.{О}. {Фамилия}",
  family: "{Фамилия}",
  "family-given": "{Фамилия} {Имя}",
  "given-family": "{Имя} {Фамилия}",
  "given-patronymic": "{Имя} {Отчество}"
};

function structurePropertyGroup(definition) {
  return globalThis.docomatorFieldGroups.key(definition);
}

function structureHeaderForElement(element) {
  const location = element?.tableLocation;
  if (!location || location.rowIndex < 1) return "";
  const previous = (structureReport?.elements || []).find(
    (candidate) =>
      candidate.kind === "paragraph" &&
      candidate.part === element.part &&
      candidate.tableLocation?.tableIndex === location.tableIndex &&
      candidate.tableLocation?.rowIndex === location.rowIndex - 1 &&
      candidate.tableLocation?.columnIndex === location.columnIndex &&
      String(candidate.text || "").trim() !== ""
  );
  return String(previous?.text || "").trim();
}

function structureInferredFieldGroup(element) {
  return globalThis.docomatorFieldGroups.infer(
    `${structureHeaderForElement(element)} ${structurePreview(element)} ${structureDraft?.title || ""}`
  );
}

function structureGroupSelectOptions(selected) {
  return globalThis.docomatorFieldGroups.options(selected, { includeUnassigned: true });
}

function structureSelectedDefinition(propertyKey = document.querySelector("#documentFieldProperty")?.value || "") {
  return (
    structureSystemPropertyDefinitions.find((definition) => definition.key === propertyKey) ||
    structurePropertyDefinitions.find((definition) => definition.key === propertyKey)
  );
}

function structureStableToken(value) {
  let hash = 2166136261;
  for (let index = 0; index < String(value).length; index += 1) {
    hash ^= String(value).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function structureEffectiveDefinition(definition, element) {
  if (definition?.systemSource !== "display-name") return definition;
  return {
    ...definition,
    key: `subject.name_${structureStableToken(element.id)}.display_name`
  };
}

function structurePropertyOptions(selectedGroup = "common") {
  const applicable = structurePropertyDefinitions
    .filter((definition) => {
      const appliesTo = Array.isArray(definition.appliesTo) ? definition.appliesTo : [];
      return appliesTo.length === 0 || appliesTo.includes("person");
    })
    .filter((definition) =>
      globalThis.docomatorFieldGroups.allowed(definition, selectedGroup, {
        includeUnassigned: true
      })
    );
  const grouped = globalThis.docomatorFieldGroups.grouped(
    applicable,
    selectedGroup,
    { includeUnassigned: true }
  );
  const order = [...new Set(["common", selectedGroup, "unassigned"])];
  return [
    '<optgroup label="Системные значения">',
    '<option value="__system_display_name__" data-search-terms="фио имя фамилия инициалы">ФИО участника · с выбором варианта записи</option>',
    "</optgroup>",
    ...order
      .filter((group) => grouped.get(group)?.length)
      .map(
        (group) =>
          `<optgroup label="${structureEscape(globalThis.docomatorFieldGroups.label(group))}">${grouped
            .get(group)
            .map(
              (definition) =>
                `<option value="${structureEscape(definition.key)}" data-search-terms="${structureEscape(`${definition.label} ${(definition.aliases || []).join(" ")}`)}">${structureEscape(definition.label)} · ${structureEscape(structureFieldTypeLabel(definition.valueType))}</option>`
            )
            .join("")}</optgroup>`
      ),
    '<optgroup label="Действия"><option value="__new__">Создать новое поле в выбранном разделе…</option></optgroup>'
  ].join("");
}

function refreshStructurePropertySelector() {
  const group = document.querySelector("#documentFieldGroup")?.value || "common";
  const select = document.querySelector("#documentFieldProperty");
  if (!select) return;
  const previous = select.value;
  select.innerHTML = structurePropertyOptions(group);
  if ([...select.options].some((option) => option.value === previous)) {
    select.value = previous;
  }
  globalThis.docomatorSearchableSelect?.refresh(select);
  renderNewStructurePropertyFields();
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
  updateStructureFieldReadiness();
}

function selectedStructureValueType() {
  const propertyKey = document.querySelector("#documentFieldProperty")?.value || "";
  if (propertyKey === "__new__") {
    return document.querySelector("#documentFieldType")?.value || "string";
  }
  return structureSelectedDefinition(propertyKey)?.valueType || "string";
}

function structureNamePatternError(pattern) {
  const text = String(pattern || "").normalize("NFKC").trim();
  if (!text || text.length > 160 || /[\u0000-\u001f\u007f]/u.test(text)) {
    return "Укажите безопасный шаблон длиной до 160 знаков.";
  }
  const allowed = new Set(["Фамилия", "Имя", "Отчество", "Ф", "И", "О"]);
  let count = 0;
  const rest = text.replace(/\{([^{}]+)\}/gu, (_match, token) => {
    count += 1;
    return allowed.has(token) ? "" : `{${token}}`;
  });
  if (count === 0 || rest.includes("{") || rest.includes("}")) {
    return "Используйте части {Фамилия}, {Имя}, {Отчество}, {Ф}, {И} или {О}.";
  }
  return "";
}

function structureSelectedPersonName(form = document) {
  const presentation = form.querySelector("#documentFieldTextPresentation")?.value || "identity";
  if (presentation === "identity") return null;
  const pattern =
    presentation === "custom"
      ? form.querySelector("#documentFieldNamePattern")?.value?.trim() || ""
      : structureNamePatterns[presentation];
  const error = structureNamePatternError(pattern);
  if (error) throw { message: error };
  return {
    sourceOrder:
      form.querySelector("#documentFieldNameSourceOrder")?.value ||
      "family-given-patronymic",
    pattern
  };
}

function structureNamePreview() {
  const presentation = document.querySelector("#documentFieldTextPresentation")?.value || "identity";
  const options = document.querySelector("#documentFieldNameOptions");
  const custom = document.querySelector("#documentFieldNamePatternField");
  const preview = document.querySelector("#documentFieldNamePreview");
  if (options) options.hidden = presentation === "identity";
  if (custom) custom.hidden = presentation !== "custom";
  if (!preview || presentation === "identity") {
    updateStructureFieldReadiness();
    return;
  }
  const pattern =
    presentation === "custom"
      ? document.querySelector("#documentFieldNamePattern")?.value || ""
      : structureNamePatterns[presentation] || "";
  const error = structureNamePatternError(pattern);
  if (error) {
    preview.className = "structure-name-preview is-error";
    preview.textContent = error;
    updateStructureFieldReadiness();
    return;
  }
  const sourceOrder =
    document.querySelector("#documentFieldNameSourceOrder")?.value ||
    "family-given-patronymic";
  const source =
    sourceOrder === "given-patronymic-family"
      ? "Иван Иванович Иванов"
      : sourceOrder === "given-family"
        ? "Иван Иванов"
        : sourceOrder === "family-given"
          ? "Иванов Иван"
          : "Иванов Иван Иванович";
  const values = {
    Фамилия: "Иванов",
    Имя: "Иван",
    Отчество: sourceOrder === "family-given" || sourceOrder === "given-family" ? "" : "Иванович",
    Ф: "И",
    И: "И",
    О: sourceOrder === "family-given" || sourceOrder === "given-family" ? "" : "И"
  };
  const result = pattern
    .replace(/\{([^{}]+)\}/gu, (_match, token) => values[token] || "")
    .replace(/\s+/gu, " ")
    .replace(/\s+([,.;:])/gu, "$1")
    .replace(/([,.;:])(?:\s*\1)+/gu, "$1")
    .replace(/\s+[,.;:]+$/gu, "")
    .trim();
  preview.className = "structure-name-preview";
  preview.textContent = `Пример: «${source}» → «${result}».`;
  updateStructureFieldReadiness();
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
    container.hidden = false;
    container.innerHTML = `
      <label>
        <span>Знаков после запятой</span>
        <select id="documentFieldDecimalPlaces">${options}</select>
        <small>В документе используется запятая. Без фиксации лишние нули не добавляются.</small>
      </label>`;
    updateStructureFieldReadiness();
    return;
  }
  if (valueType === "date-time") {
    const detectedTimeZone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow";
    container.hidden = false;
    container.innerHTML = `
      <label>
        <span>Часовой пояс документа</span>
        <input id="documentFieldTimeZone" type="text" maxlength="100" value="${structureEscape(detectedTimeZone)}" placeholder="Europe/Moscow" />
        <small>Дата и время будут зафиксированы в этом часовом поясе, например 16.07.2026 12:30.</small>
      </label>`;
    updateStructureFieldReadiness();
    return;
  }
  if (valueType === "string" || valueType === "text") {
    const systemName = structureSelectedDefinition()?.systemSource === "display-name";
    container.hidden = false;
    container.innerHTML = `
      <div class="structure-name-format">
        <label>
          <span>Как записать текст в документе?</span>
          <select id="documentFieldTextPresentation">
            <option value="identity"${systemName ? "" : " selected"}>Без изменений</option>
            <optgroup label="Варианты ФИО">
              <option value="full"${systemName ? " selected" : ""}>Фамилия Имя Отчество</option>
              <option value="family-initials">Фамилия И.О.</option>
              <option value="initials-family">И.О. Фамилия</option>
              <option value="family">Только фамилия</option>
              <option value="family-given">Фамилия Имя</option>
              <option value="given-family">Имя Фамилия</option>
              <option value="given-patronymic">Имя Отчество</option>
              <option value="custom">Свой шаблон…</option>
            </optgroup>
          </select>
          <small>Варианты ФИО применяйте к полю, где хранится полное имя сотрудника.</small>
        </label>
        <div id="documentFieldNameOptions" class="structure-name-options" hidden>
          <label>
            <span>Как ФИО записано в карточке?</span>
            <select id="documentFieldNameSourceOrder">
              <option value="family-given-patronymic">Фамилия Имя Отчество</option>
              <option value="given-patronymic-family">Имя Отчество Фамилия</option>
              <option value="family-given">Фамилия Имя</option>
              <option value="given-family">Имя Фамилия</option>
            </select>
            <small>Это нужно, чтобы система правильно определила фамилию и инициалы.</small>
          </label>
          <label id="documentFieldNamePatternField" hidden>
            <span>Свой шаблон записи</span>
            <input id="documentFieldNamePattern" type="text" maxlength="160" value="{Фамилия} {И}.{О}." />
            <small>Доступны {Фамилия}, {Имя}, {Отчество}, {Ф}, {И}, {О}.</small>
          </label>
          <output id="documentFieldNamePreview" class="structure-name-preview"></output>
        </div>
      </div>`;
    container
      .querySelector("#documentFieldTextPresentation")
      ?.addEventListener("change", structureNamePreview);
    container
      .querySelector("#documentFieldNameSourceOrder")
      ?.addEventListener("change", structureNamePreview);
    container
      .querySelector("#documentFieldNamePattern")
      ?.addEventListener("input", structureNamePreview);
    structureNamePreview();
    return;
  }
  container.innerHTML = "";
  container.hidden = true;
  updateStructureFieldReadiness();
}

function structureTextRangeControl(element) {
  if (element.kind !== "paragraph") return "";
  if (!element.text) {
    return `
      <div class="structure-placement-card is-ready">
        <input id="documentFieldParagraphMode" type="hidden" value="whole" />
        <strong>Пустое место готово к заполнению</strong>
        <small>Значение будет вставлено в этот абзац или ячейку таблицы. Выделять текст не нужно.</small>
      </div>`;
  }
  const rangeUnavailable = Boolean(element.runsTruncated);
  return `
    <fieldset class="structure-placement-field">
      <legend>Что заменить в этом абзаце?</legend>
      <label class="structure-choice-field">
        <input type="radio" name="documentFieldParagraphMode" value="range"${rangeUnavailable ? " disabled" : " checked"} />
        <span><strong>Только выделенный текст</strong><small>Подпись до и после выделения останется без изменений.</small></span>
      </label>
      <label class="structure-choice-field">
        <input type="radio" name="documentFieldParagraphMode" value="whole"${rangeUnavailable ? " checked" : ""} />
        <span><strong>Весь абзац</strong><small>Всё содержимое выбранного абзаца будет заменено значением поля.</small></span>
      </label>
      <label class="structure-text-range-field" for="documentFieldTextRange">
        <span>Выделите заменяемый фрагмент</span>
        <textarea id="documentFieldTextRange" readonly${rangeUnavailable ? " disabled" : ""}>${structureEscape(element.text)}</textarea>
        <small id="documentFieldTextRangeMessage">${
          rangeUnavailable
            ? "В абзаце слишком много текстовых фрагментов для точного выделения. Доступна замена всего абзаца."
            : "Выделите плейсхолдер или другой изменяемый текст."
        }</small>
      </label>
    </fieldset>`;
}

function structureCellCoordinate(address) {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/u.exec(
    String(address || "").toUpperCase()
  );
  if (!match) return null;
  let column = 0;
  for (const character of match[1]) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  const row = Number(match[2]);
  return column >= 1 && column <= 16384 && row >= 1 && row <= 1048576
    ? { column, row }
    : null;
}

function structureRowCells(element) {
  const selected = structureCellCoordinate(element.address);
  if (!selected || !Array.isArray(structureReport?.elements)) return [];
  return structureReport.elements
    .filter((candidate) => {
      const coordinate = structureCellCoordinate(candidate.address);
      return (
        candidate.kind === "cell" &&
        candidate.sheetName === element.sheetName &&
        candidate.sheetPath === element.sheetPath &&
        coordinate?.row === selected.row
      );
    })
    .sort(
      (left, right) =>
        structureCellCoordinate(left.address).column -
        structureCellCoordinate(right.address).column
    );
}

function structureRowCellOptions(element, selectedId) {
  return structureRowCells(element)
    .map((cell, index) => {
      const value = cell.formula
        ? "формула с рассчитанным значением"
        : cell.value || "пустая ячейка";
      return `<option value="${structureEscape(cell.id)}"${cell.id === selectedId ? " selected" : ""}>Место ${index + 1}: ${structureEscape(value)}</option>`;
    })
    .join("");
}

function structureRepeatContainsElement(repeat, element) {
  if (!repeat || element.kind !== "cell" || repeat.kind !== "xlsx.repeat-row") {
    return false;
  }
  const field = structureCellCoordinate(element.address);
  const start = structureCellCoordinate(repeat.startAddress);
  const end = structureCellCoordinate(repeat.endAddress);
  return Boolean(
    field &&
      start &&
      end &&
      element.sheetName === repeat.sheetName &&
      element.sheetPath === repeat.sheetPath &&
      field.row === repeat.rowNumber &&
      field.column >= start.column &&
      field.column <= end.column
  );
}

function structureRepeatRowControl(element) {
  const current = structureDraft?.repeatBinding;
  if (element.kind === "paragraph" && element.tableLocation) {
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
  if (element.kind !== "cell") return "";
  if (current?.kind === "xlsx.repeat-row") {
    const inside = structureRepeatContainsElement(current, element);
    return `
      <div class="structure-repeat-summary ${inside ? "is-ready" : "is-warning"}">
        <strong>${inside ? "Повторяемый диапазон уже выбран" : "Эта ячейка вне повторяемого диапазона"}</strong>
        <small>${inside ? "После сохранения поле будет повторяться для каждого сотрудника вместе с выбранной строкой." : "Выберите ячейку внутри ранее сохранённого диапазона. Текущий выбор сохранить нельзя."}</small>
      </div>`;
  }
  const rowCells = structureRowCells(element);
  const first = rowCells[0];
  const last = rowCells.at(-1);
  const usedRowUnavailable = Boolean(structureReport?.truncated);
  return `
    <div class="structure-repeat-area">
      <label class="structure-required-field">
        <input id="documentFieldRepeatArea" type="checkbox" />
        <span><strong>Создать один список сотрудников</strong><small>Выбранная строка будет заполнена по одному разу для каждого участника сводного документа.</small></span>
      </label>
      <fieldset id="documentFieldRepeatAreaOptions" hidden>
        <legend>Что повторять в строке?</legend>
        <label class="structure-choice-field">
          <input type="radio" name="documentFieldRepeatSelection" value="used-row"${usedRowUnavailable ? " disabled" : " checked"} />
          <span><strong>Всю используемую строку</strong><small>${usedRowUnavailable ? "Недоступно: показана только часть структуры. Выберите непрерывный диапазон." : "Система сама возьмёт все заполненные места этой строки."}</small></span>
        </label>
        <label class="structure-choice-field">
          <input type="radio" name="documentFieldRepeatSelection" value="range"${usedRowUnavailable ? " checked" : ""} />
          <span><strong>Непрерывный диапазон</strong><small>Подходит, если слева или справа в строке есть подпись, которую не нужно копировать.</small></span>
        </label>
        <div class="structure-repeat-range" id="documentFieldRepeatRange"${usedRowUnavailable ? "" : " hidden"}>
          <label>
            <span>Начало диапазона</span>
            <select id="documentFieldRepeatStart">${structureRowCellOptions(element, first?.id || element.id)}</select>
            <small>Первое место, которое будет повторяться.</small>
          </label>
          <label>
            <span>Конец диапазона</span>
            <select id="documentFieldRepeatEnd">${structureRowCellOptions(element, last?.id || element.id)}</select>
            <small>Последнее место той же строки.</small>
          </label>
        </div>
      </fieldset>
    </div>`;
}

function renderStructureRepeatAreaFields() {
  const enabled = Boolean(document.querySelector("#documentFieldRepeatArea")?.checked);
  const options = document.querySelector("#documentFieldRepeatAreaOptions");
  if (options) options.hidden = !enabled;
  const selection = document.querySelector(
    'input[name="documentFieldRepeatSelection"]:checked'
  )?.value;
  const range = document.querySelector("#documentFieldRepeatRange");
  if (range) range.hidden = !enabled || selection !== "range";
}

function selectedStructureParagraphMode(form = document) {
  return (
    form.querySelector("#documentFieldParagraphMode")?.value ||
    form.querySelector('input[name="documentFieldParagraphMode"]:checked')?.value ||
    "range"
  );
}

function captureStructureTextRange() {
  const control = document.querySelector("#documentFieldTextRange");
  const message = document.querySelector("#documentFieldTextRangeMessage");
  if (
    !control ||
    !message ||
    !selectedStructureElement ||
    selectedStructureParagraphMode() !== "range"
  ) {
    updateStructureFieldReadiness();
    return;
  }
  const startOffset = control.selectionStart;
  const endOffset = control.selectionEnd;
  if (endOffset <= startOffset) {
    selectedStructureTextRange = null;
    message.textContent =
      "Выделите плейсхолдер или другой изменяемый текст. Подпись до и после выделения останется без изменений.";
    updateStructureFieldReadiness();
    return;
  }
  selectedStructureTextRange = { startOffset, endOffset };
  const selected = selectedStructureElement.text.slice(startOffset, endOffset);
  message.textContent = `Будет заменён только фрагмент «${selected}». Остальной текст абзаца сохранится.`;
  updateStructureFieldReadiness();
}

function renderStructureParagraphMode() {
  const mode = selectedStructureParagraphMode();
  const control = document.querySelector("#documentFieldTextRange");
  const message = document.querySelector("#documentFieldTextRangeMessage");
  if (mode === "whole") {
    selectedStructureTextRange = null;
    if (control) control.disabled = true;
    if (message) {
      message.textContent =
        "Будет заменён весь абзац. Используйте этот режим только когда его текущий текст не нужно сохранять.";
    }
  } else {
    if (control) control.disabled = false;
    if (message && selectedStructureTextRange === null) {
      message.textContent =
        "Выделите плейсхолдер или другой изменяемый текст. Подпись до и после выделения останется без изменений.";
    }
  }
  updateStructureFieldReadiness();
}

function structureFieldBlockReason(form) {
  if (!selectedStructureElement) return "Сначала выберите место в документе.";
  if (selectedStructureElement.kind === "cell" && selectedStructureElement.formula) {
    return "Эта ячейка содержит формулу и не может быть полем сотрудника.";
  }
  if (
    selectedStructureElement.kind === "cell" &&
    structureDraft?.repeatBinding?.kind === "xlsx.repeat-row" &&
    !structureRepeatContainsElement(structureDraft.repeatBinding, selectedStructureElement)
  ) {
    return "Ячейка находится вне ранее сохранённого повторяемого диапазона.";
  }
  const propertyKey = form.querySelector("#documentFieldProperty")?.value || "";
  const fieldGroup = form.querySelector("#documentFieldGroup")?.value || "common";
  if (!propertyKey) return "Выберите поле сотрудника.";
  if (propertyKey === "__new__" && fieldGroup === "unassigned") {
    return "Для нового поля выберите конкретный раздел: общие сведения, преподаватель или студент.";
  }
  if (propertyKey === "__new__") {
    const label = form.querySelector("#documentFieldLabel")?.value?.trim() || "";
    const confirmed = Boolean(form.querySelector("#documentPropertyConfirm")?.checked);
    if (!label || !confirmed) {
      return "Укажите название нового поля и подтвердите его добавление карточкам сотрудников.";
    }
  }
  if (selectedStructureElement.kind === "paragraph") {
    const mode = selectedStructureParagraphMode(form);
    if (mode === "range" && selectedStructureTextRange === null) {
      return "Выделите в абзаце текст, который нужно заменить, либо выберите замену всего абзаца.";
    }
  }
  try {
    structureSelectedPersonName(form);
  } catch (error) {
    return error?.message || "Проверьте вариант записи ФИО.";
  }
  return "";
}

function structureFieldReadyMessage(form) {
  const definition = structureSelectedDefinition(
    form.querySelector("#documentFieldProperty")?.value || ""
  );
  const fieldLabel =
    definition?.label || form.querySelector("#documentFieldLabel")?.value?.trim() || "поле";
  if (selectedStructureElement?.kind === "cell") {
    return `Готово: «${fieldLabel}» будет записано в выбранную ячейку.`;
  }
  if (!selectedStructureElement?.text) {
    return `Готово: «${fieldLabel}» будет вставлено в пустое место. Нажмите «Связать с документом».`;
  }
  if (selectedStructureParagraphMode(form) === "whole") {
    return `Готово: «${fieldLabel}» заменит весь выбранный абзац.`;
  }
  const range = selectedStructureTextRange;
  const selected = range
    ? selectedStructureElement.text.slice(range.startOffset, range.endOffset)
    : "";
  return `Готово: «${fieldLabel}» заменит только фрагмент «${selected}».`;
}

function updateStructureFieldReadiness() {
  const form = document.querySelector("#documentFieldForm");
  const button = form?.querySelector("#documentFieldSave");
  const message = form?.querySelector("#documentFieldMessage");
  if (!form || !button || !message || fieldBusy) return;
  const reason = structureFieldBlockReason(form);
  button.disabled = Boolean(reason);
  message.className = reason ? "is-warning" : "is-ready";
  message.textContent = reason || structureFieldReadyMessage(form);
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
  const formulaUnavailable = element.kind === "cell" && Boolean(element.formula);
  const outsideCurrentRepeat = Boolean(
    element.kind === "cell" &&
      structureDraft?.repeatBinding?.kind === "xlsx.repeat-row" &&
      !structureRepeatContainsElement(structureDraft.repeatBinding, element)
  );
  const fieldUnavailable = formulaUnavailable || outsideCurrentRepeat;
  detail.innerHTML = `
    <div class="structure-selection-content">
      <strong>${structureEscape(structureLocation(element))}</strong>
      <p>${structureEscape(structurePreview(element))}</p>
      <form class="structure-field-form" id="documentFieldForm" novalidate>
        <div class="structure-field-grid">
          ${structureTextRangeControl(element)}
          ${structureRepeatRowControl(element)}
          <label>
            <span>К кому относится значение?</span>
            <select id="documentFieldGroup" name="fieldGroup">${structureGroupSelectOptions(structureInferredFieldGroup(element))}</select>
            <small>Преподавательские и студенческие поля хранятся раздельно, даже если называются одинаково.</small>
          </label>
          <label>
            <span>Какое поле поставить сюда?</span>
            <select id="documentFieldProperty" name="propertyKey" data-searchable-select data-searchable-placeholder="Выберите поле" data-searchable-search-placeholder="Найти поле по названию">${structurePropertyOptions(structureInferredFieldGroup(element))}</select>
            <small>Список сгруппирован по назначению. Введите часть названия, чтобы быстро найти нужное поле.</small>
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
          <div id="documentFieldFormatter" class="structure-new-property" hidden></div>
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
          <button class="primary-button" id="documentFieldSave" type="submit" disabled>Связать с документом</button>
          <p id="documentFieldMessage"${fieldUnavailable ? ' class="is-warning"' : ""}></p>
        </div>
      </form>
    </div>`;
  detail.hidden = false;
  detail
    .querySelector("#documentFieldGroup")
    ?.addEventListener("change", refreshStructurePropertySelector);
  detail
    .querySelector("#documentFieldProperty")
    ?.addEventListener("change", renderNewStructurePropertyFields);
  globalThis.docomatorSearchableSelect?.enhanceAll(detail);
  detail
    .querySelector("#documentFieldType")
    ?.addEventListener("change", renderStructureFormatterFields);
  detail
    .querySelector("#documentFieldRepeatArea")
    ?.addEventListener("change", renderStructureRepeatAreaFields);
  detail
    .querySelectorAll('input[name="documentFieldRepeatSelection"]')
    .forEach((control) =>
      control.addEventListener("change", renderStructureRepeatAreaFields)
    );
  detail
    .querySelectorAll('input[name="documentFieldParagraphMode"]')
    .forEach((control) => control.addEventListener("change", renderStructureParagraphMode));
  const textRange = detail.querySelector("#documentFieldTextRange");
  for (const eventName of ["select", "mouseup", "keyup", "touchend"]) {
    textRange?.addEventListener(eventName, captureStructureTextRange);
  }
  const form = detail.querySelector("#documentFieldForm");
  form?.addEventListener("input", updateStructureFieldReadiness);
  form?.addEventListener("change", updateStructureFieldReadiness);
  form?.addEventListener("submit", saveSelectedField);
  renderNewStructurePropertyFields();
  renderStructureRepeatAreaFields();
  renderStructureParagraphMode();
  updateStructureFieldReadiness();
  rowEditorInstallEntry(element);
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

function selectedStructureRepeatArea(form) {
  if (!form.querySelector("#documentFieldRepeatArea")?.checked) return null;
  const selection = form.querySelector(
    'input[name="documentFieldRepeatSelection"]:checked'
  )?.value;
  if (selection === "used-row") return { selection: "used-row" };
  if (selection !== "range") {
    throw { message: "Выберите, какую часть строки нужно повторять." };
  }
  const startElementId = form.querySelector("#documentFieldRepeatStart")?.value || "";
  const endElementId = form.querySelector("#documentFieldRepeatEnd")?.value || "";
  if (!startElementId || !endElementId) {
    throw { message: "Выберите начало и конец повторяемого диапазона." };
  }
  return { selection: "range", startElementId, endElementId };
}

async function saveSelectedField(event) {
  event.preventDefault();
  if (fieldBusy || !selectedStructureElement || !structureReport) return;
  const form = event.currentTarget;
  const button = form.querySelector("#documentFieldSave");
  const message = form.querySelector("#documentFieldMessage");
  const propertyKey = form.querySelector("#documentFieldProperty")?.value || "";
  const fieldGroup = form.querySelector("#documentFieldGroup")?.value || "common";
  let definition = structureSelectedDefinition(propertyKey);
  const label = form.querySelector("#documentFieldLabel")?.value?.trim() || "";
  const valueType = form.querySelector("#documentFieldType")?.value || "string";
  const required = Boolean(form.querySelector("#documentFieldRequired")?.checked);
  const repeatRow = Boolean(form.querySelector("#documentFieldRepeatRow")?.checked);
  const paragraphMode = selectedStructureParagraphMode(form);
  const creatingProperty = propertyKey === "__new__";
  const propertyConfirmed = Boolean(form.querySelector("#documentPropertyConfirm")?.checked);
  const blockReason = structureFieldBlockReason(form);
  if (blockReason) {
    message.className = "is-error";
    message.textContent = blockReason;
    return;
  }
  let repeatArea;
  let personName;
  try {
    repeatArea = selectedStructureRepeatArea(form);
    personName = structureSelectedPersonName(form);
  } catch (error) {
    message.className = "is-error";
    message.textContent = error?.message || "Проверьте настройки поля.";
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
    "Проверяем сохранённый исходник, координату и выбранный вариант записи значения.";

  try {
    const { spaceId, draft } = await loadStructureDraft();
    if (creatingProperty) {
      const labelMatches = structurePropertyDefinitions.filter(
        (candidate) =>
          candidate.label.trim().toLocaleLowerCase("ru-RU") ===
            label.toLocaleLowerCase("ru-RU") &&
          structurePropertyGroup(candidate) === fieldGroup
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
              sensitivity: "personal",
              validation: { uiGroup: fieldGroup }
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
    if (
      definition &&
      !definition.systemSource &&
      structurePropertyGroup(definition) === "unassigned" &&
      fieldGroup !== "unassigned"
    ) {
      const classified = await structureFetchJson(
        `/api/v1/knowledge/property-definitions/${encodeURIComponent(definition.key)}/group`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ uiGroup: fieldGroup })
        }
      );
      definition = classified.data;
      const index = structurePropertyDefinitions.findIndex(
        (candidate) => candidate.key === definition.key
      );
      if (index >= 0) structurePropertyDefinitions[index] = definition;
    }
    if (!definition) throw { message: "Выбранное поле сотрудника не найдено." };
    definition = structureEffectiveDefinition(definition, selectedStructureElement);
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
          ...(repeatArea ? { repeatArea } : {}),
          ...(personName ? { personName } : {}),
          ...(definition.valueType === "number" && decimalPlacesValue !== ""
            ? { decimalPlaces: Number(decimalPlacesValue) }
            : {}),
          ...(definition.valueType === "date-time" && timeZone
            ? { timeZone }
            : {}),
          ...(selectedStructureElement.kind === "paragraph" && paragraphMode === "range"
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
    form.querySelectorAll("input, select, textarea").forEach((control) => {
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
        <div><p class="eyebrow">Поля документа</p><h3>${structureEscape(report.fileName)}</h3><p>В DOCX пустой абзац можно заполнить сразу; в абзаце с текстом выберите фрагмент или замену всего абзаца. В XLSX выберите нужную ячейку.</p></div>
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
