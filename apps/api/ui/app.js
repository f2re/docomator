const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  view: "overview",
  tab: "types",
  theme: localStorage.getItem("docomator.theme") || "system",
  loading: false,
  retry: null,
  dialogKind: null,
  data: { types: [], properties: [], entities: [] }
};

const views = {
  overview: ["Рабочее пространство", "Обзор", "Показываем, что уже готово и какой шаг будет полезнее следующим.", "Добавить данные", "entity-type"],
  knowledge: ["Универсальные данные", "База знаний", "Люди, организации и любые типизированные параметры для будущих документов.", "Создать тип", "entity-type"],
  templates: ["Подготовка документов", "Шаблоны", "Безопасная загрузка и разметка DOCX/XLSX запланированы следующим этапом.", null, null],
  documents: ["Формирование", "Документы", "Будущий пошаговый процесс: данные, проверка, рендер и скачивание.", null, null],
  automations: ["События и расписания", "Автоматизации", "Будущие запуски с прозрачными состояниями, историей и управляемыми повторами.", null, null]
};

const tabs = {
  types: {
    label: "Создать тип",
    kind: "entity-type",
    hint: "<strong>Тип сущности</strong> описывает класс объектов. Например, «Человек», «Организация» или «Статья».",
    emoji: "🧱",
    title: "Пока нет типов сущностей",
    text: "Создайте первый тип. После этого можно будет добавлять конкретные объекты и свойства."
  },
  properties: {
    label: "Создать свойство",
    kind: "property",
    hint: "<strong>Свойство</strong> — переиспользуемый параметр: ФИО, рост, вес, должность, ИНН или адрес.",
    emoji: "🏷️",
    title: "Пока нет определений свойств",
    text: "Добавьте параметр и выберите тип данных. Серые подсказки объяснят каждое поле."
  },
  entities: {
    label: "Создать объект",
    kind: "entity",
    hint: "<strong>Объект</strong> — конкретная запись выбранного типа: человек, организация, статья или проект.",
    emoji: "👥",
    title: "Пока нет объектов",
    text: "Сначала создайте тип сущности, затем добавьте конкретные записи."
  }
};

const help = {
  overview: [
    ["Что уже работает?", "База знаний, аудит, очередь, резервное копирование и восстановление. Шаблоны пока не принимаются."],
    ["Почему разделы помечены «Скоро»?", "Сервис не изображает готовую функцию. Недоступный этап показывает причину, будущий процесс и полезное действие сейчас."],
    ["Куда отправляются данные?", "Только на этот локальный сервер. Интерфейс не использует CDN, внешние шрифты, аналитику или облачные API."]
  ],
  knowledge: [
    ["Тип, свойство и объект — в чём разница?", "Тип описывает класс, свойство — параметр, объект — конкретную запись. Например: Человек → Рост → Иванов Иван."],
    ["Что такое стабильный ключ?", "Техническое имя на латинице: person, person.height, organization.inn. Оно остаётся неизменным при переименовании подписи."],
    ["Можно ли добавить необычный параметр?", "Да. Рост, вес, количество животных и другие сведения создаются как обычные типизированные свойства."],
    ["Что означает чувствительность?", "Класс будущего доступа: public, internal, personal или restricted. До внедрения IAM API должен оставаться в доверенном контуре."]
  ],
  templates: [
    ["Почему загрузка ещё закрыта?", "Недоверенный Office-файл нельзя принимать до проверки ZIP, XML, relationships, макросов и лимитов."],
    ["Как подготовиться?", "Соберите пустой шаблон и 1–2 заполненных примера, удалите секреты и перечислите ожидаемые поля."]
  ],
  documents: [
    ["Как будет выглядеть процесс?", "Шаблон → данные → понятные вопросы → проверка → рендер → скачивание или доставка."],
    ["Можно ли работать без ИИ?", "Да. Активированный шаблон обязан заполняться обычной формой при недоступной LLM."]
  ],
  automations: [
    ["Как понять, что происходит с запуском?", "Карточка покажет триггер, этап, использованные данные, следующую попытку и требуемое действие."],
    ["Что будет при нехватке данных?", "Система создаст задачу оператору и не отправит неполный документ."]
  ]
};

