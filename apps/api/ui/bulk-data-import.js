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
    const error = new Error(
      body?.error?.message || `Сервер вернул код ${response.status}.`
    );
    error.correlationId =
      body?.correlationId || response.headers.get("x-correlation-id") || "";
    throw error;
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

function bulkImportGuessProperty(header) {
  const normalized = header.trim().toLocaleLowerCase("ru-RU");
  return (
    bulkImportPersonProperties().find(
      (property) =>
        property.label.toLocaleLowerCase("ru-RU") === normalized ||
        (Array.isArray(property.aliases) &&
          property.aliases.some(
            (alias) => alias.toLocaleLowerCase("ru-RU") === normalized
          ))
    ) || null
  );
}

function bulkImportGuessValueType(header) {
  const normalized = header.toLocaleLowerCase("ru-RU");
  if (/дата|день рождения/u.test(normalized)) return "date";
  if (/количество|стаж|номер кабинета/u.test(normalized)) return "integer";
  if (/сумма|оклад|ставка/u.test(normalized)) return "number";
  if (/примечание|комментарий|описание/u.test(normalized)) return "text";
  return "string";
}

function bulkImportPropertyOptions(selectedKey = "") {
  return bulkImportPersonProperties()
    .map(
      (property) =>
        `<option value="existing:${escapeHtml(property.key)}" ${property.key === selectedKey ? "selected" : ""}>${escapeHtml(property.label)}</option>`
    )
    .join("");
}

function bulkImportMappingRow(header, index, identityColumn, displayNameColumn) {
  const guessed = bulkImportGuessProperty(header);
  const isDisplayName = header === displayNameColumn;
  const mode = isDisplayName ? "skip" : guessed ? `existing:${guessed.key}` : "create";
  const note = isDisplayName
    ? "Используется как ФИО"
    : header === identityColumn
      ? "По этой колонке будут найдены прежние записи"
      : `Колонка ${index + 1}`;
  return `
    <article class="bulk-import-mapping-row" data-bulk-mapping-row data-column="${escapeHtml(header)}">
      <div class="bulk-import-column-name"><strong>${escapeHtml(header)}</strong><small>${note}</small></div>
      <label>
        <span>Куда перенести</span>
        <select data-bulk-mapping-mode aria-label="Куда перенести колонку ${escapeHtml(header)}">
          <option value="skip" ${mode === "skip" ? "selected" : ""}>Не переносить</option>
          <option value="create" ${mode === "create" ? "selected" : ""}>Создать новое поле</option>
          ${bulkImportPropertyOptions(guessed?.key || "")}
        </select>
      </label>
      <label data-bulk-create-field ${mode === "create" ? "" : "hidden"}>
        <span>Название поля</span>
        <input data-bulk-property-label type="text" value="${escapeHtml(header)}" maxlength="300" />
      </label>
      <label data-bulk-create-field ${mode === "create" ? "" : "hidden"}>
        <span>Формат значений</span>
        <select data-bulk-value-type>
          <option value="string" ${bulkImportGuessValueType(header) === "string" ? "selected" : ""}>Короткий текст</option>
          <option value="text" ${bulkImportGuessValueType(header) === "text" ? "selected" : ""}>Длинный текст</option>
          <option value="number" ${bulkImportGuessValueType(header) === "number" ? "selected" : ""}>Число</option>
          <option value="integer" ${bulkImportGuessValueType(header) === "integer" ? "selected" : ""}>Целое число</option>
          <option value="boolean">Да или нет</option>
          <option value="date" ${bulkImportGuessValueType(header) === "date" ? "selected" : ""}>Дата</option>
          <option value="date-time">Дата и время</option>
        </select>
      </label>
    </article>`;
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
    openButton.dataset.bulkImportLegacy = "";
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
        <input id="bulkImportFile" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
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
}

