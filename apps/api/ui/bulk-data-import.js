let bulkImportCreated = false;
let bulkImportBusy = false;
let bulkImportPreview = null;
let bulkImportHistory = [];

function bulkImportPanel() {
  return document.querySelector("#bulkDataImportPanel");
}

function bulkImportSlug(value) {
  const transliteration = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e",
    ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
    н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
    ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
    ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya"
  };
  const text = String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .split("")
    .map((character) => transliteration[character] ?? character)
    .join("")
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 80);
  return /^[a-z]/u.test(text) ? text : `field_${text || "value"}`;
}

function bulkImportCurrentType() {
  return document.querySelector("#bulkImportEntityType")?.value || "";
}

function bulkImportPropertyOptions(selected = "") {
  return state.data.properties
    .filter((property) =>
      ["string", "text", "number", "integer", "boolean", "date", "date-time", "enum"].includes(property.valueType)
    )
    .map(
      (property) =>
        `<option value="existing:${escapeHtml(property.key)}" ${property.key === selected ? "selected" : ""}>${escapeHtml(property.label)} · ${escapeHtml(property.key)}</option>`
    )
    .join("");
}

function bulkImportGuessColumn(headers, patterns, fallback = "") {
  return (
    headers.find((header) =>
      patterns.some((pattern) => pattern.test(header.toLowerCase()))
    ) || fallback || headers[0] || ""
  );
}

function bulkImportGuessProperty(header) {
  const normalized = header.trim().toLowerCase();
  return (
    state.data.properties.find(
      (property) =>
        property.key.toLowerCase() === normalized ||
        property.label.toLowerCase() === normalized ||
        (Array.isArray(property.aliases) &&
          property.aliases.some((alias) => alias.toLowerCase() === normalized))
    ) || null
  );
}

function bulkImportMappingRow(header, index, identityColumn, displayNameColumn) {
  const guessed = bulkImportGuessProperty(header);
  const isDisplayName = header === displayNameColumn;
  const mode = isDisplayName
    ? "skip"
    : guessed
      ? `existing:${guessed.key}`
      : "create";
  const typeKey = bulkImportCurrentType() || "person";
  const propertyKey =
    header === identityColumn
      ? `${typeKey}.external_id`
      : `${typeKey}.${bulkImportSlug(header)}`;
  return `
    <article class="bulk-import-mapping-row" data-bulk-mapping-row data-column="${escapeHtml(header)}">
      <div><strong>${escapeHtml(header)}</strong><small>${header === identityColumn ? "Устойчивый ключ" : header === displayNameColumn ? "Отображаемое имя" : `Колонка ${index + 1}`}</small></div>
      <label>
        <span>Действие</span>
        <select data-bulk-mapping-mode>
          <option value="skip" ${mode === "skip" ? "selected" : ""}>Не импортировать как свойство</option>
          <option value="create" ${mode === "create" ? "selected" : ""}>Создать новое свойство</option>
          ${bulkImportPropertyOptions(guessed?.key || "")}
        </select>
      </label>
      <label data-bulk-create-field ${mode === "create" ? "" : "hidden"}>
        <span>Ключ свойства</span>
        <input data-bulk-property-key type="text" value="${escapeHtml(propertyKey)}" maxlength="160" />
      </label>
      <label data-bulk-create-field ${mode === "create" ? "" : "hidden"}>
        <span>Тип данных</span>
        <select data-bulk-value-type>
          <option value="string">Короткая строка</option>
          <option value="text">Длинный текст</option>
          <option value="number">Число</option>
          <option value="integer">Целое число</option>
          <option value="boolean">Да / нет</option>
          <option value="date">Дата</option>
          <option value="date-time">Дата и время</option>
        </select>
      </label>
    </article>`;
}