const dialogs = {
  "entity-type": {
    eyebrow: "Структура данных",
    title: "Новый тип сущности",
    description: "Опишите класс объектов. Конкретные записи добавляются отдельно.",
    endpoint: "/api/v1/knowledge/entity-types",
    success: "Тип сущности создан",
    submit: "Создать тип",
    fields: [
      ["key", "Стабильный ключ", "text", true, "person", "Латиница без пробелов. Ключ используется шаблонами и не должен меняться."],
      ["label", "Понятное название", "text", true, "Человек", "Эту подпись увидят пользователи."],
      ["description", "Описание", "textarea", false, "Сотрудник, автор или получатель", "Необязательно. Коротко объясните назначение типа."]
    ],
    payload: (v) => compact({ key: v.key, label: v.label, description: v.description })
  },
  property: {
    eyebrow: "Структура данных",
    title: "Новое свойство",
    description: "Создайте параметр, который можно использовать в разных документах.",
    endpoint: "/api/v1/knowledge/property-definitions",
    success: "Свойство создано",
    submit: "Создать свойство",
    fields: [
      ["key", "Стабильный ключ", "text", true, "person.height", "Формат тип.параметр, например person.full_name."],
      ["label", "Название", "text", true, "Рост", "Короткая и понятная подпись."],
      ["valueType", "Тип значения", "value-type", true, "", "Тип определяет проверку и будущий элемент формы."],
      ["unit", "Единица измерения", "text", false, "cm", "Необязательно: cm, kg, RUB или %."],
      ["appliesTo", "Для каких типов", "text", false, "person, applicant", "Ключи через запятую. Пустое значение означает универсальное свойство."],
      ["sensitivity", "Чувствительность", "sensitivity", true, "", "Выберите наиболее строгий подходящий класс."],
      ["description", "Описание", "textarea", false, "Рост человека в сантиметрах", "Помогает редактору шаблонов и локальной модели понять смысл поля."]
    ],
    payload: (v) => compact({ key: v.key, label: v.label, valueType: v.valueType, unit: v.unit, appliesTo: split(v.appliesTo), sensitivity: v.sensitivity, description: v.description })
  },
  entity: {
    eyebrow: "Конкретные данные",
    title: "Новый объект",
    description: "Создайте конкретную запись выбранного типа.",
    endpoint: "/api/v1/knowledge/entities",
    success: "Объект создан",
    submit: "Создать объект",
    fields: [
      ["entityTypeKey", "Тип сущности", "entity-type", true, "", "Тип определяет доступные свойства."],
      ["displayName", "Отображаемое название", "text", true, "Иванов Иван Иванович", "Понятное имя для поиска и выбора."],
      ["status", "Статус", "status", true, "", "Неактивные и архивные записи можно будет скрывать из обычного выбора."]
    ],
    payload: (v) => ({ entityTypeKey: v.entityTypeKey, displayName: v.displayName, status: v.status })
  }
};

class ApiError extends Error {
  constructor(message, correlationId = "", status = 0) {
    super(message);
    this.name = "ApiError";
    this.correlationId = correlationId;
    this.status = status;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0)));
}

