{
  const databaseAdminState = {
    tables: [],
    table: "",
    page: null,
    loadingTables: false,
    loadingRows: false,
    tableError: "",
    rowsError: "",
    limit: 50,
    offset: 0,
    sortColumn: "",
    sortDirection: "asc",
    search: "",
    rowsRequestId: 0,
    tablesRequestId: 0
  };

  const databaseAdminSensitivity = Object.freeze({
    public: ["Открытые", "is-public"],
    internal: ["Внутренние", "is-internal"],
    personal: ["Персональные", "is-personal"],
    restricted: ["Ограниченные", "is-restricted"]
  });

  function databaseAdminTarget(event) {
    return event.target instanceof Element ? event.target : null;
  }

  function databaseAdminCurrentTable() {
    return (
      databaseAdminState.tables.find(
        (table) => table.name === databaseAdminState.table
      ) || null
    );
  }

  function databaseAdminPresentation() {
    return (
      databaseAdminState.page?.presentation ||
      databaseAdminCurrentTable() || {
        label: databaseAdminState.table || "Таблица",
        category: "Служебные данные",
        description: "Описание таблицы не получено.",
        sensitivity: "restricted"
      }
    );
  }

  function databaseAdminSensitivityMarkup(value) {
    const [label, className] =
      databaseAdminSensitivity[value] || databaseAdminSensitivity.restricted;
    return `<span class="database-admin-sensitivity ${className}">${escapeHtml(
      label
    )}</span>`;
  }

  function databaseAdminEnsureView() {
    if (!views.database) {
      views.database = [
        "Локальная база данных",
        "Администрирование БД",
        "Диагностика, контролируемый экспорт и безопасное расширение модели данных.",
        null,
        null
      ];
    }
    if (!document.querySelector('[data-view="database"]')) {
      const view = document.createElement("section");
      view.className = "view database-admin-view";
      view.dataset.view = "database";
      view.setAttribute("aria-labelledby", "databaseAdminHeading");
      view.innerHTML =
        '<h2 class="visually-hidden" id="databaseAdminHeading">Администрирование базы данных</h2><div id="databaseAdminRoot" aria-live="polite"></div>';
      const settings = document.querySelector('[data-view="settings"]');
      settings?.parentElement?.insertBefore(view, settings);
    }
    const grid = document.querySelector(".management-view .management-grid");
    if (grid && !grid.querySelector('[data-view-target="database"]')) {
      const button = document.createElement("button");
      button.className = "settings-row management-tile";
      button.type = "button";
      button.dataset.viewTarget = "database";
      button.dataset.managementTone = "purple";
      button.innerHTML =
        '<span class="management-tile-icon" aria-hidden="true">▤</span><span class="management-tile-copy"><strong>Таблицы базы данных</strong><small>Диагностика, проверка целостности, журналируемый экспорт и безопасное добавление полей.</small><em>Без произвольного SQL</em></span><span class="management-chevron" aria-hidden="true">›</span>';
      grid.append(button);
    }
  }

  function databaseAdminEnsureDialogs() {
    if (!document.querySelector("#databaseAdminPropertyDialog")) {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<dialog class="create-dialog database-admin-dialog" id="databaseAdminPropertyDialog" aria-labelledby="databaseAdminPropertyTitle">
          <form id="databaseAdminPropertyForm" novalidate>
            <header class="dialog-header"><div><p class="eyebrow">Безопасное изменение модели</p><h2 id="databaseAdminPropertyTitle">Добавить поле данных</h2><p>Создаётся типизированное поле Docomator. Физические колонки SQLite и применённые миграции не изменяются.</p></div><button class="icon-button" type="button" data-database-admin-close aria-label="Закрыть">×</button></header>
            <div class="dialog-body database-admin-property-grid">
              <div class="field"><label for="databaseAdminPropertyLabel">Название <span class="required-marker">*</span></label><input id="databaseAdminPropertyLabel" type="text" maxlength="300" required placeholder="Инвентарный номер" /></div>
              <div class="field"><label for="databaseAdminPropertyType">Тип значения</label><select id="databaseAdminPropertyType"><option value="string">Короткий текст</option><option value="text">Длинный текст</option><option value="integer">Целое число</option><option value="number">Число</option><option value="boolean">Да или нет</option><option value="date">Дата</option><option value="date-time">Дата и время</option><option value="enum">Список вариантов</option></select></div>
              <div class="field"><label for="databaseAdminPropertyEntityType">Тип объектов <span class="required-marker">*</span></label><select id="databaseAdminPropertyEntityType" required data-searchable-select data-searchable-placeholder="Выберите тип"></select></div>
              <div class="field"><label for="databaseAdminPropertySensitivity">Класс данных</label><select id="databaseAdminPropertySensitivity"><option value="internal">Внутренние</option><option value="public">Открытые</option><option value="personal">Персональные</option><option value="restricted">Ограниченные</option></select></div>
              <div class="field"><label for="databaseAdminPropertyCardinality">Количество значений</label><select id="databaseAdminPropertyCardinality"><option value="single">Одно значение</option><option value="multiple">Несколько значений</option></select></div>
              <div class="field"><label for="databaseAdminPropertyUnit">Единица измерения</label><input id="databaseAdminPropertyUnit" type="text" maxlength="80" placeholder="мест, м², руб." /></div>
              <div class="field database-admin-wide"><label for="databaseAdminPropertyAliases">Названия при импорте</label><textarea id="databaseAdminPropertyAliases" maxlength="4000" placeholder="По одному варианту в строке"></textarea><small>Например: «инв. номер» и «номер имущества». Повторы будут удалены.</small></div>
              <div class="field database-admin-wide" id="databaseAdminPropertyEnumField" hidden><label for="databaseAdminPropertyEnum">Разрешённые варианты <span class="required-marker">*</span></label><textarea id="databaseAdminPropertyEnum" maxlength="8000" placeholder="По одному варианту в строке"></textarea><small>Пустые строки и повторы не сохраняются.</small></div>
              <div class="field database-admin-wide"><label for="databaseAdminPropertyDescription">Описание</label><textarea id="databaseAdminPropertyDescription" maxlength="2000"></textarea></div>
            </div>
            <div class="form-error" id="databaseAdminPropertyError" role="alert" hidden></div>
            <footer class="dialog-footer"><p class="save-explanation">Операция проходит через реестр знаний и журналируется. Прямой ALTER TABLE недоступен.</p><div><button class="secondary-button" type="button" data-database-admin-close>Отмена</button><button class="primary-button" type="submit" id="databaseAdminPropertySubmit">Создать поле</button></div></footer>
          </form>
        </dialog>`
      );
    }

    if (!document.querySelector("#databaseAdminRowDialog")) {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<dialog class="create-dialog database-admin-row-dialog" id="databaseAdminRowDialog" aria-labelledby="databaseAdminRowTitle">
          <form method="dialog">
            <header class="dialog-header"><div><p class="eyebrow" id="databaseAdminRowCategory">Запись таблицы</p><h2 id="databaseAdminRowTitle">Просмотр строки</h2><p id="databaseAdminRowDescription"></p></div><button class="icon-button" value="close" aria-label="Закрыть">×</button></header>
            <div class="dialog-body"><dl class="database-admin-row-values" id="databaseAdminRowValues"></dl><div class="database-admin-correction"><strong>Как безопасно исправить значение</strong><p>Используйте предметную карточку, повторный импорт по устойчивому идентификатору либо новую проверяемую миграцию. Прямое изменение строки здесь намеренно недоступно.</p></div></div>
            <footer class="dialog-footer"><p class="save-explanation">Технические имена показаны для диагностики.</p><div><button class="secondary-button" type="button" id="databaseAdminOpenSubject" hidden>Открыть предметный раздел</button><button class="primary-button" value="close">Закрыть</button></div></footer>
          </form>
        </dialog>`
      );
    }

    document.querySelectorAll("[data-database-admin-close]").forEach((button) => {
      if (button.dataset.databaseAdminBound === "true") return;
      button.dataset.databaseAdminBound = "true";
      button.addEventListener("click", () =>
        document.querySelector("#databaseAdminPropertyDialog")?.close()
      );
    });
    const propertyForm = document.querySelector("#databaseAdminPropertyForm");
    if (propertyForm && propertyForm.dataset.databaseAdminBound !== "true") {
      propertyForm.dataset.databaseAdminBound = "true";
      propertyForm.addEventListener("submit", databaseAdminCreateProperty);
    }
    const propertyType = document.querySelector("#databaseAdminPropertyType");
    if (propertyType && propertyType.dataset.databaseAdminBound !== "true") {
      propertyType.dataset.databaseAdminBound = "true";
      propertyType.addEventListener("change", databaseAdminSyncPropertyType);
    }
    const openSubject = document.querySelector("#databaseAdminOpenSubject");
    if (openSubject && openSubject.dataset.databaseAdminBound !== "true") {
      openSubject.dataset.databaseAdminBound = "true";
      openSubject.addEventListener("click", () => {
        const view = openSubject.dataset.viewTarget;
        document.querySelector("#databaseAdminRowDialog")?.close();
        if (view) globalThis.docomatorSelectView?.(view);
      });
    }
  }

  function databaseAdminSyncPropertyType() {
    const valueType = document.querySelector("#databaseAdminPropertyType")?.value;
    const field = document.querySelector("#databaseAdminPropertyEnumField");
    if (field) field.hidden = valueType !== "enum";
  }

  function databaseAdminEnsureShell() {
    databaseAdminEnsureView();
    const root = document.querySelector("#databaseAdminRoot");
    if (!root || root.querySelector("[data-database-admin-shell]")) return root;
    root.innerHTML = `
      <div data-database-admin-shell>
        <section class="section-intro database-admin-intro"><div><p class="eyebrow">Восстановление и аудит</p><h2>Таблицы базы данных</h2><p>Просматривайте фактические строки, проверяйте целостность и выгружайте данные. Экспорт записывается в журнал действий; произвольный SQL и изменение физической схемы запрещены.</p></div><div class="database-admin-actions"><button class="secondary-button" type="button" data-db-admin-action="reload">Обновить список</button><button class="secondary-button" type="button" data-db-admin-action="check">Проверить целостность</button><button class="primary-button" type="button" data-db-admin-action="property">Добавить поле данных</button></div></section>
        <article class="panel database-admin-toolbar">
          <label class="generation-field database-admin-table-field"><span>Таблица</span><select id="databaseAdminTable" data-searchable-select data-searchable-placeholder="Выберите таблицу" data-searchable-search-placeholder="Найти таблицу"></select></label>
          <form class="database-admin-search" id="databaseAdminSearchForm"><label class="search-field" for="databaseAdminSearch"><span aria-hidden="true">⌕</span><input id="databaseAdminSearch" type="search" maxlength="300" placeholder="Поиск по первым 20 колонкам" /></label><button class="secondary-button" type="submit">Найти</button><button class="quiet-button" type="button" data-db-admin-action="clear-search">Очистить</button></form>
          <label class="generation-field"><span>Сортировать по</span><select id="databaseAdminSort"></select></label>
          <label class="generation-field"><span>Направление</span><select id="databaseAdminDirection"><option value="asc">По возрастанию</option><option value="desc">По убыванию</option></select></label>
          <label class="generation-field"><span>Строк на странице</span><select id="databaseAdminLimit"><option value="25">25</option><option value="50">50</option><option value="100">100</option><option value="200">200</option></select></label>
          <div class="database-admin-export"><button class="secondary-button" type="button" data-db-admin-export="csv">Экспорт CSV</button><button class="secondary-button" type="button" data-db-admin-export="json">Экспорт JSON</button></div>
        </article>
        <section class="database-admin-context" id="databaseAdminContext" aria-live="polite"></section>
        <div id="databaseAdminCheck" class="database-admin-check" hidden></div>
        <div id="databaseAdminRowsRegion" aria-live="polite" aria-busy="false"></div>
      </div>`;
    globalThis.docomatorSearchableSelect?.enhanceAll?.(root);
    return root;
  }

  function databaseAdminTableOptions() {
    return databaseAdminState.tables
      .map((table) => {
        const label = `${table.category} — ${table.label} · ${table.rowCount} строк [${table.name}]`;
        return `<option value="${escapeHtml(table.name)}"${
          table.name === databaseAdminState.table ? " selected" : ""
        }>${escapeHtml(label)}</option>`;
      })
      .join("");
  }

  function databaseAdminColumnOptions() {
    return (databaseAdminState.page?.columns || [])
      .map(
        (column) =>
          `<option value="${escapeHtml(column.name)}"${
            column.name === databaseAdminState.sortColumn ? " selected" : ""
          }>${escapeHtml(column.name)}</option>`
      )
      .join("");
  }

  function databaseAdminRenderControls() {
    const table = document.querySelector("#databaseAdminTable");
    const tableOptions = databaseAdminTableOptions();
    if (table && table.innerHTML !== tableOptions) {
      table.innerHTML = tableOptions;
      table.value = databaseAdminState.table;
      globalThis.docomatorSearchableSelect?.refresh?.(table);
    }

    const sort = document.querySelector("#databaseAdminSort");
    if (sort) {
      const columnOptions = databaseAdminColumnOptions();
      if (sort.innerHTML !== columnOptions) sort.innerHTML = columnOptions;
      sort.value = databaseAdminState.sortColumn;
    }
    const direction = document.querySelector("#databaseAdminDirection");
    if (direction) direction.value = databaseAdminState.sortDirection;
    const limit = document.querySelector("#databaseAdminLimit");
    if (limit) limit.value = String(databaseAdminState.limit);
    const search = document.querySelector("#databaseAdminSearch");
    if (search && document.activeElement !== search) {
      search.value = databaseAdminState.search;
    }

    const disabled = databaseAdminState.loadingRows || !databaseAdminState.table;
    document
      .querySelectorAll(
        "#databaseAdminSort, #databaseAdminDirection, #databaseAdminLimit, [data-db-admin-export]"
      )
      .forEach((control) => {
        control.disabled = disabled;
      });
  }

  function databaseAdminRenderContext() {
    const root = document.querySelector("#databaseAdminContext");
    if (!root) return;
    if (!databaseAdminState.table) {
      root.innerHTML = "";
      root.hidden = true;
      return;
    }
    const presentation = databaseAdminPresentation();
    root.hidden = false;
    root.innerHTML = `<div><p class="eyebrow">${escapeHtml(
      presentation.category
    )}</p><h3>${escapeHtml(presentation.label)}</h3><p>${escapeHtml(
      presentation.description
    )}</p></div><div class="database-admin-context-meta">${databaseAdminSensitivityMarkup(
      presentation.sensitivity
    )}<code>${escapeHtml(databaseAdminState.table)}</code></div>`;
  }

  function databaseAdminSubjectView(table) {
    if (
      table === "entities" ||
      table === "entity_property_values" ||
      table.startsWith("employee_")
    ) {
      return ["employees", "Открыть сотрудников"];
    }
    if (
      table === "spaces" ||
      table.startsWith("space_") ||
      table.startsWith("audience_")
    ) {
      return ["spaces", "Открыть разделы и группы"];
    }
    if (table.startsWith("template_") || table === "document_quarantine_records") {
      return ["templates", "Открыть шаблоны"];
    }
    if (table === "document_schedules" || table === "document_schedule_runs") {
      return ["automations", "Открыть расписания"];
    }
    if (table.startsWith("document_")) {
      return ["documents", "Открыть результаты"];
    }
    if (table === "property_definitions" || table === "entity_types") {
      return ["knowledge", "Открыть поля и справочники"];
    }
    return null;
  }

  function databaseAdminRowsMarkup(page) {
    const columns = page.columns;
    const from = page.total === 0 ? 0 : page.offset + 1;
    const to = Math.min(page.total, page.offset + page.rows.length);
    const progress = databaseAdminState.loadingRows
      ? '<div class="database-admin-progress" role="status"><span class="state-mark" aria-hidden="true"></span><span>Обновляем строки…</span></div>'
      : "";
    return `${progress}<section class="panel database-admin-data${
      databaseAdminState.loadingRows ? " is-updating" : ""
    }"><div class="database-admin-data-heading"><div><h3>${escapeHtml(
      page.presentation?.label || page.table
    )}</h3><p>Показано ${from}–${to} из ${page.total}. Бинарные значения отображаются только размером.</p></div><span class="pill">${
      columns.length
    } колонок</span></div><div class="database-admin-table-wrap"><table class="database-admin-table"><thead><tr><th class="database-admin-row-action-heading"><span>Запись</span><small>Подробности</small></th>${columns
      .map(
        (column) =>
          `<th><button type="button" data-db-admin-sort="${escapeHtml(
            column.name
          )}">${escapeHtml(column.name)}${
            column.name === page.sortColumn
              ? `<span aria-hidden="true">${
                  page.sortDirection === "asc" ? " ↑" : " ↓"
                }</span>`
              : ""
          }</button><small>${escapeHtml(column.type || "без типа")}${
            column.primaryKeyPosition ? " · ключ" : ""
          }</small></th>`
      )
      .join("")}</tr></thead><tbody>${
      page.rows.length
        ? page.rows
            .map(
              (row, rowIndex) =>
                `<tr><td class="database-admin-row-action"><button class="text-button" type="button" data-db-admin-row="${rowIndex}">Открыть</button></td>${columns
                  .map(
                    (column) =>
                      `<td>${
                        row[column.name] === null
                          ? '<span class="database-admin-null">NULL</span>'
                          : escapeHtml(String(row[column.name]))
                      }</td>`
                  )
                  .join("")}</tr>`
            )
            .join("")
        : `<tr><td colspan="${columns.length + 1}">Строки не найдены.</td></tr>`
    }</tbody></table></div><footer class="database-admin-pagination"><button class="secondary-button" type="button" data-db-admin-page="previous"${
      page.offset === 0 || databaseAdminState.loadingRows ? " disabled" : ""
    }>← Назад</button><span>${from}–${to} из ${page.total}</span><button class="secondary-button" type="button" data-db-admin-page="next"${
      to >= page.total || databaseAdminState.loadingRows ? " disabled" : ""
    }>Далее →</button></footer></section><details class="database-admin-guidance"><summary>Как исправлять найденные значения</summary><p>Панель предназначена для просмотра и диагностики. Исправляйте карточки через предметные экраны, повторный CSV/XLSX-импорт по устойчивому идентификатору либо отдельную проверяемую миграцию. Перед массовым исправлением создайте резервную копию.</p></details>`;
  }

  function databaseAdminRenderRows() {
    const root = document.querySelector("#databaseAdminRowsRegion");
    if (!root) return;
    root.setAttribute("aria-busy", String(databaseAdminState.loadingRows));
    if (databaseAdminState.rowsError) {
      root.innerHTML = `<div class="employee-state is-error"><span class="state-mark" aria-hidden="true"></span><div><strong>Строки не получены</strong><p>${escapeHtml(
        databaseAdminState.rowsError
      )}</p></div><button class="secondary-button" type="button" data-db-admin-action="retry-rows">Повторить</button></div>`;
      return;
    }
    if (!databaseAdminState.page) {
      root.innerHTML = databaseAdminState.loadingRows
        ? '<div class="employee-state is-loading"><span class="state-mark" aria-hidden="true"></span><div><strong>Получаем строки</strong><p>Запрос выполняется только к выбранной таблице.</p></div></div>'
        : '<div class="employee-state"><span class="state-mark" aria-hidden="true"></span><div><strong>Выберите таблицу</strong><p>После выбора появятся колонки и первые строки.</p></div></div>';
      return;
    }
    root.innerHTML = databaseAdminRowsMarkup(databaseAdminState.page);
  }

  function databaseAdminRender() {
    const root = databaseAdminEnsureShell();
    if (!root) return;
    if (databaseAdminState.loadingTables && databaseAdminState.tables.length === 0) {
      root.innerHTML =
        '<div class="employee-state is-loading"><span class="state-mark" aria-hidden="true"></span><div><strong>Получаем структуру базы</strong><p>Чтение выполняется без изменения данных.</p></div></div>';
      return;
    }
    if (databaseAdminState.tableError && databaseAdminState.tables.length === 0) {
      root.innerHTML = `<div class="employee-state is-error"><span class="state-mark" aria-hidden="true"></span><div><strong>Таблицы не получены</strong><p>${escapeHtml(
        databaseAdminState.tableError
      )}</p></div><button class="secondary-button" type="button" data-db-admin-action="reload">Повторить</button></div>`;
      return;
    }
    if (!root.querySelector("[data-database-admin-shell]")) {
      root.innerHTML = "";
      databaseAdminEnsureShell();
    }
    databaseAdminRenderControls();
    databaseAdminRenderContext();
    databaseAdminRenderRows();
  }

  async function databaseAdminLoadTables(force = false) {
    if (databaseAdminState.loadingTables) return;
    if (!force && databaseAdminState.tables.length > 0) {
      await databaseAdminRefreshRows();
      return;
    }
    const requestId = ++databaseAdminState.tablesRequestId;
    databaseAdminState.loadingTables = true;
    databaseAdminState.tableError = "";
    databaseAdminRender();
    try {
      const body = await api("/api/v1/admin/database/tables");
      if (requestId !== databaseAdminState.tablesRequestId) return;
      databaseAdminState.tables = Array.isArray(body.data) ? body.data : [];
      if (
        !databaseAdminState.tables.some(
          (table) => table.name === databaseAdminState.table
        )
      ) {
        databaseAdminState.table =
          databaseAdminState.tables.find((table) => table.name === "entities")
            ?.name || databaseAdminState.tables[0]?.name || "";
        databaseAdminState.sortColumn = "";
        databaseAdminState.offset = 0;
      }
    } catch (error) {
      if (requestId !== databaseAdminState.tablesRequestId) return;
      databaseAdminState.tables = [];
      databaseAdminState.page = null;
      databaseAdminState.tableError =
        error.message || "Проверьте состояние локального сервера.";
      setStatus(
        "error",
        "!",
        "База данных не открыта",
        databaseAdminState.tableError
      );
    } finally {
      if (requestId === databaseAdminState.tablesRequestId) {
        databaseAdminState.loadingTables = false;
        databaseAdminRender();
      }
    }
    if (requestId === databaseAdminState.tablesRequestId && databaseAdminState.table) {
      await databaseAdminRefreshRows();
    }
  }

  async function databaseAdminRefreshRows() {
    if (!databaseAdminState.table) return;
    const requestId = ++databaseAdminState.rowsRequestId;
    const table = databaseAdminState.table;
    databaseAdminState.loadingRows = true;
    databaseAdminState.rowsError = "";
    databaseAdminRender();
    const query = new URLSearchParams({
      limit: String(databaseAdminState.limit),
      offset: String(databaseAdminState.offset),
      sortDirection: databaseAdminState.sortDirection
    });
    if (databaseAdminState.sortColumn) {
      query.set("sortColumn", databaseAdminState.sortColumn);
    }
    if (databaseAdminState.search) query.set("search", databaseAdminState.search);
    try {
      const body = await api(
        `/api/v1/admin/database/tables/${encodeURIComponent(table)}/rows?${query}`
      );
      if (
        requestId !== databaseAdminState.rowsRequestId ||
        table !== databaseAdminState.table
      ) {
        return;
      }
      databaseAdminState.page = body.data;
      databaseAdminState.sortColumn = body.data.sortColumn;
      databaseAdminState.sortDirection = body.data.sortDirection;
    } catch (error) {
      if (
        requestId !== databaseAdminState.rowsRequestId ||
        table !== databaseAdminState.table
      ) {
        return;
      }
      databaseAdminState.rowsError =
        error.message || "Проверьте локальный сервер и повторите действие.";
      setStatus(
        "error",
        "!",
        "Строки не получены",
        databaseAdminState.rowsError
      );
    } finally {
      if (
        requestId === databaseAdminState.rowsRequestId &&
        table === databaseAdminState.table
      ) {
        databaseAdminState.loadingRows = false;
        databaseAdminRender();
      }
    }
  }

  async function databaseAdminCheck() {
    const root = document.querySelector("#databaseAdminCheck");
    if (!root) return;
    root.hidden = false;
    root.className = "database-admin-check is-loading";
    root.textContent = "Проверяем SQLite и внешние ключи…";
    try {
      const body = await api("/api/v1/admin/database/check");
      root.className = `database-admin-check is-${
        body.data.status === "ok" ? "success" : "error"
      }`;
      root.textContent =
        body.data.status === "ok"
          ? "Целостность SQLite и внешние ключи в порядке."
          : `Найдены проблемы: ${body.data.messages.join(
              "; "
            )}; нарушений внешних ключей: ${body.data.foreignKeyErrors}.`;
    } catch (error) {
      root.className = "database-admin-check is-error";
      root.textContent = error.message || "Проверка не выполнена.";
    }
  }

  function databaseAdminExport(format) {
    if (!databaseAdminState.table) return;
    const query = new URLSearchParams({
      format,
      limit: "10000",
      sortDirection: databaseAdminState.sortDirection
    });
    if (databaseAdminState.sortColumn) {
      query.set("sortColumn", databaseAdminState.sortColumn);
    }
    if (databaseAdminState.search) query.set("search", databaseAdminState.search);
    const anchor = document.createElement("a");
    anchor.href = `/api/v1/admin/database/tables/${encodeURIComponent(
      databaseAdminState.table
    )}/export?${query}`;
    anchor.download = "";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    const presentation = databaseAdminPresentation();
    notify(
      "↓",
      "Экспорт начат",
      `${presentation.label}: формат ${format.toUpperCase()}. Операция будет записана в журнал.`
    );
  }

  function databaseAdminOpenRow(index) {
    const page = databaseAdminState.page;
    const row = page?.rows?.[index];
    if (!page || !row) return;
    databaseAdminEnsureDialogs();
    const presentation = page.presentation || databaseAdminPresentation();
    const title = document.querySelector("#databaseAdminRowTitle");
    const category = document.querySelector("#databaseAdminRowCategory");
    const description = document.querySelector("#databaseAdminRowDescription");
    const values = document.querySelector("#databaseAdminRowValues");
    if (title) title.textContent = presentation.label;
    if (category) category.textContent = presentation.category;
    if (description) {
      description.textContent = `Таблица ${page.table}. Строка ${page.offset + index + 1}.`;
    }
    if (values) {
      values.innerHTML = page.columns
        .map((column) => {
          const value = row[column.name];
          return `<div><dt><strong>${escapeHtml(
            column.name
          )}</strong><small>${escapeHtml(column.type || "без типа")}${
            column.primaryKeyPosition ? " · ключ" : ""
          }</small></dt><dd>${
            value === null
              ? '<span class="database-admin-null">NULL</span>'
              : `<pre>${escapeHtml(String(value))}</pre>`
          }</dd></div>`;
        })
        .join("");
    }
    const subject = databaseAdminSubjectView(page.table);
    const subjectButton = document.querySelector("#databaseAdminOpenSubject");
    if (subjectButton) {
      subjectButton.hidden = !subject;
      if (subject) {
        subjectButton.dataset.viewTarget = subject[0];
        subjectButton.textContent = subject[1];
      } else {
        delete subjectButton.dataset.viewTarget;
      }
    }
    document.querySelector("#databaseAdminRowDialog")?.showModal();
  }

  function databaseAdminOpenProperty() {
    databaseAdminEnsureDialogs();
    const form = document.querySelector("#databaseAdminPropertyForm");
    form?.reset();
    const select = document.querySelector("#databaseAdminPropertyEntityType");
    if (select) {
      select.innerHTML = state.data.types
        .map(
          (type) =>
            `<option value="${escapeHtml(type.key)}">${escapeHtml(
              type.label
            )}</option>`
        )
        .join("");
      globalThis.docomatorSearchableSelect?.refresh?.(select);
    }
    const error = document.querySelector("#databaseAdminPropertyError");
    if (error) error.hidden = true;
    databaseAdminSyncPropertyType();
    document.querySelector("#databaseAdminPropertyDialog")?.showModal();
    document.querySelector("#databaseAdminPropertyLabel")?.focus();
  }

  function databaseAdminLines(selector) {
    const value = document.querySelector(selector)?.value || "";
    return [
      ...new Set(
        value
          .split(/\r?\n|,/u)
          .map((item) => item.normalize("NFKC").trim())
          .filter(Boolean)
      )
    ];
  }

  async function databaseAdminCreateProperty(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorBox = document.querySelector("#databaseAdminPropertyError");
    const submit = document.querySelector("#databaseAdminPropertySubmit");
    if (!form.reportValidity() || !errorBox) return;
    const valueType = document.querySelector("#databaseAdminPropertyType")?.value;
    const enumValues = databaseAdminLines("#databaseAdminPropertyEnum");
    if (valueType === "enum" && enumValues.length === 0) {
      errorBox.hidden = false;
      errorBox.textContent =
        "Для поля со списком укажите хотя бы один разрешённый вариант.";
      document.querySelector("#databaseAdminPropertyEnum")?.focus();
      return;
    }
    errorBox.hidden = true;
    if (submit) submit.disabled = true;
    try {
      await api("/api/v1/admin/database/properties", {
        method: "POST",
        body: JSON.stringify({
          label: document
            .querySelector("#databaseAdminPropertyLabel")
            .value.trim(),
          valueType,
          appliesTo: [
            document.querySelector("#databaseAdminPropertyEntityType").value
          ],
          sensitivity: document.querySelector(
            "#databaseAdminPropertySensitivity"
          ).value,
          cardinality: document.querySelector(
            "#databaseAdminPropertyCardinality"
          ).value,
          unit:
            document.querySelector("#databaseAdminPropertyUnit").value.trim() ||
            undefined,
          description:
            document
              .querySelector("#databaseAdminPropertyDescription")
              .value.trim() || undefined,
          aliases: databaseAdminLines("#databaseAdminPropertyAliases"),
          validation: valueType === "enum" ? { enum: enumValues } : {}
        })
      });
      document.querySelector("#databaseAdminPropertyDialog")?.close();
      await loadData();
      databaseAdminState.tables = [];
      await databaseAdminLoadTables(true);
      notify(
        "✓",
        "Поле создано",
        "Физическая схема SQLite не изменялась; поле добавлено в типизированную модель Docomator."
      );
    } catch (error) {
      errorBox.hidden = false;
      errorBox.textContent = error.message || "Поле создать не удалось.";
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function databaseAdminEvents() {
    document.addEventListener("click", (event) => {
      const target = databaseAdminTarget(event);
      if (!target) return;
      const action = target.closest("[data-db-admin-action]")?.dataset
        .dbAdminAction;
      if (action === "reload") void databaseAdminLoadTables(true);
      if (action === "retry-rows") void databaseAdminRefreshRows();
      if (action === "check") void databaseAdminCheck();
      if (action === "property") databaseAdminOpenProperty();
      if (action === "clear-search") {
        const search = document.querySelector("#databaseAdminSearch");
        if (search) search.value = "";
        databaseAdminState.search = "";
        databaseAdminState.offset = 0;
        void databaseAdminRefreshRows();
      }
      const exportFormat = target.closest("[data-db-admin-export]")?.dataset
        .dbAdminExport;
      if (exportFormat) databaseAdminExport(exportFormat);
      const sort = target.closest("[data-db-admin-sort]")?.dataset.dbAdminSort;
      if (sort) {
        databaseAdminState.sortDirection =
          databaseAdminState.sortColumn === sort &&
          databaseAdminState.sortDirection === "asc"
            ? "desc"
            : "asc";
        databaseAdminState.sortColumn = sort;
        databaseAdminState.offset = 0;
        void databaseAdminRefreshRows();
      }
      const page = target.closest("[data-db-admin-page]")?.dataset.dbAdminPage;
      if (page) {
        databaseAdminState.offset = Math.max(
          0,
          databaseAdminState.offset +
            (page === "next"
              ? databaseAdminState.limit
              : -databaseAdminState.limit)
        );
        void databaseAdminRefreshRows();
      }
      const row = target.closest("[data-db-admin-row]")?.dataset.dbAdminRow;
      if (row !== undefined) databaseAdminOpenRow(Number(row));
    });

    document.addEventListener("submit", (event) => {
      if (!event.target.matches("#databaseAdminSearchForm")) return;
      event.preventDefault();
      databaseAdminState.search =
        document.querySelector("#databaseAdminSearch")?.value.trim() || "";
      databaseAdminState.offset = 0;
      void databaseAdminRefreshRows();
    });

    document.addEventListener("change", (event) => {
      const target = databaseAdminTarget(event);
      if (!target) return;
      if (target.matches("#databaseAdminTable")) {
        databaseAdminState.rowsRequestId += 1;
        databaseAdminState.table = target.value;
        databaseAdminState.page = null;
        databaseAdminState.sortColumn = "";
        databaseAdminState.offset = 0;
        databaseAdminState.rowsError = "";
        void databaseAdminRefreshRows();
      }
      if (target.matches("#databaseAdminSort")) {
        databaseAdminState.sortColumn = target.value;
        databaseAdminState.offset = 0;
        void databaseAdminRefreshRows();
      }
      if (target.matches("#databaseAdminDirection")) {
        databaseAdminState.sortDirection = target.value;
        databaseAdminState.offset = 0;
        void databaseAdminRefreshRows();
      }
      if (target.matches("#databaseAdminLimit")) {
        databaseAdminState.limit = Number(target.value);
        databaseAdminState.offset = 0;
        void databaseAdminRefreshRows();
      }
    });

    window.addEventListener("docomator:view-changed", (event) => {
      if (event.detail?.view === "database") void databaseAdminLoadTables();
    });
  }

  databaseAdminEnsureView();
  databaseAdminEnsureDialogs();
  databaseAdminEvents();
}
