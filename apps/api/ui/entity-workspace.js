{
  const entityWorkspaceState = {
    ready: false,
    loading: false,
    types: [],
    properties: [],
    entities: [],
    selectedTypeKey: "",
    selectedEntityId: "",
    search: "",
    importPreview: null,
    importPlan: null,
    importBusy: false
  };

  const entityWorkspaceSupportedTypes = new Set([
    "string",
    "text",
    "number",
    "integer",
    "boolean",
    "date",
    "date-time",
    "enum"
  ]);

  function entityWorkspaceEscape(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    })[character]);
  }

  function entityWorkspaceNormalize(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/gu, "е")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  function entityWorkspaceSpaceId() {
    return String(globalThis.docomatorCurrentSpaceId || "").trim();
  }

  function entityWorkspaceType() {
    return (
      entityWorkspaceState.types.find(
        (type) => type.key === entityWorkspaceState.selectedTypeKey
      ) || null
    );
  }

  function entityWorkspaceTypeLabel(key) {
    return entityWorkspaceState.types.find((type) => type.key === key)?.label || key;
  }

  function entityWorkspaceProperties(typeKey = entityWorkspaceState.selectedTypeKey) {
    return entityWorkspaceState.properties
      .filter((property) => entityWorkspaceSupportedTypes.has(property.valueType))
      .filter((property) => {
        const appliesTo = Array.isArray(property.appliesTo) ? property.appliesTo : [];
        return appliesTo.length === 0 || appliesTo.includes(typeKey);
      })
      .sort((left, right) => left.label.localeCompare(right.label, "ru-RU"));
  }

  function entityWorkspaceValueTypeLabel(valueType) {
    return ({
      string: "Короткий текст",
      text: "Длинный текст",
      number: "Число",
      integer: "Целое число",
      boolean: "Да или нет",
      date: "Дата",
      "date-time": "Дата и время",
      enum: "Список вариантов"
    })[valueType] || "Значение";
  }

  async function entityWorkspaceFetch(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        accept: "application/json",
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        "x-correlation-id": globalThis.crypto?.randomUUID?.() || `entity-ui-${Date.now()}`,
        "x-actor-id": "local-ui",
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

  function entityWorkspaceEnsureDialogs() {
    if (!document.querySelector("#entityTypeDialog")) {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<dialog class="create-dialog entity-workspace-dialog" id="entityTypeDialog" aria-labelledby="entityTypeDialogTitle">
          <form id="entityTypeForm" novalidate>
            <header class="dialog-header"><div><p class="eyebrow">Новый тип объектов</p><h2 id="entityTypeDialogTitle">Создать тип</h2><p>Тип определяет, какие поля доступны объектам. Например, «Аудитория», «Научная статья» или «Оборудование».</p></div><button class="icon-button" type="button" data-entity-dialog-close="entityTypeDialog" aria-label="Закрыть">×</button></header>
            <div class="dialog-body">
              <div class="field"><label for="entityTypeLabel">Название <span class="required-marker">*</span></label><input id="entityTypeLabel" type="text" maxlength="160" required placeholder="Аудитория" /><small>Техническое обозначение система создаст сама.</small></div>
              <div class="field"><label for="entityTypeDescription">Описание</label><textarea id="entityTypeDescription" maxlength="2000" placeholder="Учебное помещение с номером, вместимостью и оборудованием"></textarea></div>
            </div>
            <div class="form-error" id="entityTypeError" role="alert" hidden></div>
            <footer class="dialog-footer"><p class="save-explanation">Тип станет доступен во всех пространствах, а сами объекты останутся внутри выбранного пространства.</p><div><button class="secondary-button" type="button" data-entity-dialog-close="entityTypeDialog">Отмена</button><button class="primary-button" type="submit">Создать тип</button></div></footer>
          </form>
        </dialog>`
      );
      document
        .querySelector("#entityTypeForm")
        ?.addEventListener("submit", entityWorkspaceCreateType);
    }

    if (!document.querySelector("#entityPropertyDialog")) {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<dialog class="create-dialog entity-workspace-dialog" id="entityPropertyDialog" aria-labelledby="entityPropertyDialogTitle">
          <form id="entityPropertyForm" novalidate>
            <header class="dialog-header"><div><p class="eyebrow">Новое поле</p><h2 id="entityPropertyDialogTitle">Добавить параметр</h2><p id="entityPropertyDialogDescription"></p></div><button class="icon-button" type="button" data-entity-dialog-close="entityPropertyDialog" aria-label="Закрыть">×</button></header>
            <div class="dialog-body">
              <div class="field"><label for="entityPropertyLabel">Название <span class="required-marker">*</span></label><input id="entityPropertyLabel" type="text" maxlength="300" required placeholder="Вместимость" /></div>
              <div class="field"><label for="entityPropertyType">Тип значения</label><select id="entityPropertyType"><option value="string">Короткий текст</option><option value="text">Длинный текст</option><option value="integer">Целое число</option><option value="number">Число</option><option value="boolean">Да или нет</option><option value="date">Дата</option><option value="date-time">Дата и время</option><option value="enum">Список вариантов</option></select></div>
              <div class="field" id="entityPropertyEnumField" hidden><label for="entityPropertyEnum">Варианты</label><textarea id="entityPropertyEnum" placeholder="Проектор\nИнтерактивная доска\nНет оборудования"></textarea><small>По одному варианту в строке. При импорте список можно расширить.</small></div>
              <div class="field"><label for="entityPropertyUnit">Единица измерения</label><input id="entityPropertyUnit" type="text" maxlength="80" placeholder="мест, м², руб." /></div>
              <div class="field"><label for="entityPropertySensitivity">Класс данных</label><select id="entityPropertySensitivity"><option value="internal">Внутренние</option><option value="public">Открытые</option><option value="personal">Персональные</option><option value="restricted">Ограниченные</option></select></div>
            </div>
            <div class="form-error" id="entityPropertyError" role="alert" hidden></div>
            <footer class="dialog-footer"><p class="save-explanation">Поле будет применяться только к выбранному типу объектов.</p><div><button class="secondary-button" type="button" data-entity-dialog-close="entityPropertyDialog">Отмена</button><button class="primary-button" type="submit">Создать поле</button></div></footer>
          </form>
        </dialog>`
      );
      document
        .querySelector("#entityPropertyType")
        ?.addEventListener("change", (event) => {
          const field = document.querySelector("#entityPropertyEnumField");
          if (field) field.hidden = event.target.value !== "enum";
        });
      document
        .querySelector("#entityPropertyForm")
        ?.addEventListener("submit", entityWorkspaceCreateProperty);
    }

    if (!document.querySelector("#entityRecordDialog")) {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<dialog class="create-dialog entity-workspace-dialog entity-record-dialog" id="entityRecordDialog" aria-labelledby="entityRecordDialogTitle">
          <form id="entityRecordForm" novalidate>
            <header class="dialog-header"><div><p class="eyebrow" id="entityRecordEyebrow">Новый объект</p><h2 id="entityRecordDialogTitle">Добавить объект</h2><p id="entityRecordDialogDescription"></p></div><button class="icon-button" type="button" data-entity-dialog-close="entityRecordDialog" aria-label="Закрыть">×</button></header>
            <div class="dialog-body entity-record-body">
              <div class="field"><label for="entityRecordName">Отображаемое название <span class="required-marker">*</span></label><input id="entityRecordName" type="text" maxlength="500" required /><small>Это название будет видно в списках и при создании документов.</small></div>
              <div id="entityRecordFields" class="entity-record-fields"></div>
              <button class="field-add-button" id="entityRecordAddProperty" type="button"><span aria-hidden="true">＋</span><span>Создать новое поле для типа</span></button>
            </div>
            <div class="form-error" id="entityRecordError" role="alert" hidden></div>
            <footer class="dialog-footer"><p class="save-explanation">Сохраняются только заполненные значения. Новые значения образуют проверяемую историю изменений.</p><div><button class="secondary-button" type="button" data-entity-dialog-close="entityRecordDialog">Отмена</button><button class="primary-button" id="entityRecordSubmit" type="submit">Сохранить объект</button></div></footer>
          </form>
        </dialog>`
      );
      document
        .querySelector("#entityRecordForm")
        ?.addEventListener("submit", entityWorkspaceSaveRecord);
      document
        .querySelector("#entityRecordAddProperty")
        ?.addEventListener("click", () => entityWorkspaceOpenPropertyDialog());
    }

    if (!document.querySelector("#entityImportDialog")) {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<dialog class="create-dialog entity-workspace-dialog entity-import-dialog" id="entityImportDialog" aria-labelledby="entityImportDialogTitle">
          <form id="entityImportForm" novalidate>
            <header class="dialog-header"><div><p class="eyebrow">Массовое добавление</p><h2 id="entityImportDialogTitle">Импортировать объекты</h2><p id="entityImportDialogDescription"></p></div><button class="icon-button" type="button" data-entity-dialog-close="entityImportDialog" aria-label="Закрыть">×</button></header>
            <div class="dialog-body entity-import-body">
              <ol class="bulk-import-steps" aria-label="Шаги импорта"><li class="is-current" data-entity-import-step="1">1. Файл</li><li data-entity-import-step="2">2. Колонки</li><li data-entity-import-step="3">3. Проверка</li><li data-entity-import-step="4">4. Готово</li></ol>
              <div class="field"><label for="entityImportFile">CSV или XLSX</label><input id="entityImportFile" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" /><small>До 8 МБ и 1000 строк. В XLSX используется первый лист.</small></div>
              <button class="primary-button" id="entityImportPreviewButton" type="button">Прочитать файл</button>
              <div id="entityImportMessage" class="bulk-import-message" role="status" aria-live="polite">Выберите файл со строкой заголовков.</div>
              <div id="entityImportWorkspace"></div>
            </div>
            <footer class="dialog-footer"><p class="save-explanation">Перед записью выполняется предварительная проверка без изменения базы.</p><div><button class="secondary-button" type="button" data-entity-dialog-close="entityImportDialog">Закрыть</button></div></footer>
          </form>
        </dialog>`
      );
      document
        .querySelector("#entityImportPreviewButton")
        ?.addEventListener("click", entityWorkspacePreviewImport);
      document
        .querySelector("#entityImportWorkspace")
        ?.addEventListener("change", entityWorkspaceImportChanged);
      document
        .querySelector("#entityImportWorkspace")
        ?.addEventListener("input", entityWorkspaceImportChanged);
      document
        .querySelector("#entityImportWorkspace")
        ?.addEventListener("click", entityWorkspaceImportClicked);
    }

    document.querySelectorAll("[data-entity-dialog-close]").forEach((button) => {
      if (button.dataset.entityCloseBound === "true") return;
      button.dataset.entityCloseBound = "true";
      button.addEventListener("click", () => {
        document.querySelector(`#${CSS.escape(button.dataset.entityDialogClose)}`)?.close();
      });
    });
  }

  function entityWorkspaceFieldControl(property, value = "") {
    const id = `entity-value-${property.key.replace(/[^a-z0-9_-]/giu, "-")}`;
    const common = `id="${entityWorkspaceEscape(id)}" data-entity-property="${entityWorkspaceEscape(property.key)}" data-value-type="${entityWorkspaceEscape(property.valueType)}"`;
    let control = "";
    if (property.valueType === "text") {
      control = `<textarea ${common} maxlength="20000">${entityWorkspaceEscape(value)}</textarea>`;
    } else if (property.valueType === "boolean") {
      control = `<select ${common}><option value="">Не указано</option><option value="true"${value === true ? " selected" : ""}>Да</option><option value="false"${value === false ? " selected" : ""}>Нет</option></select>`;
    } else if (property.valueType === "enum") {
      const variants = Array.isArray(property.validation?.enum)
        ? property.validation.enum.filter((item) => typeof item === "string")
        : [];
      control = variants.length
        ? `<select ${common}><option value="">Не указано</option>${variants.map((variant) => `<option value="${entityWorkspaceEscape(variant)}"${String(value) === variant ? " selected" : ""}>${entityWorkspaceEscape(variant)}</option>`).join("")}</select>`
        : `<input ${common} type="text" value="${entityWorkspaceEscape(value)}" maxlength="2000" />`;
    } else {
      const type = property.valueType === "number" || property.valueType === "integer"
        ? "number"
        : property.valueType === "date"
          ? "date"
          : property.valueType === "date-time"
            ? "datetime-local"
            : "text";
      const step = property.valueType === "integer" ? ' step="1"' : property.valueType === "number" ? ' step="any"' : "";
      control = `<input ${common} type="${type}"${step} value="${entityWorkspaceEscape(value)}" maxlength="2000" />`;
    }
    return `<div class="field entity-record-field"><label for="${entityWorkspaceEscape(id)}">${entityWorkspaceEscape(property.label)}</label>${control}<small>${entityWorkspaceEscape(entityWorkspaceValueTypeLabel(property.valueType))}${property.unit ? ` · ${entityWorkspaceEscape(property.unit)}` : ""}</small></div>`;
  }

  function entityWorkspaceLatestValues(history) {
    const result = new Map();
    for (const item of Array.isArray(history) ? history : []) {
      if (!result.has(item.propertyKey)) result.set(item.propertyKey, item.value);
    }
    return result;
  }

  function entityWorkspaceRenderRecordFields(values = new Map()) {
    const root = document.querySelector("#entityRecordFields");
    if (!root) return;
    const properties = entityWorkspaceProperties();
    root.innerHTML = properties.length
      ? properties.map((property) => entityWorkspaceFieldControl(property, values.get(property.key) ?? "")).join("")
      : `<div class="entity-workspace-empty compact"><strong>У типа пока нет полей</strong><p>Создайте первый параметр, например номер, вместимость, авторов, дату публикации или состояние оборудования.</p></div>`;
  }

  function entityWorkspaceSelectedIds() {
    const available = new Set(
      entityWorkspaceState.entities
        .filter((entity) => entity.entityTypeKey === entityWorkspaceState.selectedTypeKey)
        .map((entity) => entity.entityId)
    );
    return [...state.selectedEntityIds].filter((entityId) => available.has(entityId));
  }

  function entityWorkspaceFilteredEntities() {
    const normalizedQuery = entityWorkspaceNormalize(entityWorkspaceState.search);
    return entityWorkspaceState.entities.filter((entity) => {
      if (
        entityWorkspaceState.selectedTypeKey &&
        entity.entityTypeKey !== entityWorkspaceState.selectedTypeKey
      ) {
        return false;
      }
      return (
        !normalizedQuery ||
        entityWorkspaceNormalize(
          `${entity.displayName} ${entity.entityTypeLabel} ${entity.status}`
        ).includes(normalizedQuery)
      );
    });
  }

  function entityWorkspaceRenderList() {
    const list = document.querySelector("#entityWorkspaceList");
    if (!list) return;
    const entities = entityWorkspaceFilteredEntities();
    const selectedIds = entityWorkspaceSelectedIds();
    const count = document.querySelector("[data-entity-visible-count]");
    if (count) count.textContent = `${entities.length} объектов`;
    const documentButton = document.querySelector('[data-entity-action="document"]');
    if (documentButton) {
      documentButton.disabled = selectedIds.length === 0;
      documentButton.textContent = `Использовать отмеченные для документа (${selectedIds.length})`;
    }
    list.innerHTML = entities.length
      ? entities
          .map(
            (entity) =>
              `<article class="entity-workspace-card" data-entity-id="${entityWorkspaceEscape(entity.entityId)}"><label class="entity-workspace-select"><input type="checkbox" data-entity-select="${entityWorkspaceEscape(entity.entityId)}"${state.selectedEntityIds.has(entity.entityId) ? " checked" : ""} /><span class="visually-hidden">Отметить объект</span></label><button class="entity-workspace-open" type="button" data-entity-open="${entityWorkspaceEscape(entity.entityId)}"><span class="entity-workspace-avatar" aria-hidden="true">${entityWorkspaceEscape(entity.displayName.slice(0, 1).toLocaleUpperCase("ru-RU"))}</span><span><strong>${entityWorkspaceEscape(entity.displayName)}</strong><small>${entityWorkspaceEscape(entity.entityTypeLabel)} · ${entity.status === "active" ? "Активный" : entity.status === "inactive" ? "Неактивный" : "Архивный"}</small></span><span aria-hidden="true">›</span></button></article>`
          )
          .join("")
      : `<div class="employee-empty"><h3>${entityWorkspaceState.search ? "Ничего не найдено" : "Объектов этого типа пока нет"}</h3><p>${entityWorkspaceState.search ? "Измените поисковый запрос." : "Добавьте запись вручную или импортируйте таблицу."}</p>${entityWorkspaceState.search ? '<button class="secondary-button" type="button" data-entity-action="clear-search">Очистить поиск</button>' : '<button class="primary-button" type="button" data-entity-action="record">Добавить первый объект</button>'}</div>`;
  }

  function entityWorkspaceRender() {
    const root = document.querySelector("#entityWorkspace");
    if (!root) return;
    const spaceId = entityWorkspaceSpaceId();
    if (!spaceId) {
      root.innerHTML = `<div class="employee-empty"><h3>Пространство не выбрано</h3><p>Выберите пространство в верхней части экрана.</p></div>`;
      return;
    }
    const type = entityWorkspaceType();
    root.innerHTML = `
      <div class="section-intro entity-workspace-intro">
        <div><p class="eyebrow">Данные пространства</p><h2>Объекты</h2><p>Создавайте произвольные записи: аудитории, статьи, оборудование, организации и другие типы. Их поля можно использовать в шаблонах и списках.</p></div>
        <div class="entity-workspace-actions"><button class="secondary-button" type="button" data-entity-action="type">Создать тип</button><button class="secondary-button" type="button" data-entity-action="property"${type ? "" : " disabled"}>Добавить поле</button><button class="primary-button" type="button" data-entity-action="record"${type ? "" : " disabled"}>Добавить объект</button></div>
      </div>
      <article class="panel entity-workspace-toolbar">
        <label class="generation-field"><span>Тип объектов</span><select id="entityWorkspaceType" data-searchable-select data-searchable-placeholder="Выберите тип" data-searchable-search-placeholder="Найти тип">${entityWorkspaceState.types.map((item) => `<option value="${entityWorkspaceEscape(item.key)}"${item.key === entityWorkspaceState.selectedTypeKey ? " selected" : ""}>${entityWorkspaceEscape(item.label)}</option>`).join("")}</select><small>${type ? entityWorkspaceEscape(type.description || "Поля и объекты этого типа не смешиваются с другими типами.") : "Создайте первый тип объектов."}</small></label>
        <label class="search-field" for="entityWorkspaceSearch"><span aria-hidden="true">⌕</span><input id="entityWorkspaceSearch" type="search" placeholder="Найти объект" value="${entityWorkspaceEscape(entityWorkspaceState.search)}" autocomplete="off" /></label>
        <button class="secondary-button" type="button" data-entity-action="import"${type ? "" : " disabled"}>Импортировать CSV/XLSX</button>
      </article>
      <div class="entity-workspace-summary"><span class="pill" data-entity-visible-count></span><span class="pill">${entityWorkspaceProperties().length} полей</span><button class="text-button" type="button" data-entity-action="document">Использовать отмеченные для документа (0)</button></div>
      <div class="entity-workspace-list" id="entityWorkspaceList"></div>`;
    globalThis.docomatorSearchableSelect?.enhanceAll?.(root);
    entityWorkspaceRenderList();
  }

  async function entityWorkspaceLoad() {
    if (entityWorkspaceState.loading) return;
    const spaceId = entityWorkspaceSpaceId();
    if (!spaceId) {
      entityWorkspaceRender();
      return;
    }
    entityWorkspaceState.loading = true;
    try {
      const [types, properties, entities] = await Promise.all([
        entityWorkspaceFetch("/api/v1/knowledge/entity-types?limit=500"),
        entityWorkspaceFetch(
          globalThis.docomatorPropertyDefinitionsUrl?.("", { limit: 500 }) ||
            `/api/v1/knowledge/property-definitions?spaceId=${encodeURIComponent(spaceId)}&limit=500`
        ),
        entityWorkspaceFetch(`/api/v1/spaces/${encodeURIComponent(spaceId)}/entities?limit=1000`)
      ]);
      entityWorkspaceState.types = Array.isArray(types.data) ? types.data : [];
      entityWorkspaceState.properties = Array.isArray(properties.data) ? properties.data : [];
      entityWorkspaceState.entities = Array.isArray(entities.data) ? entities.data : [];
      const storageKey = `docomator.entity-type:${spaceId}`;
      const stored = localStorage.getItem(storageKey) || "";
      const currentValid = entityWorkspaceState.types.some((type) => type.key === entityWorkspaceState.selectedTypeKey);
      const storedValid = entityWorkspaceState.types.some((type) => type.key === stored);
      if (!currentValid) {
        entityWorkspaceState.selectedTypeKey = storedValid
          ? stored
          : entityWorkspaceState.types.find((type) => type.key !== "person")?.key || entityWorkspaceState.types[0]?.key || "";
      }
      globalThis.docomatorSelectedEntityTypeKey = entityWorkspaceState.selectedTypeKey;
      entityWorkspaceState.ready = true;
      entityWorkspaceRender();
    } catch (error) {
      const root = document.querySelector("#entityWorkspace");
      if (root) root.innerHTML = `<div class="employee-state is-error"><span class="state-mark" aria-hidden="true"></span><div><strong>Объекты не загружены</strong><p>${entityWorkspaceEscape(error.message || "Повторите действие.")}</p></div><button class="secondary-button" type="button" data-entity-action="reload">Повторить</button></div>`;
    } finally {
      entityWorkspaceState.loading = false;
    }
  }

  async function entityWorkspaceCreateType(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorBox = document.querySelector("#entityTypeError");
    if (!form.reportValidity()) return;
    if (errorBox) errorBox.hidden = true;
    try {
      const body = await entityWorkspaceFetch("/api/v1/knowledge/entity-types", {
        method: "POST",
        body: JSON.stringify({
          label: document.querySelector("#entityTypeLabel")?.value.trim(),
          description: document.querySelector("#entityTypeDescription")?.value.trim() || undefined
        })
      });
      entityWorkspaceState.selectedTypeKey = body.data.key;
      document.querySelector("#entityTypeDialog")?.close();
      form.reset();
      await entityWorkspaceLoad();
    } catch (error) {
      if (errorBox) {
        errorBox.hidden = false;
        errorBox.textContent = error.message || "Тип создать не удалось.";
      }
    }
  }

  function entityWorkspaceOpenPropertyDialog() {
    entityWorkspaceEnsureDialogs();
    const type = entityWorkspaceType();
    if (!type) return;
    document.querySelector("#entityPropertyForm")?.reset();
    document.querySelector("#entityPropertyEnumField").hidden = true;
    document.querySelector("#entityPropertySensitivity").value = type.key === "person" ? "personal" : "internal";
    document.querySelector("#entityPropertyDialogDescription").textContent = `Поле будет доступно только объектам типа «${type.label}».`;
    document.querySelector("#entityPropertyError").hidden = true;
    document.querySelector("#entityPropertyDialog")?.showModal();
    requestAnimationFrame(() => document.querySelector("#entityPropertyLabel")?.focus());
  }

  async function entityWorkspaceCreateProperty(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorBox = document.querySelector("#entityPropertyError");
    if (!form.reportValidity() || !entityWorkspaceState.selectedTypeKey) return;
    if (errorBox) errorBox.hidden = true;
    const valueType = document.querySelector("#entityPropertyType")?.value || "string";
    const variants = String(document.querySelector("#entityPropertyEnum")?.value || "")
      .split(/\r?\n/u)
      .map((item) => item.trim())
      .filter(Boolean);
    try {
      await entityWorkspaceFetch(
        globalThis.docomatorPropertyDefinitionsUrl?.() ||
          `/api/v1/knowledge/property-definitions?spaceId=${encodeURIComponent(entityWorkspaceSpaceId())}`,
        {
        method: "POST",
        body: JSON.stringify({
          label: document.querySelector("#entityPropertyLabel")?.value.trim(),
          valueType,
          unit: document.querySelector("#entityPropertyUnit")?.value.trim() || undefined,
          sensitivity: document.querySelector("#entityPropertySensitivity")?.value || "internal",
          appliesTo: [entityWorkspaceState.selectedTypeKey],
          validation: {
            ...(valueType === "enum" ? { enum: [...new Set(variants)], allowCustom: true } : {}),
            ...(entityWorkspaceState.selectedTypeKey === "person" ? { uiGroup: "common" } : {})
          }
        })
      });
      document.querySelector("#entityPropertyDialog")?.close();
      await entityWorkspaceLoad();
      if (document.querySelector("#entityRecordDialog")?.open) entityWorkspaceRenderRecordFields();
    } catch (error) {
      if (errorBox) {
        errorBox.hidden = false;
        errorBox.textContent = error.message || "Поле создать не удалось.";
      }
    }
  }

  function entityWorkspaceOpenRecordDialog(entityId = "") {
    entityWorkspaceEnsureDialogs();
    const type = entityWorkspaceType();
    if (!type) return;
    entityWorkspaceState.selectedEntityId = entityId;
    document.querySelector("#entityRecordForm")?.reset();
    document.querySelector("#entityRecordError").hidden = true;
    document.querySelector("#entityRecordEyebrow").textContent = entityId ? type.label : "Новый объект";
    document.querySelector("#entityRecordDialogTitle").textContent = entityId ? "Карточка объекта" : `Добавить: ${type.label}`;
    document.querySelector("#entityRecordDialogDescription").textContent = entityId
      ? "Измените параметры. Предыдущие значения сохранятся в истории."
      : "Укажите название и заполните известные параметры.";
    document.querySelector("#entityRecordName").disabled = Boolean(entityId);
    document.querySelector("#entityRecordSubmit").textContent = entityId ? "Сохранить значения" : "Сохранить объект";
    entityWorkspaceRenderRecordFields();
    document.querySelector("#entityRecordDialog")?.showModal();
    if (entityId) void entityWorkspaceLoadRecord(entityId);
    else requestAnimationFrame(() => document.querySelector("#entityRecordName")?.focus());
  }

  async function entityWorkspaceLoadRecord(entityId) {
    const entity = entityWorkspaceState.entities.find((item) => item.entityId === entityId);
    if (entity) document.querySelector("#entityRecordName").value = entity.displayName;
    try {
      const history = await entityWorkspaceFetch(
        `/api/v1/spaces/${encodeURIComponent(entityWorkspaceSpaceId())}/entities/${encodeURIComponent(entityId)}/property-values?limit=500`
      );
      entityWorkspaceRenderRecordFields(entityWorkspaceLatestValues(history.data));
    } catch (error) {
      const errorBox = document.querySelector("#entityRecordError");
      if (errorBox) {
        errorBox.hidden = false;
        errorBox.textContent = error.message || "Значения получить не удалось.";
      }
    }
  }

  function entityWorkspaceReadValue(control) {
    const raw = control.value;
    if (raw === "") return undefined;
    if (control.dataset.valueType === "boolean") return raw === "true";
    if (control.dataset.valueType === "number") return Number(raw);
    if (control.dataset.valueType === "integer") return Number.parseInt(raw, 10);
    if (control.dataset.valueType === "date-time") return new Date(raw).toISOString();
    return raw;
  }

  async function entityWorkspaceSaveRecord(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorBox = document.querySelector("#entityRecordError");
    const button = document.querySelector("#entityRecordSubmit");
    if (!form.reportValidity()) return;
    if (errorBox) errorBox.hidden = true;
    if (button) button.disabled = true;
    try {
      let entityId = entityWorkspaceState.selectedEntityId;
      if (!entityId) {
        const body = await entityWorkspaceFetch(
          `/api/v1/spaces/${encodeURIComponent(entityWorkspaceSpaceId())}/entities`,
          {
            method: "POST",
            body: JSON.stringify({
              entityTypeKey: entityWorkspaceState.selectedTypeKey,
              displayName: document.querySelector("#entityRecordName")?.value.trim(),
              status: "active"
            })
          }
        );
        entityId = body.data.entityId || body.data.id;
      }
      const controls = [...form.querySelectorAll("[data-entity-property]")];
      for (const control of controls) {
        const value = entityWorkspaceReadValue(control);
        if (value === undefined) continue;
        await entityWorkspaceFetch(
          `/api/v1/spaces/${encodeURIComponent(entityWorkspaceSpaceId())}/entities/${encodeURIComponent(entityId)}/properties/${encodeURIComponent(control.dataset.entityProperty)}`,
          {
            method: "PUT",
            body: JSON.stringify({
              value,
              sourceType: "user_input",
              confirmedBy: "local-ui"
            })
          }
        );
      }
      document.querySelector("#entityRecordDialog")?.close();
      entityWorkspaceState.selectedEntityId = "";
      await entityWorkspaceLoad();
    } catch (error) {
      if (errorBox) {
        errorBox.hidden = false;
        errorBox.textContent = error.message || "Объект сохранить не удалось.";
      }
    } finally {
      if (button) button.disabled = false;
    }
  }

  function entityWorkspaceOpenImportDialog() {
    entityWorkspaceEnsureDialogs();
    const type = entityWorkspaceType();
    if (!type) return;
    entityWorkspaceState.importPreview = null;
    entityWorkspaceState.importPlan = null;
    document.querySelector("#entityImportForm")?.reset();
    document.querySelector("#entityImportWorkspace").innerHTML = "";
    document.querySelector("#entityImportMessage").className = "bulk-import-message";
    document.querySelector("#entityImportMessage").textContent = "Выберите файл со строкой заголовков.";
    document.querySelector("#entityImportDialogDescription").textContent = `Каждая строка будет объектом типа «${type.label}».`;
    entityWorkspaceSetImportStep(1);
    document.querySelector("#entityImportDialog")?.showModal();
  }

  function entityWorkspaceSetImportStep(step) {
    document.querySelectorAll("[data-entity-import-step]").forEach((item) => {
      const value = Number(item.dataset.entityImportStep);
      item.classList.toggle("is-current", value === step);
      item.classList.toggle("is-complete", value < step);
    });
  }

  function entityWorkspaceGuessColumn(headers, patterns, fallback = "") {
    return headers.find((header) => patterns.some((pattern) => pattern.test(entityWorkspaceNormalize(header)))) || fallback || headers[0] || "";
  }

  function entityWorkspaceGuessType(header) {
    const value = entityWorkspaceNormalize(header);
    if (/дата|год|опублик/u.test(value)) return "date";
    if (/количество|вместимость|этаж|номер мест/u.test(value)) return "integer";
    if (/площадь|сумма|стоимость|температура/u.test(value)) return "number";
    if (/описание|аннотация|примечание|текст/u.test(value)) return "text";
    if (/есть|доступен|активен|оснащен/u.test(value)) return "boolean";
    return "string";
  }

  function entityWorkspaceGuessProperty(header) {
    const target = entityWorkspaceNormalize(header);
    return entityWorkspaceProperties().find((property) =>
      entityWorkspaceNormalize(property.label) === target ||
      (Array.isArray(property.aliases) && property.aliases.some((alias) => entityWorkspaceNormalize(alias) === target))
    ) || null;
  }

  function entityWorkspaceImportMappingRow(header, displayColumn) {
    const existing = entityWorkspaceGuessProperty(header);
    const mode = header === displayColumn ? "skip" : existing ? `existing:${existing.key}` : "create";
    return `<article class="bulk-import-mapping-row" data-entity-import-mapping data-column="${entityWorkspaceEscape(header)}"><div class="bulk-import-column-name"><strong>${entityWorkspaceEscape(header)}</strong><small>${header === displayColumn ? "Используется как название объекта" : "Параметр объекта"}</small></div><label><span>Куда перенести</span><select data-entity-import-mode data-searchable-select data-searchable-placeholder="Выберите поле" data-searchable-search-placeholder="Найти поле"><option value="skip"${mode === "skip" ? " selected" : ""}>Не переносить</option><option value="create"${mode === "create" ? " selected" : ""}>Создать новое поле</option><optgroup label="Существующие поля">${entityWorkspaceProperties().map((property) => `<option value="existing:${entityWorkspaceEscape(property.key)}"${mode === `existing:${property.key}` ? " selected" : ""}>${entityWorkspaceEscape(property.label)} · ${entityWorkspaceEscape(entityWorkspaceValueTypeLabel(property.valueType))}</option>`).join("")}</optgroup></select></label><label data-entity-import-create${mode === "create" ? "" : " hidden"}><span>Название поля</span><input data-entity-import-label type="text" value="${entityWorkspaceEscape(header)}" maxlength="300" /></label><label data-entity-import-create${mode === "create" ? "" : " hidden"}><span>Тип значения</span><select data-entity-import-type><option value="string"${entityWorkspaceGuessType(header) === "string" ? " selected" : ""}>Короткий текст</option><option value="text"${entityWorkspaceGuessType(header) === "text" ? " selected" : ""}>Длинный текст</option><option value="integer"${entityWorkspaceGuessType(header) === "integer" ? " selected" : ""}>Целое число</option><option value="number"${entityWorkspaceGuessType(header) === "number" ? " selected" : ""}>Число</option><option value="boolean"${entityWorkspaceGuessType(header) === "boolean" ? " selected" : ""}>Да или нет</option><option value="date"${entityWorkspaceGuessType(header) === "date" ? " selected" : ""}>Дата</option><option value="date-time">Дата и время</option><option value="enum">Список вариантов</option></select></label></article>`;
  }

  function entityWorkspaceRenderImportPreview() {
    const preview = entityWorkspaceState.importPreview;
    const root = document.querySelector("#entityImportWorkspace");
    if (!preview || !root) return;
    const displayColumn = entityWorkspaceGuessColumn(preview.headers, [/назван/u, /наимен/u, /заголов/u, /тема/u, /фио/u, /^name$/u], preview.headers[0]);
    const identityColumn = entityWorkspaceGuessColumn(preview.headers, [/^id$/u, /код/u, /инвентар/u, /номер/u, /doi/u, /шифр/u], preview.headers[0]);
    root.innerHTML = `<section class="bulk-import-config"><div class="bulk-import-file-summary"><strong>${entityWorkspaceEscape(preview.fileName)}</strong><span>${preview.rowCount} строк · ${preview.columnCount} колонок</span></div><div class="bulk-import-core-fields"><label class="generation-field"><span>Отображаемое название объекта</span><select id="entityImportDisplayColumn">${preview.headers.map((header) => `<option value="${entityWorkspaceEscape(header)}"${header === displayColumn ? " selected" : ""}>${entityWorkspaceEscape(header)}</option>`).join("")}</select><small>Например, «Аудитория 101» или заголовок статьи.</small></label><label class="generation-field"><span>Устойчивый идентификатор</span><select id="entityImportIdentityColumn">${preview.headers.map((header) => `<option value="${entityWorkspaceEscape(header)}"${header === identityColumn ? " selected" : ""}>${entityWorkspaceEscape(header)}</option>`).join("")}</select><small>По нему повторный импорт обновит прежний объект, а не создаст дубликат.</small></label></div><div class="panel-heading compact-heading"><div><h3>Сопоставление колонок</h3><p>Поля другого типа объектов не показываются.</p></div></div><div class="bulk-import-mappings" id="entityImportMappings">${preview.headers.map((header) => entityWorkspaceImportMappingRow(header, displayColumn)).join("")}</div><label class="bulk-import-group-option"><input id="entityImportCreateGroup" type="checkbox" /><span><strong>Создать группу из импортированных объектов</strong><small>Группа будет однородной и пригодной для формирования списка.</small></span></label><div id="entityImportGroupFields" class="bulk-import-group-fields" hidden><label class="generation-field"><span>Название группы</span><input id="entityImportGroupName" type="text" maxlength="300" value="${entityWorkspaceEscape(`${entityWorkspaceType()?.label || "Объекты"} — импорт ${new Date().toLocaleDateString("ru-RU")}`)}" /></label></div><details class="bulk-import-source-preview"><summary>Первые строки файла</summary><div class="bulk-import-table-wrap"><table class="bulk-import-table"><thead><tr>${preview.headers.map((header) => `<th>${entityWorkspaceEscape(header)}</th>`).join("")}</tr></thead><tbody>${preview.sampleRows.slice(0, 10).map((row) => `<tr>${preview.headers.map((header) => `<td>${entityWorkspaceEscape(row[header] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details><div id="entityImportPlan" class="bulk-import-plan"><p>Сначала выполните проверку без сохранения.</p></div><div class="bulk-import-submit-row"><button class="primary-button" id="entityImportPlanButton" type="button">Проверить ${preview.rowCount} строк</button></div></section>`;
    globalThis.docomatorSearchableSelect?.enhanceAll?.(root);
    entityWorkspaceSetImportStep(2);
  }

  async function entityWorkspacePreviewImport() {
    if (entityWorkspaceState.importBusy) return;
    const file = document.querySelector("#entityImportFile")?.files?.[0];
    const message = document.querySelector("#entityImportMessage");
    const button = document.querySelector("#entityImportPreviewButton");
    if (!file || !message || !button) {
      if (message) message.textContent = "Выберите CSV или XLSX.";
      return;
    }
    entityWorkspaceState.importBusy = true;
    button.disabled = true;
    message.className = "bulk-import-message is-loading";
    message.textContent = "Читаем файл…";
    try {
      const response = await fetch(`/api/v1/spaces/${encodeURIComponent(entityWorkspaceSpaceId())}/data-import/preview?fileName=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream", accept: "application/json" },
        body: file
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || "Файл прочитать не удалось.");
      entityWorkspaceState.importPreview = body.data;
      entityWorkspaceState.importPlan = null;
      message.className = "bulk-import-message is-success";
      message.textContent = `Файл прочитан: ${body.data.rowCount} строк.`;
      entityWorkspaceRenderImportPreview();
    } catch (error) {
      message.className = "bulk-import-message is-error";
      message.textContent = error.message || "Файл прочитать не удалось.";
    } finally {
      entityWorkspaceState.importBusy = false;
      button.disabled = false;
    }
  }

  function entityWorkspaceCollectImportMappings() {
    return [...document.querySelectorAll("[data-entity-import-mapping]")].flatMap((row) => {
      const mode = row.querySelector("[data-entity-import-mode]")?.value || "skip";
      if (mode === "skip") return [];
      const column = row.dataset.column;
      if (mode.startsWith("existing:")) return [{ column, propertyKey: mode.slice("existing:".length) }];
      return [{
        column,
        createIfMissing: true,
        label: row.querySelector("[data-entity-import-label]")?.value.trim() || column,
        valueType: row.querySelector("[data-entity-import-type]")?.value || "string",
        sensitivity: entityWorkspaceState.selectedTypeKey === "person" ? "personal" : "internal"
      }];
    });
  }

  function entityWorkspaceImportBody() {
    const preview = entityWorkspaceState.importPreview;
    const createGroup = document.querySelector("#entityImportCreateGroup")?.checked === true;
    return {
      fileName: preview.fileName,
      fileFormat: preview.fileFormat,
      sourceSha256: preview.sourceSha256,
      previewToken: preview.previewToken,
      entityTypeKey: entityWorkspaceState.selectedTypeKey,
      identityColumn: document.querySelector("#entityImportIdentityColumn")?.value || "",
      displayNameColumn: document.querySelector("#entityImportDisplayColumn")?.value || "",
      headers: preview.headers,
      rows: preview.rows,
      sourceRowNumbers:
        preview.sourceRowNumbers ?? preview.rows.map((_row, index) => index + 2),
      identityCaseInsensitive: true,
      mappings: entityWorkspaceCollectImportMappings(),
      group: createGroup ? { name: document.querySelector("#entityImportGroupName")?.value.trim() || "Импорт" } : null
    };
  }

  function entityWorkspaceRenderImportPlan(plan) {
    const root = document.querySelector("#entityImportPlan");
    if (!root) return;
    const valid = plan.createdCount + plan.updatedCount + plan.unchangedCount;
    root.innerHTML = `<div class="bulk-import-summary"><div><span>Новые</span><strong>${plan.createdCount}</strong></div><div><span>Обновятся</span><strong>${plan.updatedCount}</strong></div><div><span>Без изменений</span><strong>${plan.unchangedCount}</strong></div><div><span>С ошибками</span><strong>${plan.failedCount}</strong></div></div>${Array.isArray(plan.errors) && plan.errors.length ? `<div class="generation-error-list">${plan.errors.slice(0, 100).map((error) => `<article class="generation-error-item"><div><strong>Строка ${error.rowNumber}</strong><span>${entityWorkspaceEscape(error.message)}</span></div></article>`).join("")}</div>` : ""}<p class="bulk-import-safety-note">Пустые ячейки не удалят существующие значения.</p><button class="primary-button" id="entityImportExecuteButton" type="button"${valid ? "" : " disabled"}>Импортировать ${valid} объектов</button>`;
    document.querySelector("#entityImportPlanButton").hidden = true;
    entityWorkspaceSetImportStep(3);
  }

  async function entityWorkspacePlanImport() {
    if (entityWorkspaceState.importBusy || !entityWorkspaceState.importPreview) return;
    const message = document.querySelector("#entityImportMessage");
    entityWorkspaceState.importBusy = true;
    message.className = "bulk-import-message is-loading";
    message.textContent = "Проверяем строки без сохранения…";
    try {
      const body = await entityWorkspaceFetch(`/api/v1/spaces/${encodeURIComponent(entityWorkspaceSpaceId())}/data-import/plan`, {
        method: "POST",
        body: JSON.stringify(entityWorkspaceImportBody())
      });
      entityWorkspaceState.importPlan = body.data;
      message.className = body.data.failedCount ? "bulk-import-message is-warning" : "bulk-import-message is-success";
      message.textContent = body.data.failedCount ? `Проверка завершена: ${body.data.failedCount} строк требуют исправления.` : "Проверка завершена. Данные можно сохранить.";
      entityWorkspaceRenderImportPlan(body.data);
      globalThis.docomatorRememberEntityImportPlan?.(
        entityWorkspaceSpaceId(),
        body.data
      );
    } catch (error) {
      message.className = "bulk-import-message is-error";
      message.textContent = error.message || "Проверка не выполнена.";
    } finally {
      entityWorkspaceState.importBusy = false;
    }
  }

  async function entityWorkspaceExecuteImport() {
    if (entityWorkspaceState.importBusy || !entityWorkspaceState.importPlan) return;
    const message = document.querySelector("#entityImportMessage");
    entityWorkspaceState.importBusy = true;
    message.className = "bulk-import-message is-loading";
    message.textContent = "Сохраняем объекты и значения…";
    try {
      const body = await entityWorkspaceFetch(`/api/v1/spaces/${encodeURIComponent(entityWorkspaceSpaceId())}/data-import/execute`, {
        method: "POST",
        body: JSON.stringify(entityWorkspaceImportBody())
      });
      message.className = body.data.failedCount ? "bulk-import-message is-warning" : "bulk-import-message is-success";
      message.textContent = `Импорт завершён: создано ${body.data.createdCount}, обновлено ${body.data.updatedCount}, ошибок ${body.data.failedCount}.`;
      document.querySelector("#entityImportWorkspace").innerHTML = `<div class="roster-assistant-finished"><span aria-hidden="true">✓</span><div><h3>Импорт завершён</h3><p>Создано: ${body.data.createdCount}, обновлено: ${body.data.updatedCount}, без изменений: ${body.data.unchangedCount}, ошибок: ${body.data.failedCount}.</p></div></div>`;
      entityWorkspaceSetImportStep(4);
      await entityWorkspaceLoad();
    } catch (error) {
      message.className = "bulk-import-message is-error";
      message.textContent = error.message || "Импорт не выполнен.";
    } finally {
      entityWorkspaceState.importBusy = false;
    }
  }

  function entityWorkspaceImportChanged(event) {
    if (event.target.matches("#entityImportCreateGroup")) {
      const fields = document.querySelector("#entityImportGroupFields");
      if (fields) fields.hidden = !event.target.checked;
    }
    if (event.target.matches("[data-entity-import-mode]")) {
      const row = event.target.closest("[data-entity-import-mapping]");
      row?.querySelectorAll("[data-entity-import-create]").forEach((field) => {
        field.hidden = event.target.value !== "create";
      });
    }
    if (event.target.matches("#entityImportDisplayColumn")) {
      const preview = entityWorkspaceState.importPreview;
      if (preview) {
        document.querySelector("#entityImportMappings").innerHTML = preview.headers.map((header) => entityWorkspaceImportMappingRow(header, event.target.value)).join("");
        globalThis.docomatorSearchableSelect?.enhanceAll?.(document.querySelector("#entityImportMappings"));
      }
    }
    if (event.target.matches("#entityImportWorkspace input, #entityImportWorkspace select, #entityImportWorkspace textarea")) {
      entityWorkspaceState.importPlan = null;
      const planButton = document.querySelector("#entityImportPlanButton");
      if (planButton) planButton.hidden = false;
      document.querySelector("#entityImportExecuteButton")?.remove();
      entityWorkspaceSetImportStep(2);
    }
  }

  function entityWorkspaceImportClicked(event) {
    if (event.target.closest("#entityImportPlanButton")) void entityWorkspacePlanImport();
    if (event.target.closest("#entityImportExecuteButton")) void entityWorkspaceExecuteImport();
  }

  function entityWorkspaceHandleClick(event) {
    const action = event.target.closest("[data-entity-action]")?.dataset.entityAction;
    if (action === "reload") void entityWorkspaceLoad();
    if (action === "clear-search") {
      entityWorkspaceState.search = "";
      const input = document.querySelector("#entityWorkspaceSearch");
      if (input) input.value = "";
      entityWorkspaceRenderList();
      input?.focus();
    }
    if (action === "type") {
      entityWorkspaceEnsureDialogs();
      document.querySelector("#entityTypeForm")?.reset();
      document.querySelector("#entityTypeError").hidden = true;
      document.querySelector("#entityTypeDialog")?.showModal();
    }
    if (action === "property") entityWorkspaceOpenPropertyDialog();
    if (action === "record") entityWorkspaceOpenRecordDialog();
    if (action === "import") entityWorkspaceOpenImportDialog();
    if (action === "document") {
      globalThis.docomatorSelectView?.("spaces");
      if (typeof setSpaceTab === "function") setSpaceTab("audience");
    }
    const open = event.target.closest("[data-entity-open]");
    if (open) entityWorkspaceOpenRecordDialog(open.dataset.entityOpen);
  }

  function entityWorkspaceHandleChange(event) {
    if (event.target.matches("#entityWorkspaceType")) {
      entityWorkspaceState.selectedTypeKey = event.target.value;
      localStorage.setItem(`docomator.entity-type:${entityWorkspaceSpaceId()}`, event.target.value);
      globalThis.docomatorSelectedEntityTypeKey = event.target.value;
      const available = new Set(
        entityWorkspaceState.entities
          .filter((entity) => entity.entityTypeKey === event.target.value)
          .map((entity) => entity.entityId)
      );
      state.selectedEntityIds = new Set(
        [...state.selectedEntityIds].filter((entityId) => available.has(entityId))
      );
      entityWorkspaceRender();
    }
    const checkbox = event.target.closest("[data-entity-select]");
    if (checkbox) {
      if (checkbox.checked) state.selectedEntityIds.add(checkbox.dataset.entitySelect);
      else state.selectedEntityIds.delete(checkbox.dataset.entitySelect);
      entityWorkspaceRenderList();
    }
  }

  function entityWorkspaceInstall() {
    if (entityWorkspaceState.ready && document.querySelector("#entityWorkspace")) return;
    views.entities = [
      "Каталог данных",
      "Объекты",
      "Произвольные типы записей, их параметры и массовый импорт.",
      null,
      null
    ];
    entityWorkspaceEnsureDialogs();
    const root = document.querySelector("#entityWorkspace");
    root?.addEventListener("click", entityWorkspaceHandleClick);
    root?.addEventListener("change", entityWorkspaceHandleChange);
    root?.addEventListener("input", (event) => {
      if (event.target.matches("#entityWorkspaceSearch")) {
        entityWorkspaceState.search = event.target.value;
        entityWorkspaceRenderList();
      }
    });
    window.addEventListener("docomator:view-changed", (event) => {
      if (event.detail?.view === "entities") void entityWorkspaceLoad();
    });
    document.addEventListener("docomator:space-changed", () => {
      entityWorkspaceState.ready = false;
      entityWorkspaceState.entities = [];
      entityWorkspaceState.search = "";
      if (state.view === "entities") void entityWorkspaceLoad();
    });
    globalThis.docomatorEntityWorkspaceReload = entityWorkspaceLoad;
    if (state.view === "entities") void entityWorkspaceLoad();
  }

  const entityWorkspaceBaseRenderMembers = renderMembers;
  renderMembers = function renderGenericSpaceMembers() {
    entityWorkspaceBaseRenderMembers();
    const pane = document.querySelector('[data-space-pane="members"]');
    pane?.querySelector("h2") && (pane.querySelector("h2").textContent = "Объекты пространства");
    const hint = pane?.querySelector(".inline-hint p");
    if (hint) hint.textContent = "Отмечайте объекты одного типа для разового документа или будущей группы.";
  };

  const entityWorkspaceBaseRenderGroups = renderGroups;
  renderGroups = function renderGenericGroups() {
    entityWorkspaceBaseRenderGroups();
    document.querySelectorAll("#spaceGroups .pill").forEach((pill) => {
      pill.textContent = pill.textContent.replace(/\sчел\.$/u, " объектов");
    });
  };

  renderAudienceSource = function renderGenericAudienceSource() {
    const select = document.querySelector("#audienceSource");
    if (!select) return;
    const previous = select.value;
    const selectedCount = state.selectedEntityIds.size;
    const active = state.data.spaceEntities.filter((entity) => entity.status === "active");
    const typeKeys = [...new Set(active.map((entity) => entity.entityTypeKey))];
    const options = [
      ...typeKeys.map((typeKey) => [
        `all_space:${typeKey}`,
        `Все объекты типа «${entityWorkspaceEscape(active.find((entity) => entity.entityTypeKey === typeKey)?.entityTypeLabel || typeKey)}» (${active.filter((entity) => entity.entityTypeKey === typeKey).length})`
      ]),
      ["selected", `Только отмеченные (${selectedCount})`],
      ...state.data.groups
        .filter((group) => group.status === "active")
        .map((group) => [`group:${group.id}`, `Группа «${group.name}» (${group.memberCount})`])
    ];
    select.innerHTML = options.map(([value, label]) => `<option value="${entityWorkspaceEscape(value)}">${label}</option>`).join("");
    if (options.some(([value]) => value === previous)) select.value = previous;
    updateAudiencePreview();
  };

  estimatedAudienceCount = function estimatedGenericAudienceCount() {
    const source = document.querySelector("#audienceSource")?.value || "";
    if (source === "selected") return state.selectedEntityIds.size;
    if (source.startsWith("group:")) return state.data.groups.find((group) => `group:${group.id}` === source)?.memberCount || 0;
    if (source.startsWith("all_space:")) {
      const typeKey = source.slice("all_space:".length);
      return state.data.spaceEntities.filter((entity) => entity.status === "active" && entity.entityTypeKey === typeKey).length;
    }
    return 0;
  };

  updateAudiencePreview = function updateGenericAudiencePreview() {
    const target = document.querySelector("#audiencePreviewText");
    if (!target) return;
    const count = estimatedAudienceCount();
    const mode = document.querySelector('input[name="targetMode"]:checked')?.value || "aggregate";
    target.textContent = count === 0
      ? "В выбранном источнике нет активных объектов."
      : mode === "aggregate"
        ? `Будет подготовлен один документ со списком из ${count} объектов.`
        : `Будет подготовлено ${count} отдельных документов — по одному на каждый объект.`;
  };

  const entityWorkspaceBaseCreateAudienceSnapshot = createAudienceSnapshot;
  createAudienceSnapshot = async function createGenericAudienceSnapshot() {
    const sourceValue = document.querySelector("#audienceSource")?.value || "";
    if (!sourceValue.startsWith("all_space:")) {
      if (sourceValue === "selected") {
        const selectedTypes = new Set(
          state.data.spaceEntities
            .filter((entity) => state.selectedEntityIds.has(entity.entityId))
            .map((entity) => entity.entityTypeKey)
        );
        if (selectedTypes.size > 1) {
          notify("⚠️", "Выбраны разные типы объектов", "Один документ использует объекты одного типа. Снимите лишние отметки или создайте отдельные группы.");
          return;
        }
      }
      return entityWorkspaceBaseCreateAudienceSnapshot();
    }
    if (!currentSpace()) return;
    const mode = document.querySelector('input[name="targetMode"]:checked')?.value || "aggregate";
    const typeKey = sourceValue.slice("all_space:".length);
    const button = document.querySelector("#createAudienceSnapshotButton");
    button.disabled = true;
    try {
      const result = await api(spaceEndpoint("/audience-snapshots"), {
        method: "POST",
        body: JSON.stringify({ source: { kind: "all_space", entityTypeKey: typeKey }, targetMode: mode })
      });
      renderPlan(result.data);
      const snapshots = await api(spaceEndpoint("/audience-snapshots?limit=50"));
      state.data.snapshots = snapshots?.data || [];
      renderSnapshots();
      notify("✅", "Состав объектов зафиксирован", `Тип: ${entityWorkspaceTypeLabel(typeKey)}. Объектов: ${result.data.snapshot.memberCount}.`);
    } catch (error) {
      setStatus("error", "!", "Состав не создан", error.message || "Повторите действие.");
    } finally {
      button.disabled = false;
    }
  };

  entityWorkspaceInstall();
}
