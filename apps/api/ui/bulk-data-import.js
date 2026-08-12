let bulkImportCreated = false;
let bulkImportBusy = false;
let bulkImportPreview = null;
let bulkImportPlan = null;
let bulkImportHistory = [];
let bulkImportReturnFocus = null;
let bulkImportSpaceId = null;
let bulkImportPlanSpaceId = null;
let bulkImportSession = 0;
let bulkImportPropertyDefinitions = [];

const BULK_IMPORT_VALUE_TYPES = new Set([
  "string",
  "text",
  "number",
  "integer",
  "boolean",
  "date",
  "date-time",
  "enum"
]);

function setBulkImportStep(step, completeCurrent = false) {
  document.querySelectorAll("[data-bulk-import-step]").forEach((item) => {
    const itemStep = Number(item.dataset.bulkImportStep);
    const isCurrent = itemStep === step;
    item.classList.toggle("is-current", isCurrent);
    item.classList.toggle(
      "is-complete",
      itemStep < step || (completeCurrent && isCurrent)
    );
    if (isCurrent) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  });
}

function clearBulkImportState(message) {
  bulkImportSession += 1;
  bulkImportBusy = false;
  bulkImportPreview = null;
  bulkImportPlan = null;
  bulkImportSpaceId = null;
  bulkImportPlanSpaceId = null;
  const file = document.querySelector("#bulkImportFile");
  if (file) file.value = "";
  const root = document.querySelector("#bulkImportPreview");
  if (root) root.innerHTML = "";
  const status = document.querySelector("#bulkImportMessage");
  if (status) {
    status.className = "bulk-import-message is-warning";
    status.textContent = message;
  }
  const previewButton = document.querySelector("#bulkImportPreviewButton");
  if (previewButton) previewButton.disabled = false;
  setBulkImportStep(1);
}

function bulkImportCurrentSpaceId() {
  return String(globalThis.docomatorCurrentSpaceId || "").trim();
}

function bulkImportSpaceMatches(spaceId) {
  return Boolean(spaceId) && bulkImportCurrentSpaceId() === spaceId;
}

function bulkImportResponseError(body, response, fallback) {
  const error = new Error(body?.error?.message || fallback);
  error.code = body?.error?.code || "import_request_failed";
  error.issue =
    body?.error?.issue && typeof body.error.issue === "object"
      ? body.error.issue
      : null;
  error.correlationId =
    body?.correlationId || response.headers.get("x-correlation-id") || "";
  return error;
}

async function bulkImportApi(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  if (!response.ok) {
    throw bulkImportResponseError(
      body,
      response,
      `Сервер вернул код ${response.status}.`
    );
  }
  if (url.endsWith("/data-import/execute")) {
    writeBulkImportMappingMemory(body?.data?.mappingResolutions);
  }
  return body;
}

async function loadBulkImportPropertyDefinitions() {
  try {
    const body = await bulkImportApi(
      "/api/v1/knowledge/property-definitions?limit=500"
    );
    bulkImportPropertyDefinitions = Array.isArray(body.data) ? body.data : [];
  } catch {
    bulkImportPropertyDefinitions = [];
  }
}

function bulkImportGuessColumn(headers, patterns, fallback = "") {
  return (
    headers.find((header) =>
      patterns.some((pattern) => pattern.test(header.toLocaleLowerCase("ru-RU")))
    ) || fallback || headers[0] || ""
  );
}

function bulkImportPersonProperties() {
  return bulkImportPropertyDefinitions.filter(
    (property) =>
      BULK_IMPORT_VALUE_TYPES.has(property.valueType) &&
      (!Array.isArray(property.appliesTo) ||
        property.appliesTo.length === 0 ||
        property.appliesTo.includes("person"))
  );
}



const bulkImportMatchMeta = new Map();
const bulkImportMemoryKey = "docomator.import.column-mappings";
const bulkImportSemanticGroups = [
  ["fio", ["фио", "фамилия имя отчество", "полное имя", "студент", "сотрудник", "обучающийся"]],
  ["personnel_number", ["табельный номер", "кадровый номер", "личный номер"]],
  ["student_number", ["номер зачетной книжки", "зачетная книжка", "номер студента", "student id"]],
  ["position", ["должность", "позиция", "профессия", "роль"]],
  ["department", ["подразделение", "отдел", "кафедра", "факультет", "институт"]],
  ["research_topic", ["тема научной работы", "тема работы", "тема вкр", "тема диплома", "тема диссертации", "научная тема"]],
  ["supervisor", ["научный руководитель", "руководитель", "научрук", "куратор"]],
  ["passport_series", ["серия паспорта", "паспорт серия"]],
  ["passport_number", ["номер паспорта", "паспорт номер"]],
  ["passport_issued_by", ["кем выдан паспорт", "орган выдачи паспорта", "паспорт выдан"]],
  ["passport_issue_date", ["дата выдачи паспорта", "паспорт дата выдачи"]],
  ["passport_department_code", ["код подразделения паспорта", "код подразделения"]],
  ["birth_date", ["дата рождения", "день рождения"]],
  ["registration_address", ["адрес регистрации", "прописка", "место регистрации"]],
  ["address", ["адрес проживания", "адрес"]],
  ["phone", ["телефон", "мобильный телефон", "номер телефона"]],
  ["email", ["электронная почта", "почта", "email", "e mail"]],
  ["snils", ["снилс"]],
  ["inn", ["инн"]],
  ["group", ["учебная группа", "группа", "поток"]],
  ["course", ["курс", "год обучения"]],
  ["status", ["статус", "состояние"]]
];

function normalizeBulkImportText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function bulkImportTokens(value) {
  return new Set(normalizeBulkImportText(value).split(" ").filter((token) => token.length > 1));
}

function bulkImportSemanticKey(value) {
  const normalized = normalizeBulkImportText(value);
  for (const [key, variants] of bulkImportSemanticGroups) {
    if (variants.some((variant) => {
      const candidate = normalizeBulkImportText(variant);
      return normalized === candidate || normalized.includes(candidate) || candidate.includes(normalized);
    })) return key;
  }
  return "";
}