function split(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function correlationId() {
  return globalThis.crypto?.randomUUID?.() || `ui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-correlation-id": correlationId(),
      "x-actor-id": "local-ui",
      ...(options.headers || {})
    }
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    throw new ApiError(body?.error?.message || `Сервер вернул код ${response.status}.`, body?.correlationId || response.headers.get("x-correlation-id") || "", response.status);
  }
  return body;
}

function announce(text) {
  $("#screenReaderStatus").textContent = "";
  requestAnimationFrame(() => { $("#screenReaderStatus").textContent = text; });
}

function setConnection(kind, text) {
  const badge = $("#connectionBadge");
  badge.classList.toggle("is-ok", kind === "ok");
  badge.classList.toggle("is-error", kind === "error");
  badge.querySelector("span:last-child").textContent = text;
}

function setStatus(kind, icon, title, detail, retry = null) {
  const ribbon = $("#statusRibbon");
  ribbon.className = `status-ribbon${kind ? ` is-${kind}` : ""}`;
  $("#statusRibbonIcon").textContent = icon;
  $("#statusRibbonTitle").textContent = title;
  $("#statusRibbonDetail").textContent = detail;
  state.retry = retry;
  $("#statusRetryButton").hidden = !retry;
  announce(`${title}. ${detail}`);
}

function notify(icon, title, detail) {
  const toast = document.createElement("article");
  toast.className = "toast";
  toast.innerHTML = `<span aria-hidden="true">${escapeHtml(icon)}</span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div><button type="button" aria-label="Закрыть">×</button>`;
  toast.querySelector("button").addEventListener("click", () => toast.remove());
  $("#toastRegion").append(toast);
  setTimeout(() => toast.remove(), 6500);
}

function applyTheme(theme) {
  state.theme = theme;
  localStorage.setItem("docomator.theme", theme);
  document.documentElement.dataset.theme = theme;
  const labels = { system: ["◐", "Тема: системная"], light: ["☀", "Тема: светлая"], dark: ["☾", "Тема: тёмная"] };
  $("#themeIcon").textContent = labels[theme][0];
  $("#themeLabel").textContent = labels[theme][1];
}

function selectView(view) {
  if (!views[view]) return;
  state.view = view;
  $$("[data-view]").forEach((element) => element.classList.toggle("is-visible", element.dataset.view === view));
  $$("[data-view-target]").forEach((button) => {
    const active = button.dataset.viewTarget === view;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  const [eyebrow, title, description, primaryLabel, primaryKind] = views[view];
  $("#viewEyebrow").textContent = eyebrow;
  $("#viewTitle").textContent = title;
  $("#viewDescription").textContent = description;
  const primary = $("#primaryAction");
  primary.hidden = !primaryLabel;
  primary.dataset.create = primaryKind || "";
  primary.querySelector("span:last-child").textContent = primaryLabel || "";
  if (view === "knowledge") renderKnowledge();
  window.history.replaceState(null, "", `#${view}`);
}

function setTab(tab) {
  if (!tabs[tab]) return;
  state.tab = tab;
  $$('[data-knowledge-tab]').forEach((button) => button.setAttribute("aria-selected", String(button.dataset.knowledgeTab === tab)));
  $("#knowledgeCreateButton span:last-child").textContent = tabs[tab].label;
  $("#knowledgeCreateButton").dataset.create = tabs[tab].kind;
  $("#knowledgeHint").innerHTML = tabs[tab].hint;
  renderKnowledge();
}

function itemText(item) {
  return [item.key, item.label, item.displayName, item.description, item.valueType, item.status].filter(Boolean).join(" ").toLowerCase();
}

function emptyHtml(meta) {
  return `<div class="empty-state"><div><span class="empty-emoji" aria-hidden="true">${meta.emoji}</span><h3>${escapeHtml(meta.title)}</h3><p>${escapeHtml(meta.text)}</p><button class="primary-button" type="button" data-create="${meta.kind}">${escapeHtml(meta.label)}</button></div></div>`;
}

function renderKnowledge() {
  const root = $("#knowledgeContent");
  const meta = tabs[state.tab];
  const query = $("#knowledgeSearch").value.trim().toLowerCase();
  const items = state.data[state.tab].filter((item) => !query || itemText(item).includes(query));
  root.setAttribute("aria-busy", "false");
  if (items.length === 0) {
    root.innerHTML = query ? `<div class="empty-state"><div><span class="empty-emoji">🔎</span><h3>Ничего не найдено</h3><p>Измените запрос. Данные не удалены и фильтр можно очистить.</p><button class="secondary-button" type="button" data-clear-search>Очистить поиск</button></div></div>` : emptyHtml(meta);
    root.querySelector("[data-clear-search]")?.addEventListener("click", () => { $("#knowledgeSearch").value = ""; renderKnowledge(); });
    return;
  }
  root.innerHTML = items.map((item) => {
    if (state.tab === "types") return `<article class="collection-card"><header><div><h3>${escapeHtml(item.label)}</h3><code>${escapeHtml(item.key)}</code></div><span class="pill">Тип</span></header><p>${escapeHtml(item.description || "Описание пока не добавлено.")}</p><div class="card-meta"><span class="pill">v${escapeHtml(item.version || 1)}</span></div></article>`;
    if (state.tab === "properties") return `<article class="collection-card"><header><div><h3>${escapeHtml(item.label)}</h3><code>${escapeHtml(item.key)}</code></div><span class="pill">${escapeHtml(item.valueType)}</span></header><p>${escapeHtml(item.description || "Описание пока не добавлено.")}</p><div class="card-meta"><span class="pill">${escapeHtml(item.sensitivity || "internal")}</span>${item.unit ? `<span class="pill">${escapeHtml(item.unit)}</span>` : ""}</div></article>`;
    return `<article class="collection-card"><header><div><h3>${escapeHtml(item.displayName)}</h3><code>${escapeHtml(item.entityTypeKey || item.entityTypeId || "объект")}</code></div><span class="pill">${escapeHtml(item.status || "active")}</span></header><p>Версия ${escapeHtml(item.version || 1)}. Свойства будут доступны в карточке объекта следующим инкрементом.</p></article>`;
  }).join("");
}

function renderSkeletons() {
  $("#knowledgeContent").setAttribute("aria-busy", "true");
  $("#knowledgeContent").innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>';
}

function renderLoadError(error) {
  $("#knowledgeContent").setAttribute("aria-busy", "false");
  $("#knowledgeContent").innerHTML = `<div class="error-state"><div><span class="empty-emoji" aria-hidden="true">⚠️</span><h3>Не удалось загрузить данные</h3><p>${escapeHtml(error.message)}</p>${error.correlationId ? `<p><code>Correlation ID: ${escapeHtml(error.correlationId)}</code></p>` : ""}<button class="primary-button" type="button" data-retry-load>Повторить загрузку</button></div></div>`;
  $("[data-retry-load]")?.addEventListener("click", loadData);
}

async function loadData() {
  if (state.loading) return;
  state.loading = true;
  $("#refreshButton").disabled = true;
  renderSkeletons();
  setStatus("", "⏳", "Обновляем локальные данные", "Проверяем сервер и получаем структуру базы знаний. Следующий шаг появится автоматически.");
  try {
    const [ready, types, properties, entities] = await Promise.all([
      api("/readyz"),
      api("/api/v1/knowledge/entity-types?limit=500"),
      api("/api/v1/knowledge/property-definitions?limit=500"),
      api("/api/v1/knowledge/entities?limit=500")
    ]);
    state.data.types = types?.data || [];
    state.data.properties = properties?.data || [];
    state.data.entities = entities?.data || [];
    $("#entityTypeCount").textContent = state.data.types.length;
    $("#propertyCount").textContent = state.data.properties.length;
    $("#entityCount").textContent = state.data.entities.length;
    setConnection("ok", "Локальный сервер готов");
    const detail = state.data.types.length === 0 ? "База пока пустая. Начните с типа сущности — остальные шаги интерфейс подскажет." : `Загружено: ${state.data.types.length} типов, ${state.data.properties.length} свойств и ${state.data.entities.length} объектов.`;
    setStatus(ready?.status === "ok" ? "success" : "warning", ready?.status === "ok" ? "✓" : "!", ready?.status === "ok" ? "Данные актуальны" : "Система работает с ограничениями", detail, ready?.status === "ok" ? null : loadData);
    renderKnowledge();
  } catch (cause) {
    const error = cause instanceof ApiError ? cause : new ApiError("Неизвестная ошибка загрузки.");
    setConnection("error", "Нет связи с локальным сервером");
    setStatus("error", "!", "Не удалось обновить данные", `${error.message}${error.correlationId ? ` Correlation ID: ${error.correlationId}.` : ""}`, loadData);
    renderLoadError(error);
  } finally {
    state.loading = false;
    $("#refreshButton").disabled = false;
  }
}

function optionsFor(type) {
  if (type === "value-type") return [["string", "Короткая строка"], ["text", "Длинный текст"], ["number", "Число"], ["integer", "Целое число"], ["boolean", "Да / нет"], ["date", "Дата"], ["date-time", "Дата и время"], ["enum", "Список вариантов"], ["entity-reference", "Ссылка на объект"], ["list", "Список"], ["json", "Структурированные данные"], ["file", "Файл"], ["image", "Изображение"]];
  if (type === "sensitivity") return [["internal", "Внутренние"], ["public", "Публичные"], ["personal", "Персональные"], ["restricted", "Ограниченные"]];
  if (type === "status") return [["active", "Активный"], ["inactive", "Неактивный"], ["archived", "Архивный"]];
  if (type === "entity-type") return state.data.types.map((item) => [item.key, item.label]);
  return null;
}

function fieldHtml([name, label, type, required, placeholder, hint]) {
  const id = `field-${name}`;
  const mark = required ? '<span class="required-marker"> *</span>' : "";
  const requiredAttr = required ? " required" : "";
  const options = optionsFor(type);
  let control;
  if (type === "textarea") control = `<textarea id="${id}" name="${name}" placeholder="${escapeHtml(placeholder)}"${requiredAttr}></textarea>`;
  else if (options) control = `<select id="${id}" name="${name}"${requiredAttr}>${options.map(([value, text]) => `<option value="${escapeHtml(value)}">${escapeHtml(text)}</option>`).join("")}</select>`;
  else control = `<input id="${id}" name="${name}" type="text" placeholder="${escapeHtml(placeholder)}" autocomplete="off"${requiredAttr}>`;
  return `<div class="field"><label for="${id}">${escapeHtml(label)}${mark}</label>${control}<small>${escapeHtml(hint)}</small></div>`;
}

function openDialog(kind) {
  if (!dialogs[kind]) return;
  if (kind === "entity" && state.data.types.length === 0) {
    notify("💡", "Сначала создайте тип сущности", "Без типа система не сможет определить назначение нового объекта.");
    kind = "entity-type";
  }
  state.dialogKind = kind;
  const definition = dialogs[kind];
  $("#dialogEyebrow").textContent = definition.eyebrow;
  $("#dialogTitle").textContent = definition.title;
  $("#dialogDescription").textContent = definition.description;
  $("#dialogFields").innerHTML = definition.fields.map(fieldHtml).join("");
  $("#dialogSubmitButton").textContent = definition.submit;
  $("#dialogSubmitButton").disabled = false;
  $("#formError").hidden = true;
  $("#createDialog").showModal();
  requestAnimationFrame(() => $("#dialogFields input, #dialogFields select, #dialogFields textarea")?.focus());
}

function closeDialog() {
  if ($("#createDialog").open) $("#createDialog").close();
  state.dialogKind = null;
}

async function submitDialog(event) {
  event.preventDefault();
  const kind = state.dialogKind;
  const definition = dialogs[kind];
  if (!definition) return;
  if (!event.currentTarget.reportValidity()) {
    $("#formError").hidden = false;
    $("#formError").textContent = "Проверьте обязательные поля. Введённые значения сохранены в форме.";
    return;
  }
  const button = $("#dialogSubmitButton");
  button.disabled = true;
  button.textContent = "Сохраняем…";
  $("#formError").hidden = true;
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());
  setStatus("", "⏳", "Сохраняем запись", "Проверяем значения и записываем изменение вместе с аудитом. Форма закроется после подтверждения сервера.");
  try {
    const result = await api(definition.endpoint, { method: "POST", body: JSON.stringify(definition.payload(values)) });
    closeDialog();
    notify("✅", definition.success, "Запись подтверждена сервером и доступна в базе знаний.");
    setStatus("success", "✓", definition.success, `Операция завершена. Correlation ID: ${result?.correlationId || "не указан"}.`);
    await loadData();
    selectView("knowledge");
    if (kind === "property") setTab("properties");
    if (kind === "entity") setTab("entities");
  } catch (cause) {
    const error = cause instanceof ApiError ? cause : new ApiError("Не удалось сохранить запись.");
    $("#formError").hidden = false;
    $("#formError").innerHTML = `${escapeHtml(error.message)}${error.correlationId ? `<code>Correlation ID: ${escapeHtml(error.correlationId)}</code>` : ""}`;
    setStatus("error", "!", "Запись не сохранена", "Введённые данные остались в форме. Исправьте причину или повторите действие.");
  } finally {
    button.disabled = false;
    button.textContent = definition.submit;
  }
}

