{
  const databaseAdminState = {
    tables: [],
    table: "",
    page: null,
    loading: false,
    limit: 50,
    offset: 0,
    sortColumn: "",
    sortDirection: "asc",
    search: ""
  };

  function databaseAdminEnsureView() {
    if (!views.database) {
      views.database = [
        "Локальная база данных",
        "Администрирование БД",
        "Безопасный просмотр, сортировка, проверка и экспорт без произвольного SQL.",
        null,
        null
      ];
    }
    if (!document.querySelector('[data-view="database"]')) {
      const view = document.createElement("section");
      view.className = "view database-admin-view";
      view.dataset.view = "database";
      view.setAttribute("aria-labelledby", "databaseAdminHeading");
      view.innerHTML = '<h2 class="visually-hidden" id="databaseAdminHeading">Администрирование базы данных</h2><div id="databaseAdminRoot" aria-live="polite"></div>';
      const settings = document.querySelector('[data-view="settings"]');
      settings?.parentElement?.insertBefore(view, settings);
    }
    const grid = document.querySelector('.management-view .management-grid');
    if (grid && !grid.querySelector('[data-view-target="database"]')) {
      const button = document.createElement("button");
      button.className = "settings-row management-tile";
      button.type = "button";
      button.dataset.viewTarget = "database";
      button.dataset.managementTone = "purple";
      button.innerHTML = '<span class="management-tile-icon" aria-hidden="true">▤</span><span class="management-tile-copy"><strong>Таблицы базы данных</strong><small>Просмотр, сортировка, контроль целостности, экспорт и безопасное добавление полей.</small><em>Без произвольного SQL</em></span><span class="management-chevron" aria-hidden="true">›</span>';
      grid.append(button);
    }
  }

  function databaseAdminEnsureDialog() {
    if (document.querySelector("#databaseAdminPropertyDialog")) return;
    document.body.insertAdjacentHTML(
      "beforeend",
      `<dialog class="create-dialog database-admin-dialog" id="databaseAdminPropertyDialog" aria-labelledby="databaseAdminPropertyTitle">
        <form id="databaseAdminPropertyForm" novalidate>
          <header class="dialog-header"><div><p class="eyebrow">Безопасное изменение модели</p><h2 id="databaseAdminPropertyTitle">Добавить поле данных</h2><p>Создаётся типизированное поле Docomator. Физические колонки SQLite и применённые миграции не изменяются.</p></div><button class="icon-button" type="button" data-database-admin-close aria-label="Закрыть">×</button></header>
          <div class="dialog-body database-admin-property-grid">
            <div class="field"><label for="databaseAdminPropertyLabel">Название <span class="required-marker">*</span></label><input id="databaseAdminPropertyLabel" type="text" maxlength="300" required placeholder="Инвентарный номер" /></div>
            <div class="field"><label for="databaseAdminPropertyType">Тип значения</label><select id="databaseAdminPropertyType"><option value="string">Короткий текст</option><option value="text">Длинный текст</option><option value="integer">Целое число</option><option value="number">Число</option><option value="boolean">Да или нет</option><option value="date">Дата</option><option value="date-time">Дата и время</option><option value="enum">Список вариантов</option></select></div>
            <div class="field"><label for="databaseAdminPropertyEntityType">Тип объектов</label><select id="databaseAdminPropertyEntityType" data-searchable-select data-searchable-placeholder="Выберите тип"></select></div>
            <div class="field"><label for="databaseAdminPropertySensitivity">Класс данных</label><select id="databaseAdminPropertySensitivity"><option value="internal">Внутренние</option><option value="public">Открытые</option><option value="personal">Персональные</option><option value="restricted">Ограниченные</option></select></div>
            <div class="field"><label for="databaseAdminPropertyUnit">Единица измерения</label><input id="databaseAdminPropertyUnit" type="text" maxlength="80" placeholder="мест, м², руб." /></div>
            <div class="field"><label for="databaseAdminPropertyDescription">Описание</label><textarea id="databaseAdminPropertyDescription" maxlength="2000"></textarea></div>
          </div>
          <div class="form-error" id="databaseAdminPropertyError" role="alert" hidden></div>
          <footer class="dialog-footer"><p class="save-explanation">Операция проходит через реестр знаний и журналируется. Прямой ALTER TABLE недоступен.</p><div><button class="secondary-button" type="button" data-database-admin-close>Отмена</button><button class="primary-button" type="submit">Создать поле</button></div></footer>
        </form>
      </dialog>`
    );
    document.querySelectorAll("[data-database-admin-close]").forEach((button) =>
      button.addEventListener("click", () =>
        document.querySelector("#databaseAdminPropertyDialog")?.close()
      )
    );
    document.querySelector("#databaseAdminPropertyForm")?.addEventListener(
      "submit",
      databaseAdminCreateProperty
    );
  }

  function databaseAdminTableOptions() {
    return databaseAdminState.tables
      .map(
        (table) =>
          `<option value="${escapeHtml(table.name)}"${table.name === databaseAdminState.table ? " selected" : ""}>${escapeHtml(table.name)} · ${table.rowCount} строк</option>`
      )
      .join("");
  }

  function databaseAdminColumnOptions() {
    return (databaseAdminState.page?.columns || [])
      .map(
        (column) =>
          `<option value="${escapeHtml(column.name)}"${column.name === databaseAdminState.sortColumn ? " selected" : ""}>${escapeHtml(column.name)}</option>`
      )
      .join("");
  }

  function databaseAdminRender() {
    databaseAdminEnsureView();
    const root = document.querySelector("#databaseAdminRoot");
    if (!root) return;
    if (databaseAdminState.loading && databaseAdminState.tables.length === 0) {
      root.innerHTML = '<div class="employee-state is-loading"><span class="state-mark" aria-hidden="true"></span><div><strong>Получаем структуру базы</strong><p>Чтение выполняется без изменения данных.</p></div></div>';
      return;
    }
    if (databaseAdminState.tables.length === 0) {
      root.innerHTML = '<div class="employee-state is-error"><span class="state-mark" aria-hidden="true"></span><div><strong>Таблицы не получены</strong><p>Проверьте состояние локального сервера.</p></div><button class="secondary-button" type="button" data-db-admin-action="reload">Повторить</button></div>';
      return;
    }
    const page = databaseAdminState.page;
    root.innerHTML = `
      <section class="section-intro database-admin-intro"><div><p class="eyebrow">Восстановление и аудит</p><h2>Таблицы базы данных</h2><p>Инструмент показывает строки только для диагностики и экспорта. Добавление поля выполняется через модель данных Docomator; произвольный SQL и изменение физической схемы запрещены.</p></div><div class="database-admin-actions"><button class="secondary-button" type="button" data-db-admin-action="check">Проверить целостность</button><button class="primary-button" type="button" data-db-admin-action="property">Добавить поле данных</button></div></section>
      <article class="panel database-admin-toolbar">
        <label class="generation-field"><span>Таблица</span><select id="databaseAdminTable" data-searchable-select data-searchable-placeholder="Выберите таблицу" data-searchable-search-placeholder="Найти таблицу">${databaseAdminTableOptions()}</select></label>
        <label class="search-field"><span aria-hidden="true">⌕</span><input id="databaseAdminSearch" type="search" placeholder="Поиск по первым 20 колонкам" value="${escapeHtml(databaseAdminState.search)}" /></label>
        <label class="generation-field"><span>Сортировать по</span><select id="databaseAdminSort">${databaseAdminColumnOptions()}</select></label>
        <label class="generation-field"><span>Направление</span><select id="databaseAdminDirection"><option value="asc"${databaseAdminState.sortDirection === "asc" ? " selected" : ""}>По возрастанию</option><option value="desc"${databaseAdminState.sortDirection === "desc" ? " selected" : ""}>По убыванию</option></select></label>
        <label class="generation-field"><span>Строк на странице</span><select id="databaseAdminLimit"><option value="25"${databaseAdminState.limit === 25 ? " selected" : ""}>25</option><option value="50"${databaseAdminState.limit === 50 ? " selected" : ""}>50</option><option value="100"${databaseAdminState.limit === 100 ? " selected" : ""}>100</option><option value="200"${databaseAdminState.limit === 200 ? " selected" : ""}>200</option></select></label>
        <div class="database-admin-export"><button class="secondary-button" type="button" data-db-admin-export="csv">Экспорт CSV</button><button class="secondary-button" type="button" data-db-admin-export="json">Экспорт JSON</button></div>
      </article>
      <div id="databaseAdminCheck" class="database-admin-check" hidden></div>
      ${page ? databaseAdminRowsMarkup(page) : '<div class="employee-state is-loading"><span class="state-mark" aria-hidden="true"></span><div><strong>Получаем строки</strong></div></div>'}`;
    globalThis.docomatorSearchableSelect?.enhanceAll?.(root);
  }

  function databaseAdminRowsMarkup(page) {
    const columns = page.columns;
    const from = page.total === 0 ? 0 : page.offset + 1;
    const to = Math.min(page.total, page.offset + page.rows.length);
    return `<section class="panel database-admin-data"><div class="database-admin-data-heading"><div><h3>${escapeHtml(page.table)}</h3><p>Показано ${from}–${to} из ${page.total}. Бинарные значения отображаются только размером.</p></div><span class="pill">${columns.length} колонок</span></div><div class="database-admin-table-wrap"><table class="database-admin-table"><thead><tr>${columns.map((column) => `<th><button type="button" data-db-admin-sort="${escapeHtml(column.name)}">${escapeHtml(column.name)}${column.name === page.sortColumn ? `<span aria-hidden="true">${page.sortDirection === "asc" ? " ↑" : " ↓"}</span>` : ""}</button><small>${escapeHtml(column.type || "без типа")}${column.primaryKeyPosition ? " · ключ" : ""}</small></th>`).join("")}</tr></thead><tbody>${page.rows.length ? page.rows.map((row) => `<tr>${columns.map((column) => `<td>${row[column.name] === null ? '<span class="database-admin-null">NULL</span>' : escapeHtml(String(row[column.name]))}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${columns.length}">Строки не найдены.</td></tr>`}</tbody></table></div><footer class="database-admin-pagination"><button class="secondary-button" type="button" data-db-admin-page="previous"${page.offset === 0 ? " disabled" : ""}>← Назад</button><span>${from}–${to} из ${page.total}</span><button class="secondary-button" type="button" data-db-admin-page="next"${to >= page.total ? " disabled" : ""}>Далее →</button></footer></section>`;
  }

  async function databaseAdminLoadTables() {
    if (databaseAdminState.loading) return;
    databaseAdminState.loading = true;
    databaseAdminRender();
    try {
      const body = await api("/api/v1/admin/database/tables");
      databaseAdminState.tables = body.data || [];
      if (!databaseAdminState.tables.some((table) => table.name === databaseAdminState.table)) {
        databaseAdminState.table = databaseAdminState.tables.find((table) => table.name === "entities")?.name || databaseAdminState.tables[0]?.name || "";
      }
      await databaseAdminLoadRows();
    } catch (error) {
      databaseAdminState.tables = [];
      setStatus("error", "!", "База данных не открыта", error.message || "Повторите действие.");
    } finally {
      databaseAdminState.loading = false;
      databaseAdminRender();
    }
  }

  async function databaseAdminLoadRows() {
    if (!databaseAdminState.table) return;
    const query = new URLSearchParams({
      limit: String(databaseAdminState.limit),
      offset: String(databaseAdminState.offset),
      sortDirection: databaseAdminState.sortDirection
    });
    if (databaseAdminState.sortColumn) query.set("sortColumn", databaseAdminState.sortColumn);
    if (databaseAdminState.search) query.set("search", databaseAdminState.search);
    const body = await api(`/api/v1/admin/database/tables/${encodeURIComponent(databaseAdminState.table)}/rows?${query}`);
    databaseAdminState.page = body.data;
    databaseAdminState.sortColumn = body.data.sortColumn;
    databaseAdminState.sortDirection = body.data.sortDirection;
  }

  async function databaseAdminRefreshRows() {
    databaseAdminState.loading = true;
    databaseAdminRender();
    try {
      await databaseAdminLoadRows();
    } catch (error) {
      setStatus("error", "!", "Строки не получены", error.message || "Повторите действие.");
    } finally {
      databaseAdminState.loading = false;
      databaseAdminRender();
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
      root.className = `database-admin-check is-${body.data.status === "ok" ? "success" : "error"}`;
      root.textContent = body.data.status === "ok"
        ? "Целостность SQLite и внешние ключи в порядке."
        : `Найдены проблемы: ${body.data.messages.join("; ")}; нарушений внешних ключей: ${body.data.foreignKeyErrors}.`;
    } catch (error) {
      root.className = "database-admin-check is-error";
      root.textContent = error.message || "Проверка не выполнена.";
    }
  }

  function databaseAdminExport(format) {
    const query = new URLSearchParams({
      format,
      limit: "10000",
      sortDirection: databaseAdminState.sortDirection
    });
    if (databaseAdminState.sortColumn) query.set("sortColumn", databaseAdminState.sortColumn);
    if (databaseAdminState.search) query.set("search", databaseAdminState.search);
    const anchor = document.createElement("a");
    anchor.href = `/api/v1/admin/database/tables/${encodeURIComponent(databaseAdminState.table)}/export?${query}`;
    anchor.download = "";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  function databaseAdminOpenProperty() {
    databaseAdminEnsureDialog();
    const select = document.querySelector("#databaseAdminPropertyEntityType");
    if (select) {
      select.innerHTML = state.data.types.map((type) => `<option value="${escapeHtml(type.key)}">${escapeHtml(type.label)}</option>`).join("");
      globalThis.docomatorSearchableSelect?.refresh?.(select);
    }
    document.querySelector("#databaseAdminPropertyForm")?.reset();
    document.querySelector("#databaseAdminPropertyError").hidden = true;
    document.querySelector("#databaseAdminPropertyDialog")?.showModal();
  }

  async function databaseAdminCreateProperty(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorBox = document.querySelector("#databaseAdminPropertyError");
    if (!form.reportValidity()) return;
    errorBox.hidden = true;
    try {
      await api("/api/v1/admin/database/properties", {
        method: "POST",
        body: JSON.stringify({
          label: document.querySelector("#databaseAdminPropertyLabel").value.trim(),
          valueType: document.querySelector("#databaseAdminPropertyType").value,
          appliesTo: [document.querySelector("#databaseAdminPropertyEntityType").value],
          sensitivity: document.querySelector("#databaseAdminPropertySensitivity").value,
          unit: document.querySelector("#databaseAdminPropertyUnit").value.trim() || undefined,
          description: document.querySelector("#databaseAdminPropertyDescription").value.trim() || undefined
        })
      });
      document.querySelector("#databaseAdminPropertyDialog")?.close();
      await loadData();
      notify("✅", "Поле создано", "Физическая схема SQLite не изменялась; поле добавлено в типизированную модель Docomator.");
    } catch (error) {
      errorBox.hidden = false;
      errorBox.textContent = error.message || "Поле создать не удалось.";
    }
  }

  function databaseAdminEvents() {
    document.addEventListener("click", (event) => {
      const action = event.target.closest("[data-db-admin-action]")?.dataset.dbAdminAction;
      if (action === "reload") void databaseAdminLoadTables();
      if (action === "check") void databaseAdminCheck();
      if (action === "property") databaseAdminOpenProperty();
      const exportFormat = event.target.closest("[data-db-admin-export]")?.dataset.dbAdminExport;
      if (exportFormat) databaseAdminExport(exportFormat);
      const sort = event.target.closest("[data-db-admin-sort]")?.dataset.dbAdminSort;
      if (sort) {
        databaseAdminState.sortDirection = databaseAdminState.sortColumn === sort && databaseAdminState.sortDirection === "asc" ? "desc" : "asc";
        databaseAdminState.sortColumn = sort;
        databaseAdminState.offset = 0;
        void databaseAdminRefreshRows();
      }
      const page = event.target.closest("[data-db-admin-page]")?.dataset.dbAdminPage;
      if (page) {
        databaseAdminState.offset = Math.max(0, databaseAdminState.offset + (page === "next" ? databaseAdminState.limit : -databaseAdminState.limit));
        void databaseAdminRefreshRows();
      }
    });
    document.addEventListener("change", (event) => {
      if (event.target.matches("#databaseAdminTable")) {
        databaseAdminState.table = event.target.value;
        databaseAdminState.sortColumn = "";
        databaseAdminState.offset = 0;
        void databaseAdminRefreshRows();
      }
      if (event.target.matches("#databaseAdminSort")) {
        databaseAdminState.sortColumn = event.target.value;
        databaseAdminState.offset = 0;
        void databaseAdminRefreshRows();
      }
      if (event.target.matches("#databaseAdminDirection")) {
        databaseAdminState.sortDirection = event.target.value;
        databaseAdminState.offset = 0;
        void databaseAdminRefreshRows();
      }
      if (event.target.matches("#databaseAdminLimit")) {
        databaseAdminState.limit = Number(event.target.value);
        databaseAdminState.offset = 0;
        void databaseAdminRefreshRows();
      }
    });
    let searchTimer;
    document.addEventListener("input", (event) => {
      if (!event.target.matches("#databaseAdminSearch")) return;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        databaseAdminState.search = event.target.value.trim();
        databaseAdminState.offset = 0;
        void databaseAdminRefreshRows();
      }, 250);
    });
    window.addEventListener("docomator:view-changed", (event) => {
      if (event.detail?.view === "database") void databaseAdminLoadTables();
    });
  }

  databaseAdminEnsureView();
  databaseAdminEnsureDialog();
  databaseAdminEvents();
}