function bulkImportSimilarity(left, right) {
  const a = normalizeBulkImportText(left);
  const b = normalizeBulkImportText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const semanticA = bulkImportSemanticKey(a);
  const semanticB = bulkImportSemanticKey(b);
  if (semanticA && semanticA === semanticB) return 0.96;
  if (a.includes(b) || b.includes(a)) return 0.84;
  const leftTokens = bulkImportTokens(a);
  const rightTokens = bulkImportTokens(b);
  const union = new Set([...leftTokens, ...rightTokens]);
  if (union.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / union.size;
}

function readBulkImportMappingMemory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(bulkImportMemoryKey) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeBulkImportMappingMemory(resolutions) {
  if (!Array.isArray(resolutions)) return;
  try {
    const memory = readBulkImportMappingMemory();
    for (const item of resolutions) {
      if (!item?.column || !item?.propertyKey) continue;
      memory[normalizeBulkImportText(item.column)] = {
        propertyKey: item.propertyKey,
        propertyLabel: item.propertyLabel,
        valueType: item.valueType,
        updatedAt: new Date().toISOString()
      };
    }
    localStorage.setItem(bulkImportMemoryKey, JSON.stringify(memory));
  } catch {
    // Локальная память сопоставлений является необязательной.
  }
}

function bulkImportColumnValues(header) {
  if (!bulkImportPreview?.rows) return [];
  return bulkImportPreview.rows
    .map((row) => String(row[header] || "").normalize("NFKC").trim())
    .filter(Boolean);
}

function bulkImportUniqueValues(header, limit = 500) {
  const result = [];
  const seen = new Set();
  for (const value of bulkImportColumnValues(header)) {
    const identity = normalizeBulkImportText(value);
    if (!seen.has(identity)) {
      seen.add(identity);
      result.push(value);
    }
    if (result.length >= limit) break;
  }
  return result;
}

function bulkImportSensitivity(header) {
  const semantic = bulkImportSemanticKey(header);
  if (["passport_series", "passport_number", "passport_issued_by", "passport_issue_date", "passport_department_code", "registration_address", "snils"].includes(semantic)) {
    return "restricted";
  }
  if (["birth_date", "address", "phone", "email", "inn", "personnel_number", "student_number"].includes(semantic)) {
    return "personal";
  }
  return "internal";
}

function bulkImportGuessValueType(header) {
  const normalized = normalizeBulkImportText(header);
  const semantic = bulkImportSemanticKey(header);
  const values = bulkImportColumnValues(header);
  if (["birth_date", "passport_issue_date"].includes(semantic) || /дата|день рождения/u.test(normalized)) return "date";
  if (/примечание|комментарий|описание|тема науч|тема работ|кем выдан/u.test(normalized)) return "text";
  if (/да нет|признак|активен|является/u.test(normalized)) return "boolean";
  if (/оклад|ставка|сумма|процент|коэффициент/u.test(normalized)) return "number";
  if (/количество|курс|стаж|номер кабинета/u.test(normalized)) return "integer";
  const booleanValues = new Set(["да", "нет", "true", "false", "1", "0", "+", "-"]);
  if (values.length > 0 && values.every((value) => booleanValues.has(normalizeBulkImportText(value)))) return "boolean";
  if (values.length > 0 && values.every((value) => /^\d{1,2}[./-]\d{1,2}[./-]\d{4}$|^\d{4}-\d{2}-\d{2}$/u.test(value))) return "date";
  if (values.length > 0 && values.every((value) => /^[-+]?\d+$/u.test(value.replace(/\s/gu, ""))) && !/номер|паспорт|телефон|снилс|инн/u.test(normalized)) return "integer";
  if (values.length > 0 && values.every((value) => /^[-+]?\d+(?:[.,]\d+)?$/u.test(value.replace(/\s/gu, ""))) && /сумма|ставка|оклад|процент|балл/u.test(normalized)) return "number";
  if (["position", "department", "group", "course", "status"].includes(semantic)) return "enum";
  const unique = bulkImportUniqueValues(header, 30);
  if (values.length >= 5 && unique.length <= 20 && unique.length / values.length <= 0.45) return "enum";
  return values.some((value) => value.length > 180) ? "text" : "string";
}

function bulkImportBestProperty(header) {
  const memory = readBulkImportMappingMemory()[normalizeBulkImportText(header)];
  if (memory?.propertyKey) {
    const remembered = bulkImportPersonProperties().find((property) => property.key === memory.propertyKey);
    if (remembered) return { property: remembered, score: 1, source: "remembered" };
  }
  let best = null;
  for (const property of bulkImportPersonProperties()) {
    const candidates = [property.label, ...(Array.isArray(property.aliases) ? property.aliases : [])];
    const score = Math.max(...candidates.map((candidate) => bulkImportSimilarity(header, candidate)));
    if (!best || score > best.score) best = { property, score, source: score === 1 ? "exact" : "similar" };
  }
  return best && best.score >= 0.68 ? best : null;
}
function bulkImportGuessProperty(header) {
  const match = bulkImportBestProperty(header);
  bulkImportMatchMeta.set(header, match || { property: null, score: 0, source: "new" });
  return match?.property || null;
}

function bulkImportTypeOptions(selected) {
  const options = [
    ["string", "Короткий текст"],
    ["text", "Длинный текст"],
    ["enum", "Список вариантов"],
    ["number", "Число"],
    ["integer", "Целое число"],
    ["boolean", "Да или нет"],
    ["date", "Дата"],
    ["date-time", "Дата и время"]
  ];
  return options.map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`).join("");
}

function bulkImportSensitivityOptions(selected) {
  return [
    ["internal", "Рабочие сведения"],
    ["personal", "Персональные данные"],
    ["restricted", "Особо чувствительные данные"],
    ["public", "Открытые сведения"]
  ].map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`).join("");
}
function bulkImportMappingRow(header, index, identityColumn, displayNameColumn) {
  const guessed = bulkImportGuessProperty(header);
  const meta = bulkImportMatchMeta.get(header) || { score: 0 };
  const isDisplayName = header === displayNameColumn;
  const confident = guessed && meta.score >= 0.72;
  const mode = isDisplayName ? "skip" : confident ? `existing:${guessed.key}` : "create";
  const type = bulkImportGuessValueType(header);
  const sensitivity = bulkImportSensitivity(header);
  const uniqueValues = type === "enum" ? bulkImportUniqueValues(header, 100) : [];
  const samples = bulkImportUniqueValues(header, 3);
  const confidence = isDisplayName
    ? '<span class="bulk-import-confidence is-ready">ФИО</span>'
    : guessed
      ? `<span class="bulk-import-confidence ${meta.score >= 0.9 ? "is-ready" : meta.score >= 0.72 ? "is-medium" : "is-review"}">${Math.round(meta.score * 100)}% совпадение</span>`
      : '<span class="bulk-import-confidence is-review">Новое поле</span>';
  const note = isDisplayName
    ? "Используется как имя человека"
    : header === identityColumn
      ? "Используется при повторных импортах"
      : `Колонка ${index + 1}`;
  return `<article class="bulk-import-mapping-row bulk-import-mapping-row-enhanced" data-bulk-mapping-row data-column="${escapeHtml(header)}">
    <div class="bulk-import-column-name"><div><strong>${escapeHtml(header)}</strong>${confidence}</div><small>${escapeHtml(note)}</small>${samples.length ? `<small>Примеры: ${samples.map((value) => `«${escapeHtml(value)}»`).join(", ")}</small>` : ""}</div>
    <label><span>Куда перенести</span><select data-bulk-mapping-mode aria-label="Куда перенести колонку ${escapeHtml(header)}">
      <option value="skip"${mode === "skip" ? " selected" : ""}>Не переносить</option>
      <option value="create"${mode === "create" ? " selected" : ""}>Создать новое поле</option>
      ${bulkImportPropertyOptions(guessed?.key || "")}
    </select></label>
    <label data-bulk-create-field${mode === "create" ? "" : " hidden"}><span>Название поля</span><input data-bulk-property-label type="text" value="${escapeHtml(header)}" maxlength="300" /></label>
    <label data-bulk-create-field${mode === "create" ? "" : " hidden"}><span>Тип значения</span><select data-bulk-value-type>${bulkImportTypeOptions(type)}</select></label>
    <label data-bulk-create-field${mode === "create" ? "" : " hidden"}><span>Класс данных</span><select data-bulk-sensitivity>${bulkImportSensitivityOptions(sensitivity)}</select><small>${sensitivity === "restricted" ? "Доступ и журналы должны обрабатываться особенно осторожно." : "Класс используется для маскирования, журналирования и локальной обработки."}</small></label>
    <section class="bulk-import-enum" data-bulk-enum-fields${mode === "create" && type === "enum" ? "" : " hidden"}>
      <label><span>Варианты выбора</span><textarea data-bulk-enum-values rows="4" placeholder="По одному варианту в строке">${escapeHtml(uniqueValues.join("\n"))}</textarea></label>
      <label class="operator-check"><input data-bulk-allow-custom type="checkbox" checked /><span>Разрешать новые значения и автоматически пополнять список</span></label>
    </section>
    ${isDisplayName ? "" : `<label class="operator-check bulk-import-case-option"><input data-bulk-case-insensitive type="checkbox"${type === "enum" ? " checked" : ""} /><span><strong>Сравнивать без учёта регистра</strong><small>«Кафедра» и «КАФЕДРА» считаются одним значением. Сохраняется первое написание.</small></span></label>`}
  </article>`;
}