let helpReturnFocus = null;
function openHelp() {
  helpReturnFocus = document.activeElement;
  $("#helpContent").innerHTML = (help[state.view] || help.overview).map(([question, answer]) => `<article class="help-question"><h3>${escapeHtml(question)}</h3><p>${escapeHtml(answer)}</p></article>`).join("");
  $("#helpDrawer").classList.add("is-open");
  $("#helpDrawer").setAttribute("aria-hidden", "false");
  $("#helpDrawer button[data-close-help]")?.focus();
}
function closeHelp() {
  $("#helpDrawer").classList.remove("is-open");
  $("#helpDrawer").setAttribute("aria-hidden", "true");
  helpReturnFocus?.focus?.();
}

function attachEvents() {
  document.addEventListener("click", (event) => {
    const view = event.target.closest("[data-view-target]");
    if (view) selectView(view.dataset.viewTarget);
    const create = event.target.closest("[data-create]");
    if (create) openDialog(create.dataset.create);
    if (event.target.closest("[data-close-help]")) closeHelp();
  });
  $$('[data-knowledge-tab]').forEach((button) => button.addEventListener("click", () => setTab(button.dataset.knowledgeTab)));
  $("#knowledgeSearch").addEventListener("input", renderKnowledge);
  $("#refreshButton").addEventListener("click", loadData);
  $("#statusRetryButton").addEventListener("click", () => state.retry?.());
  $("#themeButton").addEventListener("click", () => applyTheme({ system: "light", light: "dark", dark: "system" }[state.theme]));
  $("#helpButton").addEventListener("click", openHelp);
  $("#mobileHelpButton").addEventListener("click", openHelp);
  $("#overviewHelpButton").addEventListener("click", openHelp);
  $("#dialogCloseButton").addEventListener("click", closeDialog);
  $("#dialogCancelButton").addEventListener("click", closeDialog);
  $("#createForm").addEventListener("submit", submitDialog);
  $("#createDialog").addEventListener("cancel", (event) => { event.preventDefault(); closeDialog(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeHelp(); });
  window.addEventListener("online", loadData);
  window.addEventListener("offline", () => {
    setConnection("error", "Браузер не видит сеть");
    setStatus("warning", "!", "Соединение прервано", "Введённые данные не удалены. После восстановления подключения нажмите «Повторить».", loadData);
  });
}

applyTheme(state.theme);
attachEvents();
selectView(location.hash.slice(1) in views ? location.hash.slice(1) : "overview");
loadData();
