import { installОформляторApiMock } from "./fixtures/docomator-api.mjs";

export const CANONICAL_UI_VIEWS = Object.freeze([
  Object.freeze({ view: "overview", label: "Главная", tier: "primary" }),
  Object.freeze({ view: "employees", label: "Сотрудники", tier: "primary" }),
  Object.freeze({ view: "entities", label: "Объекты", tier: "primary" }),
  Object.freeze({ view: "templates", label: "Шаблоны", tier: "primary" }),
  Object.freeze({ view: "gost-formatting", label: "Форматирование по ГОСТ", tier: "primary" }),
  Object.freeze({ view: "generation", label: "Создать документы", tier: "primary" }),
  Object.freeze({ view: "documents", label: "Результаты", tier: "primary" }),
  Object.freeze({ view: "automations", label: "Расписания", tier: "primary" }),
  Object.freeze({ view: "settings", label: "Настройки", tier: "primary" }),
  Object.freeze({ view: "publications", label: "Публикации", tier: "primary" }),
  Object.freeze({ view: "help", label: "Руководство", tier: "primary" }),
  Object.freeze({ view: "spaces", label: "Пространства", tier: "advanced" }),
  Object.freeze({ view: "knowledge", label: "Типы и свойства", tier: "advanced" }),
  Object.freeze({ view: "database", label: "Администрирование БД", tier: "advanced" })
]);

const GENERIC_IMPORT_PREVIEW = Object.freeze({
  fileName: "Аудитории.csv",
  fileFormat: "csv",
  sourceSha256: "ui-regression-room-import",
  previewToken: "ui-regression-room-import-token",
  headers: ["Код", "Название", "Вместимость"],
  columnCount: 3,
  rowCount: 2,
  rows: [
    { "Код": "ROOM-101", "Название": "Аудитория 101", "Вместимость": "32" },
    { "Код": "ROOM-205", "Название": "Лаборатория 205", "Вместимость": "18" }
  ],
  sampleRows: [
    { "Код": "ROOM-101", "Название": "Аудитория 101", "Вместимость": "32" },
    { "Код": "ROOM-205", "Название": "Лаборатория 205", "Вместимость": "18" }
  ]
});

const GENERIC_ENTITY_TYPES = Object.freeze([
  Object.freeze({ key: "person", label: "Человек", description: "Сотрудник" }),
  Object.freeze({ key: "room", label: "Аудитория", description: "Учебное помещение" })
]);

const GENERIC_PROPERTIES = Object.freeze([
  Object.freeze({
    key: "room.capacity",
    label: "Вместимость",
    valueType: "integer",
    sensitivity: "internal",
    appliesTo: ["room"],
    aliases: ["Количество мест"],
    validation: {},
    unit: "мест"
  })
]);

async function openEmployeeAdd(page, app) {
  await app.openView("employees");
  await page.locator('[data-employee-action="add"]:visible').first().click();
  await page.locator("#employeeDialog").waitFor({ state: "visible" });
}

async function openEmployeeEdit(page, app) {
  await app.openView("employees");
  await page.locator("#employeeList .employee-row").first().click();
  await page.locator("#employeeDialog").waitFor({ state: "visible" });
}

async function openEmployeeImport(page, app) {
  await app.openView("employees");
  await page.locator("[data-bulk-import-open]:visible").first().click();
  await page.locator("#bulkDataImportPanel").waitFor({ state: "visible" });
  await page.locator("#bulkImportFile").setInputFiles({
    name: "Сотрудники.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "ФИО;Табельный номер;Должность\nАнна Смирнова;T-001;Инженер\nИван Петров;T-002;Аналитик",
      "utf8"
    )
  });
  await page.locator("#bulkImportPreviewButton").click();
  await page.locator("#bulkImportMappings").waitFor({ state: "visible" });
}

async function openEntityImport(page, app) {
  await app.openView("entities");
  await page.locator('[data-entity-action="import"]:visible').first().click();
  await page.locator("#entityImportDialog").waitFor({ state: "visible" });
  await page.locator("#entityImportFile").setInputFiles({
    name: "Аудитории.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Код,Название,Вместимость\n", "utf8")
  });
  await page.locator("#entityImportPreviewButton").click();
  await page.locator("#entityImportMappings").waitFor({ state: "visible" });
}

async function openPublicationRelations(page, app) {
  await app.openView("publications");
  await page.locator('[data-publication-tab="registry"]').click();
  const edit = page.locator('[data-publication-edit="publication-e2e-1"]');
  await edit.waitFor({ state: "visible" });
  await edit.click();
  await page.locator("#publicationRelationsDialog").waitFor({ state: "visible" });
  await page.locator("[data-publication-classification]").first().waitFor({ state: "visible" });
}