function updateBulkImportMappingVisibility() {
  document.querySelectorAll("[data-bulk-mapping-row]").forEach((row) => {
    const mode = row.querySelector("[data-bulk-mapping-mode]")?.value || "skip";
    const type = row.querySelector("[data-bulk-value-type]")?.value || "string";
    row.querySelectorAll("[data-bulk-create-field]").forEach((field) => {
      field.hidden = mode !== "create";
    });
    const enumFields = row.querySelector("[data-bulk-enum-fields]");
    if (enumFields) enumFields.hidden = mode !== "create" || type !== "enum";
  });
  const group = document.querySelector("#bulkImportGroupFields");
  if (group) group.hidden = !document.querySelector("#bulkImportCreateGroup")?.checked;
}

function collectBulkImportMappings() {
  const mappings = [];
  document.querySelectorAll("[data-bulk-mapping-row]").forEach((row) => {
    const mode = row.querySelector("[data-bulk-mapping-mode]")?.value || "skip";
    if (mode === "skip") return;
    const column = row.dataset.column || "";
    if (mode.startsWith("existing:")) {
      mappings.push({ column, propertyKey: mode.slice("existing:".length), aliases: [column] });
      return;
    }
    const valueType = row.querySelector("[data-bulk-value-type]")?.value || "string";
    const mapping = {
      column,
      createIfMissing: true,
      label: row.querySelector("[data-bulk-property-label]")?.value.trim() || column,
      valueType,
      sensitivity: row.querySelector("[data-bulk-sensitivity]")?.value || "personal",
      aliases: [column]
    };
    if (valueType === "enum") {
      mapping.enumValues = String(row.querySelector("[data-bulk-enum-values]")?.value || "")
        .split(/[\n,;]+/u)
        .map((value) => value.normalize("NFKC").trim())
        .filter(Boolean);
      mapping.allowCustom = Boolean(row.querySelector("[data-bulk-allow-custom]")?.checked);
    }
    mappings.push(mapping);
  });
  return mappings.map((mapping) => ({
    ...mapping,
    caseInsensitive: Boolean(
      bulkImportColumnRow(mapping.column)?.querySelector(
        "[data-bulk-case-insensitive]"
      )?.checked
    )
  }));
}

