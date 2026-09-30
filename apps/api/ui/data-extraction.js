(() => {
  const MAX_BYTES = 32 * 1024 * 1024;
  const state = {
    mounted: false,
    active: false,
    templates: [],
    runs: [],
    sampleFile: null,
    structure: null,
    assignments: new Map(),
    batchFiles: [],
    currentRun: null,
    busy: false
  };

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function spaceId() {
    return String(globalThis.docomatorCurrentSpaceId || "").trim();
  }

  function correlationId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `extract-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: "no-store",
      ...options,
      headers: {
        accept: "application/json",
        "x-correlation-id": correlationId(),
        "x-actor-id": "local-ui",
        ...(options.headers || {})
      }
    });
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await response.json() : null;
    if (!response.ok) {
      const error = new Error(body?.error?.message || `Сервер вернул код ${response.status}.`);
      error.correlationId = body?.correlationId || response.headers.get("x-correlation-id") || "";
      error.status = response.status;
      throw error;
    }
    return body?.data ?? body;
  }

  function root() {
    return document.querySelector("#dataExtractionWorkspace");
  }

  function status(kind, title, detail = "", operationId = "") {
    const target = document.querySelector("#dataExtractionStatus");
    if (!target) return;
    target.className = `extraction-status is-${kind}`;
    target.innerHTML = `<span class="extraction-status-mark" aria-hidden="true">${kind === "error" ? "!" : kind === "ok" ? "✓" : "…"}</span><div><strong>${escapeHtml(title)}</strong>${detail ? `<p>${escapeHtml(detail)}</p>` : ""}${operationId ? `<small>Идентификатор операции: <code>${escapeHtml(operationId)}</code></small>` : ""}</div>`;
  }

  function installNavigation() {
    const nav = document.querySelector(".sidebar .nav-list");
    if (nav && !nav.querySelector("[data-extraction-open]")) {
      const button = document.createElement("button");
      button.className = "nav-item";
      button.type = "button";
      button.setAttribute("data-extraction-open", "");
      button.innerHTML = '<span class="nav-symbol" aria-hidden="true">⇲</span><span>Извлечение данных</span>';
      const templates = nav.querySelector('[data-view-target="templates"]');
      templates?.insertAdjacentElement("afterend", button);
    }
    const settings = document.querySelector(".settings-grid");
    if (settings && !settings.querySelector("[data-extraction-settings-open]")) {
      const button = document.createElement("button");
      button.className = "settings-row";
      button.type = "button";
      button.setAttribute("data-extraction-settings-open", "");
      button.innerHTML = '<span><strong>Извлечение данных</strong><small>Собрать одинаковые поля из пачки DOCX/XLSX в одну таблицу</small></span><span aria-hidden="true">›</span>';
      settings.prepend(button);
    }
  }

  function workspaceMarkup() {
    return `<section class="view extraction-view" data-view="extraction" id="dataExtractionWorkspace" aria-labelledby="data-extraction-heading">
      <div class="section-intro extraction-intro">
        <div><p class="eyebrow">Пакетный разбор документов</p><h2 id="data-extraction-heading">Извлечение данных</h2><p>Один раз отметьте нужные места в образце, затем загрузите пачку документов. Результат можно проверить по каждому файлу и скачать одной таблицей.</p></div>
      </div>
      <div class="extraction-status is-idle" id="dataExtractionStatus" role="status" aria-live="polite"><span class="extraction-status-mark" aria-hidden="true">1</span><div><strong>Выберите или создайте шаблон извлечения</strong><p>Исходные файлы не изменяются. Сейчас проверенно поддерживаются DOCX и XLSX.</p></div></div>
      <div class="extraction-layout">
        <aside class="panel extraction-sidebar" aria-label="Шаги извлечения">
          <ol class="extraction-steps">
            <li class="is-current" data-extraction-step="1"><span>1</span><div><strong>Шаблон</strong><small>Что и откуда брать</small></div></li>
            <li data-extraction-step="2"><span>2</span><div><strong>Документы</strong><small>До 100 файлов за запуск</small></div></li>
            <li data-extraction-step="3"><span>3</span><div><strong>Проверка</strong><small>Исправить спорные значения</small></div></li>
          </ol>
          <div class="field"><label for="extractionTemplateSelect">Шаблон</label><select id="extractionTemplateSelect"><option value="">Загружаем…</option></select></div>
          <button class="secondary-button" id="extractionNewTemplateButton" type="button">Создать новый шаблон</button>
          <div class="extraction-recent" id="extractionRecentRuns"></div>
        </aside>
        <div class="extraction-main">
          <section class="panel extraction-panel" id="extractionTemplatePanel" aria-labelledby="extraction-template-title">
            <div class="panel-heading"><div><p class="eyebrow">Шаг 1</p><h3 id="extraction-template-title">Покажите, что нужно извлекать</h3><p>Выберите образец, нажимайте на нужные абзацы или ячейки и дайте им понятные названия.</p></div></div>
            <div class="field"><label for="extractionTemplateTitle">Название шаблона</label><input id="extractionTemplateTitle" type="text" maxlength="500" placeholder="Например, Реестр актов" /></div>
            <div class="extraction-drop" id="extractionSampleDrop">
              <input id="extractionSampleFile" type="file" accept=".docx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
              <label for="extractionSampleFile"><span aria-hidden="true">↓</span><strong>Перетащите образец или выберите файл</strong><small>DOCX/XLSX до 32 МБ. Файл проверяется локально.</small></label>
            </div>
            <div class="extraction-sample-name" id="extractionSampleName" hidden></div>
            <div class="extraction-template-grid" id="extractionTemplateGrid" hidden>
              <div><div class="extraction-subheading"><strong>Образец документа</strong><small>Щёлкните по нужному месту.</small></div><div class="extraction-document-preview" id="extractionDocumentPreview"></div></div>
              <div><div class="extraction-subheading"><strong>Что собирать</strong><small>Названия станут колонками результата.</small></div><div class="extraction-assignments" id="extractionAssignments"></div></div>
            </div>
            <div class="extraction-actions"><button class="primary-button" id="extractionAnalyzeSample" type="button" disabled>Показать документ</button><button class="primary-button" id="extractionSaveTemplate" type="button" hidden>Сохранить шаблон</button></div>
          </section>

          <section class="panel extraction-panel" id="extractionBatchPanel" aria-labelledby="extraction-batch-title" hidden>
            <div class="panel-heading"><div><p class="eyebrow">Шаг 2</p><h3 id="extraction-batch-title">Загрузите документы</h3><p>Можно выбрать сразу пачку. Каждый файл проходит ту же локальную проверку безопасности.</p></div></div>
            <div class="extraction-drop" id="extractionBatchDrop">
              <input id="extractionBatchFiles" type="file" multiple accept=".docx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
              <label for="extractionBatchFiles"><span aria-hidden="true">＋</span><strong>Перетащите документы или выберите несколько</strong><small>До 100 файлов; повторные одинаковые файлы будут обработаны один раз.</small></label>
            </div>
            <div class="extraction-file-list" id="extractionBatchList"></div>
            <div class="extraction-actions"><button class="primary-button" id="extractionRunButton" type="button" disabled>Извлечь данные</button></div>
          </section>

          <section class="extraction-panel" id="extractionResultPanel" aria-labelledby="extraction-result-title" hidden>
            <div class="panel extraction-result-heading"><div class="panel-heading"><div><p class="eyebrow">Шаг 3</p><h3 id="extraction-result-title">Проверьте результат</h3><p>Автоматически найденное значение остаётся в истории. Ваши исправления сохраняются отдельно.</p></div><a class="primary-button" id="extractionCsvLink" href="#">Скачать общую таблицу CSV</a></div></div>
            <div class="extraction-result-list" id="extractionResultList"></div>
          </section>
        </div>
      </div>
    </section>`;
  }

  function installWorkspace() {
    const generation = document.querySelector('[data-view="generation"]');
    if (!generation || document.querySelector("#dataExtractionWorkspace")) return;
    generation.insertAdjacentHTML("beforebegin", workspaceMarkup());
  }

  function setStep(step) {
    document.querySelectorAll("[data-extraction-step]").forEach((item) => {
      const value = Number(item.getAttribute("data-extraction-step"));
      item.classList.toggle("is-current", value === step);
      item.classList.toggle("is-complete", value < step);
    });
  }

  function showView() {
    state.active = true;
    document.querySelectorAll("[data-view]").forEach((element) => {
      element.classList.toggle("is-visible", element.getAttribute("data-view") === "extraction");
    });
    document.querySelectorAll("[data-view-target]").forEach((button) => {
      button.classList.remove("is-active");
      button.removeAttribute("aria-current");
    });
    const nav = document.querySelector("[data-extraction-open]");
    nav?.classList.add("is-active");
    nav?.setAttribute("aria-current", "page");
    const eyebrow = document.querySelector("#viewEyebrow");
    const title = document.querySelector("#viewTitle");
    const description = document.querySelector("#viewDescription");
    if (eyebrow) eyebrow.textContent = "Разбор документов";
    if (title) title.textContent = "Извлечение данных";
    if (description) description.textContent = "Собирайте одинаковые сведения из пачки документов по сохранённому шаблону.";
    const primary = document.querySelector("#primaryAction");
    if (primary) primary.hidden = true;
    history.replaceState(null, "", "#extraction");
    void refreshCatalog();
  }

  function hideCustomNav() {
    state.active = false;
    document.querySelector("[data-extraction-open]")?.classList.remove("is-active");
  }

  function validFile(file) {
    const lower = file.name.toLowerCase();
    if (!(lower.endsWith(".docx") || lower.endsWith(".xlsx"))) {
      status("error", `Файл «${file.name}» не добавлен`, "Поддерживаются только проверенные форматы DOCX и XLSX.");
      return false;
    }
    if (file.size < 1 || file.size > MAX_BYTES) {
      status("error", `Файл «${file.name}» не добавлен`, "Размер одного файла должен быть от 1 байта до 32 МБ.");
      return false;
    }
    return true;
  }

  function bindDrop(zone, input, onFiles) {
    zone?.addEventListener("dragover", (event) => {
      event.preventDefault();
      zone.classList.add("is-dragover");
    });
    zone?.addEventListener("dragleave", () => zone.classList.remove("is-dragover"));
    zone?.addEventListener("drop", (event) => {
      event.preventDefault();
      zone.classList.remove("is-dragover");
      onFiles([...(event.dataTransfer?.files || [])]);
    });
    input?.addEventListener("change", () => onFiles([...(input.files || [])]));
  }

  function setSample(files) {
    const file = files.find(validFile);
    if (!file) return;
    state.sampleFile = file;
    state.structure = null;
    state.assignments.clear();
    const name = document.querySelector("#extractionSampleName");
    if (name) {
      name.hidden = false;
      name.innerHTML = `<strong>${escapeHtml(file.name)}</strong><small>${Math.ceil(file.size / 1024).toLocaleString("ru-RU")} КБ</small>`;
    }
    document.querySelector("#extractionAnalyzeSample")?.removeAttribute("disabled");
    document.querySelector("#extractionTemplateGrid")?.setAttribute("hidden", "");
    document.querySelector("#extractionSaveTemplate")?.setAttribute("hidden", "");
    status("idle", "Образец выбран", "Нажмите «Показать документ». Файл пока не сохранён как шаблон.");
  }

  async function analyzeSample() {
    if (!state.sampleFile || state.busy) return;
    state.busy = true;
    const button = document.querySelector("#extractionAnalyzeSample");
    if (button) button.disabled = true;
    status("busy", "Разбираем образец", "Показываем только безопасное локальное представление документа.");
    try {
      const query = new URLSearchParams({ fileName: state.sampleFile.name, limit: "2000" });
      state.structure = await api(`/api/v1/document-intake/analyze?${query}`, {
        method: "POST",
        headers: { "content-type": state.sampleFile.type || "application/octet-stream" },
        body: state.sampleFile
      });
      if (state.structure.truncated) {
        throw new Error("Документ содержит больше 2000 структурных элементов. Для надёжного шаблона разделите его на меньшие части.");
      }
      renderDocument();
      renderAssignments();
      document.querySelector("#extractionTemplateGrid")?.removeAttribute("hidden");
      document.querySelector("#extractionSaveTemplate")?.removeAttribute("hidden");
      status("ok", "Образец готов", "Щёлкайте по нужным абзацам и ячейкам; затем задайте названия полей справа.");
    } catch (error) {
      status("error", "Не удалось показать образец", `${error.message} Данные шаблона не сохранены.`, error.correlationId || "");
    } finally {
      state.busy = false;
      if (button) button.disabled = false;
    }
  }

  function docxPreview(elements) {
    const ordinary = elements.filter((element) => element.kind === "paragraph" && !element.tableLocation);
    const tableElements = elements.filter((element) => element.kind === "paragraph" && element.tableLocation);
    const tables = new Map();
    for (const element of tableElements) {
      const key = `${element.part}:${element.tableLocation.tableIndex}`;
      if (!tables.has(key)) tables.set(key, new Map());
      const rows = tables.get(key);
      const rowIndex = element.tableLocation.rowIndex;
      if (!rows.has(rowIndex)) rows.set(rowIndex, new Map());
      const row = rows.get(rowIndex);
      const columnIndex = element.tableLocation.columnIndex;
      if (!row.has(columnIndex)) row.set(columnIndex, []);
      row.get(columnIndex).push(element);
    }
    const ordinaryMarkup = ordinary.map((element) =>
      `<button type="button" class="extraction-doc-paragraph" data-extraction-element="${escapeHtml(element.id)}"><span>${escapeHtml(element.text || "Пустой абзац")}</span></button>`
    ).join("");
    const tablesMarkup = [...tables.values()].map((rows) => {
      const body = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, columns]) => {
        const maxColumn = Math.max(...columns.keys());
        const cells = [];
        for (let column = 0; column <= maxColumn; column += 1) {
          const items = columns.get(column) || [];
          const first = items[0];
          cells.push(`<td>${first ? `<button type="button" data-extraction-element="${escapeHtml(first.id)}">${escapeHtml(items.map((item) => item.text).join(" ") || "Пустая ячейка")}</button>` : ""}</td>`);
        }
        return `<tr>${cells.join("")}</tr>`;
      }).join("");
      return `<div class="extraction-preview-table-wrap"><table class="extraction-preview-table"><tbody>${body}</tbody></table></div>`;
    }).join("");
    return ordinaryMarkup + tablesMarkup || '<p class="extraction-empty">В документе не найден текст для выбора.</p>';
  }

  function xlsxAddress(address) {
    const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/u.exec(String(address || "").toUpperCase());
    if (!match) return null;
    let column = 0;
    for (const char of match[1]) column = column * 26 + char.charCodeAt(0) - 64;
    return { row: Number(match[2]), column };
  }

  function xlsxPreview(elements) {
    const sheets = new Map();
    for (const cell of elements.filter((element) => element.kind === "cell")) {
      if (!sheets.has(cell.sheetName)) sheets.set(cell.sheetName, []);
      sheets.get(cell.sheetName).push(cell);
    }
    return [...sheets.entries()].map(([name, cells]) => {
      const parsed = cells.map((cell) => ({ cell, coordinate: xlsxAddress(cell.address) })).filter((entry) => entry.coordinate);
      const maxRow = Math.min(120, Math.max(1, ...parsed.map((entry) => entry.coordinate.row)));
      const maxColumn = Math.min(30, Math.max(1, ...parsed.map((entry) => entry.coordinate.column)));
      const byKey = new Map(parsed.map((entry) => [`${entry.coordinate.row}:${entry.coordinate.column}`, entry.cell]));
      const rows = [];
      for (let row = 1; row <= maxRow; row += 1) {
        const columns = [];
        for (let column = 1; column <= maxColumn; column += 1) {
          const cell = byKey.get(`${row}:${column}`);
          columns.push(`<td>${cell ? `<button type="button" data-extraction-element="${escapeHtml(cell.id)}" title="${escapeHtml(cell.address)}">${escapeHtml(cell.value || cell.address)}</button>` : ""}</td>`);
        }
        rows.push(`<tr><th scope="row">${row}</th>${columns.join("")}</tr>`);
      }
      return `<section class="extraction-sheet"><h4>${escapeHtml(name)}</h4><div class="extraction-preview-table-wrap"><table class="extraction-preview-table extraction-sheet-table"><tbody>${rows.join("")}</tbody></table></div></section>`;
    }).join("") || '<p class="extraction-empty">На листах не найдено доступных ячеек.</p>';
  }

  function renderDocument() {
    const target = document.querySelector("#extractionDocumentPreview");
    if (!target || !state.structure) return;
    target.innerHTML = state.structure.format === "docx"
      ? docxPreview(state.structure.elements || [])
      : xlsxPreview(state.structure.elements || []);
    target.querySelectorAll("[data-extraction-element]").forEach((button) => {
      const id = button.getAttribute("data-extraction-element");
      button.classList.toggle("is-selected", state.assignments.has(id));
    });
  }

  function elementById(id) {
    return state.structure?.elements?.find((element) => element.id === id) || null;
  }

  function defaultLabel(element) {
    if (!element) return "Поле";
    const raw = element.kind === "cell" ? element.value : element.text;
    const text = String(raw || "").trim().replace(/\s+/gu, " ");
    return text && text.length <= 60 ? text : element.kind === "cell" ? element.address : "Поле";
  }

  function canRepeat(element) {
    return Boolean(element && (element.kind === "cell" || element.tableLocation));
  }

  function toggleElement(id) {
    const element = elementById(id);
    if (!element) return;
    if (state.assignments.has(id)) state.assignments.delete(id);
    else state.assignments.set(id, {
      label: defaultLabel(element),
      outputType: "text",
      role: "field"
    });
    renderDocument();
    renderAssignments();
  }

  function renderAssignments() {
    const target = document.querySelector("#extractionAssignments");
    if (!target) return;
    if (state.assignments.size === 0) {
      target.innerHTML = '<div class="extraction-empty"><strong>Пока ничего не выбрано</strong><p>Нажмите слева на значение, которое нужно собирать из каждого документа.</p></div>';
      return;
    }
    target.innerHTML = [...state.assignments.entries()].map(([id, item], index) => {
      const element = elementById(id);
      const location = element?.kind === "cell"
        ? `${element.sheetName}!${element.address}`
        : element?.tableLocation
          ? `Таблица ${element.tableLocation.tableIndex + 1}, строка ${element.tableLocation.rowIndex + 1}, колонка ${element.tableLocation.columnIndex + 1}`
          : `Абзац ${(element?.index ?? 0) + 1}`;
      return `<article class="extraction-assignment" data-assignment-id="${escapeHtml(id)}">
        <div class="extraction-assignment-heading"><span>${index + 1}</span><div><strong>${escapeHtml(location)}</strong><small>${escapeHtml(element?.kind === "cell" ? element.value : element?.text || "Пустое место")}</small></div><button type="button" class="icon-button" data-assignment-remove="${escapeHtml(id)}" aria-label="Убрать поле">×</button></div>
        <div class="extraction-assignment-grid">
          <div class="field"><label>Название колонки</label><input type="text" maxlength="200" data-assignment-label="${escapeHtml(id)}" value="${escapeHtml(item.label)}" /></div>
          <div class="field"><label>Вид значения</label><select data-assignment-type="${escapeHtml(id)}"><option value="text"${item.outputType === "text" ? " selected" : ""}>Текст</option><option value="number"${item.outputType === "number" ? " selected" : ""}>Число</option><option value="integer"${item.outputType === "integer" ? " selected" : ""}>Целое число</option><option value="date"${item.outputType === "date" ? " selected" : ""}>Дата</option></select></div>
          <div class="field"><label>Как собирать</label><select data-assignment-role="${escapeHtml(id)}"${canRepeat(element) ? "" : " disabled"}><option value="field"${item.role === "field" ? " selected" : ""}>Одно значение из документа</option><option value="repeat"${item.role === "repeat" ? " selected" : ""}>Колонка повторяемой таблицы</option></select>${canRepeat(element) ? "" : "<small>Этот абзац не находится в таблице.</small>"}</div>
        </div>
      </article>`;
    }).join("");
  }

  function assignmentRequests() {
    const fields = [];
    const columns = [];
    for (const [elementId, item] of state.assignments.entries()) {
      const target = {
        label: String(item.label || "").trim(),
        elementId,
        outputType: item.outputType
      };
      if (!target.label) throw new Error("Укажите название для каждого выбранного поля.");
      if (item.role === "repeat") columns.push(target);
      else fields.push(target);
    }
    if (fields.length === 0 && columns.length === 0) {
      throw new Error("Выберите хотя бы одно значение в образце.");
    }
    return { fields, ...(columns.length === 0 ? {} : { repeat: { label: "Строки таблицы", columns } }) };
  }

  async function quarantineFile(file) {
    const currentSpace = spaceId();
    if (!currentSpace) throw new Error("Сначала выберите рабочее пространство.");
    const query = new URLSearchParams({ fileName: file.name });
    return api(`/api/v1/spaces/${encodeURIComponent(currentSpace)}/document-sources/quarantine?${query}`, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file
    });
  }

  async function saveTemplate() {
    if (!state.sampleFile || !state.structure || state.busy) return;
    const title = String(document.querySelector("#extractionTemplateTitle")?.value || "").trim();
    if (!title) {
      status("error", "Не задано название шаблона", "Введите понятное название. Выбранные поля сохранены на экране.");
      document.querySelector("#extractionTemplateTitle")?.focus();
      return;
    }
    let definitionInput;
    try {
      definitionInput = assignmentRequests();
    } catch (error) {
      status("error", "Шаблон пока не готов", `${error.message} Выбранные места не потеряны.`);
      return;
    }
    state.busy = true;
    status("busy", "Сохраняем шаблон", "Проверяем исходник ещё раз и фиксируем структурные координаты выбранных мест.");
    try {
      const source = await quarantineFile(state.sampleFile);
      const template = await api(`/api/v1/spaces/${encodeURIComponent(spaceId())}/data-extraction/templates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, sourceRecordId: source.id, ...definitionInput })
      });
      await refreshCatalog(template.id);
      document.querySelector("#extractionTemplatePanel")?.setAttribute("hidden", "");
      document.querySelector("#extractionBatchPanel")?.removeAttribute("hidden");
      setStep(2);
      status("ok", "Шаблон сохранён", "Теперь загрузите документы той же формы. Образец сохранён как проверенный локальный исходник.");
      document.querySelector("#extractionBatchFiles")?.focus();
    } catch (error) {
      status("error", "Шаблон не сохранён", `${error.message} Образец и настройки остались на экране.`, error.correlationId || "");
    } finally {
      state.busy = false;
    }
  }

  function setBatch(files) {
    const valid = files.filter(validFile).slice(0, 100);
    const seen = new Set();
    state.batchFiles = valid.filter((file) => {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const list = document.querySelector("#extractionBatchList");
    if (list) {
      list.innerHTML = state.batchFiles.length === 0
        ? ""
        : `<div class="extraction-file-summary"><strong>${state.batchFiles.length} файл(ов)</strong><small>Файлы будут проверены и сохранены только после запуска.</small></div>${state.batchFiles.map((file, index) => `<div class="extraction-file-row"><span>${index + 1}</span><strong>${escapeHtml(file.name)}</strong><small>${Math.ceil(file.size / 1024).toLocaleString("ru-RU")} КБ</small></div>`).join("")}`;
    }
    const run = document.querySelector("#extractionRunButton");
    if (run) run.disabled = state.batchFiles.length === 0;
    if (state.batchFiles.length > 0) status("idle", "Документы выбраны", `Готово к обработке: ${state.batchFiles.length}. Введённые настройки шаблона не изменятся.`);
  }

  async function runExtraction() {
    const templateId = document.querySelector("#extractionTemplateSelect")?.value || "";
    if (!templateId || state.batchFiles.length === 0 || state.busy) return;
    state.busy = true;
    const button = document.querySelector("#extractionRunButton");
    if (button) button.disabled = true;
    status("busy", "Проверяем и разбираем документы", `Обрабатываем ${state.batchFiles.length} файл(ов). Уже сохранённые файлы не дублируются.`);
    try {
      const sourceIds = [];
      const seenSources = new Set();
      for (let index = 0; index < state.batchFiles.length; index += 1) {
        status("busy", "Проверяем документы", `${index + 1} из ${state.batchFiles.length}: ${state.batchFiles[index].name}`);
        const source = await quarantineFile(state.batchFiles[index]);
        if (!seenSources.has(source.id)) {
          seenSources.add(source.id);
          sourceIds.push(source.id);
        }
      }
      const run = await api(`/api/v1/spaces/${encodeURIComponent(spaceId())}/data-extraction/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateId,
          sourceRecordIds: sourceIds,
          idempotencyKey: correlationId()
        })
      });
      state.currentRun = run;
      renderRun();
      document.querySelector("#extractionTemplatePanel")?.setAttribute("hidden", "");
      document.querySelector("#extractionBatchPanel")?.setAttribute("hidden", "");
      document.querySelector("#extractionResultPanel")?.removeAttribute("hidden");
      setStep(3);
      await refreshCatalog(templateId, run.id);
      const problemCount = run.items.filter((item) => Array.isArray(item.issues) && item.issues.length > 0).length;
      status(problemCount ? "idle" : "ok", "Извлечение завершено", problemCount ? `${problemCount} документ(ов) требуют внимания. Остальные данные сохранены.` : "Все документы обработаны. Проверьте значения и скачайте общую таблицу.");
    } catch (error) {
      status("error", "Извлечение не завершено", `${error.message} Уже сохранённые исходники не потеряны; можно повторить запуск.`, error.correlationId || "");
    } finally {
      state.busy = false;
      if (button) button.disabled = state.batchFiles.length === 0;
    }
  }

  function jsonRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function effectiveValue(item, fieldId, fallback) {
    const fields = jsonRecord(jsonRecord(item.corrections).fields);
    return typeof fields[fieldId] === "string" ? fields[fieldId] : fallback;
  }

  function effectiveCell(item, rowNumber, columnId, fallback) {
    const rows = jsonRecord(jsonRecord(item.corrections).repeat);
    const row = jsonRecord(rows[String(rowNumber)]);
    return typeof row[columnId] === "string" ? row[columnId] : fallback;
  }

  function issuesMarkup(issues) {
    if (!Array.isArray(issues) || issues.length === 0) return '<div class="extraction-ok-note"><span aria-hidden="true">✓</span><span>Автоматическая проверка замечаний не нашла.</span></div>';
    return `<div class="extraction-issues">${issues.map((issue) => `<article class="extraction-issue is-${escapeHtml(issue.severity || "warning")}"><strong>${escapeHtml(issue.message || "Требуется проверка")}</strong>${issue.coordinate ? `<small>Место: ${escapeHtml(issue.coordinate)}</small>` : ""}${issue.rawValue !== undefined ? `<small>Найдено: ${escapeHtml(issue.rawValue)}</small>` : ""}<p>${escapeHtml(issue.suggestedAction || "Проверьте документ.")}</p></article>`).join("")}</div>`;
  }

  function renderRun() {
    const run = state.currentRun;
    const target = document.querySelector("#extractionResultList");
    if (!run || !target) return;
    const link = document.querySelector("#extractionCsvLink");
    if (link) link.href = `/api/v1/spaces/${encodeURIComponent(run.spaceId)}/data-extraction/runs/${encodeURIComponent(run.id)}/export.csv`;
    target.innerHTML = run.items.map((item, itemIndex) => {
      const result = jsonRecord(item.result);
      const fields = Array.isArray(result.fields) ? result.fields : [];
      const repeat = jsonRecord(result.repeat);
      const rows = Array.isArray(repeat.rows) ? repeat.rows : [];
      const fieldMarkup = fields.map((field) => `<div class="field extraction-result-field"><label>${escapeHtml(field.label || "Поле")}<small>${escapeHtml(field.source || "")}</small></label><input type="text" maxlength="20000" value="${escapeHtml(effectiveValue(item, field.fieldId, field.value || ""))}" data-result-field="${escapeHtml(field.fieldId)}" /></div>`).join("");
      const repeatMarkup = rows.length === 0 ? "" : `<div class="extraction-result-table-wrap"><table class="extraction-result-table"><thead><tr><th>№</th>${(rows[0]?.cells || []).map((cell) => `<th>${escapeHtml(cell.label)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr><th scope="row">${row.rowNumber}</th>${(row.cells || []).map((cell) => `<td><label class="visually-hidden">${escapeHtml(cell.label)}, строка ${row.rowNumber}</label><input type="text" maxlength="20000" value="${escapeHtml(effectiveCell(item, row.rowNumber, cell.columnId, cell.value || ""))}" data-result-row="${row.rowNumber}" data-result-column="${escapeHtml(cell.columnId)}" title="${escapeHtml(cell.source || "")}" /></td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      return `<article class="panel extraction-result-card" data-extraction-item="${escapeHtml(item.id)}" data-version="${item.version}">
        <header><div><p class="eyebrow">Документ ${itemIndex + 1}</p><h4>${escapeHtml(item.sourceName)}</h4></div><span class="pill">${Array.isArray(item.issues) ? item.issues.length : 0} замечаний</span></header>
        ${issuesMarkup(item.issues)}
        <div class="extraction-result-fields">${fieldMarkup}</div>
        ${repeatMarkup}
        <footer><span data-item-save-status>Изменения ещё не отправлялись.</span><button class="secondary-button" type="button" data-save-extraction-item="${escapeHtml(item.id)}">Сохранить исправления</button></footer>
      </article>`;
    }).join("");
  }

  function collectCorrections(card) {
    const fields = {};
    card.querySelectorAll("[data-result-field]").forEach((input) => {
      fields[input.getAttribute("data-result-field")] = input.value;
    });
    const repeat = {};
    card.querySelectorAll("[data-result-row][data-result-column]").forEach((input) => {
      const row = input.getAttribute("data-result-row");
      const column = input.getAttribute("data-result-column");
      repeat[row] ||= {};
      repeat[row][column] = input.value;
    });
    return { fields, repeat };
  }

  async function saveItem(itemId) {
    if (!state.currentRun || state.busy) return;
    const card = document.querySelector(`[data-extraction-item="${CSS.escape(itemId)}"]`);
    const item = state.currentRun.items.find((candidate) => candidate.id === itemId);
    if (!card || !item) return;
    const button = card.querySelector("[data-save-extraction-item]");
    const text = card.querySelector("[data-item-save-status]");
    if (button) button.disabled = true;
    if (text) text.textContent = "Сохраняем…";
    try {
      const updated = await api(`/api/v1/spaces/${encodeURIComponent(state.currentRun.spaceId)}/data-extraction/runs/${encodeURIComponent(state.currentRun.id)}/items/${encodeURIComponent(item.id)}/corrections`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: item.version,
          corrections: collectCorrections(card)
        })
      });
      Object.assign(item, updated);
      card.dataset.version = String(updated.version);
      if (text) text.textContent = "Исправления сохранены. Исходный автоматический результат не изменён.";
      status("ok", `Исправления для «${item.sourceName}» сохранены`, "Общая CSV-таблица уже будет учитывать эти значения.");
    } catch (error) {
      if (text) text.textContent = "Исправления не сохранены; введённые значения остаются в форме.";
      status("error", "Не удалось сохранить исправления", `${error.message} Введённые значения не очищены.`, error.correlationId || "");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function refreshCatalog(preferredTemplate = "", preferredRun = "") {
    const currentSpace = spaceId();
    if (!currentSpace) {
      status("error", "Рабочее пространство не выбрано", "Выберите раздел данных и повторите действие.");
      return;
    }
    try {
      const [templates, runs] = await Promise.all([
        api(`/api/v1/spaces/${encodeURIComponent(currentSpace)}/data-extraction/templates?limit=200`),
        api(`/api/v1/spaces/${encodeURIComponent(currentSpace)}/data-extraction/runs?limit=20`)
      ]);
      state.templates = Array.isArray(templates) ? templates : [];
      state.runs = Array.isArray(runs) ? runs : [];
      const select = document.querySelector("#extractionTemplateSelect");
      if (select) {
        const previous = preferredTemplate || select.value;
        select.innerHTML = state.templates.length === 0
          ? '<option value="">Пока нет шаблонов</option>'
          : state.templates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.title)} · ${template.format.toUpperCase()}</option>`).join("");
        if (state.templates.some((template) => template.id === previous)) select.value = previous;
      }
      renderRecentRuns(preferredRun);
      if (state.templates.length > 0 && !state.structure && !state.currentRun) {
        document.querySelector("#extractionTemplatePanel")?.setAttribute("hidden", "");
        document.querySelector("#extractionBatchPanel")?.removeAttribute("hidden");
        setStep(2);
      }
    } catch (error) {
      status("error", "Не удалось получить шаблоны извлечения", `${error.message} Локальные введённые данные не очищены.`, error.correlationId || "");
    }
  }

  function renderRecentRuns(preferredRun = "") {
    const target = document.querySelector("#extractionRecentRuns");
    if (!target) return;
    if (state.runs.length === 0) {
      target.innerHTML = '<p class="extraction-recent-empty">Предыдущих запусков пока нет.</p>';
      return;
    }
    target.innerHTML = `<strong>Недавние результаты</strong>${state.runs.slice(0, 8).map((run) => {
      const template = state.templates.find((candidate) => candidate.id === run.templateId);
      return `<button type="button" data-open-extraction-run="${escapeHtml(run.id)}" class="extraction-run-link${run.id === preferredRun ? " is-current" : ""}"><span>${escapeHtml(template?.title || "Извлечение")}</span><small>${run.items.length} файл(ов) · ${escapeHtml(new Date(run.createdAt).toLocaleString("ru-RU"))}</small></button>`;
    }).join("")}`;
  }

  function newTemplate() {
    state.sampleFile = null;
    state.structure = null;
    state.assignments.clear();
    state.currentRun = null;
    document.querySelector("#extractionTemplatePanel")?.removeAttribute("hidden");
    document.querySelector("#extractionBatchPanel")?.setAttribute("hidden", "");
    document.querySelector("#extractionResultPanel")?.setAttribute("hidden", "");
    document.querySelector("#extractionTemplateGrid")?.setAttribute("hidden", "");
    document.querySelector("#extractionSaveTemplate")?.setAttribute("hidden", "");
    const title = document.querySelector("#extractionTemplateTitle");
    if (title) title.value = "";
    const name = document.querySelector("#extractionSampleName");
    if (name) name.hidden = true;
    setStep(1);
    status("idle", "Новый шаблон", "Выберите один DOCX или XLSX в качестве образца. Незавершённый шаблон не изменяет серверные данные.");
  }

  async function openRun(runId) {
    try {
      state.currentRun = await api(`/api/v1/spaces/${encodeURIComponent(spaceId())}/data-extraction/runs/${encodeURIComponent(runId)}`);
      renderRun();
      document.querySelector("#extractionTemplatePanel")?.setAttribute("hidden", "");
      document.querySelector("#extractionBatchPanel")?.setAttribute("hidden", "");
      document.querySelector("#extractionResultPanel")?.removeAttribute("hidden");
      setStep(3);
      status("ok", "Сохранённый результат открыт", "Можно продолжить проверку и исправления после перезапуска браузера или сервера.");
    } catch (error) {
      status("error", "Не удалось открыть результат", `${error.message} Другие результаты не изменены.`, error.correlationId || "");
    }
  }

  function attachEvents() {
    document.addEventListener("click", (event) => {
      const open = event.target.closest("[data-extraction-open], [data-extraction-settings-open]");
      if (open) {
        event.preventDefault();
        showView();
        return;
      }
      const element = event.target.closest("[data-extraction-element]");
      if (element) {
        toggleElement(element.getAttribute("data-extraction-element"));
        return;
      }
      const remove = event.target.closest("[data-assignment-remove]");
      if (remove) {
        state.assignments.delete(remove.getAttribute("data-assignment-remove"));
        renderDocument();
        renderAssignments();
        return;
      }
      const saveItemButton = event.target.closest("[data-save-extraction-item]");
      if (saveItemButton) {
        void saveItem(saveItemButton.getAttribute("data-save-extraction-item"));
        return;
      }
      const runButton = event.target.closest("[data-open-extraction-run]");
      if (runButton) void openRun(runButton.getAttribute("data-open-extraction-run"));
    });

    document.addEventListener("input", (event) => {
      const label = event.target.closest?.("[data-assignment-label]");
      if (label) {
        const item = state.assignments.get(label.getAttribute("data-assignment-label"));
        if (item) item.label = label.value;
      }
    });
    document.addEventListener("change", (event) => {
      const type = event.target.closest?.("[data-assignment-type]");
      if (type) {
        const item = state.assignments.get(type.getAttribute("data-assignment-type"));
        if (item) item.outputType = type.value;
      }
      const role = event.target.closest?.("[data-assignment-role]");
      if (role) {
        const item = state.assignments.get(role.getAttribute("data-assignment-role"));
        if (item) item.role = role.value;
      }
      if (event.target.id === "extractionTemplateSelect" && event.target.value) {
        document.querySelector("#extractionTemplatePanel")?.setAttribute("hidden", "");
        document.querySelector("#extractionBatchPanel")?.removeAttribute("hidden");
        document.querySelector("#extractionResultPanel")?.setAttribute("hidden", "");
        setStep(2);
      }
    });

    document.querySelector("#extractionAnalyzeSample")?.addEventListener("click", () => void analyzeSample());
    document.querySelector("#extractionSaveTemplate")?.addEventListener("click", () => void saveTemplate());
    document.querySelector("#extractionRunButton")?.addEventListener("click", () => void runExtraction());
    document.querySelector("#extractionNewTemplateButton")?.addEventListener("click", newTemplate);
    bindDrop(
      document.querySelector("#extractionSampleDrop"),
      document.querySelector("#extractionSampleFile"),
      setSample
    );
    bindDrop(
      document.querySelector("#extractionBatchDrop"),
      document.querySelector("#extractionBatchFiles"),
      setBatch
    );

    window.addEventListener("docomator:view-changed", (event) => {
      if (event.detail?.view !== "extraction") hideCustomNav();
    });
    document.addEventListener("docomator:space-changed", () => {
      state.templates = [];
      state.runs = [];
      state.currentRun = null;
      state.batchFiles = [];
      if (state.active) {
        newTemplate();
        void refreshCatalog();
      }
    });
  }

  function initialize() {
    if (state.mounted) return;
    state.mounted = true;
    installNavigation();
    installWorkspace();
    attachEvents();
    if (location.hash === "#extraction") showView();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