async function openTemplateTrialError(page, app) {
  await app.openView("templates");
  await page.locator("#documentIntakeFile").setInputFiles({
    name: "Личная карточка.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("ui-regression-template-error", "utf8")
  });
  await page.locator("#documentIntakeButton").click();
  await page.locator("#documentQuarantineButton").click();
  await page.locator("#documentStructureButton").click();
  await page.locator(".structure-element").first().click();
  const textRange = page.locator("#documentFieldTextRange");
  if ((await textRange.count()) > 0) {
    await textRange.evaluate((control) => {
      const start = control.value.indexOf("______");
      control.focus();
      control.setSelectionRange(start, start + 6);
      control.dispatchEvent(new Event("select", { bubbles: true }));
    });
  }
  await page.locator("#documentFieldProperty").selectOption("__new__", { force: true });
  await page.locator("#documentFieldLabel").fill("ФИО");
  await page.locator("#documentFieldType").selectOption("string");
  await page.locator("#documentPropertyConfirm").check();
  await page.locator("#documentFieldRequired").check();
  await page.locator("#documentFieldSave").click();
  await page.locator("#documentFieldsContinue").click();
  await page.locator("#templateTrialForm").waitFor({ state: "visible" });
  await page.locator("#templateTrialValue").fill("Анна Смирнова");
  await page.locator("#templateTrialSubmit").click();
  await page.getByText("Пробное заполнение не прошло").waitFor({ state: "visible" });
}

async function openGenerationPreflightError(page, app) {
  await app.openView("generation");
  await page.locator("#generationSubmit").click();
  await page.getByText("Найдены незаполненные обязательные поля").waitFor({
    state: "visible"
  });
}

async function openOperationError(page, app) {
  await app.openView("documents");
  await page.getByText("Не удалось получить операции").waitFor({ state: "visible" });
  await page.locator("#operationCenterRetry").waitFor({ state: "visible" });
}

export const CANONICAL_UI_STATES = Object.freeze([
  Object.freeze({
    id: "employee-add",
    label: "Добавление сотрудника",
    mode: "mock",
    view: "employees",
    root: "#employeeDialog",
    focusWithin: true,
    closeWithEscape: true,
    returnFocus: '[data-employee-action="add"]:visible',
    options: Object.freeze({}),
    open: openEmployeeAdd
  }),
  Object.freeze({
    id: "employee-edit",
    label: "Редактирование сотрудника",
    mode: "mock",
    view: "employees",
    root: "#employeeDialog",
    focusWithin: true,
    options: Object.freeze({}),
    open: openEmployeeEdit
  }),
  Object.freeze({
    id: "employee-import-preview",
    label: "Предпросмотр импорта сотрудников",
    mode: "mock",
    view: "employees",
    root: "#bulkDataImportPanel",
    focusWithin: false,
    options: Object.freeze({}),
    open: openEmployeeImport
  }),
  Object.freeze({
    id: "entity-import-preview",
    label: "Предпросмотр импорта произвольных объектов",
    mode: "mock",
    view: "entities",
    root: "#entityImportDialog",
    focusWithin: true,
    closeWithEscape: true,
    returnFocus: '[data-entity-action="import"]:visible',
    options: Object.freeze({
      entityTypes: GENERIC_ENTITY_TYPES,
      properties: GENERIC_PROPERTIES,
      importPreview: GENERIC_IMPORT_PREVIEW
    }),
    open: openEntityImport
  }),
  Object.freeze({
    id: "publication-relations",
    label: "Авторы и классификация публикации",
    mode: "mock",
    view: "publications",
    root: "#publicationRelationsDialog",
    focusWithin: true,
    closeWithEscape: true,
    returnFocus: '[data-publication-edit="publication-e2e-1"]',
    options: Object.freeze({ publicationConfigured: true }),
    open: openPublicationRelations
  }),
  Object.freeze({
    id: "template-trial-error",
    label: "Ошибка пробного заполнения шаблона",
    mode: "mock",
    view: "templates",
    root: "#templateWizard",
    focusWithin: false,
    options: Object.freeze({ failTrialOnce: true }),
    open: openTemplateTrialError
  }),
  Object.freeze({
    id: "generation-preflight-error",
    label: "Исправление данных перед выпуском",
    mode: "mock",
    view: "generation",
    root: "#documentGenerationStatus",
    focusWithin: false,
    options: Object.freeze({ preflightMissingCount: 1 }),
    open: openGenerationPreflightError
  }),
  Object.freeze({
    id: "operation-error",
    label: "Ошибка фоновой операции и повтор",
    mode: "mock",
    view: "documents",
    root: "#operationCenter",
    focusWithin: false,
    options: Object.freeze({ failOperationsOnce: true }),
    open: openOperationError
  }),
  Object.freeze({
    id: "auth-login",
    label: "Вход по общему паролю",
    mode: "auth",
    root: ".card",
    heading: "Вход",
    focusSelector: "#password",
    configured: true
  }),
  Object.freeze({
    id: "auth-first-run",
    label: "Первый запуск и создание общего пароля",
    mode: "auth",
    root: ".card",
    heading: "Первый запуск",
    focusSelector: "#password",
    configured: false
  })
]);