function bulkImportIdentityGuess(preview, displayNameColumn) {
  const preferred = bulkImportGuessColumn(
    preview.headers,
    [/табел/u, /кадров/u, /зачет/u, /личн.*номер/u, /^id$/u, /email/u, /почт/u, /номер/u],
    ""
  );
  return preferred || displayNameColumn || preview.headers[0] || "";
}
async function previewBulkImportBytes(fileName, bytes) {
  if (bulkImportBusy) return;
  const message = document.querySelector("#bulkImportMessage");
  if (!message) return;
  const previousPreview = bulkImportPreview;
  const previousSpaceId = bulkImportSpaceId;
  const spaceId = bulkImportCurrentSpaceId();
  if (!spaceId) {
    message.textContent = "Сначала выберите раздел данных.";
    return;
  }
  await loadBulkImportPropertyDefinitions();
  const requestSession = ++bulkImportSession;
  bulkImportSpaceId = spaceId;
  bulkImportPlanSpaceId = null;
  bulkImportBusy = true;
  bulkImportPlan = null;
  message.className = "bulk-import-message is-loading";
  message.textContent = "Разбираем вставленную таблицу и определяем поля…";
  try {
    const response = await fetch(`/api/v1/spaces/${encodeURIComponent(spaceId)}/data-import/preview?fileName=${encodeURIComponent(fileName)}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", accept: "application/json" },
      body: bytes
    });
    const body = await response.json();
    if (requestSession !== bulkImportSession || !bulkImportSpaceMatches(spaceId)) return;
    if (!response.ok) throw bulkImportResponseError(body, response, "Не удалось прочитать таблицу.");
    bulkImportPreview = body.data;
    message.className = "bulk-import-message is-success";
    message.textContent = `Таблица прочитана: ${body.data.rowCount} строк. Проверьте автоматическое сопоставление.`;
    renderBulkImportPreview(body.data);
    setBulkImportStep(2);
    document.querySelector("#bulkImportDisplayNameColumn")?.focus();
  } catch (error) {
    if (requestSession !== bulkImportSession) return;
    bulkImportPreview = previousPreview;
    bulkImportSpaceId = previousSpaceId;
    message.className = "bulk-import-message is-error";
    message.textContent = error instanceof Error ? error.message : "Не удалось прочитать таблицу.";
    if (typeof showBulkImportOperationIssue === "function") {
      showBulkImportOperationIssue(error);
    }
  } finally {
    if (requestSession === bulkImportSession) bulkImportBusy = false;
  }
}
function switchBulkImportSource(mode) {
  const fileBox = document.querySelector("#bulkImportFileSource");
  const pasteBox = document.querySelector("#bulkImportPasteSource");
  if (fileBox) fileBox.hidden = mode !== "file";
  if (pasteBox) pasteBox.hidden = mode !== "paste";
  document.querySelectorAll("[data-bulk-import-source]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.bulkImportSource === mode);
    button.setAttribute("aria-pressed", String(button.dataset.bulkImportSource === mode));
  });
  (mode === "paste" ? document.querySelector("#bulkImportPaste") : document.querySelector("#bulkImportFile"))?.focus();
}
function initializeBulkImportSources() {
  const panel = document.querySelector("#bulkDataImportPanel");
  if (!panel || panel.dataset.bulkImportEnhanced === "true") return;
  panel.dataset.bulkImportEnhanced = "true";
  const title = panel.querySelector(".panel-heading h2");
  const description = panel.querySelector(".panel-heading p:last-child");
  if (title) title.textContent = "Импортировать людей и заполненные поля";
  if (description) description.textContent = "Загрузите Excel/CSV или вставьте таблицу. Система предложит сопоставление, типы и классы данных; оператор только проверит.";
  const upload = panel.querySelector(".bulk-import-upload");
  if (upload) {
    upload.innerHTML = `<div class="bulk-import-source-tabs" role="group" aria-label="Источник данных"><button class="secondary-button is-active" type="button" data-bulk-import-source="file" aria-pressed="true">Файл CSV или XLSX</button><button class="secondary-button" type="button" data-bulk-import-source="paste" aria-pressed="false">Вставить из Excel</button></div>
      <section id="bulkImportFileSource"><label class="generation-field"><span>Таблица с людьми и данными</span><input id="bulkImportFile" type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" /><small>До 8 МБ, 100 колонок и 1000 строк. В XLSX используется первый рабочий лист.</small></label><button class="primary-button" id="bulkImportPreviewButton" type="button">Прочитать файл</button></section>
      <section id="bulkImportPasteSource" hidden><label class="generation-field"><span>Вставьте диапазон вместе с заголовками</span><textarea id="bulkImportPaste" rows="10" placeholder="ФИО&#9;Номер зачётной книжки&#9;Тема научной работы&#9;Научный руководитель"></textarea><small>Скопируйте диапазон из Excel или LibreOffice. Первая строка должна содержать названия колонок.</small></label><div class="bulk-import-paste-actions"><button class="secondary-button" id="bulkImportStudentExample" type="button">Пример: студенты и темы</button><button class="primary-button" id="bulkImportPastePreview" type="button">Разобрать таблицу</button></div></section>`;
    upload.querySelector("#bulkImportPreviewButton")?.addEventListener("click", previewBulkImportFile);
    upload.querySelectorAll("[data-bulk-import-source]").forEach((button) => button.addEventListener("click", () => switchBulkImportSource(button.dataset.bulkImportSource)));
    upload.querySelector("#bulkImportStudentExample")?.addEventListener("click", () => {
      const textarea = document.querySelector("#bulkImportPaste");
      textarea.value = "ФИО\tНомер зачётной книжки\tУчебная группа\tТема научной работы\tНаучный руководитель\nИванов Иван Иванович\tЗК-001\tМ-21\tОценка точности краткосрочного прогноза осадков\tПетров Пётр Петрович\nСмирнова Анна Сергеевна\tЗК-002\tМ-21\tАвтоматизация обработки данных радиозондирования\tСидорова Мария Андреевна";
      textarea.focus();
    });
    upload.querySelector("#bulkImportPastePreview")?.addEventListener("click", () => {
      const text = document.querySelector("#bulkImportPaste")?.value || "";
      if (!text.trim()) {
        const message = document.querySelector("#bulkImportMessage");
        if (message) message.textContent = "Вставьте таблицу вместе со строкой заголовков.";
        return;
      }
      void previewBulkImportBytes("Вставленная таблица.csv", new Blob([text], { type: "text/csv;charset=utf-8" }));
    });
  }
}
function bulkImportColumnRow(column) {
  return [...document.querySelectorAll("[data-bulk-mapping-row]")].find(
    (row) => row.dataset.column === column
  );
}
function bulkImportNormalizationOptions() {
  return `<section class="bulk-import-normalization" aria-labelledby="bulkImportNormalizationHeading">
    <div><h3 id="bulkImportNormalizationHeading">Нормализация значений</h3><p>Настройки применяются до предварительной проверки и одинаково работают для CSV и XLSX.</p></div>
    <label class="operator-check"><input id="bulkImportIdentityCaseInsensitive" type="checkbox" checked /><span><strong>Искать прежнюю запись без учёта регистра</strong><small>Например, <code>EMP-001</code> и <code>emp-001</code> не создадут два объекта. Исходное значение в файле не переписывается.</small></span></label>
    <label class="operator-check"><input id="bulkImportNormalizePersonName" type="checkbox" checked /><span><strong>Привести ФИО к нормальному регистру</strong><small>«ИВАНОВ ИВАН ИВАНОВИЧ» станет «Иванов Иван Иванович»; дефисы и апострофы сохраняются.</small></span></label>
    <label class="operator-check"><input id="bulkImportSplitPersonName" type="checkbox" /><span><strong>Разделить ФИО на Фамилию, Имя и Отчество</strong><small>Система создаст или переиспользует три отдельных поля, доступных в шаблонах.</small></span></label>
    <label class="generation-field" id="bulkImportNameOrderField" hidden><span>Порядок слов в исходной колонке</span><select id="bulkImportNameOrder"><option value="family-given-patronymic">Фамилия Имя Отчество</option><option value="given-patronymic-family">Имя Отчество Фамилия</option></select><small>Для разделения поддерживаются два или три слова. Неоднозначные строки попадут в отчёт ошибок с исходным номером строки.</small></label>
  </section>`;
}
function decorateBulkImportPreview(preview) {
  const root = document.querySelector("#bulkImportPreview");
  if (!root) return;
  const core = root.querySelector(".bulk-import-core-fields");
  if (core && !root.querySelector(".bulk-import-normalization")) {
    core.insertAdjacentHTML("afterend", bulkImportNormalizationOptions());
  }
  const split = root.querySelector("#bulkImportSplitPersonName");
  const order = root.querySelector("#bulkImportNameOrderField");
  if (split && order) {
    order.hidden = !split.checked;
    split.addEventListener("change", () => {
      order.hidden = !split.checked;
      invalidateBulkImportPlan();
    });
  }
  const table = root.querySelector(".bulk-import-source-preview table");
  if (table && !table.querySelector("[data-source-row-heading]")) {
    const heading = document.createElement("th");
    heading.dataset.sourceRowHeading = "";
    heading.textContent = "Строка файла";
    table.querySelector("thead tr")?.prepend(heading);
    [...table.querySelectorAll("tbody tr")].forEach((row, index) => {
      const cell = document.createElement("td");
      cell.textContent = String(
        preview.sampleRowNumbers?.[index] ??
          preview.sourceRowNumbers?.[index] ??
          index + 2
      );
      row.prepend(cell);
    });
  }
  if (Array.isArray(preview.warnings) && preview.warnings.length > 0) {
    const summary = root.querySelector(".bulk-import-file-summary");
    if (summary && !root.querySelector(".bulk-import-parser-warnings")) {
      summary.insertAdjacentHTML(
        "afterend",
        `<div class="bulk-import-parser-warnings">${preview.warnings
          .map((warning) => `<p>${escapeHtml(warning)}</p>`)
          .join("")}</div>`
      );
    }
  }
}
function renderBulkImportPreview(preview) {
  const root = document.querySelector("#bulkImportPreview");
  if (!root) return;
  const displayNameColumn = bulkImportGuessColumn(
    preview.headers,
    [/фио/u, /полное.*имя/u, /студент/u, /сотрудник/u, /обучающ/u, /^имя$/u, /^name$/u],
    preview.headers[0]
  );
  const identityColumn = bulkImportIdentityGuess(preview, displayNameColumn);
  bulkImportMatchMeta.clear();
  const mappingHtml = preview.headers.map((header, index) => bulkImportMappingRow(header, index, identityColumn, displayNameColumn)).join("");
  const confidentCount = [...bulkImportMatchMeta.values()].filter((item) => item?.property && item.score >= 0.72).length;
  const identityWarning = identityColumn === displayNameColumn
    ? '<div class="bulk-import-notice is-warning"><strong>ФИО используется как ключ повторного импорта</strong><p>Это допустимо для разовой загрузки. Для регулярного обновления добавьте табельный номер, номер зачётной книжки или рабочую почту.</p></div>'
    : "";
  const studentDetected = preview.headers.some((header) => bulkImportSemanticKey(header) === "research_topic");
  root.innerHTML = `<section class="bulk-import-config">
    <div class="bulk-import-file-summary"><strong>${escapeHtml(preview.fileName)}</strong><span>${preview.rowCount} строк · ${preview.columnCount} колонок</span></div>
    ${studentDetected ? '<div class="bulk-import-notice is-ready"><strong>Распознан список студентов и научных работ</strong><p>ФИО станет карточкой человека, тема и руководитель — отдельными полями. Их можно сразу использовать в таблице Word.</p></div>' : ""}
    ${identityWarning}
    <div class="bulk-import-core-fields">
      <label class="generation-field"><span>Колонка с ФИО</span><select id="bulkImportDisplayNameColumn">${preview.headers.map((header) => `<option value="${escapeHtml(header)}"${header === displayNameColumn ? " selected" : ""}>${escapeHtml(header)}</option>`).join("")}</select><small>Это имя будет показано в карточке и списках.</small></label>
      <label class="generation-field"><span>Как узнавать прежнюю запись</span><select id="bulkImportIdentityColumn">${preview.headers.map((header) => `<option value="${escapeHtml(header)}"${header === identityColumn ? " selected" : ""}>${escapeHtml(header)}</option>`).join("")}</select><small>При следующей загрузке запись с тем же ключом будет обновлена, а не создана повторно.</small></label>
    </div>
    <div class="panel-heading compact-heading"><div><h3>Сопоставление колонок</h3><p>Система уверенно сопоставила ${confidentCount} колонок. Проверьте отмеченные как новые или неуверенные.</p></div><span class="operator-counter">${preview.headers.length} колонок</span></div>
    <div id="bulkImportMappings" class="bulk-import-mappings">${mappingHtml}</div>
    <label class="bulk-import-group-option"><input id="bulkImportCreateGroup" type="checkbox"${studentDetected ? " checked" : ""} /><span><strong>Собрать импортированных людей в группу</strong><small>Группа нужна для одного сводного документа и расписаний.</small></span></label>
    <div id="bulkImportGroupFields" class="bulk-import-group-fields"${studentDetected ? "" : " hidden"}><label class="generation-field"><span>Название группы</span><input id="bulkImportGroupName" type="text" maxlength="300" value="${studentDetected ? "Студенты — темы научных работ" : `Импорт от ${new Date().toLocaleDateString("ru-RU")}`}" /></label></div>
    <details class="bulk-import-source-preview"><summary>Посмотреть первые строки</summary><div class="bulk-import-table-wrap"><table class="bulk-import-table"><thead><tr>${preview.headers.map((header) => `<th data-source-column="${escapeHtml(header)}">${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${preview.sampleRows.slice(0, 10).map((row, rowIndex) => `<tr data-source-row-number="${escapeHtml(String(preview.sampleRowNumbers?.[rowIndex] ?? preview.sourceRowNumbers?.[rowIndex] ?? rowIndex + 2))}">${preview.headers.map((header) => `<td data-source-column="${escapeHtml(header)}">${escapeHtml(row[header] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>
    <div id="bulkImportPlan" class="bulk-import-plan"><p>Нажмите «Проверить»: система выполнит полный импорт в транзакции и откатит его, чтобы показать точный результат без сохранения.</p></div>
    <div class="bulk-import-submit-row"><button class="primary-button" id="bulkImportPlanButton" type="button">Проверить ${preview.rowCount} строк</button><p>Пустые ячейки не стирают уже заполненные сведения.</p></div>
  </section>`;
  decorateBulkImportPreview(preview);
  updateBulkImportMappingVisibility();
}

function bulkImportRequestBody() {
  const createGroup = document.querySelector("#bulkImportCreateGroup")?.checked === true;
  const rows = Array.isArray(bulkImportPreview?.rows) ? bulkImportPreview.rows : [];
  return {
    fileName: bulkImportPreview.fileName,
    fileFormat: bulkImportPreview.fileFormat,
    sourceSha256: bulkImportPreview.sourceSha256,
    previewToken: bulkImportPreview.previewToken,
    identityColumn: document.querySelector("#bulkImportIdentityColumn")?.value || "",
    displayNameColumn: document.querySelector("#bulkImportDisplayNameColumn")?.value || "",
    headers: bulkImportPreview.headers,
    rows,
    sourceRowNumbers:
      bulkImportPreview?.sourceRowNumbers ?? rows.map((_row, index) => index + 2),
    mappings: collectBulkImportMappings(),
    identityCaseInsensitive: Boolean(
      document.querySelector("#bulkImportIdentityCaseInsensitive")?.checked
    ),
    personName: {
      normalizeCase: Boolean(
        document.querySelector("#bulkImportNormalizePersonName")?.checked
      ),
      split: Boolean(
        document.querySelector("#bulkImportSplitPersonName")?.checked
      ),
      sourceOrder:
        document.querySelector("#bulkImportNameOrder")?.value ||
        "family-given-patronymic"
    },
    group: createGroup
      ? { name: document.querySelector("#bulkImportGroupName")?.value.trim() || "Импорт" }
      : null
  };
}

function bulkImportPropertyOptions(selectedKey = "") {
  return bulkImportPersonProperties()
    .map(
      (property) =>
        `<option value="existing:${escapeHtml(property.key)}" ${property.key === selectedKey ? "selected" : ""}>${escapeHtml(property.label)}</option>`
    )
    .join("");
}


function openBulkImportPanel(trigger) {
  createBulkImportPanel();
  const employeesView = document.querySelector('[data-view="employees"]');
  bulkImportReturnFocus =
    trigger instanceof HTMLElement && trigger.closest('[data-view="employees"]')
      ? trigger
      : employeesView?.querySelector("[data-bulk-import-open]") || null;
  globalThis.docomatorSelectView?.("employees");
  const panel = document.querySelector("#bulkDataImportPanel");
  if (!panel) return;
  panel.hidden = false;
  panel.scrollIntoView({ block: "start" });
  panel.querySelector("#bulkImportFile")?.focus();
  setBulkImportStep(
    bulkImportPlan ? 3 : bulkImportPreview ? 2 : 1,
    false
  );
  void loadBulkImportPropertyDefinitions();
  void loadBulkImportHistory();
}

function createBulkImportPanel() {
  if (bulkImportCreated) return;
  const employeesView = document.querySelector('[data-view="employees"]');
  const membersPane = document.querySelector('[data-space-pane="members"]');
  if (!employeesView) return;
  bulkImportCreated = true;
  const heading = membersPane?.querySelector(".compact-heading");
  if (heading) {
    const openButton = document.createElement("button");
    openButton.className = "secondary-button";
    openButton.type = "button";
    openButton.id = "bulkImportOpen";
    openButton.dataset.bulkImportOpen = "";
    openButton.textContent = "Импортировать список";
    heading.append(openButton);
  }

  const panel = document.createElement("article");
  panel.id = "bulkDataImportPanel";
  panel.className = "bulk-import-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="panel-heading">
      <div><p class="eyebrow">Сотрудники</p><h2>Импортировать список</h2><p>Проверьте колонки перед сохранением. Пустые ячейки не сотрут уже заполненные сведения.</p></div>
      <button class="icon-button" id="bulkImportClose" type="button" aria-label="Закрыть импорт">×</button>
    </div>
    <ol class="bulk-import-steps" aria-label="Шаги импорта">
      <li class="is-current" data-bulk-import-step="1" aria-current="step">1. Файл</li><li data-bulk-import-step="2">2. Поля</li><li data-bulk-import-step="3">3. Проверка</li><li data-bulk-import-step="4">4. Готово</li>
    </ol>
    <div class="bulk-import-upload">
      <label class="generation-field">
        <span>Список сотрудников</span>
        <input id="bulkImportFile" type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
        <small>CSV или XLSX до 8 МБ и 1000 строк. В XLSX используется первый лист.</small>
      </label>
      <button class="primary-button" id="bulkImportPreviewButton" type="button">Продолжить</button>
    </div>
    <div id="bulkImportMessage" class="bulk-import-message" role="status" aria-live="polite">Выберите файл со строкой заголовков.</div>
    <div id="bulkImportPreview"></div>
    <section class="bulk-import-history">
      <div class="panel-heading compact-heading"><div><h3>Недавние импорты</h3><p>Сколько сотрудников было добавлено или обновлено.</p></div><button class="quiet-button" id="bulkImportHistoryRefresh" type="button">Обновить</button></div>
      <div id="bulkImportHistory" class="generation-history-list"><div class="generation-history-empty">История ещё не загружена.</div></div>
    </section>`;
  employeesView.append(panel);

  panel.querySelector("#bulkImportClose")?.addEventListener("click", () => {
    panel.hidden = true;
    bulkImportReturnFocus?.focus?.();
    bulkImportReturnFocus = null;
  });
  panel
    .querySelector("#bulkImportPreviewButton")
    ?.addEventListener("click", previewBulkImportFile);
  panel
    .querySelector("#bulkImportHistoryRefresh")
    ?.addEventListener("click", loadBulkImportHistory);
  panel.addEventListener("change", handleBulkImportFieldChange);
  panel.addEventListener("input", handleBulkImportFieldInput);
  panel.addEventListener("click", handleBulkImportClick);
  initializeBulkImportSources();
}


async function previewBulkImportFile() {
  if (bulkImportBusy) return;
  const file = document.querySelector("#bulkImportFile")?.files?.[0];
  const previousPreview = bulkImportPreview;
  const previousSpaceId = bulkImportSpaceId;
  const message = document.querySelector("#bulkImportMessage");
  const button = document.querySelector("#bulkImportPreviewButton");
  if (!file || !message || !button) {
    if (message) message.textContent = "Выберите файл CSV или XLSX.";
    return;
  }
  const spaceId = bulkImportCurrentSpaceId();
  if (!spaceId) {
    message.textContent = "Сначала выберите раздел сотрудников.";
    return;
  }
  await loadBulkImportPropertyDefinitions();
  const requestSession = bulkImportSession + 1;
  bulkImportSession = requestSession;
  bulkImportSpaceId = spaceId;
  bulkImportPlanSpaceId = null;
  bulkImportBusy = true;
  bulkImportPlan = null;
  button.disabled = true;
  message.className = "bulk-import-message is-loading";
  message.textContent = "Читаем файл и показываем первые строки…";
  try {
    const response = await fetch(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/data-import/preview?fileName=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream", accept: "application/json" },
        body: file
      }
    );
    const body = await response.json();
    if (
      requestSession !== bulkImportSession ||
      !bulkImportSpaceMatches(spaceId)
    ) {
      return;
    }
    if (!response.ok) throw bulkImportResponseError(body, response, "Не удалось прочитать файл.");
    bulkImportPreview = body.data;
    message.className = "bulk-import-message is-success";
    message.textContent = `Файл прочитан: ${body.data.rowCount} строк. Теперь проверьте назначение колонок.`;
    renderBulkImportPreview(body.data);
    setBulkImportStep(2);
    document.querySelector("#bulkImportDisplayNameColumn")?.focus();
  } catch (error) {
    if (requestSession !== bulkImportSession) return;
    bulkImportPreview = previousPreview;
    bulkImportSpaceId = previousSpaceId;
    message.className = "bulk-import-message is-error";
    message.textContent = error instanceof Error ? error.message : "Не удалось прочитать файл.";
    if (typeof showBulkImportOperationIssue === "function") {
      showBulkImportOperationIssue(error);
    }
  } finally {
    if (requestSession === bulkImportSession) {
      bulkImportBusy = false;
      button.disabled = false;
    }
  }
}


function rebuildBulkImportMappings() {
  if (!bulkImportPreview) return;
  const root = document.querySelector("#bulkImportMappings");
  if (!root) return;
  const identityColumn = document.querySelector("#bulkImportIdentityColumn")?.value || bulkImportPreview.headers[0];
  const displayNameColumn = document.querySelector("#bulkImportDisplayNameColumn")?.value || bulkImportPreview.headers[0];
  root.innerHTML = bulkImportPreview.headers
    .map((header, index) => bulkImportMappingRow(header, index, identityColumn, displayNameColumn))
    .join("");
  updateBulkImportMappingVisibility();
}

function invalidateBulkImportPlan() {
  bulkImportPlan = null;
  bulkImportPlanSpaceId = null;
  const root = document.querySelector("#bulkImportPlan");
  if (root) root.innerHTML = "<p>Настройки изменились. Выполните проверку ещё раз.</p>";
  const executeButton = document.querySelector("#bulkImportExecute");
  executeButton?.remove();
  const planButton = document.querySelector("#bulkImportPlanButton");
  if (planButton) planButton.hidden = false;
  setBulkImportStep(2);
}

function handleBulkImportFieldChange(event) {
  if (event.target.matches("[data-bulk-mapping-mode], [data-bulk-value-type], #bulkImportCreateGroup")) {
    updateBulkImportMappingVisibility();
  }
  if (event.target.matches("#bulkImportIdentityColumn, #bulkImportDisplayNameColumn")) {
    rebuildBulkImportMappings();
  }
  if (event.target.matches("#bulkImportPreview input, #bulkImportPreview select, #bulkImportPreview textarea")) {
    invalidateBulkImportPlan();
  }
}

function handleBulkImportFieldInput(event) {
  if (event.target.matches("[data-bulk-property-label], [data-bulk-enum-values], #bulkImportGroupName")) {
    invalidateBulkImportPlan();
  }
}



function renderBulkImportErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return "";
  return `<section class="generation-error-list"><div><p class="eyebrow">Нужно проверить</p></div>${errors.slice(0, 100).map((error) => `<article class="generation-error-item"><div><strong>Строка ${error.rowNumber}</strong><span>${escapeHtml(error.message)}</span></div></article>`).join("")}</section>`;
}

function renderBulkImportPlan(plan) {
  const root = document.querySelector("#bulkImportPlan");
  const submitRow = document.querySelector(".bulk-import-submit-row");
  if (!root || !submitRow) return;
  const validCount = plan.createdCount + plan.updatedCount + plan.unchangedCount;
  root.innerHTML = `
    <div class="bulk-import-summary" aria-label="Предварительный итог">
      <div><span>Новые</span><strong>${plan.createdCount}</strong></div>
      <div><span>Обновятся</span><strong>${plan.updatedCount}</strong></div>
      <div><span>Без изменений</span><strong>${plan.unchangedCount}</strong></div>
      <div><span>С ошибками</span><strong>${plan.failedCount}</strong></div>
    </div>
    ${renderBulkImportErrors(plan.errors)}
    <p class="bulk-import-safety-note">Пустые ячейки будут пропущены: существующие сведения останутся на месте.</p>`;
  const planButton = document.querySelector("#bulkImportPlanButton");
  if (planButton) planButton.hidden = true;
  document.querySelector("#bulkImportExecute")?.remove();
  const executeButton = document.createElement("button");
  executeButton.className = "primary-button";
  executeButton.id = "bulkImportExecute";
  executeButton.type = "button";
  executeButton.disabled = validCount === 0;
  executeButton.textContent = validCount === 0
    ? "Нет строк для импорта"
    : `Импортировать ${validCount} ${validCount === 1 ? "сотрудника" : "сотрудников"}`;
  submitRow.prepend(executeButton);
}

async function planBulkImport() {
  if (bulkImportBusy || !bulkImportPreview) return;
  const button = document.querySelector("#bulkImportPlanButton");
  const message = document.querySelector("#bulkImportMessage");
  if (!button || !message) return;
  const spaceId = bulkImportSpaceId;
  if (!bulkImportSpaceMatches(spaceId)) {
    clearBulkImportState(
      "Раздел сотрудников изменился. Выберите файл заново, чтобы не смешать данные."
    );
    return;
  }
  const requestSession = bulkImportSession;
  bulkImportBusy = true;
  button.disabled = true;
  message.className = "bulk-import-message is-loading";
  message.textContent = "Проверяем строки. Ничего пока не сохраняется…";
  try {
    const body = await bulkImportApi(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/data-import/plan`,
      { method: "POST", body: JSON.stringify(bulkImportRequestBody()) }
    );
    if (
      requestSession !== bulkImportSession ||
      !bulkImportSpaceMatches(spaceId)
    ) {
      return;
    }
    bulkImportPlan = body.data;
    bulkImportPlanSpaceId = spaceId;
    message.className = body.data.failedCount > 0 ? "bulk-import-message is-warning" : "bulk-import-message is-success";
    message.textContent = body.data.failedCount > 0
      ? `Проверка завершена: ${body.data.failedCount} строк требуют внимания. Остальные можно импортировать.`
      : "Проверка завершена. Ни одна запись ещё не сохранена.";
    renderBulkImportPlan(body.data);
    setBulkImportStep(3);
    document.querySelector("#bulkImportExecute")?.focus();
  } catch (error) {
    if (requestSession !== bulkImportSession) return;
    bulkImportPlan = null;
    bulkImportPlanSpaceId = null;
    message.className = "bulk-import-message is-error";
    message.textContent = error instanceof Error ? error.message : "Не удалось проверить импорт.";
    if (typeof showBulkImportOperationIssue === "function") {
      showBulkImportOperationIssue(error);
    }
  } finally {
    if (requestSession === bulkImportSession) {
      bulkImportBusy = false;
      button.disabled = false;
    }
  }
}

async function executeBulkImport() {
  if (bulkImportBusy || !bulkImportPreview || !bulkImportPlan) return;
  const button = document.querySelector("#bulkImportExecute");
  const message = document.querySelector("#bulkImportMessage");
  if (!button || !message) return;
  const spaceId = bulkImportSpaceId;
  if (
    !bulkImportSpaceMatches(spaceId) ||
    bulkImportPlanSpaceId !== spaceId
  ) {
    clearBulkImportState(
      "Раздел сотрудников изменился после проверки. Выберите файл и выполните проверку заново."
    );
    return;
  }
  const requestSession = bulkImportSession;
  bulkImportBusy = true;
  button.disabled = true;
  message.className = "bulk-import-message is-loading";
  message.textContent = "Сохраняем сотрудников и их поля…";
  try {
    const body = await bulkImportApi(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/data-import/execute`,
      { method: "POST", body: JSON.stringify(bulkImportRequestBody()) }
    );
    if (
      requestSession !== bulkImportSession ||
      !bulkImportSpaceMatches(spaceId)
    ) {
      return;
    }
    const result = body.data;
    message.className = result.state === "completed" ? "bulk-import-message is-success" : "bulk-import-message is-warning";
    message.textContent = `Импорт завершён: добавлено ${result.createdCount}, обновлено ${result.updatedCount}, без изменений ${result.unchangedCount}, с ошибками ${result.failedCount}.`;
    renderBulkImportResult(result);
    setBulkImportStep(4, true);
    window.dispatchEvent(
      new CustomEvent("docomator:employees-changed", { detail: { spaceId } })
    );
    await loadBulkImportHistory();
  } catch (error) {
    if (requestSession !== bulkImportSession) return;
    message.className = "bulk-import-message is-error";
    message.textContent = error instanceof Error ? error.message : "Импорт не выполнен. Настройки и файл сохранены на экране.";
    button.disabled = false;
  } finally {
    if (requestSession === bulkImportSession) bulkImportBusy = false;
  }
}

function renderBulkImportResult(result) {
  const root = document.querySelector("#bulkImportPreview");
  if (!root) return;
  root.innerHTML = `
    <section class="bulk-import-finished">
      <p class="eyebrow">Готово</p><h3>Список сотрудников обработан</h3>
      <div class="bulk-import-summary">
        <div><span>Добавлено</span><strong>${result.createdCount}</strong></div>
        <div><span>Обновлено</span><strong>${result.updatedCount}</strong></div>
        <div><span>Без изменений</span><strong>${result.unchangedCount}</strong></div>
        <div><span>С ошибками</span><strong>${result.failedCount}</strong></div>
      </div>
      ${result.groupName ? `<p>Группа «${escapeHtml(result.groupName)}» готова для выбора при создании документов.</p>` : ""}
      ${renderBulkImportErrors(result.errors)}
      <button class="secondary-button" id="bulkImportAnother" type="button">Импортировать другой файл</button>
    </section>`;
  root.querySelector("#bulkImportAnother")?.addEventListener("click", () => {
    clearBulkImportState("Выберите следующий файл со строкой заголовков.");
    const status = document.querySelector("#bulkImportMessage");
    if (status) status.className = "bulk-import-message";
    const file = document.querySelector("#bulkImportFile");
    if (file) {
      file.focus();
    }
  });
}

function renderBulkImportHistory() {
  const root = document.querySelector("#bulkImportHistory");
  if (!root) return;
  if (bulkImportHistory.length === 0) {
    root.innerHTML = `<div class="generation-history-empty">Импортов сотрудников ещё нет.</div>`;
    return;
  }
  root.innerHTML = bulkImportHistory
    .map(
      (run) => `<article class="generation-history-item"><div><span class="generation-state-code">${run.state === "completed" ? "Завершён" : run.state === "partial" ? "Есть ошибки" : "Не выполнен"}</span><strong>${escapeHtml(run.fileName)}</strong><span>Добавлено ${run.createdCount} · обновлено ${run.updatedCount} · с ошибками ${run.failedCount} · ${escapeHtml(new Date(run.createdAt).toLocaleString("ru-RU"))}</span></div></article>`
    )
    .join("");
}

async function loadBulkImportHistory() {
  const spaceId = bulkImportCurrentSpaceId();
  if (!spaceId) return;
  const root = document.querySelector("#bulkImportHistory");
  if (root) root.innerHTML = `<div class="generation-history-empty">Получаем историю…</div>`;
  try {
    const body = await bulkImportApi(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/data-import/runs?limit=50`
    );
    bulkImportHistory = Array.isArray(body.data) ? body.data : [];
    renderBulkImportHistory();
  } catch (error) {
    if (root) root.innerHTML = `<div class="generation-history-empty is-error">${escapeHtml(error instanceof Error ? error.message : "История временно недоступна.")}</div>`;
  }
}

function handleBulkImportClick(event) {
  if (event.target.closest("#bulkImportPlanButton")) void planBulkImport();
  if (event.target.closest("#bulkImportExecute")) void executeBulkImport();
}

createBulkImportPanel();
document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-bulk-import-open]");
  if (trigger) openBulkImportPanel(trigger);
});
window.addEventListener("docomator:space-changed", (event) => {
  const nextSpaceId = event.detail?.spaceId || bulkImportCurrentSpaceId();
  if (bulkImportSpaceId && nextSpaceId !== bulkImportSpaceId) {
    clearBulkImportState(
      "Раздел сотрудников изменён. Файл и проверка сброшены, чтобы данные не попали в другой раздел. Выберите файл заново."
    );
  }
});
new MutationObserver(createBulkImportPanel).observe(document.body, {
  childList: true,
  subtree: true
});
