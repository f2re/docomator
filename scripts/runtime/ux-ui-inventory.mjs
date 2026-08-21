export const UI_REGRESSION_INVENTORY_VERSION = 2;

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

export const CANONICAL_UI_STATES = Object.freeze([
  Object.freeze({
    id: "employee-card",
    label: "Добавление сотрудника",
    view: "employees",
    selector: "#employeeDialog",
    expectedText: "Сотрудник",
    runner: "critical-state",
    checks: Object.freeze(["overflow", "touch", "axe", "zoom", "keyboard"])
  }),
  Object.freeze({
    id: "employee-import",
    label: "Импорт сотрудников",
    view: "employees",
    selector: "#bulkDataImportPanel",
    expectedText: "Импортировать список",
    runner: "critical-state",
    checks: Object.freeze(["overflow", "touch", "axe", "zoom", "keyboard"])
  }),
  Object.freeze({
    id: "entity-import",
    label: "Импорт произвольных объектов",
    view: "entities",
    selector: "#entityImportDialog",
    expectedText: "Импорт",
    runner: "critical-state",
    checks: Object.freeze(["overflow", "touch", "axe", "zoom", "keyboard"])
  }),
  Object.freeze({
    id: "publication-relations",
    label: "Связи публикации",
    view: "publications",
    selector: "#publicationRelationsDialog",
    expectedText: "Авторы и классификация",
    runner: "critical-state",
    checks: Object.freeze(["overflow", "touch", "axe", "zoom", "keyboard"])
  }),
  Object.freeze({
    id: "template-trial-error",
    label: "Ошибка пробного заполнения шаблона",
    view: "templates",
    selector: "#templateTrialResult",
    expectedText: "Пробное заполнение не прошло",
    runner: "critical-state",
    checks: Object.freeze(["overflow", "touch", "axe", "zoom", "recovery", "state-preservation", "correlation-id"])
  }),
  Object.freeze({
    id: "generation-preflight",
    label: "Незаполненные обязательные данные выпуска",
    view: "generation",
    selector: "#documentGenerationStatus",
    expectedText: "Найдены незаполненные обязательные поля",
    runner: "critical-state",
    checks: Object.freeze(["overflow", "touch", "axe", "zoom", "recovery"])
  }),
  Object.freeze({
    id: "operation-error",
    label: "Ошибка центра операций",
    view: "documents",
    selector: "#operationCenter",
    expectedText: "Не удалось получить операции",
    runner: "critical-state",
    checks: Object.freeze(["overflow", "touch", "axe", "zoom", "recovery", "state-preservation", "correlation-id"])
  }),
  Object.freeze({
    id: "login",
    label: "Вход по общему паролю",
    view: null,
    selector: "#password",
    expectedText: "Вход",
    runner: "password-gate",
    checks: Object.freeze(["overflow", "touch", "zoom", "keyboard", "error", "session"])
  }),
  Object.freeze({
    id: "first-run",
    label: "Первый запуск",
    view: null,
    selector: "#confirmation",
    expectedText: "Первый запуск",
    runner: "password-gate",
    checks: Object.freeze(["overflow", "touch", "zoom", "keyboard", "state-preservation", "session"])
  })
]);

export function canonicalUiState(id) {
  const state = CANONICAL_UI_STATES.find((candidate) => candidate.id === id);
  if (!state) throw new Error(`Неизвестное каноническое состояние UI: ${id}`);
  return state;
}

export function canonicalViewAxeTitle(label) {
  return `экран «${label}» не содержит машинно-выявляемых нарушений WCAG`;
}

export function canonicalStateTestTitle(label) {
  return `критическое состояние «${label}» входит в общую regression-матрицу`;
}