export function canonicalUiState(id) {
  return CANONICAL_UI_STATES.find((state) => state.id === id) || null;
}

export async function openCanonicalUiState(page, app, state) {
  if (state.mode !== "mock" || typeof state.open !== "function") {
    throw new Error(`Состояние ${state.id} не относится к mocked UI matrix`);
  }
  await state.open(page, app);
}

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-correlation-id": "ui-regression-e2e"
};

function fulfillJson(route, data) {
  return route.fulfill({
    status: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({ data, correlationId: "ui-regression-e2e" })
  });
}

function databaseColumns() {
  return [
    { name: "id", type: "TEXT", notNull: true, primaryKeyPosition: 1 },
    { name: "display_name", type: "TEXT", notNull: true, primaryKeyPosition: 0 },
    { name: "status", type: "TEXT", notNull: true, primaryKeyPosition: 0 }
  ];
}

async function installDatabaseRegressionScenario(page) {
  await page.route("**/api/v1/admin/database/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET") {
      await route.fallback();
      return;
    }

    if (url.pathname === "/api/v1/admin/database/tables") {
      await fulfillJson(route, [
        {
          name: "entities",
          rowCount: 2,
          columns: databaseColumns(),
          label: "Объекты и сотрудники",
          category: "Основные данные",
          description: "Карточки людей и других объектов текущего контура.",
          sensitivity: "personal"
        }
      ]);
      return;
    }

    if (url.pathname === "/api/v1/admin/database/tables/entities/rows") {
      await fulfillJson(route, {
        table: "entities",
        presentation: {
          label: "Объекты и сотрудники",
          category: "Основные данные",
          description: "Карточки людей и других объектов текущего контура.",
          sensitivity: "personal"
        },
        columns: databaseColumns(),
        rows: [
          { id: "entity-1", display_name: "Смирнов Сергей Сергеевич", status: "active" },
          { id: "entity-2", display_name: "Петрова Анна Игоревна", status: "active" }
        ],
        total: 2,
        limit: 50,
        offset: 0,
        sortColumn: "id",
        sortDirection: "asc",
        search: ""
      });
      return;
    }

    if (url.pathname === "/api/v1/admin/database/check") {
      await fulfillJson(route, {
        status: "ok",
        messages: ["ok"],
        foreignKeyErrors: 0
      });
      return;
    }

    await route.fallback();
  });
}

function publicationConfiguration() {
  return {
    publicationEntityTypeKey: "publication",
    teacherEntityTypeKey: "person",
    publicationYearPropertyKey: null,
    publicationDatePropertyKey: null,
    teacherDepartmentPropertyKey: null,
    doiPropertyKey: null,
    journalPropertyKey: null,
    bibliographyPropertyKey: null,
    statusPropertyKey: null
  };
}

function publicationReport() {
  return {
    spaceId: "00000000-0000-4000-8000-000000000001",
    criteria: { year: 2026, includeReview: false },
    generatedAt: "2026-08-18T09:00:00.000Z",
    totals: {
      uniquePublications: 1,
      authorships: 1,
      byClassification: {
        vak: 1,
        rinc: 0,
        mbd: 0,
        scopus: 0,
        web_of_science: 0,
        rinc_core: 0
      },
      withoutDoi: 0,
      truncated: false
    },
    rows: [
      {
        publicationEntityId: "publication-e2e-1",
        title: "Методы испытаний автономных систем",
        year: 2026,
        authors: [
          {
            authorEntityId: "employee-e2e-1",
            displayName: "Сотрудник 1",
            role: "author",
            position: 0
          }
        ],
        departments: ["Испытательная лаборатория"],
        classifications: [
          { code: "vak", label: "ВАК", state: "confirmed", source: "Карточка издания" }
        ],
        doi: "10.1000/ui-regression",
        journal: "Вестник испытаний",
        publicationStatus: "Опубликована"
      }
    ]
  };
}

