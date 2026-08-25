const root = document.querySelector("#employeeCollections");

if (root) {
  const state = {
    spaceId: "",
    entityId: "",
    displayName: "",
    definitions: [],
    collections: new Map(),
    importPreview: null
  };

  const TYPE_LABELS = {
    string: "Короткий текст",
    text: "Длинный текст",
    number: "Число",
    integer: "Целое число",
    boolean: "Да / нет",
    date: "Дата",
    "date-time": "Дата и время",
    enum: "Список вариантов"
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function normalizeLabel(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/gu, "е")
      .replace(/^№\s*/u, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .replace(/\s+/gu, " ");
  }

  function endpoint(path = "") {
    return `/api/v1/spaces/${encodeURIComponent(state.spaceId)}${path}`;
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: {
        ...(options.body instanceof Blob || options.body instanceof File
          ? {}
          : { "content-type": "application/json" }),
        ...(options.headers || {})
      },
      ...options
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        body?.error?.issue?.message ||
        body?.error?.message ||
        "Операция не выполнена. Введённые данные сохранены в форме.";
      const error = new Error(message);
      error.code = body?.error?.code || "request_failed";
      error.correlationId = body?.correlationId || response.headers.get("x-correlation-id") || "";
      error.issue = body?.error?.issue || null;
      throw error;
    }
    return body;
  }

  function status(card, message, kind = "") {
    const element = card?.querySelector("[data-collection-status]");
    if (!element) return;
    element.className = `entity-collection-status${kind ? ` is-${kind}` : ""}`;
    element.textContent = message;
  }

  function setBusy(card, busy) {
    card?.setAttribute("aria-busy", busy ? "true" : "false");
    card?.querySelectorAll("button, input, select, textarea").forEach((control) => {
      if (control.matches("[data-collection-row-input]")) return;
      if (control.dataset.keepEnabled === "true") return;
      control.disabled = Boolean(busy);
    });
  }

  function enumValues(field) {
    const values = field?.validation?.enum;
    return Array.isArray(values) ? values.filter((value) => typeof value === "string") : [];
  }

  function controlHtml(field, value = "") {
    const common = `data-collection-row-input data-field-key="${escapeHtml(field.key)}" data-value-type="${escapeHtml(field.valueType)}" data-required="${field.required ? "true" : "false"}" aria-label="${escapeHtml(field.label)}"`;
    if (field.valueType === "boolean") {
      const normalized = value === true ? "true" : value === false ? "false" : "";
      return `<select ${common}><option value="">Не указано</option><option value="true"${normalized === "true" ? " selected" : ""}>Да</option><option value="false"${normalized === "false" ? " selected" : ""}>Нет</option></select>`;
    }
    if (field.valueType === "enum") {
      const options = enumValues(field)
        .map((option) => `<option value="${escapeHtml(option)}"${String(value ?? "") === option ? " selected" : ""}>${escapeHtml(option)}</option>`)
        .join("");
      return `<select ${common}><option value="">Не указано</option>${options}</select>`;
    }
    if (field.valueType === "text") {
      return `<textarea ${common} maxlength="20000">${escapeHtml(value ?? "")}</textarea>`;
    }
    const type =
      field.valueType === "number" || field.valueType === "integer"
        ? "number"
        : field.valueType === "date"
          ? "date"
          : field.valueType === "date-time"
            ? "datetime-local"
            : "text";
    const step = field.valueType === "integer" ? " step=\"1\"" : field.valueType === "number" ? " step=\"any\"" : "";
    return `<input ${common} type="${type}"${step} value="${escapeHtml(value ?? "")}" maxlength="${field.valueType === "string" ? "4000" : "20000"}" />`;
  }

  function rowHtml(definition, values = {}, itemId = "") {
    const cells = definition.fields
      .map((field) => `<td>${controlHtml(field, values[field.key])}</td>`)
      .join("");
    return `<tr data-collection-row data-item-id="${escapeHtml(itemId)}">
      <td class="collection-row-number" data-row-number></td>
      ${cells}
      <td class="collection-row-actions">
        <button class="quiet-button compact" type="button" data-collection-action="row-up" title="Поднять строку" aria-label="Поднять строку">↑</button>
        <button class="quiet-button compact" type="button" data-collection-action="row-down" title="Опустить строку" aria-label="Опустить строку">↓</button>
        <button class="quiet-button compact" type="button" data-collection-action="row-duplicate" title="Дублировать строку" aria-label="Дублировать строку">⧉</button>
        <button class="quiet-button compact" type="button" data-collection-action="row-delete" title="Удалить строку" aria-label="Удалить строку">×</button>
      </td>
    </tr>`;
  }

  function renumber(card) {
    card.querySelectorAll("[data-collection-row]").forEach((row, index) => {
      const number = row.querySelector("[data-row-number]");
      if (number) number.textContent = String(index + 1);
    });
  }

  function markDirty(card) {
    card.classList.add("is-dirty");
    status(card, "Есть несохранённые изменения. Нажмите «Сохранить таблицу».");
    renumber(card);
  }

  function collectionCard(collection) {
    const definition = collection.definition;
    const headers = definition.fields
      .map((field) => `<th scope="col">${escapeHtml(field.label)}${field.required ? " *" : ""}</th>`)
      .join("");
    const rows = collection.items.map((item) => rowHtml(definition, item.values, item.id)).join("");
    const exportBase = endpoint(
      `/entities/${encodeURIComponent(state.entityId)}/collections/${encodeURIComponent(definition.id)}/export`
    );
    return `<article class="entity-collection-card" data-collection-card data-collection-id="${escapeHtml(definition.id)}">
      <div class="entity-collection-head">
        <div>
          <h4>${escapeHtml(definition.label)}</h4>
          <p>${escapeHtml(definition.description || "Повторяемые строки, которые можно использовать в таблице шаблона.")}</p>
        </div>
        <span class="entity-collection-meta">Строк: <strong data-collection-count>${collection.items.length}</strong></span>
      </div>
      <div class="collection-table-scroll" tabindex="0" aria-label="Таблица ${escapeHtml(definition.label)}">
        <table class="collection-table">
          <thead><tr><th class="collection-row-number" scope="col">№</th>${headers}<th class="collection-row-actions" scope="col">Действия</th></tr></thead>
          <tbody data-collection-tbody>${rows}</tbody>
        </table>
      </div>
      <div class="entity-collection-actions">
        <button class="secondary-button compact-button" type="button" data-collection-action="add-row">＋ Добавить строку</button>
        <button class="secondary-button compact-button" type="button" data-collection-action="paste">Вставить из Excel</button>
        <label class="secondary-button compact-button" role="button" tabindex="0">Импорт CSV/XLSX<input type="file" hidden data-collection-import-file accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" /></label>
        <a class="text-button" href="${escapeHtml(exportBase)}.csv" download>CSV</a>
        <a class="text-button" href="${escapeHtml(exportBase)}.xlsx" download>XLSX</a>
        <button class="primary-button compact-button collection-save" type="button" data-collection-action="save">Сохранить таблицу</button>
      </div>
      <div data-collection-import-panel></div>
      <div class="entity-collection-status" data-collection-status role="status" aria-live="polite">${collection.items.length ? "Таблица загружена. Нумерация рассчитывается автоматически." : "Строк пока нет. Добавьте их вручную, вставьте из Excel или импортируйте файл."}</div>
    </article>`;
  }

  function schemaFieldRow(index, defaults = {}) {
    const valueType = defaults.valueType || "string";
    const enumText = Array.isArray(defaults.enumValues) ? defaults.enumValues.join(", ") : "";
    return `<div class="collection-schema-field" data-schema-field>
      <div class="field"><label>Название колонки</label><input data-schema-label type="text" maxlength="160" value="${escapeHtml(defaults.label || "")}" placeholder="Например, Срок выполнения" /></div>
      <div class="field"><label>Тип</label><select data-schema-type>
        ${Object.entries(TYPE_LABELS).map(([key, label]) => `<option value="${key}"${key === valueType ? " selected" : ""}>${label}</option>`).join("")}
      </select></div>
      <label><input data-schema-required type="checkbox"${defaults.required ? " checked" : ""} /> Обязательно</label>
      <button class="quiet-button compact" type="button" data-collection-action="schema-remove-field" aria-label="Удалить колонку ${index + 1}">×</button>
      <div class="field collection-enum-values" data-enum-values${valueType === "enum" ? "" : " hidden"}><label>Варианты через запятую</label><input type="text" data-schema-enum maxlength="2000" value="${escapeHtml(enumText)}" placeholder="Доклад, Отчёт, Презентация" /></div>
    </div>`;
  }

  function schemaBuilderHtml() {
    return `<section class="collection-schema-builder" data-schema-builder>
      <div class="collection-schema-head"><div><strong>Новая таблица данных</strong><p class="collection-help">Создайте набор колонок один раз. Такая таблица станет доступна в карточке каждого сотрудника этого пространства.</p></div><button class="quiet-button compact" type="button" data-collection-action="schema-cancel">Закрыть</button></div>
      <div class="field"><label>Название таблицы</label><input data-schema-name type="text" maxlength="160" value="Пункты плана" /></div>
      <div class="collection-schema-fields" data-schema-fields>
        ${schemaFieldRow(0, { label: "Наименование вопроса", valueType: "text", required: true })}
        ${schemaFieldRow(1, { label: "Срок выполнения", valueType: "date" })}
        ${schemaFieldRow(2, { label: "Отчётность", valueType: "string" })}
      </div>
      <div class="entity-collection-actions"><button class="secondary-button compact-button" type="button" data-collection-action="schema-add-field">＋ Добавить колонку</button><button class="primary-button compact-button" type="button" data-collection-action="schema-save">Создать таблицу</button></div>
      <div class="entity-collection-status" data-schema-status role="status" aria-live="polite"></div>
    </section>`;
  }

  async function loadCollections() {
    if (!state.spaceId || !state.entityId) return;
    root.setAttribute("aria-busy", "true");
    root.innerHTML = `<div class="employee-collections-header"><div><h3>Таблицы и списки данных</h3><p>Повторяемые строки для планов, перечней и других таблиц документа.</p></div></div><div class="employee-inline-loading"><span class="state-mark" aria-hidden="true"></span><span>Получаем таблицы…</span></div>`;
    try {
      const definitionsBody = await requestJson(
        endpoint("/entity-collections?ownerEntityTypeKey=person")
      );
      state.definitions = Array.isArray(definitionsBody?.data) ? definitionsBody.data : [];
      const collections = await Promise.all(
        state.definitions.map(async (definition) => {
          const body = await requestJson(
            endpoint(
              `/entities/${encodeURIComponent(state.entityId)}/collections/${encodeURIComponent(definition.id)}`
            )
          );
          return body.data;
        })
      );
      state.collections = new Map(collections.map((collection) => [collection.definition.id, collection]));
      renderCollections();
    } catch (error) {
      root.innerHTML = `<div class="employee-collections-header"><div><h3>Таблицы и списки данных</h3></div></div><div class="entity-collection-status is-error" role="alert">${escapeHtml(error.message)}${error.correlationId ? ` Идентификатор операции: ${escapeHtml(error.correlationId)}.` : ""}</div>`;
    } finally {
      root.setAttribute("aria-busy", "false");
    }
  }

  function renderCollections() {
    const cards = [...state.collections.values()].map(collectionCard).join("");
    root.innerHTML = `<div class="employee-collections-header">
      <div><h3>Таблицы и списки данных</h3><p>Для повторяемых строк документа: планы работ, этапы, перечни и другие наборы.</p></div>
      <button class="secondary-button compact-button" type="button" data-collection-action="schema-open">＋ Новая таблица</button>
    </div>
    <div data-schema-host></div>
    ${cards || `<div class="entity-collection-empty"><strong>Таблиц пока нет</strong><p>Создайте, например, «Пункты плана». Номер строки будет добавляться автоматически.</p></div>`}`;
    root.querySelectorAll("[data-collection-card]").forEach((card) => renumber(card));
  }

  function currentCard(target) {
    return target.closest("[data-collection-card]");
  }

  function definitionForCard(card) {
    return state.collections.get(card?.dataset.collectionId)?.definition || null;
  }

  function rowValue(control, type) {
    if (!control || control.value === "") return undefined;
    if (type === "boolean") return control.value === "true";
    if (type === "number") {
      const number = Number(control.value.replace?.(",", ".") ?? control.value);
      return Number.isFinite(number) ? number : control.value;
    }
    if (type === "integer") {
      const number = Number(control.value);
      return Number.isSafeInteger(number) ? number : control.value;
    }
    if (type === "date-time") {
      const value = control.value;
      if (!value) return undefined;
      return /(?:Z|[+-]\d{2}:\d{2})$/u.test(value) ? value : `${value}:00Z`;
    }
    return control.value;
  }

  function collectRows(card) {
    const definition = definitionForCard(card);
    if (!definition) throw new Error("Схема таблицы не найдена. Обновите карточку.");
    let invalidControl = null;
    const items = [...card.querySelectorAll("[data-collection-row]")].map((row) => {
      const values = {};
      for (const field of definition.fields) {
        const control = row.querySelector(`[data-field-key="${CSS.escape(field.key)}"]`);
        const value = rowValue(control, field.valueType);
        const missing = value === undefined || value === null || value === "";
        control?.setAttribute("aria-invalid", field.required && missing ? "true" : "false");
        if (field.required && missing && invalidControl === null) invalidControl = control;
        if (!missing) values[field.key] = value;
      }
      return {
        ...(row.dataset.itemId ? { id: row.dataset.itemId } : {}),
        values
      };
    });
    if (invalidControl) {
      invalidControl.focus();
      throw new Error("Заполните обязательные ячейки. Остальные изменения остаются в таблице.");
    }
    return items;
  }

  async function saveCard(card, items = null) {
    const definition = definitionForCard(card);
    if (!definition) return;
    let payload;
    try {
      payload = items ?? collectRows(card);
    } catch (error) {
      status(card, error.message, "error");
      return;
    }
    setBusy(card, true);
    status(card, "Проверяем и сохраняем все строки одной операцией…");
    try {
      const body = await requestJson(
        endpoint(
          `/entities/${encodeURIComponent(state.entityId)}/collections/${encodeURIComponent(definition.id)}/items`
        ),
        { method: "PUT", body: JSON.stringify({ items: payload }) }
      );
      state.collections.set(definition.id, body.data);
      const replacement = document.createElement("div");
      replacement.innerHTML = collectionCard(body.data);
      const nextCard = replacement.firstElementChild;
      card.replaceWith(nextCard);
      renumber(nextCard);
      status(nextCard, `Сохранено строк: ${body.data.items.length}. Нумерация обновлена автоматически.`, "success");
    } catch (error) {
      status(
        card,
        `${error.message}${error.correlationId ? ` Идентификатор операции: ${error.correlationId}.` : ""} Данные в таблице не потеряны.`,
        "error"
      );
    } finally {
      setBusy(card, false);
    }
  }

  function addRow(card, values = {}, itemId = "") {
    const definition = definitionForCard(card);
    if (!definition) return;
    const tbody = card.querySelector("[data-collection-tbody]");
    const template = document.createElement("tbody");
    template.innerHTML = rowHtml(definition, values, itemId);
    tbody.append(template.firstElementChild);
    const count = card.querySelector("[data-collection-count]");
    if (count) count.textContent = String(tbody.children.length);
    markDirty(card);
  }

  function moveRow(row, direction) {
    const sibling = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!sibling) return;
    if (direction < 0) row.parentElement.insertBefore(row, sibling);
    else row.parentElement.insertBefore(sibling, row);
    markDirty(row.closest("[data-collection-card]"));
  }

  function rowValues(row) {
    return Object.fromEntries(
      [...row.querySelectorAll("[data-collection-row-input]")]
        .map((control) => [control.dataset.fieldKey, rowValue(control, control.dataset.valueType)])
        .filter(([, value]) => value !== undefined)
    );
  }

  function schemaPayload(builder) {
    const label = builder.querySelector("[data-schema-name]").value.trim();
    const fieldRows = [...builder.querySelectorAll("[data-schema-field]")];
    if (!label) throw new Error("Укажите название таблицы.");
    if (fieldRows.length < 1) throw new Error("Добавьте хотя бы одну колонку.");
    const fields = fieldRows.map((row, index) => {
      const fieldLabel = row.querySelector("[data-schema-label]").value.trim();
      const valueType = row.querySelector("[data-schema-type]").value;
      if (!fieldLabel) throw new Error(`Укажите название колонки ${index + 1}.`);
      const field = {
        label: fieldLabel,
        valueType,
        required: row.querySelector("[data-schema-required]").checked
      };
      if (valueType === "enum") {
        const values = row.querySelector("[data-schema-enum]").value
          .split(/[,;\n]/u)
          .map((value) => value.trim())
          .filter(Boolean);
        if (values.length < 1) throw new Error(`Укажите варианты для колонки «${fieldLabel}».`);
        field.validation = { enum: [...new Set(values)] };
      }
      return field;
    });
    if (new Set(fields.map((field) => normalizeLabel(field.label))).size !== fields.length) {
      throw new Error("Названия колонок должны различаться.");
    }
    return { label, ownerEntityTypeKey: "person", fields };
  }

  async function createSchema(builder) {
    const statusElement = builder.querySelector("[data-schema-status]");
    try {
      const payload = schemaPayload(builder);
      statusElement.textContent = "Создаём таблицу…";
      const body = await requestJson(endpoint("/entity-collections"), {
        method: "POST",
        body: JSON.stringify(payload)
      });
      statusElement.className = "entity-collection-status is-success";
      statusElement.textContent = `Таблица «${body.data.label}» создана.`;
      await loadCollections();
    } catch (error) {
      statusElement.className = "entity-collection-status is-error";
      statusElement.textContent = `${error.message}${error.correlationId ? ` Идентификатор операции: ${error.correlationId}.` : ""}`;
    }
  }

  function sourceRowsFromPaste(text) {
    const lines = String(text)
      .replace(/\r\n?/gu, "\n")
      .split("\n")
      .filter((line) => line.trim().length > 0);
    if (lines.length < 2) throw new Error("Вставьте строку заголовков и хотя бы одну строку данных из Excel или LibreOffice.");
    const matrix = lines.map((line) => line.split("\t"));
    const headers = matrix[0].map((value, index) => value.trim() || `Колонка ${index + 1}`);
    const rows = matrix.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim() || ""])));
    return { headers, rows, sourceRowNumbers: rows.map((_row, index) => index + 2), fileName: "Вставленные данные", warnings: [] };
  }

  function importMappingPanel(card, preview) {
    const definition = definitionForCard(card);
    if (!definition) return;
    const automatic = new Map(
      definition.fields.map((field) => [normalizeLabel(field.label), field.key])
    );
    const rows = preview.headers.map((header) => {
      const normalized = normalizeLabel(header);
      const isNumber = /^(?:№|номер|n|no)$/iu.test(header.trim()) || normalized === "номер";
      const selected = isNumber ? "" : automatic.get(normalized) || "";
      return `<div class="collection-import-map-row"><strong>${escapeHtml(header)}</strong><select data-import-header="${escapeHtml(header)}"><option value="">Не импортировать</option>${definition.fields.map((field) => `<option value="${escapeHtml(field.key)}"${field.key === selected ? " selected" : ""}>${escapeHtml(field.label)}</option>`).join("")}</select></div>`;
    }).join("");
    const sample = preview.rows.slice(0, 5);
    const previewTable = `<div class="collection-import-preview"><table><thead><tr>${preview.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${sample.map((row) => `<tr>${preview.headers.map((header) => `<td>${escapeHtml(row[header] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    card.querySelector("[data-collection-import-panel]").innerHTML = `<section class="collection-import-panel" data-import-panel>
      <div class="collection-import-head"><div><strong>Проверьте сопоставление колонок</strong><p class="collection-help">Источник: ${escapeHtml(preview.fileName || "данные")}. Строк: ${preview.rows.length}. Сохранение произойдёт только после проверки всех строк.</p></div><button class="quiet-button compact" type="button" data-collection-action="import-cancel">Закрыть</button></div>
      <div class="collection-import-map">${rows}</div>
      ${previewTable}
      ${preview.warnings?.length ? `<p class="collection-help">${preview.warnings.map(escapeHtml).join(" ")}</p>` : ""}
      <div class="entity-collection-actions"><button class="primary-button compact-button" type="button" data-collection-action="import-apply">Заменить таблицу этими строками</button></div>
    </section>`;
    state.importPreview = { collectionId: definition.id, preview };
  }

  function importItems(card) {
    const definition = definitionForCard(card);
    const panel = card.querySelector("[data-import-panel]");
    const preview = state.importPreview?.collectionId === definition?.id ? state.importPreview.preview : null;
    if (!definition || !panel || !preview) throw new Error("Предпросмотр импорта устарел. Выберите файл ещё раз.");
    const mappings = [...panel.querySelectorAll("[data-import-header]")]
      .map((select) => ({ header: select.dataset.importHeader, fieldKey: select.value }))
      .filter((mapping) => mapping.fieldKey);
    if (mappings.length < 1) throw new Error("Сопоставьте хотя бы одну колонку.");
    if (new Set(mappings.map((mapping) => mapping.fieldKey)).size !== mappings.length) {
      throw new Error("Одна колонка таблицы назначения выбрана несколько раз.");
    }
    const byKey = new Map(definition.fields.map((field) => [field.key, field]));
    return preview.rows.map((sourceRow, rowIndex) => {
      const values = {};
      for (const mapping of mappings) {
        const field = byKey.get(mapping.fieldKey);
        if (!field) continue;
        const raw = String(sourceRow[mapping.header] || "").trim();
        if (!raw) continue;
        if (field.valueType === "number") {
          const value = Number(raw.replace(/\s+/gu, "").replace(",", "."));
          if (!Number.isFinite(value)) throw new Error(`Строка ${preview.sourceRowNumbers?.[rowIndex] || rowIndex + 2}: «${field.label}» должно быть числом.`);
          values[field.key] = value;
        } else if (field.valueType === "integer") {
          const value = Number(raw.replace(/\s+/gu, ""));
          if (!Number.isSafeInteger(value)) throw new Error(`Строка ${preview.sourceRowNumbers?.[rowIndex] || rowIndex + 2}: «${field.label}» должно быть целым числом.`);
          values[field.key] = value;
        } else if (field.valueType === "boolean") {
          if (/^(?:да|yes|true|1)$/iu.test(raw)) values[field.key] = true;
          else if (/^(?:нет|no|false|0)$/iu.test(raw)) values[field.key] = false;
          else throw new Error(`Строка ${preview.sourceRowNumbers?.[rowIndex] || rowIndex + 2}: «${field.label}» должно быть «Да» или «Нет».`);
        } else {
          values[field.key] = raw;
        }
      }
      for (const field of definition.fields) {
        if (field.required && (values[field.key] === undefined || values[field.key] === "")) {
          throw new Error(`Строка ${preview.sourceRowNumbers?.[rowIndex] || rowIndex + 2}: не заполнено обязательное поле «${field.label}».`);
        }
      }
      return { values };
    });
  }

  async function parseFileImport(card, file) {
    status(card, `Читаем ${file.name}…`);
    try {
      const body = await requestJson(
        endpoint(`/data-import/preview?fileName=${encodeURIComponent(file.name)}`),
        { method: "POST", body: file, headers: { "content-type": "application/octet-stream" } }
      );
      importMappingPanel(card, body.data);
      status(card, "Файл прочитан. Проверьте сопоставление колонок перед заменой таблицы.");
    } catch (error) {
      const coordinate = error.issue?.row ? ` Строка ${error.issue.row}.` : "";
      status(card, `${error.message}${coordinate} Таблица не изменена.`, "error");
    }
  }

  function showPaste(card) {
    card.querySelector("[data-collection-import-panel]").innerHTML = `<section class="collection-import-panel" data-paste-panel><div class="collection-import-head"><div><strong>Вставка из Excel / LibreOffice</strong><p class="collection-help">Скопируйте диапазон вместе с заголовками колонок.</p></div><button class="quiet-button compact" type="button" data-collection-action="import-cancel">Закрыть</button></div><textarea class="collection-paste-area" data-paste-text placeholder="№\tНаименование вопроса\tСрок выполнения\tОтчётность"></textarea><div class="entity-collection-actions"><button class="primary-button compact-button" type="button" data-collection-action="paste-preview">Проверить данные</button></div></section>`;
    card.querySelector("[data-paste-text]")?.focus();
  }

  root.addEventListener("input", (event) => {
    const card = currentCard(event.target);
    if (card && event.target.matches("[data-collection-row-input]")) markDirty(card);
  });

  root.addEventListener("change", (event) => {
    if (event.target.matches("[data-schema-type]")) {
      const field = event.target.closest("[data-schema-field]");
      const enumBlock = field?.querySelector("[data-enum-values]");
      if (enumBlock) enumBlock.hidden = event.target.value !== "enum";
      return;
    }
    if (event.target.matches("[data-collection-import-file]")) {
      const card = currentCard(event.target);
      const file = event.target.files?.[0];
      if (card && file) void parseFileImport(card, file);
      event.target.value = "";
    }
  });

  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-collection-action]");
    if (!button) return;
    const action = button.dataset.collectionAction;
    const card = currentCard(button);
    const row = button.closest("[data-collection-row]");
    if (action === "add-row" && card) addRow(card);
    if (action === "row-up" && row) moveRow(row, -1);
    if (action === "row-down" && row) moveRow(row, 1);
    if (action === "row-delete" && row) {
      const ownerCard = currentCard(row);
      row.remove();
      const count = ownerCard.querySelector("[data-collection-count]");
      if (count) count.textContent = String(ownerCard.querySelectorAll("[data-collection-row]").length);
      markDirty(ownerCard);
    }
    if (action === "row-duplicate" && row && card) addRow(card, rowValues(row));
    if (action === "save" && card) void saveCard(card);
    if (action === "paste" && card) showPaste(card);
    if (action === "import-cancel" && card) {
      card.querySelector("[data-collection-import-panel]").innerHTML = "";
      state.importPreview = null;
    }
    if (action === "paste-preview" && card) {
      try {
        const preview = sourceRowsFromPaste(card.querySelector("[data-paste-text]")?.value || "");
        importMappingPanel(card, preview);
        status(card, "Вставленные данные разобраны. Проверьте сопоставление колонок.");
      } catch (error) {
        status(card, error.message, "error");
      }
    }
    if (action === "import-apply" && card) {
      try {
        const items = importItems(card);
        void saveCard(card, items);
      } catch (error) {
        status(card, `${error.message} Таблица не изменена.`, "error");
      }
    }
    if (action === "schema-open") {
      const host = root.querySelector("[data-schema-host]");
      if (host) host.innerHTML = schemaBuilderHtml();
      host?.querySelector("[data-schema-name]")?.focus();
    }
    if (action === "schema-cancel") {
      const host = root.querySelector("[data-schema-host]");
      if (host) host.innerHTML = "";
    }
    if (action === "schema-add-field") {
      const builder = button.closest("[data-schema-builder]");
      const fields = builder?.querySelector("[data-schema-fields]");
      if (fields) fields.insertAdjacentHTML("beforeend", schemaFieldRow(fields.children.length));
      fields?.lastElementChild?.querySelector("[data-schema-label]")?.focus();
    }
    if (action === "schema-remove-field") {
      const builder = button.closest("[data-schema-builder]");
      const rows = builder?.querySelectorAll("[data-schema-field]") || [];
      if (rows.length <= 1) {
        const statusElement = builder?.querySelector("[data-schema-status]");
        if (statusElement) {
          statusElement.className = "entity-collection-status is-error";
          statusElement.textContent = "В таблице должна остаться хотя бы одна колонка.";
        }
      } else button.closest("[data-schema-field]")?.remove();
    }
    if (action === "schema-save") {
      const builder = button.closest("[data-schema-builder]");
      if (builder) void createSchema(builder);
    }
  });

  document.addEventListener("docomator:employee-dialog-opened", (event) => {
    state.spaceId = String(event.detail?.spaceId || globalThis.docomatorCurrentSpaceId || "");
    state.entityId = String(event.detail?.entityId || "");
    state.displayName = String(event.detail?.displayName || "");
    state.importPreview = null;
    if (!state.entityId) {
      root.innerHTML = `<div class="employee-collections-header"><div><h3>Таблицы и списки данных</h3><p>Сначала сохраните нового сотрудника. После этого здесь можно будет добавить повторяемые строки для документов.</p></div></div>`;
      return;
    }
    void loadCollections();
  });

  document.addEventListener("docomator:space-changed", () => {
    state.spaceId = String(globalThis.docomatorCurrentSpaceId || "");
    state.entityId = "";
    state.collections.clear();
    state.importPreview = null;
    root.innerHTML = "";
  });
}