function createBulkImportPanel() {
  if (bulkImportCreated) return;
  const membersPane = document.querySelector('[data-space-pane="members"]');
  if (!membersPane) return;
  bulkImportCreated = true;
  const heading = membersPane.querySelector(".compact-heading");
  const button = document.createElement("button");
  button.className = "secondary-button";
  button.type = "button";
  button.id = "bulkImportOpen";
  button.textContent = "Импорт CSV/XLSX";
  heading?.append(button);

  const panel = document.createElement("article");
  panel.id = "bulkDataImportPanel";
  panel.className = "bulk-import-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="panel-heading">
      <div><p class="eyebrow">Массовые данные</p><h2>Импорт участников и свойств</h2><p>Повторная загрузка обновляет записи по устойчивому ключу и не создаёт дубли.</p></div>
      <button class="icon-button" id="bulkImportClose" type="button" aria-label="Закрыть импорт">×</button>
    </div>
    <div class="bulk-import-upload">
      <label class="generation-field">
        <span>Файл CSV или XLSX</span>
        <input id="bulkImportFile" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
        <small>До 8 МБ, 1000 строк и 100 колонок. CSV должен быть в UTF-8. В XLSX используется первый лист.</small>
      </label>
      <button class="primary-button" id="bulkImportPreviewButton" type="button">Показать данные</button>
    </div>
    <div id="bulkImportMessage" class="bulk-import-message">Файл ещё не выбран.</div>
    <div id="bulkImportPreview"></div>
    <section class="bulk-import-history">
      <div class="panel-heading compact-heading"><div><h3>Последние импорты</h3><p>Результаты создания, обновления и пропущенные строки.</p></div><button class="quiet-button" id="bulkImportHistoryRefresh" type="button">Обновить</button></div>
      <div id="bulkImportHistory" class="generation-history-list"><div class="generation-history-empty">История ещё не загружена.</div></div>
    </section>`;
  membersPane.append(panel);

  button.addEventListener("click", () => {
    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
    void loadBulkImportHistory();
  });
  panel.querySelector("#bulkImportClose")?.addEventListener("click", () => {
    panel.hidden = true;
  });
  panel
    .querySelector("#bulkImportPreviewButton")
    ?.addEventListener("click", previewBulkImportFile);
  panel
    .querySelector("#bulkImportHistoryRefresh")
    ?.addEventListener("click", loadBulkImportHistory);
  panel.addEventListener("change", handleBulkImportFieldChange);
  panel.addEventListener("click", handleBulkImportClick);
}

function renderBulkImportPreview(preview) {
  const root = document.querySelector("#bulkImportPreview");
  if (!root) return;
  if (state.data.types.length === 0) {
    root.innerHTML = `<div class="generation-state is-warning"><span aria-hidden="true">⚠️</span><div><strong>Сначала создайте тип сущности</strong><p>Например, тип «Человек». После этого повторите предварительный просмотр.</p></div></div>`;
    return;
  }
  const identityColumn = bulkImportGuessColumn(
    preview.headers,
    [/^id$/u, /код/u, /табел/u, /номер/u, /email/u, /инн/u]
  );
  const displayNameColumn = bulkImportGuessColumn(
    preview.headers,
    [/фио/u, /полное.*имя/u, /имя/u, /name/u, /сотрудник/u],
    preview.headers[0]
  );
  root.innerHTML = `
    <section class="bulk-import-config">
      <div class="generation-progress-grid">
        <div class="generation-progress-item"><span>Формат</span><strong>${preview.fileFormat.toUpperCase()}</strong><small>${escapeHtml(preview.fileName)}</small></div>
        <div class="generation-progress-item"><span>Строк данных</span><strong>${preview.rowCount}</strong><small>не более 1000</small></div>
        <div class="generation-progress-item"><span>Колонок</span><strong>${preview.columnCount}</strong><small>названия сделаны уникальными</small></div>
        <div class="generation-progress-item"><span>Контрольная сумма</span><strong>${preview.sourceSha256.slice(0, 8)}…</strong><small>предпросмотр защищён токеном</small></div>
      </div>
      <div class="bulk-import-core-fields">
        <label class="generation-field"><span>Тип записей</span><select id="bulkImportEntityType">${state.data.types.map((type) => `<option value="${escapeHtml(type.key)}">${escapeHtml(type.label)} · ${escapeHtml(type.key)}</option>`).join("")}</select></label>
        <label class="generation-field"><span>Колонка устойчивого ключа</span><select id="bulkImportIdentityColumn">${preview.headers.map((header) => `<option value="${escapeHtml(header)}" ${header === identityColumn ? "selected" : ""}>${escapeHtml(header)}</option>`).join("")}</select><small>Повторная загрузка найдёт запись по этому значению.</small></label>
        <label class="generation-field"><span>Колонка отображаемого имени</span><select id="bulkImportDisplayNameColumn">${preview.headers.map((header) => `<option value="${escapeHtml(header)}" ${header === displayNameColumn ? "selected" : ""}>${escapeHtml(header)}</option>`).join("")}</select></label>
        <label class="generation-field"><span>Свойство устойчивого ключа</span><input id="bulkImportIdentityProperty" type="text" maxlength="160" value="${escapeHtml(`${state.data.types[0]?.key || "person"}.external_id`)}" /><small>Будет создано как строка, если его ещё нет.</small></label>
      </div>
      <div class="panel-heading compact-heading"><div><h3>Сопоставление колонок</h3><p>Можно использовать существующее свойство, создать новое или пропустить колонку.</p></div></div>
      <div id="bulkImportMappings" class="bulk-import-mappings">
        ${preview.headers.map((header, index) => bulkImportMappingRow(header, index, identityColumn, displayNameColumn)).join("")}
      </div>
      <label class="bulk-import-group-option"><input id="bulkImportCreateGroup" type="checkbox" /><span><strong>Добавить импортированных участников в группу</strong><small>Если группа с таким ключом существует, новые участники будут добавлены к текущему составу.</small></span></label>
      <div id="bulkImportGroupFields" class="bulk-import-group-fields" hidden>
        <label class="generation-field"><span>Название группы</span><input id="bulkImportGroupName" type="text" maxlength="300" value="Импорт ${new Date().toLocaleDateString("ru-RU")}" /></label>
        <label class="generation-field"><span>Ключ группы</span><input id="bulkImportGroupKey" type="text" maxlength="160" value="import_${new Date().toISOString().slice(0, 10).replaceAll("-", "_")}" /></label>
      </div>
      <div class="bulk-import-table-wrap">
        <table class="bulk-import-table"><thead><tr>${preview.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${preview.sampleRows.slice(0, 10).map((row) => `<tr>${preview.headers.map((header) => `<td>${escapeHtml(row[header] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table>
      </div>
      <div class="bulk-import-submit-row"><button class="primary-button" id="bulkImportExecute" type="button">Импортировать ${preview.rowCount} строк</button><p>Перед записью сервер повторно проверит контрольный токен и типы значений.</p></div>
    </section>`;
  updateBulkImportMappingVisibility();
}

async function previewBulkImportFile() {
  if (bulkImportBusy) return;
  const file = document.querySelector("#bulkImportFile")?.files?.[0];
  const message = document.querySelector("#bulkImportMessage");
  const button = document.querySelector("#bulkImportPreviewButton");
  if (!file || !message || !button) {
    if (message) message.textContent = "Выберите CSV или XLSX.";
    return;
  }
  if (!state.currentSpaceId) {
    message.textContent = "Сначала выберите организационный раздел.";
    return;
  }
  bulkImportBusy = true;
  button.disabled = true;
  message.className = "bulk-import-message is-loading";
  message.textContent = "Читаем файл и строим предварительный просмотр…";
  try {
    const response = await fetch(
      `/api/v1/spaces/${encodeURIComponent(state.currentSpaceId)}/data-import/preview?fileName=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream", accept: "application/json" },
        body: file
      }
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message || "Файл не разобран.");
    bulkImportPreview = body.data;
    message.className = "bulk-import-message is-success";
    message.textContent = `Файл прочитан: ${body.data.rowCount} строк, ${body.data.columnCount} колонок. ${body.data.warnings.join(" ")}`;
    renderBulkImportPreview(body.data);
  } catch (error) {
    bulkImportPreview = null;
    message.className = "bulk-import-message is-error";
    message.textContent = error instanceof Error ? error.message : String(error);
    const root = document.querySelector("#bulkImportPreview");
    if (root) root.innerHTML = "";
  } finally {
    bulkImportBusy = false;
    button.disabled = false;
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
  const identityProperty = document.querySelector("#bulkImportIdentityProperty");
  if (identityProperty) identityProperty.value = `${bulkImportCurrentType()}.external_id`;
  updateBulkImportMappingVisibility();
}

function handleBulkImportFieldChange(event) {
  if (event.target.matches("[data-bulk-mapping-mode], #bulkImportCreateGroup")) {
    updateBulkImportMappingVisibility();
  }
  if (event.target.matches("#bulkImportEntityType, #bulkImportIdentityColumn, #bulkImportDisplayNameColumn")) {
    rebuildBulkImportMappings();
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
      propertyKey: row.querySelector("[data-bulk-property-key]")?.value.trim() || "",
      createIfMissing: true,
      label: column,
      valueType: row.querySelector("[data-bulk-value-type]")?.value || "string"
    });
  });
  return mappings;
}