async function installPublicationRegressionScenario(page, state) {
  state.entityTypes.push({
    key: "publication",
    label: "Научная статья",
    description: "Публикация"
  });
  state.primary.entities.push({
    entityId: "publication-e2e-1",
    displayName: "Методы испытаний автономных систем",
    entityTypeKey: "publication",
    entityTypeLabel: "Научная статья",
    status: "active"
  });

  await page.route(
    /\/api\/v1\/spaces\/[^/]+\/publications\/config(?:\?.*)?$/u,
    (route) => fulfillJson(route, publicationConfiguration())
  );
  await page.route(
    /\/api\/v1\/spaces\/[^/]+\/publications\/reports\/snapshots(?:\?.*)?$/u,
    (route) => fulfillJson(route, [])
  );
  await page.route(
    /\/api\/v1\/spaces\/[^/]+\/publications\/reports\/preview(?:\?.*)?$/u,
    (route) => fulfillJson(route, publicationReport())
  );
  await page.route(
    /\/api\/v1\/spaces\/[^/]+\/publications\/publication-e2e-1\/authors(?:\?.*)?$/u,
    (route) =>
      fulfillJson(route, [
        { authorEntityId: "employee-e2e-1", role: "author", position: 0 }
      ])
  );
  await page.route(
    /\/api\/v1\/spaces\/[^/]+\/publications\/publication-e2e-1\/classifications(?:\?.*)?$/u,
    (route) =>
      fulfillJson(route, [
        { code: "vak", state: "confirmed", source: "Карточка издания" }
      ])
  );
}

async function installGenerationPreflightRegressionScenario(page, state, missingCount) {
  const boundedMissingCount = Math.min(
    Math.max(1, Number(missingCount) || 1),
    Math.max(1, state.primary.entities.length)
  );
  await page.route(/\/api\/v1\/spaces\/[^/]+\/document-jobs\/preflight$/u, (route) => {
    const members = state.primary.entities.map((entity, position) => ({
      position,
      displayName: entity.displayName,
      ready: position >= boundedMissingCount,
      missingRequired:
        position < boundedMissingCount ? [{ key: "person.position", label: "Должность" }] : []
    }));
    return fulfillJson(route, {
      targetMode: "one_per_member",
      memberCount: members.length,
      readyMemberCount: members.length - boundedMissingCount,
      missingMemberCount: boundedMissingCount,
      missingValueCount: boundedMissingCount,
      canStart: members.length > boundedMissingCount,
      members
    });
  });
}

export async function installUiRegressionScenario(page, options = {}) {
  const mockOptions = {
    employeeCount: options.employeeCount ?? 3,
    activeTemplate: options.activeTemplate ?? true,
    ...options
  };
  const state = await installОформляторApiMock(page, mockOptions);

  await page.route("**/api/v1/document-formatting/profiles", (route) =>
    fulfillJson(route, [
      {
        id: "gost-r-7.0.97-2025",
        label: "ГОСТ Р 7.0.97-2025",
        scope: "Базовое оформление организационно-распорядительного DOCX; параметры остаются редактируемыми.",
        settings: {
          profile: "gost-r-7.0.97-2025",
          fontFamily: "Times New Roman",
          fontSizePt: 14,
          lineSpacing: 1.5,
          firstLineIndentMm: 12.5,
          marginsMm: { top: 20, right: 10, bottom: 20, left: 20 },
          bodyAlignment: "both"
        }
      },
      {
        id: "eskd-gost-r-2.105-2019",
        label: "ЕСКД — ГОСТ Р 2.105-2019",
        scope: "Базовое оформление текстового DOCX ЕСКД без синтеза рамок и основных надписей.",
        settings: {
          profile: "eskd-gost-r-2.105-2019",
          fontFamily: "Times New Roman",
          fontSizePt: 14,
          lineSpacing: 1.5,
          firstLineIndentMm: 12.5,
          marginsMm: { top: 20, right: 10, bottom: 20, left: 20 },
          bodyAlignment: "both"
        }
      }
    ])
  );

  if (options.publicationConfigured) {
    await installPublicationRegressionScenario(page, state);
  } else {
    await page.route(
      /\/api\/v1\/spaces\/[^/]+\/publications\/config(?:\?.*)?$/u,
      (route) => fulfillJson(route, null)
    );
    await page.route(
      /\/api\/v1\/spaces\/[^/]+\/publications\/reports\/snapshots(?:\?.*)?$/u,
      (route) => fulfillJson(route, [])
    );
  }

  if (options.preflightMissingCount) {
    await installGenerationPreflightRegressionScenario(
      page,
      state,
      options.preflightMissingCount
    );
  }

  await installDatabaseRegressionScenario(page);

  return state;
}