function renderBulkImportPreview(preview) {
  const root = document.querySelector("#bulkImportPreview");
  if (!root) return;
  const identityColumn = bulkImportGuessColumn(
    preview.headers,
    [/табел/u, /кадров/u, /^id$/u, /номер/u, /почт/u, /email/u]
  );
  const displayNameColumn = bulkImportGuessColumn(
    preview.headers,
    [/фио/u, /полное.*имя/u, /сотрудник/u, /^имя$/u, /^name$/u],
    preview.headers[0]
  );
  root.innerHTML = `
    <section class="bulk-import-config">
      <div class="bulk-import-file-summary">
        <strong>${escapeHtml(preview.fileName)}</strong>
        <span>${preview.rowCount} ${preview.rowCount === 1 ? "сотрудник" : "строк"} · ${preview.columnCount} колонок</span>
      </div>
      <div class="bulk-import-core-fields">
        <label class="generation-field"><span>В какой колонке ФИО?</span><select id="bulkImportDisplayNameColumn">${preview.headers.map((header) => `<option value="${escapeHtml(header)}" ${header === displayNameColumn ? "selected" : ""}>${escapeHtml(header)}</option>`).join("")}</select><small>Это имя будет показано в карточке сотрудника.</small></label>
        <label class="generation-field"><span>Как находить сотрудника при повторном импорте?</span><select id="bulkImportIdentityColumn">${preview.headers.map((header) => `<option value="${escapeHtml(header)}" ${header === identityColumn ? "selected" : ""}>${escapeHtml(header)}</option>`).join("")}</select><small>Обычно это табельный номер или рабочая почта. Значения должны быть заполнены и не повторяться.</small></label>
      </div>
      <div class="panel-heading compact-heading"><div><h3>Куда перенести колонки</h3><p>Для каждой колонки выберите поле карточки. Создание нового поля всегда отмечено явно.</p></div></div>
      <div id="bulkImportMappings" class="bulk-import-mappings">
        ${preview.headers.map((header, index) => bulkImportMappingRow(header, index, identityColumn, displayNameColumn)).join("")}
      </div>
      <label class="bulk-import-group-option"><input id="bulkImportCreateGroup" type="checkbox" /><span><strong>Собрать этих сотрудников в группу</strong><small>Группу можно будет выбрать при создании документов.</small></span></label>
      <div id="bulkImportGroupFields" class="bulk-import-group-fields" hidden>
        <label class="generation-field"><span>Название группы</span><input id="bulkImportGroupName" type="text" maxlength="300" value="Импорт от ${new Date().toLocaleDateString("ru-RU")}" /></label>
      </div>
      <details class="bulk-import-source-preview">
        <summary>Посмотреть первые строки файла</summary>
        <div class="bulk-import-table-wrap">
          <table class="bulk-import-table"><thead><tr>${preview.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${preview.sampleRows.slice(0, 10).map((row) => `<tr>${preview.headers.map((header) => `<td>${escapeHtml(row[header] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table>
        </div>
      </details>
      <div id="bulkImportPlan" class="bulk-import-plan"><p>Сначала проверьте, что получится после импорта.</p></div>
      <div class="bulk-import-submit-row"><button class="primary-button" id="bulkImportPlanButton" type="button">Проверить ${preview.rowCount} строк</button><p>Проверка ничего не сохранит. После неё появится точный итог.</p></div>
    </section>`;
  updateBulkImportMappingVisibility();
}

async function previewBulkImportFile() {
  if (bulkImportBusy) return;
  const file = document.querySelector("#bulkImportFile")?.files?.[0];
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
    if (!response.ok) throw new Error(body?.error?.message || "Не удалось прочитать файл.");
    bulkImportPreview = body.data;
    message.className = "bulk-import-message is-success";
    message.textContent = `Файл прочитан: ${body.data.rowCount} строк. Теперь проверьте назначение колонок.`;
    renderBulkImportPreview(body.data);
    setBulkImportStep(2);
    document.querySelector("#bulkImportDisplayNameColumn")?.focus();
  } catch (error) {
    if (requestSession !== bulkImportSession) return;
    bulkImportPreview = null;
    bulkImportSpaceId = null;
    message.className = "bulk-import-message is-error";
    message.textContent = error instanceof Error ? error.message : "Не удалось прочитать файл.";
    const root = document.querySelector("#bulkImportPreview");
    if (root) root.innerHTML = "";
  } finally {
    if (requestSession === bulkImportSession) {
      bulkImportBusy = false;
      button.disabled = false;
    }
  }
}

function updateBulkImportMappingVisibility() {
  document.querySelectorAll("[data-bulk-mapping-row]").forEach((row) => {
    const mode = row.querySelector("[data-bulk-mapping-mode]")?.value || "skip";
    row.querySelectorAll("[data-bulk-create-field]").forEach((field) => {
      field.hidden = mode !== "create";
    });
  });
  const group = document.querySelector("#bulkImportGroupFields");
  if (group) group.hidden = !document.querySelector("#bulkImportCreateGroup")?.checked;
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
  if (event.target.matches("[data-bulk-mapping-mode], #bulkImportCreateGroup")) {
    updateBulkImportMappingVisibility();
  }
  if (event.target.matches("#bulkImportIdentityColumn, #bulkImportDisplayNameColumn")) {
    rebuildBulkImportMappings();
  }
  if (event.target.matches("#bulkImportPreview input, #bulkImportPreview select")) {
    invalidateBulkImportPlan();
  }
}

function handleBulkImportFieldInput(event) {
  if (event.target.matches("[data-bulk-property-label], #bulkImportGroupName")) {
    invalidateBulkImportPlan();
  }
}

function collectBulkImportMappings() {
  const mappings = [];
  document.querySelectorAll("[data-bulk-mapping-row]").forEach((row) => {
    const mode = row.querySelector("[data-bulk-mapping-mode]")?.value || "skip";
    if (mode === "skip") return;
    const column = row.dataset.column;
    if (mode.startsWith("existing:")) {
      mappings.push({ column, propertyKey: mode.slice("existing:".length) });
      return;
    }
    mappings.push({
      column,
      createIfMissing: true,
      label: row.querySelector("[data-bulk-property-label]")?.value.trim() || column,
      valueType: row.querySelector("[data-bulk-value-type]")?.value || "string"
    });
  });
  return mappings;
}

function bulkImportRequestBody() {
  const createGroup = document.querySelector("#bulkImportCreateGroup")?.checked === true;
  return {
    fileName: bulkImportPreview.fileName,
    fileFormat: bulkImportPreview.fileFormat,
    sourceSha256: bulkImportPreview.sourceSha256,
    previewToken: bulkImportPreview.previewToken,
    identityColumn: document.querySelector("#bulkImportIdentityColumn")?.value || "",
    displayNameColumn: document.querySelector("#bulkImportDisplayNameColumn")?.value || "",
    headers: bulkImportPreview.headers,
    rows: bulkImportPreview.rows,
    mappings: collectBulkImportMappings(),
    group: createGroup
      ? { name: document.querySelector("#bulkImportGroupName")?.value.trim() || "Импорт" }
      : null
  };
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