async function executeBulkImport() {
  if (bulkImportBusy || !bulkImportPreview) return;
  const button = document.querySelector("#bulkImportExecute");
  const message = document.querySelector("#bulkImportMessage");
  if (!button || !message) return;
  const identityColumn = document.querySelector("#bulkImportIdentityColumn")?.value || "";
  const displayNameColumn = document.querySelector("#bulkImportDisplayNameColumn")?.value || "";
  const identityPropertyKey = document.querySelector("#bulkImportIdentityProperty")?.value.trim() || "";
  const mappings = collectBulkImportMappings();
  if (!mappings.some((mapping) => mapping.propertyKey === identityPropertyKey)) {
    mappings.unshift({
      column: identityColumn,
      propertyKey: identityPropertyKey,
      createIfMissing: true,
      label: "Устойчивый ключ импорта",
      valueType: "string"
    });
  }
  const createGroup = document.querySelector("#bulkImportCreateGroup")?.checked === true;
  bulkImportBusy = true;
  button.disabled = true;
  message.className = "bulk-import-message is-loading";
  message.textContent = "Создаём и обновляем записи. Страница покажет итог по каждой проблемной строке…";
  try {
    const body = await api(
      `/api/v1/spaces/${encodeURIComponent(state.currentSpaceId)}/data-import/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          fileName: bulkImportPreview.fileName,
          fileFormat: bulkImportPreview.fileFormat,
          sourceSha256: bulkImportPreview.sourceSha256,
          previewToken: bulkImportPreview.previewToken,
          entityTypeKey: bulkImportCurrentType(),
          identityColumn,
          displayNameColumn,
          identityPropertyKey,
          headers: bulkImportPreview.headers,
          rows: bulkImportPreview.rows,
          mappings,
          group: createGroup
            ? {
                name: document.querySelector("#bulkImportGroupName")?.value.trim() || "Импорт",
                key: document.querySelector("#bulkImportGroupKey")?.value.trim() || "import"
              }
            : null
        })
      }
    );
    const result = body.data;
    message.className = result.state === "completed" ? "bulk-import-message is-success" : "bulk-import-message is-warning";
    message.textContent = `Импорт завершён: создано ${result.createdCount}, обновлено ${result.updatedCount}, без изменений ${result.unchangedCount}, пропущено ${result.skippedCount}, ошибок ${result.failedCount}.`;
    renderBulkImportResult(result);
    await loadData();
    await loadBulkImportHistory();
  } catch (error) {
    message.className = "bulk-import-message is-error";
    message.textContent = error instanceof Error ? error.message : "Импорт не выполнен.";
  } finally {
    bulkImportBusy = false;
    button.disabled = false;
  }
}

function renderBulkImportResult(result) {
  const root = document.querySelector("#bulkImportPreview");
  if (!root) return;
  root.innerHTML = `
    <div class="generation-progress-grid">
      <div class="generation-progress-item"><span>Создано</span><strong>${result.createdCount}</strong></div>
      <div class="generation-progress-item"><span>Обновлено</span><strong>${result.updatedCount}</strong></div>
      <div class="generation-progress-item"><span>Без изменений</span><strong>${result.unchangedCount}</strong></div>
      <div class="generation-progress-item"><span>Ошибок</span><strong>${result.failedCount}</strong></div>
    </div>
    ${result.groupName ? `<div class="generation-state is-success"><span aria-hidden="true">👥</span><div><strong>Группа «${escapeHtml(result.groupName)}» обновлена</strong><p>Импортированные участники добавлены в сохранённый состав.</p></div></div>` : ""}
    ${result.errors.length > 0 ? `<section class="generation-error-list"><div><p class="eyebrow">Проблемные строки</p></div>${result.errors.slice(0, 100).map((error) => `<article class="generation-error-item"><div><strong>Строка ${error.rowNumber}${error.externalKey ? ` · ${escapeHtml(error.externalKey)}` : ""}</strong><span>${escapeHtml(error.message)}</span></div></article>`).join("")}</section>` : `<div class="generation-state is-success"><span aria-hidden="true">✅</span><div><strong>Все строки обработаны</strong><p>Повторная загрузка этого файла обновит записи по устойчивому ключу.</p></div></div>`}
    <button class="secondary-button" id="bulkImportAnother" type="button">Импортировать другой файл</button>`;
  root.querySelector("#bulkImportAnother")?.addEventListener("click", () => {
    bulkImportPreview = null;
    root.innerHTML = "";
    const file = document.querySelector("#bulkImportFile");
    if (file) file.value = "";
  });
}

function renderBulkImportHistory() {
  const root = document.querySelector("#bulkImportHistory");
  if (!root) return;
  if (bulkImportHistory.length === 0) {
    root.innerHTML = `<div class="generation-history-empty">Импортов в этом разделе ещё нет.</div>`;
    return;
  }
  root.innerHTML = bulkImportHistory
    .map(
      (run) => `<article class="generation-history-item"><div><span class="generation-state-code">${run.state === "completed" ? "Завершён" : run.state === "partial" ? "Частично" : "Ошибка"}</span><strong>${escapeHtml(run.fileName)}</strong><span>${escapeHtml(run.entityTypeKey)} · создано ${run.createdCount} · обновлено ${run.updatedCount} · ошибок ${run.failedCount} · ${escapeHtml(new Date(run.createdAt).toLocaleString("ru-RU"))}</span></div></article>`
    )
    .join("");
}

async function loadBulkImportHistory() {
  if (!state.currentSpaceId) return;
  const root = document.querySelector("#bulkImportHistory");
  if (root) root.innerHTML = `<div class="generation-history-empty">Получаем историю…</div>`;
  try {
    const body = await api(
      `/api/v1/spaces/${encodeURIComponent(state.currentSpaceId)}/data-import/runs?limit=50`
    );
    bulkImportHistory = Array.isArray(body.data) ? body.data : [];
    renderBulkImportHistory();
  } catch (error) {
    if (root) root.innerHTML = `<div class="generation-history-empty is-error">${escapeHtml(error instanceof Error ? error.message : "История недоступна.")}</div>`;
  }
}

function handleBulkImportClick(event) {
  if (event.target.closest("#bulkImportExecute")) void executeBulkImport();
}

createBulkImportPanel();
new MutationObserver(createBulkImportPanel).observe(document.body, {
  childList: true,
  subtree: true
});
