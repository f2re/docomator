{
  const publicationClassifications = [
    ["vak", "ВАК"],
    ["rinc", "РИНЦ"],
    ["mbd", "МБД"],
    ["scopus", "Scopus"],
    ["web_of_science", "Web of Science"],
    ["rinc_core", "Ядро РИНЦ"]
  ];

  const publicationDerivedPropertyKeys = new Set([
    "publication.authors",
    "publication.internal_authors",
    "publication.departments",
    "publication.classifications",
    "publication.vak",
    "publication.rinc",
    "publication.mbd",
    "publication.scopus",
    "publication.web_of_science",
    "publication.rinc_core"
  ]);

  const publicationUi = {
    installed: false,
    loading: false,
    tab: "report",
    configuration: null,
    types: [],
    properties: [],
    entities: [],
    report: null,
    catalog: null,
    criteria: {
      year: new Date().getFullYear(),
      teacherEntityId: undefined,
      department: undefined,
      status: undefined,
      classifications: "",
      classificationMatch: "any",
      includeReview: false,
      includeInactive: false,
      limit: 1000
    },
    snapshots: [],
    openSnapshotId: "",
    editingPublicationId: "",
    authorSearch: "",
    authorDraft: []
  };

  function publicationEscape(value) {
    return String(value ?? "").replace(/[&<>'"]/gu, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    })[character]);
  }

  function publicationSpaceId() {
    return String(globalThis.docomatorCurrentSpaceId || "").trim();
  }

  function publicationCorrelationId() {
    return globalThis.crypto?.randomUUID?.() || `publication-${Date.now()}`;
  }

  async function publicationFetch(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        accept: "application/json",
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        "x-correlation-id": publicationCorrelationId(),
        "x-actor-id": "local-ui",
        ...(options.headers || {})
      }
    });
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await response.json() : null;
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

  function publicationEndpoint(path = "") {
    const spaceId = publicationSpaceId();
    if (!spaceId) throw new Error("Сначала выберите пространство.");
    return `/api/v1/spaces/${encodeURIComponent(spaceId)}/publications${path}`;
  }

  function publicationTypeLabel(key) {
    return publicationUi.types.find((type) => type.key === key)?.label || key || "Не выбран";
  }

  function publicationPropertyLabel(key) {
    if (!key) return "Не используется";
    return publicationUi.properties.find((property) => property.key === key)?.label || key;
  }

  function publicationCurrentYear() {
    return new Date().getFullYear();
  }

  function publicationHideDerivedControls(root = document) {
    root.querySelectorAll?.("[data-entity-property]").forEach((control) => {
      if (!publicationDerivedPropertyKeys.has(control.dataset.entityProperty || "")) return;
      const field = control.closest(".entity-record-field");
      if (field) field.hidden = true;
    });
  }

  function publicationInstallShell() {
    if (publicationUi.installed) return;
    const navigation = document.querySelector(".nav-list");
    if (navigation && !navigation.querySelector('[data-view-target="publications"]')) {
      const button = document.createElement("button");
      button.className = "nav-item";
      button.type = "button";
      button.dataset.viewTarget = "publications";
      button.innerHTML = '<span class="nav-symbol" aria-hidden="true">◫</span><span>Публикации</span>';
      const entitiesButton = navigation.querySelector('[data-view-target="entities"]');
      entitiesButton?.after(button);
    }

    const mobileNavigation = document.querySelector(".mobile-nav");
    if (mobileNavigation && !mobileNavigation.querySelector('[data-view-target="publications"]')) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.viewTarget = "publications";
      button.innerHTML = '<span aria-hidden="true">◫</span><small>Статьи</small>';
      mobileNavigation.append(button);
    }

    const main = document.querySelector("main.main");
    if (main && !main.querySelector('[data-view="publications"]')) {
      const section = document.createElement("section");
      section.className = "view";
      section.dataset.view = "publications";
      section.setAttribute("aria-labelledby", "publications-heading");
      section.innerHTML = '<h2 class="visually-hidden" id="publications-heading">Учёт научных публикаций</h2><div id="publicationWorkspace" aria-live="polite"></div>';
      main.append(section);
    }

    if (!document.querySelector("#publicationRelationsDialog")) {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<dialog class="create-dialog publication-relations-dialog" id="publicationRelationsDialog" aria-labelledby="publicationRelationsTitle">
          <form id="publicationRelationsForm" novalidate>
            <header class="dialog-header"><div><p class="eyebrow">Связи публикации</p><h2 id="publicationRelationsTitle">Авторы и классификация</h2><p id="publicationRelationsDescription"></p></div><button class="icon-button" type="button" data-publication-dialog-close aria-label="Закрыть">×</button></header>
            <div class="dialog-body publication-relations-body">
              <section class="publication-dialog-section"><div class="panel-heading compact-heading"><div><h3>Авторы</h3><p>Один объект статьи связывается с несколькими авторами без дублирования.</p></div></div><label class="search-field" for="publicationAuthorSearch"><span aria-hidden="true">⌕</span><input id="publicationAuthorSearch" type="search" placeholder="Найти автора" autocomplete="off" /></label><div id="publicationAuthorList" class="publication-author-list"></div></section>
              <section class="publication-dialog-section"><div class="panel-heading compact-heading"><div><h3>Классификация</h3><p>Подтверждённые и требующие проверки признаки учитываются отдельно.</p></div></div><div id="publicationClassificationList" class="publication-classification-list"></div></section>
            </div>
            <div class="form-error" id="publicationRelationsError" role="alert" hidden></div>
            <footer class="dialog-footer"><p class="save-explanation">После сохранения поля «Авторы», «Кафедры» и признаки ВАК/РИНЦ/МБД обновятся для шаблонов.</p><div><button class="secondary-button" type="button" data-publication-dialog-close>Отмена</button><button class="primary-button" id="publicationRelationsSave" type="submit">Сохранить связи</button></div></footer>
          </form>
        </dialog>`
      );
      document
        .querySelector("#publicationRelationsForm")
        ?.addEventListener("submit", publicationSaveRelations);
      document
        .querySelector("#publicationAuthorSearch")
        ?.addEventListener("input", (event) => {
          publicationCaptureAuthorDraft();
          publicationUi.authorSearch = event.target.value;
          publicationRenderAuthorCandidates();
        });
      document
        .querySelector("#publicationAuthorList")
        ?.addEventListener("change", publicationCaptureAuthorDraft);
      document.querySelectorAll("[data-publication-dialog-close]").forEach((button) =>
        button.addEventListener("click", () =>
          document.querySelector("#publicationRelationsDialog")?.close()
        )
      );
    }

    views.publications = [
      "Научная деятельность",
      "Публикации",
      "Связывайте статьи с преподавателями, проверяйте классификации и формируйте годовые отчёты.",
      null,
      null
    ];
    help.publications = [
      ["Почему статья хранится один раз?", "Одна публикация может иметь несколько авторов. Связи позволяют считать уникальные статьи отдельно от авторских участий."],
      ["Как получить отчёт ВАК за год?", "Укажите год, отметьте ВАК и нажмите «Показать». Результат можно скачать как CSV или передать в мастер создания документов."],
      ["Что означает «требует проверки»?", "Признак сохранён, но по умолчанию не входит в подтверждённую статистику. Его можно включить отдельным флажком."],
      ["Как получить карточку преподавателя?", "Выберите преподавателя в условиях отчёта и передайте найденные статьи в шаблон персональной карточки."]
    ];

    window.addEventListener("docomator:view-changed", (event) => {
      if (event.detail?.view === "publications") void publicationLoad();
    });
    document.addEventListener("docomator:space-changed", () => {
      publicationUi.configuration = null;
      publicationUi.report = null;
      publicationUi.catalog = null;
      publicationUi.entities = [];
      publicationUi.criteria = {
        year: publicationCurrentYear(),
        teacherEntityId: undefined,
        department: undefined,
        status: undefined,
        classifications: "",
        classificationMatch: "any",
        includeReview: false,
        includeInactive: false,
        limit: 1000
      };
      publicationUi.snapshots = [];
      publicationUi.openSnapshotId = "";
      if (state.view === "publications") void publicationLoad();
    });
    document
      .querySelector("#publicationWorkspace")
      ?.addEventListener("click", publicationHandleClick);
    document
      .querySelector("#publicationWorkspace")
      ?.addEventListener("submit", publicationHandleSubmit);
    document
      .querySelector("#publicationWorkspace")
      ?.addEventListener("change", publicationHandleChange);

    const derivedControlObserver = new MutationObserver(() =>
      publicationHideDerivedControls(document)
    );
    derivedControlObserver.observe(document.body, { childList: true, subtree: true });
    publicationHideDerivedControls(document);

    publicationUi.installed = true;
    if (location.hash === "#publications") globalThis.docomatorSelectView?.("publications");
  }

  function publicationLoadingHtml() {
    return '<div class="employee-state is-loading" role="status" aria-busy="true"><span class="state-mark" aria-hidden="true"></span><div><strong>Получаем публикации</strong><p>Проверяем настройки, связи и годовую статистику.</p></div></div>';
  }

  async function publicationLoad() {
    if (publicationUi.loading) return;
    const root = document.querySelector("#publicationWorkspace");
    if (!root) return;
    if (!publicationSpaceId()) {
      root.innerHTML = '<div class="employee-empty"><h3>Пространство не выбрано</h3><p>Выберите рабочее пространство в верхней части экрана.</p></div>';
      return;
    }
    publicationUi.loading = true;
    root.innerHTML = publicationLoadingHtml();
    try {
      const [configuration, types, properties, entities, snapshots] = await Promise.all([
        publicationFetch(publicationEndpoint("/config")),
        publicationFetch("/api/v1/knowledge/entity-types?limit=500"),
        publicationFetch("/api/v1/knowledge/property-definitions?limit=500"),
        publicationFetch(`/api/v1/spaces/${encodeURIComponent(publicationSpaceId())}/entities?limit=1000`),
        publicationFetch(publicationEndpoint("/reports/snapshots?limit=20"))
      ]);
      publicationUi.configuration = configuration.data;
      publicationUi.types = Array.isArray(types.data) ? types.data : [];
      publicationUi.properties = Array.isArray(properties.data) ? properties.data : [];
      publicationUi.entities = Array.isArray(entities.data) ? entities.data : [];
      publicationUi.snapshots = Array.isArray(snapshots.data) ? snapshots.data : [];
      publicationRender();
      if (publicationUi.configuration && publicationUi.tab === "report") {
        await publicationPreviewReport();
      }
    } catch (error) {
      root.innerHTML = `<div class="employee-state is-error"><span class="state-mark" aria-hidden="true"></span><div><strong>Учёт публикаций не загружен</strong><p>${publicationEscape(error.message || "Повторите действие.")}</p>${error.correlationId ? `<code>Идентификатор операции: ${publicationEscape(error.correlationId)}</code>` : ""}</div><button class="secondary-button" type="button" data-publication-action="reload">Повторить</button></div>`;
    } finally {
      publicationUi.loading = false;
    }
  }

  function publicationRender() {
    const root = document.querySelector("#publicationWorkspace");
    if (!root) return;
    if (!publicationUi.configuration) {
      root.innerHTML = `
        <article class="hero-card publication-onboarding">
          <div class="hero-copy"><span class="pill pill-accent">Первичная настройка</span><h2>Настройте реестр научных публикаций</h2><p>Система создаст тип «Научная статья», стандартные поля, связи с преподавателями и классификации ВАК, РИНЦ, МБД, Scopus и Web of Science.</p><div class="hero-actions"><button class="primary-button" type="button" data-publication-action="bootstrap">Создать стандартную структуру</button><button class="secondary-button" type="button" data-publication-action="show-settings">Использовать существующие типы</button></div></div>
          <div class="hero-visual" aria-hidden="true"><div class="publication-hero-sheet"><i></i><i></i><i></i><b>ВАК</b></div></div>
        </article>
        <div id="publicationSettingsStandalone" hidden>${publicationSettingsHtml()}</div>`;
      return;
    }
    root.innerHTML = `
      <div class="section-intro publication-intro"><div><p class="eyebrow">Реестр и отчётность</p><h2>Научные публикации</h2><p>Статьи хранятся без дублирования, а авторство и классификация учитываются отдельными связями.</p></div><div class="publication-header-actions"><button class="secondary-button" type="button" data-publication-action="open-objects">Добавить или импортировать статьи</button><button class="primary-button" type="button" data-publication-action="preview">Обновить отчёт</button></div></div>
      <div class="segmented-control publication-tabs" role="tablist" aria-label="Раздел публикаций">
        <button type="button" role="tab" aria-selected="${publicationUi.tab === "report"}" data-publication-tab="report">Отчёт</button>
        <button type="button" role="tab" aria-selected="${publicationUi.tab === "registry"}" data-publication-tab="registry">Реестр</button>
        <button type="button" role="tab" aria-selected="${publicationUi.tab === "settings"}" data-publication-tab="settings">Настройка</button>
      </div>
      <section class="publication-pane${publicationUi.tab === "report" ? " is-visible" : ""}" data-publication-pane="report">${publicationReportHtml()}</section>
      <section class="publication-pane${publicationUi.tab === "registry" ? " is-visible" : ""}" data-publication-pane="registry">${publicationRegistryHtml()}</section>
      <section class="publication-pane${publicationUi.tab === "settings" ? " is-visible" : ""}" data-publication-pane="settings">${publicationSettingsHtml()}</section>`;
    globalThis.docomatorSearchableSelect?.enhanceAll?.(root);
    if (publicationUi.report) publicationRenderReport(publicationUi.report);
  }

  function publicationReportHtml() {
    const teachers = publicationUi.entities.filter(
      (entity) => entity.entityTypeKey === publicationUi.configuration.teacherEntityTypeKey
    );
    const criteria = publicationUi.criteria || {};
    const selectedClassifications = new Set(
      String(criteria.classifications || "").split(",").filter(Boolean)
    );
    return `
      <article class="panel publication-filter-panel">
        <div class="panel-heading"><div><p class="eyebrow">Условия выборки</p><h2>Годовой отчёт</h2><p>Фильтр формирует один набор данных для таблицы, подсчётов и документа.</p></div><span class="large-emoji" aria-hidden="true">📚</span></div>
        <form id="publicationReportForm" class="publication-filter-form">
          <label class="field"><span>Год</span><input id="publicationReportYear" name="year" type="number" min="1900" max="3000" value="${publicationEscape(criteria.year ?? "")}" /></label>
          <label class="field"><span>Преподаватель</span><select id="publicationReportTeacher" name="teacherEntityId" data-searchable-select data-searchable-placeholder="Все преподаватели"><option value="">Все преподаватели</option>${teachers.map((teacher) => `<option value="${publicationEscape(teacher.entityId)}"${teacher.entityId === criteria.teacherEntityId ? " selected" : ""}>${publicationEscape(teacher.displayName)}</option>`).join("")}</select></label>
          <label class="field"><span>Кафедра</span><input id="publicationReportDepartment" name="department" type="text" value="${publicationEscape(criteria.department || "")}" placeholder="Все кафедры" /></label>
          <label class="field"><span>Статус публикации</span><input id="publicationReportStatus" name="status" type="text" value="${publicationEscape(criteria.status || "")}" placeholder="Например, Опубликована" /></label>
          <fieldset class="publication-classification-filter"><legend>Классификация</legend>${publicationClassifications.map(([code, label]) => `<label><input type="checkbox" name="classification" value="${code}"${selectedClassifications.has(code) ? " checked" : ""} /><span>${publicationEscape(label)}</span></label>`).join("")}</fieldset>
          <div class="publication-filter-options"><label><input type="checkbox" id="publicationReportIncludeReview" name="includeReview"${criteria.includeReview ? " checked" : ""} /><span>Включать требующие проверки</span></label><label><input type="checkbox" id="publicationReportIncludeInactive" name="includeInactive"${criteria.includeInactive ? " checked" : ""} /><span>Показывать архивные статьи</span></label><label><input type="radio" name="classificationMatch" value="any"${criteria.classificationMatch !== "all" ? " checked" : ""} /><span>Любая отмеченная</span></label><label><input type="radio" name="classificationMatch" value="all"${criteria.classificationMatch === "all" ? " checked" : ""} /><span>Все отмеченные</span></label></div>
          <div class="publication-filter-actions"><button class="primary-button" type="submit">Показать</button><button class="secondary-button" type="button" data-publication-action="download-csv">Скачать CSV</button><button class="secondary-button" type="button" data-publication-action="save-snapshot">Зафиксировать отчёт</button><button class="secondary-button" type="button" data-publication-action="prepare-document">Передать в создание документов</button></div>
        </form>
      </article>
      <div id="publicationReportResult" class="publication-report-result" aria-live="polite"><div class="generation-history-empty">Укажите условия и нажмите «Показать».</div></div>
      <article class="panel publication-snapshots"><div class="panel-heading compact-heading"><div><h2>Зафиксированные отчёты</h2><p>Состав и итоговые показатели не меняются после сохранения.</p></div></div><div class="publication-snapshot-list">${publicationUi.snapshots.length ? publicationUi.snapshots.map((snapshot) => `<button type="button" class="snapshot-row" data-publication-snapshot="${publicationEscape(snapshot.id)}"><span class="snapshot-icon" aria-hidden="true">📌</span><span><strong>${snapshot.criteria.year || "Все годы"}: ${snapshot.rowCount} публикаций</strong><small>${publicationEscape(new Date(snapshot.createdAt).toLocaleString("ru-RU"))} · ВАК ${snapshot.totals.byClassification.vak} · РИНЦ ${snapshot.totals.byClassification.rinc}</small></span><span aria-hidden="true">›</span></button>`).join("") : '<div class="mini-empty horizontal"><span aria-hidden="true">📌</span><p>Снимков отчётов пока нет.</p></div>'}</div></article>`;
  }

  function publicationRegistryHtml() {
    return `
      <article class="panel publication-registry-panel"><div class="panel-heading"><div><p class="eyebrow">Карточки статей</p><h2>Реестр публикаций</h2><p>Откройте статью, чтобы закрепить авторов и подтвердить классификации.</p></div><button class="primary-button" type="button" data-publication-action="open-objects">Добавить или импортировать</button></div><div id="publicationRegistryList" class="publication-registry-list">${publicationUi.catalog ? publicationRegistryRows(publicationUi.catalog.rows) : '<div class="generation-history-empty">Получаем статьи…</div>'}</div></article>`;
  }

  function publicationRegistryRows(rows) {
    if (!rows.length) return '<div class="employee-empty"><h3>Публикаций пока нет</h3><p>Добавьте статью вручную или импортируйте CSV/XLSX.</p><button class="primary-button" type="button" data-publication-action="open-objects">Добавить статью</button></div>';
    return rows.map((row) => `
      <article class="publication-card">
        <div class="publication-card-main"><span class="publication-year">${publicationEscape(row.year || "—")}</span><div><h3>${publicationEscape(row.title)}</h3><p>${publicationEscape(row.authors.map((author) => author.displayName).join("; ") || "Авторы не закреплены")}</p><div class="card-meta">${row.classifications.filter((item) => item.state !== "excluded").map((item) => `<span class="pill${item.state === "review" ? " is-warning" : ""}">${publicationEscape(item.label)}</span>`).join("")}${row.doi ? `<span class="pill">DOI</span>` : ""}</div></div></div>
        <button class="secondary-button compact-button" type="button" data-publication-edit="${publicationEscape(row.publicationEntityId)}">Авторы и классификация</button>
      </article>`).join("");
  }

  function publicationApplicableProperties(typeKey, allowedTypes) {
    return publicationUi.properties.filter((property) => {
      const appliesTo = Array.isArray(property.appliesTo) ? property.appliesTo : [];
      return allowedTypes.includes(property.valueType) &&
        (appliesTo.length === 0 || appliesTo.includes(typeKey));
    });
  }

  function publicationPropertyOptions(typeKey, allowedTypes, selectedKey) {
    return `<option value="">Не используется</option>${publicationApplicableProperties(typeKey, allowedTypes).map((property) => `<option value="${publicationEscape(property.key)}"${property.key === selectedKey ? " selected" : ""}>${publicationEscape(property.label)}</option>`).join("")}`;
  }

  function publicationSettingsHtml() {
    const configuration = publicationUi.configuration || {};
    const publicationTypeKey = configuration.publicationEntityTypeKey || publicationUi.types.find((type) => type.key !== "person")?.key || "";
    const teacherTypeKey = configuration.teacherEntityTypeKey || "person";
    return `
      <article class="panel publication-settings-panel"><div class="panel-heading"><div><p class="eyebrow">Сопоставление данных</p><h2>Настройка реестра</h2><p>Выберите типы и поля, которые уже используются в вашем пространстве.</p></div><button class="secondary-button" type="button" data-publication-action="bootstrap">Создать стандартную структуру</button></div>
      <form id="publicationSettingsForm" class="publication-settings-form">
        <label class="field"><span>Тип «Научная статья»</span><select id="publicationConfigType" name="publicationEntityTypeKey" required>${publicationUi.types.map((type) => `<option value="${publicationEscape(type.key)}"${type.key === publicationTypeKey ? " selected" : ""}>${publicationEscape(type.label)}</option>`).join("")}</select></label>
        <label class="field"><span>Тип преподавателей</span><select id="publicationConfigTeacherType" name="teacherEntityTypeKey" required>${publicationUi.types.map((type) => `<option value="${publicationEscape(type.key)}"${type.key === teacherTypeKey ? " selected" : ""}>${publicationEscape(type.label)}</option>`).join("")}</select></label>
        <label class="field"><span>Год публикации</span><select name="publicationYearPropertyKey">${publicationPropertyOptions(publicationTypeKey, ["integer", "number", "string"], configuration.publicationYearPropertyKey)}</select></label>
        <label class="field"><span>Дата публикации</span><select name="publicationDatePropertyKey">${publicationPropertyOptions(publicationTypeKey, ["date", "date-time", "string"], configuration.publicationDatePropertyKey)}</select></label>
        <label class="field"><span>Кафедра преподавателя</span><select name="teacherDepartmentPropertyKey">${publicationPropertyOptions(teacherTypeKey, ["string", "text", "enum"], configuration.teacherDepartmentPropertyKey)}</select></label>
        <label class="field"><span>DOI</span><select name="doiPropertyKey">${publicationPropertyOptions(publicationTypeKey, ["string", "text", "enum"], configuration.doiPropertyKey)}</select></label>
        <label class="field"><span>Журнал или сборник</span><select name="journalPropertyKey">${publicationPropertyOptions(publicationTypeKey, ["string", "text", "enum"], configuration.journalPropertyKey)}</select></label>
        <label class="field"><span>Библиографическое описание</span><select name="bibliographyPropertyKey">${publicationPropertyOptions(publicationTypeKey, ["string", "text", "enum"], configuration.bibliographyPropertyKey)}</select></label>
        <label class="field"><span>Статус публикации</span><select name="statusPropertyKey">${publicationPropertyOptions(publicationTypeKey, ["string", "text", "enum"], configuration.statusPropertyKey)}</select></label>
        <div class="publication-settings-summary"><strong>Системные поля создаются автоматически</strong><p>Авторы, кафедры, список классификаций и признаки ВАК/РИНЦ/МБД становятся доступны шаблонам как обычные поля статьи.</p></div>
        <div class="publication-filter-actions"><button class="primary-button" type="submit">Сохранить настройку</button></div>
      </form></article>`;
  }

  function publicationReportCriteria() {
    const form = document.querySelector("#publicationReportForm");
    if (!form) return { ...publicationUi.criteria, limit: 1000 };
    const data = new FormData(form);
    const yearRaw = String(data.get("year") || "").trim();
    const criteria = {
      ...(yearRaw ? { year: Number(yearRaw) } : {}),
      teacherEntityId: String(data.get("teacherEntityId") || "").trim() || undefined,
      department: String(data.get("department") || "").trim() || undefined,
      status: String(data.get("status") || "").trim() || undefined,
      classifications: data.getAll("classification").map(String).join(","),
      classificationMatch: String(data.get("classificationMatch") || "any"),
      includeReview: data.get("includeReview") === "on",
      includeInactive: data.get("includeInactive") === "on",
      limit: 1000
    };
    publicationUi.criteria = criteria;
    return criteria;
  }

  function publicationCriteriaQuery(criteria = publicationReportCriteria()) {
    const params = new URLSearchParams();
    Object.entries(criteria).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      params.set(key, String(value));
    });
    return params.toString();
  }

  async function publicationLoadRegistry() {
    if (!publicationUi.configuration) return;
    const holder = document.querySelector("#publicationRegistryList");
    if (holder) holder.innerHTML = '<div class="generation-history-empty">Получаем полный реестр…</div>';
    try {
      const body = await publicationFetch(
        publicationEndpoint("/reports/preview?includeInactive=true&includeReview=true&limit=1000")
      );
      publicationUi.catalog = body.data;
      if (holder) holder.innerHTML = publicationRegistryRows(body.data.rows);
    } catch (error) {
      if (holder) holder.innerHTML = `<div class="generation-state is-error"><span aria-hidden="true">⛔</span><div><strong>Реестр не загружен</strong><p>${publicationEscape(error.message || "Повторите действие.")}</p></div></div>`;
    }
  }

  async function publicationPreviewReport() {
    if (!publicationUi.configuration) return;
    publicationUi.openSnapshotId = "";
    const holder = document.querySelector("#publicationReportResult");
    if (holder) holder.innerHTML = '<div class="generation-history-empty">Рассчитываем уникальные статьи и авторские участия…</div>';
    try {
      const body = await publicationFetch(
        publicationEndpoint(`/reports/preview?${publicationCriteriaQuery()}`)
      );
      publicationUi.report = body.data;
      publicationRenderReport(body.data);
      if (publicationUi.tab === "registry") void publicationLoadRegistry();
    } catch (error) {
      if (holder) holder.innerHTML = `<div class="generation-state is-error"><span aria-hidden="true">⛔</span><div><strong>Отчёт не рассчитан</strong><p>${publicationEscape(error.message || "Повторите действие.")}</p></div></div>`;
    }
  }

  function publicationRenderReport(report) {
    const holder = document.querySelector("#publicationReportResult");
    if (!holder) return;
    const totals = report.totals;
    holder.innerHTML = `
      <div class="publication-metrics">
        <article><span>Уникальные статьи</span><strong>${totals.uniquePublications}</strong><small>без двойного счёта соавторов</small></article>
        <article><span>Авторские участия</span><strong>${totals.authorships}</strong><small>все связи статья—автор</small></article>
        <article><span>ВАК</span><strong>${totals.byClassification.vak}</strong><small>подтверждённые${report.criteria.includeReview ? " и проверяемые" : ""}</small></article>
        <article><span>РИНЦ</span><strong>${totals.byClassification.rinc}</strong><small>уникальные публикации</small></article>
        <article><span>МБД</span><strong>${totals.byClassification.mbd}</strong><small>уникальные публикации</small></article>
        <article><span>Без DOI</span><strong>${totals.withoutDoi}</strong><small>требуют уточнения</small></article>
      </div>
      ${publicationUi.openSnapshotId ? '<div class="inline-hint is-success"><span aria-hidden="true">📌</span><p>Открыт зафиксированный отчёт. Выгрузка CSV и состав документа будут взяты из этого снимка.</p></div>' : ""}
      ${totals.truncated ? '<div class="inline-hint"><span aria-hidden="true">ⓘ</span><p>Показаны первые 1000 строк. Уточните условия перед созданием документа.</p></div>' : ""}
      <div class="publication-table-wrap"><table class="publication-report-table"><thead><tr><th>Год</th><th>Публикация</th><th>Авторы</th><th>Кафедры</th><th>Классификация</th><th>DOI</th></tr></thead><tbody>${report.rows.map((row) => `<tr><td>${publicationEscape(row.year || "—")}</td><td><strong>${publicationEscape(row.title)}</strong><small>${publicationEscape(row.journal || row.publicationStatus || "")}</small></td><td>${publicationEscape(row.authors.map((author) => author.displayName).join("; ") || "—")}</td><td>${publicationEscape(row.departments.join("; ") || "—")}</td><td><div class="card-meta">${row.classifications.filter((item) => item.state !== "excluded").map((item) => `<span class="pill${item.state === "review" ? " is-warning" : ""}">${publicationEscape(item.label)}</span>`).join("") || "—"}</div></td><td>${publicationEscape(row.doi || "—")}</td></tr>`).join("")}</tbody></table></div>`;
  }

  async function publicationBootstrap() {
    try {
      await publicationFetch(publicationEndpoint("/bootstrap"), {
        method: "POST"
      });
      notify("✅", "Структура публикаций создана", "Добавьте статьи вручную или импортируйте таблицу.");
      await publicationLoad();
    } catch (error) {
      notify("⚠️", "Структура не создана", error.message || "Повторите действие.");
    }
  }

  function publicationOpenObjects() {
    if (!publicationUi.configuration) return;
    localStorage.setItem(
      `docomator.entity-type:${publicationSpaceId()}`,
      publicationUi.configuration.publicationEntityTypeKey
    );
    globalThis.docomatorSelectedEntityTypeKey =
      publicationUi.configuration.publicationEntityTypeKey;
    globalThis.docomatorSelectView?.("entities");
    void globalThis.docomatorEntityWorkspaceReload?.();
  }

  function publicationSetTab(tab) {
    if (!["report", "registry", "settings"].includes(tab)) return;
    publicationUi.tab = tab;
    publicationRender();
    if (tab === "report" && !publicationUi.report) void publicationPreviewReport();
    if (tab === "registry") void publicationLoadRegistry();
  }

  async function publicationSaveSettings(form) {
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const payload = Object.fromEntries(
      [...data.entries()].map(([key, value]) => [key, String(value).trim() || null])
    );
    try {
      await publicationFetch(publicationEndpoint("/config"), {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      notify("✅", "Настройка сохранена", "Поля и типы используются в отчётах и шаблонах.");
      publicationUi.tab = "report";
      await publicationLoad();
    } catch (error) {
      notify("⚠️", "Настройка не сохранена", error.message || "Проверьте выбранные поля.");
    }
  }

  function publicationAuthorCandidates() {
    const publicationType = publicationUi.configuration?.publicationEntityTypeKey;
    const query = publicationUi.authorSearch
      .normalize("NFKC")
      .toLocaleLowerCase("ru-RU")
      .trim();
    return publicationUi.entities
      .filter((entity) => entity.entityTypeKey !== publicationType)
      .filter((entity) =>
        !query ||
        `${entity.displayName} ${entity.entityTypeLabel}`
          .normalize("NFKC")
          .toLocaleLowerCase("ru-RU")
          .includes(query)
      )
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "ru-RU"));
  }

  function publicationCaptureAuthorDraft() {
    const visibleRows = document.querySelectorAll("[data-publication-author-row]");
    if (!visibleRows.length) return;
    const draft = new Map(
      publicationUi.authorDraft.map((author) => [author.authorEntityId, { ...author }])
    );
    let nextPosition = Math.max(
      -1,
      ...[...draft.values()].map((author) => Number(author.position) || 0)
    ) + 1;
    visibleRows.forEach((row) => {
      const checkbox = row.querySelector("[data-publication-author]");
      const authorEntityId = checkbox?.dataset.publicationAuthor || "";
      if (!authorEntityId) return;
      if (!checkbox.checked) {
        draft.delete(authorEntityId);
        return;
      }
      const role =
        row.querySelector("[data-publication-author-role]")?.value || "author";
      const positionRaw = Number(
        row.querySelector("[data-publication-author-position]")?.value
      );
      const existing = draft.get(authorEntityId);
      const position =
        Number.isInteger(positionRaw) && positionRaw >= 1
          ? positionRaw - 1
          : existing?.position ?? nextPosition++;
      draft.set(authorEntityId, { authorEntityId, role, position });
    });
    publicationUi.authorDraft = [...draft.values()].sort(
      (left, right) => left.position - right.position
    );
  }

  function publicationRenderAuthorCandidates(existing = null) {
    const root = document.querySelector("#publicationAuthorList");
    if (!root) return;
    if (Array.isArray(existing)) {
      publicationUi.authorDraft = existing.map((author) => ({
        authorEntityId: author.authorEntityId,
        role: author.role || "author",
        position: Number(author.position) || 0
      }));
    }
    const existingById = new Map(
      publicationUi.authorDraft.map((author) => [author.authorEntityId, author])
    );
    const candidates = publicationAuthorCandidates();
    root.innerHTML = candidates.length
      ? candidates.map((entity) => {
          const author = existingById.get(entity.entityId);
          const internal = entity.entityTypeKey === publicationUi.configuration.teacherEntityTypeKey;
          return `<div class="publication-author-row" data-publication-author-row><label><input type="checkbox" data-publication-author="${publicationEscape(entity.entityId)}"${author ? " checked" : ""} /><span class="publication-author-avatar" aria-hidden="true">${publicationEscape(entity.displayName.slice(0, 1).toLocaleUpperCase("ru-RU"))}</span><span><strong>${publicationEscape(entity.displayName)}</strong><small>${publicationEscape(entity.entityTypeLabel)}${internal ? " · внутренний автор" : " · внешний автор"}</small></span></label><label class="publication-author-order"><span>№</span><input type="number" min="1" max="200" data-publication-author-position="${publicationEscape(entity.entityId)}" value="${author ? Number(author.position) + 1 : ""}" aria-label="Порядок автора" /></label><select data-publication-author-role="${publicationEscape(entity.entityId)}" aria-label="Роль автора"><option value="author"${!author || author.role === "author" ? " selected" : ""}>Автор</option><option value="corresponding_author"${author?.role === "corresponding_author" ? " selected" : ""}>Ответственный автор</option><option value="editor"${author?.role === "editor" ? " selected" : ""}>Редактор</option><option value="translator"${author?.role === "translator" ? " selected" : ""}>Переводчик</option></select></div>`;
        }).join("")
      : '<div class="mini-empty horizontal"><span aria-hidden="true">👤</span><p>Подходящих объектов не найдено.</p></div>';
  }

  function publicationRenderClassifications(existing) {
    const root = document.querySelector("#publicationClassificationList");
    if (!root) return;
    const byCode = new Map(existing.map((item) => [item.code, item]));
    root.innerHTML = publicationClassifications.map(([code, label]) => {
      const item = byCode.get(code);
      return `<div class="publication-classification-row" data-publication-classification="${code}"><strong>${publicationEscape(label)}</strong><select data-publication-classification-state><option value=""${!item ? " selected" : ""}>Не указано</option><option value="confirmed"${item?.state === "confirmed" ? " selected" : ""}>Подтверждено</option><option value="review"${item?.state === "review" ? " selected" : ""}>Требует проверки</option><option value="excluded"${item?.state === "excluded" ? " selected" : ""}>Исключено</option></select><input type="text" data-publication-classification-source value="${publicationEscape(item?.source || "")}" placeholder="Источник подтверждения" /></div>`;
    }).join("");
    root.publicationExistingClassifications = existing;
  }

  async function publicationOpenRelations(publicationId) {
    const row = [...(publicationUi.catalog?.rows || []), ...(publicationUi.report?.rows || [])].find(
      (item) => item.publicationEntityId === publicationId
    );
    publicationUi.editingPublicationId = publicationId;
    publicationUi.authorSearch = "";
    publicationUi.authorDraft = [];
    const dialog = document.querySelector("#publicationRelationsDialog");
    const errorBox = document.querySelector("#publicationRelationsError");
    const search = document.querySelector("#publicationAuthorSearch");
    if (errorBox) errorBox.hidden = true;
    if (search) search.value = "";
    document.querySelector("#publicationRelationsTitle").textContent = row?.title || "Авторы и классификация";
    document.querySelector("#publicationRelationsDescription").textContent = "Закрепите авторов и укажите подтверждённые признаки публикации.";
    dialog?.showModal();
    const authorRoot = document.querySelector("#publicationAuthorList");
    const classificationRoot = document.querySelector("#publicationClassificationList");
    if (authorRoot) authorRoot.innerHTML = '<div class="generation-history-empty">Получаем авторов…</div>';
    if (classificationRoot) classificationRoot.innerHTML = '<div class="generation-history-empty">Получаем классификации…</div>';
    try {
      const [authors, classifications] = await Promise.all([
        publicationFetch(publicationEndpoint(`/${encodeURIComponent(publicationId)}/authors`)),
        publicationFetch(publicationEndpoint(`/${encodeURIComponent(publicationId)}/classifications`))
      ]);
      publicationRenderAuthorCandidates(authors.data || []);
      publicationRenderClassifications(classifications.data || []);
    } catch (error) {
      if (errorBox) {
        errorBox.hidden = false;
        errorBox.textContent = error.message || "Связи не загружены.";
      }
    }
  }

  async function publicationSaveRelations(event) {
    event.preventDefault();
    if (!publicationUi.editingPublicationId) return;
    const button = document.querySelector("#publicationRelationsSave");
    const errorBox = document.querySelector("#publicationRelationsError");
    if (button) button.disabled = true;
    if (errorBox) errorBox.hidden = true;
    try {
      publicationCaptureAuthorDraft();
      const authors = publicationUi.authorDraft
        .slice()
        .sort((left, right) => left.position - right.position)
        .map((author, position) => ({
          authorEntityId: author.authorEntityId,
          role: author.role,
          position
        }));
      await publicationFetch(
        publicationEndpoint(`/${encodeURIComponent(publicationUi.editingPublicationId)}/authors`),
        { method: "PUT", body: JSON.stringify({ authors }) }
      );
      const existing = new Set(
        (document.querySelector("#publicationClassificationList")?.publicationExistingClassifications || []).map((item) => item.code)
      );
      for (const row of document.querySelectorAll("[data-publication-classification]")) {
        const code = row.dataset.publicationClassification;
        const stateValue = row.querySelector("[data-publication-classification-state]")?.value || "";
        const source = row.querySelector("[data-publication-classification-source]")?.value.trim() || null;
        const endpoint = publicationEndpoint(`/${encodeURIComponent(publicationUi.editingPublicationId)}/classifications/${encodeURIComponent(code)}`);
        if (!stateValue) {
          if (existing.has(code)) await publicationFetch(endpoint, { method: "DELETE" });
          continue;
        }
        await publicationFetch(endpoint, {
          method: "PUT",
          body: JSON.stringify({ state: stateValue, source, checkedAt: new Date().toISOString().slice(0, 10) })
        });
      }
      document.querySelector("#publicationRelationsDialog")?.close();
      notify("✅", "Связи публикации сохранены", "Отчёт и поля шаблонов будут пересчитаны.");
      await publicationPreviewReport();
      if (publicationUi.tab === "registry") await publicationLoadRegistry();
    } catch (error) {
      if (errorBox) {
        errorBox.hidden = false;
        errorBox.textContent = error.message || "Связи не сохранены.";
      }
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function publicationSaveSnapshot() {
    try {
      const body = await publicationFetch(publicationEndpoint("/reports/snapshots"), {
        method: "POST",
        body: JSON.stringify({ criteria: publicationReportCriteria() })
      });
      publicationUi.snapshots.unshift(body.data);
      notify("✅", "Отчёт зафиксирован", `Сохранено строк: ${body.data.rowCount}.`);
      publicationRender();
    } catch (error) {
      notify("⚠️", "Отчёт не зафиксирован", error.message || "Повторите действие.");
    }
  }

  async function publicationPrepareDocument() {
    try {
      const body = publicationUi.openSnapshotId
        ? await publicationFetch(
            publicationEndpoint(
              `/reports/snapshots/${encodeURIComponent(publicationUi.openSnapshotId)}/audience-snapshot`
            ),
            { method: "POST" }
          )
        : await publicationFetch(publicationEndpoint("/reports/audience-snapshot"), {
            method: "POST",
            body: JSON.stringify({ criteria: publicationReportCriteria() })
          });
      state.data.snapshots = [body.data.audience.snapshot, ...state.data.snapshots.filter((snapshot) => snapshot.id !== body.data.audience.snapshot.id)];
      notify("✅", "Состав для документа готов", `Публикаций: ${body.data.report.totals.uniquePublications}.`);
      globalThis.docomatorSelectView?.("generation");
    } catch (error) {
      notify("⚠️", "Состав не создан", error.message || "Уточните условия отчёта.");
    }
  }

  async function publicationOpenSnapshot(snapshotId) {
    try {
      const body = await publicationFetch(publicationEndpoint(`/reports/snapshots/${encodeURIComponent(snapshotId)}`));
      publicationUi.openSnapshotId = snapshotId;
      publicationUi.criteria = {
        ...body.data.criteria,
        classifications: Array.isArray(body.data.criteria?.classifications)
          ? body.data.criteria.classifications.join(",")
          : "",
        limit: 1000
      };
      publicationUi.report = {
        spaceId: body.data.spaceId,
        criteria: body.data.criteria,
        generatedAt: body.data.createdAt,
        totals: body.data.totals,
        rows: body.data.rows
      };
      publicationUi.tab = "report";
      publicationRender();
      publicationRenderReport(publicationUi.report);
    } catch (error) {
      notify("⚠️", "Снимок не открыт", error.message || "Повторите действие.");
    }
  }

  function publicationHandleClick(event) {
    const tab = event.target.closest("[data-publication-tab]")?.dataset.publicationTab;
    if (tab) publicationSetTab(tab);
    const action = event.target.closest("[data-publication-action]")?.dataset.publicationAction;
    if (action === "reload") void publicationLoad();
    if (action === "bootstrap") void publicationBootstrap();
    if (action === "show-settings") {
      const holder = document.querySelector("#publicationSettingsStandalone");
      if (holder) {
        holder.hidden = false;
        globalThis.docomatorSearchableSelect?.enhanceAll?.(holder);
      }
    }
    if (action === "open-objects") publicationOpenObjects();
    if (action === "preview") void publicationPreviewReport();
    if (action === "download-csv") {
      const path = publicationUi.openSnapshotId
        ? `/reports/snapshots/${encodeURIComponent(publicationUi.openSnapshotId)}/export.csv`
        : `/reports/export.csv?${publicationCriteriaQuery()}`;
      window.location.assign(publicationEndpoint(path));
    }
    if (action === "save-snapshot") void publicationSaveSnapshot();
    if (action === "prepare-document") void publicationPrepareDocument();
    const edit = event.target.closest("[data-publication-edit]");
    if (edit) void publicationOpenRelations(edit.dataset.publicationEdit);
    const snapshot = event.target.closest("[data-publication-snapshot]");
    if (snapshot) void publicationOpenSnapshot(snapshot.dataset.publicationSnapshot);
  }

  function publicationHandleSubmit(event) {
    if (event.target.matches("#publicationReportForm")) {
      event.preventDefault();
      void publicationPreviewReport();
    }
    if (event.target.matches("#publicationSettingsForm")) {
      event.preventDefault();
      void publicationSaveSettings(event.target);
    }
  }

  function publicationHandleChange(event) {
    if (event.target.closest("#publicationReportForm")) {
      publicationUi.openSnapshotId = "";
      publicationUi.report = null;
      const result = document.querySelector("#publicationReportResult");
      if (result) {
        result.innerHTML = '<div class="generation-history-empty">Условия изменены. Нажмите «Показать», чтобы пересчитать отчёт.</div>';
      }
    }
    if (
      event.target.matches("#publicationConfigType, #publicationConfigTeacherType")
    ) {
      const form = event.target.closest("#publicationSettingsForm");
      if (!form) return;
      const data = new FormData(form);
      publicationUi.configuration = {
        ...(publicationUi.configuration || {}),
        publicationEntityTypeKey: String(data.get("publicationEntityTypeKey") || ""),
        teacherEntityTypeKey: String(data.get("teacherEntityTypeKey") || "")
      };
      publicationRender();
      publicationSetTab("settings");
    }
  }

  publicationInstallShell();
}
