const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const DEFAULT_SPACE_ID = "00000000-0000-4000-8000-000000000001";

const displayNames = Object.freeze({
  valueTypes: {
    string: "Короткая строка",
    text: "Длинный текст",
    number: "Число",
    integer: "Целое число",
    boolean: "Да / нет",
    date: "Дата",
    "date-time": "Дата и время",
    enum: "Список вариантов",
    "entity-reference": "Ссылка на объект",
    list: "Список",
    json: "Структурированные данные",
    file: "Файл",
    image: "Изображение"
  },
  sensitivity: {
    public: "Открытые",
    internal: "Внутренние",
    personal: "Персональные",
    restricted: "Ограниченные"
  },
  entityStatus: {
    active: "Активный",
    inactive: "Неактивный",
    archived: "Архивный"
  },
  spaceRole: {
    owner: "Владелец",
    manager: "Руководитель",
    editor: "Редактор",
    viewer: "Наблюдатель"
  },
  membershipStatus: {
    active: "Доступ включён",
    inactive: "Доступ отключён"
  }
});

function displayLabel(group, value) {
  return displayNames[group]?.[value] || String(value ?? "Не указано");
}

const state = {
  view: "overview",
  knowledgeTab: "types",
  spaceTab: "members",
  theme: localStorage.getItem("docomator.theme") || "system",
  loading: false,
  spaceLoading: false,
  retry: null,
  dialogKind: null,
  employee: {
    loading: false,
    loaded: false,
    editingId: null,
    fieldConfirmed: false,
    idempotencyKey: "",
    lastSavedName: ""
  },
  templateCatalog: {
    loading: false,
    loaded: false,
    error: false
  },
  currentSpaceId: localStorage.getItem("docomator.space") || DEFAULT_SPACE_ID,
  selectedEntityIds: new Set(),
  lastPlan: null,
  data: {
    types: [],
    properties: [],
    spaces: [],
    employees: [],
    activeTemplates: [],
    spaceEntities: [],
    groups: [],
    snapshots: [],
    access: []
  }
};

function publishCurrentSpace() {
  window.docomatorCurrentSpaceId = state.currentSpaceId || "";
  document.dispatchEvent(new CustomEvent("docomator:space-changed", {
    detail: { spaceId: window.docomatorCurrentSpaceId }
  }));
}

const views = {
  overview: ["Рабочий стол", "Главная", "Следующий понятный шаг к готовым документам.", null, null],
  employees: ["Карточки людей", "Сотрудники", "Добавляйте людей и нужные для документов сведения в одном месте.", null, null],
  spaces: ["Изолированные наборы", "Пространства", "Люди, группы и точный план будущего документа.", "Создать пространство", "space"],
  knowledge: ["Общая схема", "Типы и свойства", "Переиспользуемая структура данных для всех пространств.", "Создать тип", "entity-type"],
  templates: ["Документ-основа", "Шаблоны", "Подключите DOCX или XLSX и сопоставьте поля по понятным названиям.", null, null],
  generation: ["Новый выпуск", "Создать документы", "Выберите шаблон, сотрудников и проверьте итог перед запуском.", null, null],
  documents: ["Готовые файлы", "Результаты", "Скачивайте документы, комплекты и повторяйте только неуспешные строки.", null, null],
  automations: ["Повторные выпуски", "Расписания", "Управляйте запланированными выпусками и смотрите их состояние.", null, null],
  settings: ["Дополнительные возможности", "Настройки", "Организация данных, доступ и диагностика.", null, null]
};

const knowledgeTabs = {
  types: {
    label: "Создать тип",
    kind: "entity-type",
    hint: "<strong>Тип сущности</strong> описывает класс объектов. Например, «Человек», «Организация» или «Статья».",
    emoji: "🧱",
    title: "Пока нет типов сущностей",
    text: "Создайте первый тип. После этого внутри пространства можно добавлять конкретных людей и организации."
  },
  properties: {
    label: "Создать свойство",
    kind: "property",
    hint: "<strong>Свойство</strong> — переиспользуемый параметр: ФИО, рост, вес, должность, ИНН или количество животных.",
    emoji: "🏷️",
    title: "Пока нет определений свойств",
    text: "Добавьте параметр и выберите тип данных. Серые подсказки объяснят назначение каждого поля."
  }
};

const help = {
  overview: [
    ["Зачем нужны пространства?", "Они не дают смешать людей, группы и будущие документы разных подразделений, проектов или заказчиков."],
    ["Можно сделать один документ на всех?", "Да. Режим «Один общий документ» передаёт шаблону упорядоченный список участников для таблицы или перечня."],
    ["Можно сделать отдельный документ каждому?", "Да. Режим «По документу на каждого» создаёт отдельную единицу будущего запуска для каждого участника."],
    ["Куда отправляются данные?", "Только на локальный сервер. Интерфейс не использует внешние хранилища, шрифты, аналитику или облачные службы."]
  ],
  employees: [
    ["Как добавить новое поле?", "Откройте карточку сотрудника и нажмите «Добавить поле». Назовите его обычными словами, например «Должность»."],
    ["Поле появится только у одного человека?", "Нет. После подтверждения поле станет доступно во всех карточках, а введённое значение сохранится у выбранного сотрудника."],
    ["Где хранятся данные?", "На локальном сервере Docomator. Интерфейс не передаёт карточки внешним службам."]
  ],
  spaces: [
    ["Пространство и группа — это одно?", "Нет. Пространство является границей изоляции. Группа — сохранённый набор людей только внутри этого пространства."],
    ["Что такое снимок аудитории?", "Неизменяемая фиксация выбранных людей, их порядка и режима результата. Позднее изменение группы не меняет уже начатый запуск."],
    ["Что значит «отмеченные»?", "Это разовый выбор флажками. Его можно сразу зафиксировать для документа или сохранить как именованную группу."],
    ["Почему общий документ пока не скачивается?", "Серверная часть уже строит точный план и состав. Запись списка в DOCX/XLSX появится вместе с компилятором шаблонов."]
  ],
  knowledge: [
    ["Почему здесь нет списка людей?", "Конкретные люди находятся в пространствах, чтобы не показывать данные одного подразделения в другом. Здесь хранится только общая схема типов и свойств."],
    ["Что такое стабильный ключ?", "Техническое имя на латинице: person, person.height, organization.inn. Оно остаётся неизменным при смене понятной подписи."],
    ["Можно добавить необычный параметр?", "Да. Рост, вес, количество животных и другие сведения создаются как обычные типизированные свойства."],
    ["Что означает чувствительность?", "Будущий класс доступа: открытые, внутренние, персональные или ограниченные сведения. Проверка прав будет выполняться до обращения к локальной модели, формирования и доставки."]
  ],
templates: [
  ["Что именно проверяет система?", "Размеры и число частей, опасные пути, подозрительное сжатие, макросы, ActiveX, встроенные объекты, цифровые подписи и внешние связи."],
  ["Сохраняется ли выбранный файл?", "Нет. Текущий этап только проверяет структуру в памяти. Сохранение версии шаблона появится после построения структурного представления документа."],
  ["Что означает «принят с замечаниями»?", "Файл не содержит блокирующих особенностей, но результат будущего формирования потребует пробной проверки."],
  ["Почему файл может быть отклонён?", "Система отклоняет повреждённые архивы, небезопасные пути, шифрованные части, макросы и превышение защитных ограничений."]
],
  documents: [
    ["Как будет выглядеть процесс?", "Пространство → состав → форма результата → данные → проверка → формирование → скачивание или доставка."],
    ["Можно работать без ИИ?", "Да. Активированный шаблон обязан заполняться обычной формой при недоступной локальной модели."]
  ],
  automations: [
    ["Как правило выберет людей?", "Оно будет привязано к пространству и выберет всех активных, именованную группу или вычисленную выборку."],
    ["Что будет при нехватке данных?", "Система создаст задачу оператору и не отправит неполный документ."]
  ]
};

const dialogs = {
  "entity-type": {
    eyebrow: "Структура данных",
    title: "Новый тип сущности",
    description: "Опишите класс объектов. Конкретные записи добавляются внутри пространства.",
    endpoint: "/api/v1/knowledge/entity-types",
    success: "Тип сущности создан",
    submit: "Создать тип",
    fields: [
      ["label", "Понятное название", "text", true, "Человек", "Эту подпись увидят пользователи."],
      ["description", "Описание", "textarea", false, "Сотрудник, автор или получатель", "Необязательно. Коротко объясните назначение типа."]
    ],
    payload: (values) => compact({ label: values.label, description: values.description })
  },
  property: {
    eyebrow: "Структура данных",
    title: "Новое свойство",
    description: "Создайте параметр, который можно использовать в разных пространствах и документах.",
    endpoint: "/api/v1/knowledge/property-definitions",
    success: "Свойство создано",
    submit: "Создать свойство",
    fields: [
      ["label", "Название", "text", true, "Рост", "Короткая и понятная подпись."],
      ["valueType", "Тип значения", "value-type", true, "", "Тип определяет проверку и будущий элемент формы."],
      ["unit", "Единица измерения", "text", false, "cm", "Необязательно: cm, kg, RUB или %."],
      ["sensitivity", "Чувствительность", "sensitivity", true, "", "Выберите наиболее строгий подходящий класс."],
      ["description", "Описание", "textarea", false, "Рост человека в сантиметрах", "Помогает редактору шаблонов и локальной модели понять смысл поля."]
    ],
    payload: (values) => compact({ label: values.label, valueType: values.valueType, unit: values.unit, sensitivity: values.sensitivity, description: values.description })
  },
  space: {
    eyebrow: "Изоляция данных",
    title: "Новое пространство",
    description: "Создайте отдельный контур для подразделения, проекта или заказчика.",
    endpoint: "/api/v1/spaces",
    success: "Пространство создано",
    submit: "Создать пространство",
    fields: [
      ["name", "Понятное название", "text", true, "Инженерная служба", "Название показывается в переключателе пространства."],
      ["description", "Описание", "textarea", false, "Сотрудники и документы инженерной службы", "Объясните, какие данные должны находиться только здесь."]
    ],
    payload: (values) => compact({ name: values.name, description: values.description })
  },
  "space-entity": {
    eyebrow: "Участники пространства",
    title: "Новый участник",
    description: "Запись будет принадлежать только текущему пространству.",
    endpoint: () => spaceEndpoint("/entities"),
    success: "Участник добавлен",
    submit: "Добавить участника",
    fields: [
      ["entityTypeKey", "Тип сущности", "entity-type", true, "", "Обычно это тип «Человек», но пространство может содержать и другие объекты."],
      ["displayName", "Отображаемое имя", "text", true, "Иванов Иван Иванович", "Понятное имя для поиска, выбора и будущего документа."],
      ["status", "Статус", "status", true, "", "В обычную аудиторию автоматически входят только активные записи."]
    ],
    payload: (values) => ({ entityTypeKey: values.entityTypeKey, displayName: values.displayName, status: values.status })
  },
  group: {
    eyebrow: "Повторная аудитория",
    title: "Новая группа",
    description: "Сохраните отмеченных участников под понятным названием.",
    endpoint: () => spaceEndpoint("/groups"),
    success: "Группа создана",
    submit: "Создать группу",
    fields: [
      ["name", "Название группы", "text", true, "Ежемесячный отчёт", "Название будет показано при выборе аудитории."],
      ["description", "Описание", "textarea", false, "Участники ежемесячного сводного отчёта", "Необязательно. Укажите назначение группы."]
    ],
    payload: (values) => compact({ name: values.name, description: values.description }),
    afterCreate: async (created) => {
      await api(spaceEndpoint(`/groups/${encodeURIComponent(created.id)}/members`), {
        method: "PUT",
        body: JSON.stringify({ entityIds: [...state.selectedEntityIds] })
      });
    }
  },
  "space-access": {
    eyebrow: "Доступ к пространству",
    title: "Добавить пользователя приложения",
    description: "Укажите внутренний идентификатор пользователя и его роль в текущем пространстве.",
    endpoint: (values) => spaceEndpoint(`/access-members/${encodeURIComponent(values.actorId)}`),
    method: "PUT",
    success: "Доступ обновлён",
    submit: "Сохранить доступ",
    fields: [
      ["actorId", "Идентификатор пользователя", "text", true, "user-42", "Внутренний идентификатор локальной учётной записи. Раздел управления учётными записями будет добавлен отдельным этапом."],
      ["role", "Роль", "space-role", true, "", "Владелец управляет пространством; руководитель — составом; редактор — данными; наблюдатель — только просматривает."],
      ["status", "Статус доступа", "membership-status", true, "", "Неактивный доступ сохраняется в истории, но не разрешает вход."]
    ],
    payload: (values) => ({ role: values.role, status: values.status })
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

function requestCorrelationId() {
  return globalThis.crypto?.randomUUID?.() || `ui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function currentSpace() {
  return state.data.spaces.find((space) => space.id === state.currentSpaceId) || null;
}

function spaceEndpoint(pathname = "") {
  if (!state.currentSpaceId) throw new ApiError("Сначала выберите пространство.");
  return `/api/v1/spaces/${encodeURIComponent(state.currentSpaceId)}${pathname}`;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-correlation-id": requestCorrelationId(),
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
  $$('[data-view]').forEach((element) => element.classList.toggle("is-visible", element.dataset.view === view));
  $$('[data-view-target]').forEach((button) => {
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
  delete primary.dataset.employeeAction;
  primary.querySelector("span:last-child").textContent = primaryLabel || "";
  if (view === "knowledge") renderKnowledge();
  if (view === "spaces") renderSpaces();
  if (view === "employees" && state.data.spaces.length > 0 && !state.employee.loaded) void loadEmployees();
  window.history.replaceState(null, "", `#${view}`);
  window.dispatchEvent(new CustomEvent("docomator:view-changed", { detail: { view } }));
}

globalThis.docomatorSelectView = selectView;

function setKnowledgeTab(tab) {
  if (!knowledgeTabs[tab]) return;
  state.knowledgeTab = tab;
  $$('[data-knowledge-tab]').forEach((button) => button.setAttribute("aria-selected", String(button.dataset.knowledgeTab === tab)));
  const meta = knowledgeTabs[tab];
  $("#knowledgeCreateButton span:last-child").textContent = meta.label;
  $("#knowledgeCreateButton").dataset.create = meta.kind;
  $("#knowledgeHint").innerHTML = meta.hint;
  renderKnowledge();
}

function setSpaceTab(tab) {
  if (!['members', 'groups', 'audience', 'access'].includes(tab)) return;
  state.spaceTab = tab;
  $$('[data-space-tab]').forEach((button) => button.setAttribute("aria-selected", String(button.dataset.spaceTab === tab)));
  $$('[data-space-pane]').forEach((pane) => pane.classList.toggle("is-visible", pane.dataset.spacePane === tab));
  if (tab === "audience") updateAudiencePreview();
}

function itemText(item) {
  return [item.key, item.label, item.name, item.displayName, item.description, item.valueType, item.status].filter(Boolean).join(" ").toLowerCase();
}

function emptyHtml(meta) {
  return `<div class="empty-state"><div><span class="empty-emoji" aria-hidden="true">${meta.emoji}</span><h3>${escapeHtml(meta.title)}</h3><p>${escapeHtml(meta.text)}</p><button class="primary-button" type="button" data-create="${escapeHtml(meta.kind)}">${escapeHtml(meta.label)}</button></div></div>`;
}

function renderKnowledge() {
  const root = $("#knowledgeContent");
  const meta = knowledgeTabs[state.knowledgeTab];
  const query = $("#knowledgeSearch").value.trim().toLowerCase();
  const items = state.data[state.knowledgeTab].filter((item) => !query || itemText(item).includes(query));
  root.setAttribute("aria-busy", "false");
  if (items.length === 0) {
    root.innerHTML = query ? `<div class="empty-state"><div><span class="empty-emoji" aria-hidden="true">🔎</span><h3>Ничего не найдено</h3><p>Измените запрос. Данные не удалены и фильтр можно очистить.</p><button class="secondary-button" type="button" data-clear-search>Очистить поиск</button></div></div>` : emptyHtml(meta);
    return;
  }
  root.innerHTML = items.map((item) => {
    const technical = `<details class="technical-details"><summary>Технические сведения</summary><dl><div><dt>Системное обозначение</dt><dd><code>${escapeHtml(item.key)}</code></dd></div></dl></details>`;
    if (state.knowledgeTab === "types") return `<article class="collection-card"><header><div><h3>${escapeHtml(item.label)}</h3></div><span class="pill">Тип</span></header><p>${escapeHtml(item.description || "Описание пока не добавлено.")}</p>${technical}</article>`;
    return `<article class="collection-card"><header><div><h3>${escapeHtml(item.label)}</h3></div><span class="pill">${escapeHtml(displayLabel("valueTypes", item.valueType))}</span></header><p>${escapeHtml(item.description || "Описание пока не добавлено.")}</p><div class="card-meta"><span class="pill">${escapeHtml(displayLabel("sensitivity", item.sensitivity || "internal"))}</span>${item.unit ? `<span class="pill">${escapeHtml(item.unit)}</span>` : ""}</div>${technical}</article>`;
  }).join("");
}

function renderSpaceList() {
  const root = $("#spaceList");
  if (state.data.spaces.length === 0) {
    root.innerHTML = '<div class="mini-empty"><span aria-hidden="true">🧑‍🤝‍🧑</span><p>Создайте первое пространство.</p></div>';
    return;
  }
  root.innerHTML = state.data.spaces.map((space) => `<button class="workspace-list-item${space.id === state.currentSpaceId ? " is-active" : ""}" type="button" data-space-id="${escapeHtml(space.id)}"><span class="workspace-avatar" aria-hidden="true">${escapeHtml((space.name || "П").slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(space.name)}</strong><small>${space.entityCount} участников · ${space.groupCount} групп</small></span>${space.id === state.currentSpaceId ? '<span class="current-marker" aria-label="Выбрано">✓</span>' : ""}</button>`).join("");
}

function renderSpaceSummary() {
  const space = currentSpace();
  const chip = $("#currentSpaceChip");
  if (!space) {
    chip.hidden = true;
    $("#spaceName").textContent = "Пространство не выбрано";
    $("#spaceDescription").textContent = "Создайте пространство, чтобы добавить участников.";
    return;
  }
  chip.hidden = false;
  $("#currentSpaceChipText").textContent = space.name;
  $("#spaceName").textContent = space.name;
  $("#spaceDescription").textContent = space.description || `Изолированный контур «${space.name}». Здесь ${state.data.spaceEntities.length} участников и ${state.data.groups.length} групп.`;
}

function renderMembers() {
  const root = $("#spaceMembers");
  if (!currentSpace()) {
    root.innerHTML = '<div class="empty-state compact-empty"><div><span class="empty-emoji" aria-hidden="true">🧑‍🤝‍🧑</span><h3>Нет пространства</h3><p>Сначала создайте или выберите пространство.</p></div></div>';
    return;
  }
  if (state.data.spaceEntities.length === 0) {
    root.innerHTML = '<div class="empty-state compact-empty"><div><span class="empty-emoji" aria-hidden="true">👤</span><h3>В пространстве пока нет участников</h3><p>Добавьте первого человека. Он будет доступен только в этом пространстве.</p><button class="primary-button" type="button" data-create="space-entity">Добавить участника</button></div></div>';
    updateSelectedCount();
    return;
  }
  root.innerHTML = state.data.spaceEntities.map((entity) => `<label class="member-row${state.selectedEntityIds.has(entity.entityId) ? " is-selected" : ""}"><input type="checkbox" data-select-entity="${escapeHtml(entity.entityId)}" ${state.selectedEntityIds.has(entity.entityId) ? "checked" : ""} /><span class="member-avatar" aria-hidden="true">${escapeHtml(entity.displayName.slice(0, 1).toUpperCase())}</span><span class="member-copy"><strong>${escapeHtml(entity.displayName)}</strong><small>${escapeHtml(entity.entityTypeLabel)} · ${escapeHtml(displayLabel("entityStatus", entity.status))}</small></span><span class="member-check" aria-hidden="true">✓</span></label>`).join("");
  updateSelectedCount();
}

function renderGroups() {
  const root = $("#spaceGroups");
  if (state.data.groups.length === 0) {
    root.innerHTML = '<div class="empty-state compact-empty"><div><span class="empty-emoji" aria-hidden="true">🗃️</span><h3>Пока нет групп</h3><p>Отметьте участников на вкладке «Участники», затем сохраните выбор под понятным названием.</p><button class="secondary-button" type="button" data-space-tab-target="members">Отметить участников</button></div></div>';
    return;
  }
  root.innerHTML = state.data.groups.map((group) => `<article class="collection-card group-card"><header><div><h3>${escapeHtml(group.name)}</h3></div><span class="pill">${group.memberCount} чел.</span></header><p>${escapeHtml(group.description || "Описание не добавлено.")}</p><div class="card-actions"><button class="text-button" type="button" data-edit-group="${escapeHtml(group.id)}">Показать состав</button><button class="secondary-button compact-button" type="button" data-use-group="${escapeHtml(group.id)}">Использовать для документа</button></div><details class="technical-details"><summary>Технические сведения</summary><dl><div><dt>Системное обозначение</dt><dd><code>${escapeHtml(group.key)}</code></dd></div></dl></details></article>`).join("");
}

function renderAccess() {
  const root = $("#spaceAccess");
  if (state.data.access.length === 0) {
    root.innerHTML = '<div class="empty-state compact-empty"><div><span class="empty-emoji" aria-hidden="true">🔐</span><h3>Дополнительный доступ не настроен</h3><p>Создатель пространства уже имеет роль владельца. При необходимости добавьте внутренний идентификатор другого пользователя.</p><button class="primary-button" type="button" data-create="space-access">Добавить доступ</button></div></div>';
    return;
  }
  root.innerHTML = state.data.access.map((member) => `<article class="access-row"><span class="member-avatar" aria-hidden="true">🔑</span><span><strong>${escapeHtml(member.actorId)}</strong><small>Роль: ${escapeHtml(displayLabel("spaceRole", member.role))} · ${escapeHtml(displayLabel("membershipStatus", member.status))}</small></span><span class="pill">Версия ${member.version}</span></article>`).join("");
}

function sourceLabel(snapshot) {
  if (snapshot.sourceKind === "all_space") return "Все активные";
  if (snapshot.sourceKind === "group") return "Сохранённая группа";
  return "Отмеченные вручную";
}

function modeLabel(mode) {
  return mode === "aggregate" ? "Один общий документ" : "По документу на каждого";
}

function renderSnapshots() {
  const root = $("#audienceSnapshots");
  if (state.data.snapshots.length === 0) {
    root.innerHTML = '<div class="mini-empty horizontal"><span aria-hidden="true">📸</span><p>Снимков пока нет. Подготовьте первый план выше.</p></div>';
    return;
  }
  root.innerHTML = state.data.snapshots.map((snapshot) => `<button class="snapshot-row" type="button" data-open-snapshot="${escapeHtml(snapshot.id)}"><span class="snapshot-icon" aria-hidden="true">${snapshot.targetMode === "aggregate" ? "📋" : "📄"}</span><span><strong>${escapeHtml(modeLabel(snapshot.targetMode))}</strong><small>${escapeHtml(sourceLabel(snapshot))} · ${snapshot.memberCount} участников · ${escapeHtml(new Date(snapshot.createdAt).toLocaleString("ru-RU"))}</small></span><span aria-hidden="true">›</span></button>`).join("");
}

function renderAudienceSource() {
  const select = $("#audienceSource");
  const previous = select.value;
  const selectedCount = state.selectedEntityIds.size;
  const options = [
    ["all_space", `Все активные участники (${state.data.spaceEntities.filter((entity) => entity.status === "active").length})`],
    ["selected", `Только отмеченные (${selectedCount})`],
    ...state.data.groups.filter((group) => group.status === "active").map((group) => [`group:${group.id}`, `Группа «${group.name}» (${group.memberCount})`])
  ];
  select.innerHTML = options.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
  if (options.some(([value]) => value === previous)) select.value = previous;
  updateAudiencePreview();
}

function estimatedAudienceCount() {
  const source = $("#audienceSource")?.value || "all_space";
  if (source === "selected") return state.selectedEntityIds.size;
  if (source.startsWith("group:")) return state.data.groups.find((group) => `group:${group.id}` === source)?.memberCount || 0;
  return state.data.spaceEntities.filter((entity) => entity.status === "active").length;
}

function updateAudiencePreview() {
  const target = $("#audiencePreviewText");
  if (!target) return;
  const count = estimatedAudienceCount();
  const mode = $('input[name="targetMode"]:checked')?.value || "aggregate";
  if (count === 0) {
    target.textContent = "В выбранном источнике нет активных участников. Добавьте людей или измените выбор.";
    return;
  }
  target.textContent = mode === "aggregate"
    ? `Будет подготовлен 1 документ с таблицей или списком из ${count} участников.`
    : `Будет подготовлено ${count} отдельных документов — по одному на каждого участника.`;
}

function renderPlan(result) {
  state.lastPlan = result;
  const root = $("#audiencePlan");
  const { snapshot, plan } = result;
  const memberNames = snapshot.members.map((member) => member.displayName);
  root.innerHTML = `<article class="panel plan-card is-success"><div class="plan-icon" aria-hidden="true">${plan.targetMode === "aggregate" ? "📋" : "📄"}</div><div><p class="eyebrow">Состав зафиксирован</p><h2>${escapeHtml(modeLabel(plan.targetMode))}</h2><p>${plan.targetMode === "aggregate" ? `Создаётся одно задание. Шаблон получит упорядоченный список из ${snapshot.memberCount} участников.` : `Создаётся ${plan.documentCount} независимых заданий — каждое со своим основным участником.`}</p><div class="member-chip-list">${memberNames.slice(0, 12).map((name) => `<span class="pill">${escapeHtml(name)}</span>`).join("")}${memberNames.length > 12 ? `<span class="pill">ещё ${memberNames.length - 12}</span>` : ""}</div><small>Изменение группы не изменит этот состав.</small><details class="technical-details"><summary>Технические сведения</summary><dl><div><dt>Идентификатор состава</dt><dd><code>${escapeHtml(snapshot.id)}</code></dd></div></dl></details></div></article>`;
  root.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
}

function renderSpaces() {
  renderSpaceList();
  renderSpaceSummary();
  renderMembers();
  renderGroups();
  renderAccess();
  renderAudienceSource();
  renderSnapshots();
  setSpaceTab(state.spaceTab);
}

function updateMetrics() {
  $("#spaceCount").textContent = state.data.spaces.length;
  $("#spaceEntityCount").textContent = state.data.spaceEntities.length;
  $("#groupCount").textContent = state.data.groups.length;
  $("#snapshotCount").textContent = state.data.snapshots.length;
}

function updateSelectedCount() {
  const count = state.selectedEntityIds.size;
  $("#selectedCount").textContent = `${count} отмечено`;
  renderAudienceSource();
}

function renderLoadingStates() {
  $("#knowledgeContent").setAttribute("aria-busy", "true");
  $("#knowledgeContent").innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>';
  $("#spaceList").innerHTML = '<div class="skeleton-line"></div><div class="skeleton-line"></div>';
  $("#spaceMembers").innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div>';
}

async function loadCurrentSpaceData() {
  const space = currentSpace();
  if (!space) {
    state.data.spaceEntities = [];
    state.data.groups = [];
    state.data.snapshots = [];
    state.data.access = [];
    renderSpaces();
    updateMetrics();
    return;
  }
  state.spaceLoading = true;
  try {
    const base = `/api/v1/spaces/${encodeURIComponent(space.id)}`;
    const [entities, groups, snapshots, access] = await Promise.all([
      api(`${base}/entities?limit=1000`),
      api(`${base}/groups?limit=500`),
      api(`${base}/audience-snapshots?limit=50`),
      api(`${base}/access-members`)
    ]);
    state.data.spaceEntities = entities?.data || [];
    state.data.groups = groups?.data || [];
    state.data.snapshots = snapshots?.data || [];
    state.data.access = access?.data || [];
    const available = new Set(state.data.spaceEntities.map((entity) => entity.entityId));
    state.selectedEntityIds = new Set([...state.selectedEntityIds].filter((id) => available.has(id)));
    renderSpaces();
    updateMetrics();
  } finally {
    state.spaceLoading = false;
  }
}

async function loadData() {
  if (state.loading) return;
  state.loading = true;
  $("#refreshButton").disabled = true;
  renderLoadingStates();
  setStatus("", "⏳", "Обновляем локальные данные", "Проверяем схему, пространства и выбранную аудиторию. Следующий шаг появится автоматически.");
  try {
    const [ready, types, properties, spaces] = await Promise.all([
      api("/readyz"),
      api("/api/v1/knowledge/entity-types?limit=500"),
      api("/api/v1/knowledge/property-definitions?limit=500"),
      api("/api/v1/spaces?limit=500")
    ]);
    state.data.types = types?.data || [];
    state.data.properties = properties?.data || [];
    state.data.spaces = spaces?.data || [];
    if (!state.data.spaces.some((space) => space.id === state.currentSpaceId)) {
      state.currentSpaceId = state.data.spaces.find((space) => space.id === DEFAULT_SPACE_ID)?.id || state.data.spaces[0]?.id || "";
      if (state.currentSpaceId) localStorage.setItem("docomator.space", state.currentSpaceId);
    }
    publishCurrentSpace();
    await loadCurrentSpaceData();
    await Promise.all([loadEmployees(), loadActiveTemplates()]);
    setConnection("ok", "Локальный сервер готов");
    const detail = state.data.spaces.length === 0
      ? "Пространств пока нет. Создайте первое — интерфейс подскажет следующий шаг."
      : `Загружено ${state.data.spaces.length} пространств. Выбрано «${currentSpace()?.name || "не выбрано"}»: ${state.data.spaceEntities.length} участников, ${state.data.groups.length} групп.`;
    setStatus(ready?.status === "ok" ? "success" : "warning", ready?.status === "ok" ? "✓" : "!", ready?.status === "ok" ? "Данные актуальны" : "Система работает с ограничениями", detail, ready?.status === "ok" ? null : loadData);
    renderKnowledge();
    updateMetrics();
  } catch (cause) {
    const error = cause instanceof ApiError ? cause : new ApiError("Неизвестная ошибка загрузки.");
    setConnection("error", "Нет связи с локальным сервером");
    setStatus("error", "!", "Не удалось обновить данные", `${error.message}${error.correlationId ? ` Идентификатор операции: ${error.correlationId}.` : ""}`, loadData);
    $("#knowledgeContent").setAttribute("aria-busy", "false");
    $("#knowledgeContent").innerHTML = `<div class="error-state"><div><span class="empty-emoji" aria-hidden="true">⚠️</span><h3>Не удалось загрузить данные</h3><p>${escapeHtml(error.message)}</p>${error.correlationId ? `<p><code>Идентификатор операции: ${escapeHtml(error.correlationId)}</code></p>` : ""}<button class="primary-button" type="button" data-retry-load>Повторить загрузку</button></div></div>`;
  } finally {
    state.loading = false;
    $("#refreshButton").disabled = false;
  }
}

async function selectSpace(spaceId) {
  if (spaceId === state.currentSpaceId || state.spaceLoading) return;
  state.currentSpaceId = spaceId;
  localStorage.setItem("docomator.space", spaceId);
  publishCurrentSpace();
  state.selectedEntityIds.clear();
  state.data.employees = [];
  state.data.activeTemplates = [];
  state.employee.loaded = false;
  state.templateCatalog.loaded = false;
  state.templateCatalog.error = false;
  state.lastPlan = null;
  $("#audiencePlan").innerHTML = "";
  setStatus("", "⏳", "Переключаем пространство", "Получаем только его участников, группы, снимки и настройки доступа.");
  try {
    await loadCurrentSpaceData();
    await Promise.all([loadEmployees(), loadActiveTemplates()]);
    setStatus("success", "✓", "Пространство выбрано", `Рабочий контекст: «${currentSpace()?.name || "пространство"}». Данные других пространств не показаны.`);
  } catch (cause) {
    const error = cause instanceof ApiError ? cause : new ApiError("Не удалось открыть пространство.");
    setStatus("error", "!", "Пространство не открыто", `${error.message}${error.correlationId ? ` Идентификатор операции: ${error.correlationId}.` : ""}`, () => selectSpace(spaceId));
  }
}

function optionsFor(type) {
  if (type === "value-type") return [["string", "Короткая строка"], ["text", "Длинный текст"], ["number", "Число"], ["integer", "Целое число"], ["boolean", "Да / нет"], ["date", "Дата"], ["date-time", "Дата и время"], ["enum", "Список вариантов"], ["entity-reference", "Ссылка на объект"], ["list", "Список"], ["json", "Структурированные данные"], ["file", "Файл"], ["image", "Изображение"]];
  if (type === "sensitivity") return [["internal", "Внутренние"], ["public", "Публичные"], ["personal", "Персональные"], ["restricted", "Ограниченные"]];
  if (type === "status") return [["active", "Активный"], ["inactive", "Неактивный"], ["archived", "Архивный"]];
  if (type === "space-role") return [["viewer", "Наблюдатель — просмотр"], ["editor", "Редактор — изменение данных"], ["manager", "Руководитель — состав и группы"], ["owner", "Владелец — полное управление"]];
  if (type === "membership-status") return [["active", "Активный доступ"], ["inactive", "Доступ отключён"]];
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
  if ((kind === "space-entity" || kind === "group" || kind === "space-access") && !currentSpace()) {
    notify("💡", "Сначала выберите пространство", "Эта операция должна иметь однозначную границу данных.");
    kind = "space";
  }
  if (kind === "space-entity" && state.data.types.length === 0) {
    notify("💡", "Сначала создайте тип сущности", "Например, тип «Человек». После этого добавьте участника в пространство.");
    kind = "entity-type";
  }
  if (kind === "group" && state.selectedEntityIds.size === 0) {
    notify("💡", "Сначала отметьте участников", "Откройте вкладку «Участники», выберите людей и повторите создание группы.");
    setSpaceTab("members");
    return;
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
  setStatus("", "⏳", "Сохраняем изменение", "Проверяем границу пространства, значения и запись в журнале. Форма закроется только после подтверждения сервера.");
  try {
    const endpoint = typeof definition.endpoint === "function" ? definition.endpoint(values) : definition.endpoint;
    const result = await api(endpoint, { method: definition.method || "POST", body: JSON.stringify(definition.payload(values)) });
    if (definition.afterCreate) await definition.afterCreate(result?.data);
    const createdSpaceId = kind === "space" ? result?.data?.id : null;
    closeDialog();
    notify("✅", definition.success, "Изменение подтверждено сервером и записано в журнал действий.");
    setStatus("success", "✓", definition.success, `Операция завершена. Идентификатор операции: ${result?.correlationId || "не указан"}.`);
    if (kind === "entity-type" || kind === "property" || kind === "space") await loadData(); else await loadCurrentSpaceData();
    if (createdSpaceId) await selectSpace(createdSpaceId);
    if (kind === "entity-type" || kind === "property") selectView("knowledge"); else selectView("spaces");
    if (kind === "property") setKnowledgeTab("properties");
    if (kind === "group") setSpaceTab("groups");
    if (kind === "space-access") setSpaceTab("access");
  } catch (cause) {
    const error = cause instanceof ApiError ? cause : new ApiError("Не удалось сохранить изменение.");
    $("#formError").hidden = false;
    $("#formError").innerHTML = `${escapeHtml(error.message)}${error.correlationId ? `<code>Идентификатор операции: ${escapeHtml(error.correlationId)}</code>` : ""}`;
    setStatus("error", "!", "Изменение не сохранено", "Введённые данные остались в форме. Исправьте причину или повторите действие.");
  } finally {
    button.disabled = false;
    button.textContent = definition.submit;
  }
}

async function loadGroupSelection(groupId) {
  setStatus("", "⏳", "Получаем состав группы", "После загрузки участники будут отмечены на вкладке «Участники».");
  try {
    const result = await api(spaceEndpoint(`/groups/${encodeURIComponent(groupId)}/members`));
    state.selectedEntityIds = new Set((result?.data || []).map((member) => member.entityId));
    renderMembers();
    setSpaceTab("members");
    setStatus("success", "✓", "Состав группы отмечен", `Выбрано ${state.selectedEntityIds.size} участников. Можно изменить отметки или подготовить документ.`);
  } catch (cause) {
    const error = cause instanceof ApiError ? cause : new ApiError("Не удалось получить состав группы.");
    setStatus("error", "!", "Группа не открыта", error.message, () => loadGroupSelection(groupId));
  }
}

async function useGroup(groupId) {
  setSpaceTab("audience");
  const select = $("#audienceSource");
  select.value = `group:${groupId}`;
  updateAudiencePreview();
}

async function createAudienceSnapshot() {
  if (!currentSpace()) {
    notify("💡", "Сначала выберите пространство", "Снимок аудитории всегда принадлежит одному пространству.");
    return;
  }
  const sourceValue = $("#audienceSource").value;
  const mode = $('input[name="targetMode"]:checked')?.value || "aggregate";
  let source;
  if (sourceValue === "selected") source = { kind: "selected", entityIds: [...state.selectedEntityIds] };
  else if (sourceValue.startsWith("group:")) source = { kind: "group", groupId: sourceValue.slice("group:".length) };
  else source = { kind: "all_space" };
  if (estimatedAudienceCount() === 0) {
    notify("⚠️", "Аудитория пуста", "Добавьте активных участников, отметьте людей или выберите непустую группу.");
    return;
  }
  const button = $("#createAudienceSnapshotButton");
  button.disabled = true;
  button.textContent = "Фиксируем состав…";
  setStatus("", "⏳", "Фиксируем аудиторию", "Проверяем принадлежность каждого участника пространству и строим точное число будущих документов.");
  try {
    const result = await api(spaceEndpoint("/audience-snapshots"), { method: "POST", body: JSON.stringify({ source, targetMode: mode }) });
    renderPlan(result.data);
    notify("✅", "План документа готов", mode === "aggregate" ? "Подготовлено одно задание с коллекцией участников." : `Подготовлено ${result.data.plan.documentCount} отдельных единиц.`);
    setStatus("success", "✓", "Состав и режим зафиксированы", `Снимок содержит ${result.data.snapshot.memberCount} участников. Изменение группы не повлияет на этот запуск.`);
    const snapshots = await api(spaceEndpoint("/audience-snapshots?limit=50"));
    state.data.snapshots = snapshots?.data || [];
    renderSnapshots();
    updateMetrics();
  } catch (cause) {
    const error = cause instanceof ApiError ? cause : new ApiError("Не удалось подготовить план.");
    setStatus("error", "!", "План не создан", `${error.message}${error.correlationId ? ` Идентификатор операции: ${error.correlationId}.` : ""}`);
  } finally {
    button.disabled = false;
    button.textContent = "Зафиксировать состав и план";
  }
}

async function openSnapshot(snapshotId) {
  setStatus("", "⏳", "Открываем снимок", "Получаем сохранённый состав и исполнимый план без пересчёта группы.");
  try {
    const result = await api(spaceEndpoint(`/audience-snapshots/${encodeURIComponent(snapshotId)}`));
    renderPlan(result.data);
    setSpaceTab("audience");
    setStatus("success", "✓", "Снимок открыт", `Состав зафиксирован: ${result.data.snapshot.memberCount} участников, ${result.data.plan.documentCount} будущих документов.`);
  } catch (cause) {
    const error = cause instanceof ApiError ? cause : new ApiError("Не удалось открыть снимок.");
    setStatus("error", "!", "Снимок не открыт", error.message, () => openSnapshot(snapshotId));
  }
}

function employeeEndpoint(employeeId = "") {
  const base = spaceEndpoint("/employees");
  return employeeId ? `${base}/${encodeURIComponent(employeeId)}` : base;
}

function employeeItems(body) {
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.data?.items)) return body.data.items;
  return [];
}

function employeeId(employee) {
  return employee?.id || employee?.employeeId || employee?.entityId || "";
}

function employeeFields(employee) {
  const fields = employee?.fields || employee?.values || [];
  return Array.isArray(fields) ? fields : [];
}

function employeeFieldMeta(field) {
  const propertyKey = field?.propertyKey || field?.key || field?.definition?.key || "";
  const definition = state.data.properties.find((item) => item.key === propertyKey);
  return {
    propertyKey,
    label: field?.label || field?.definition?.label || definition?.label || "Дополнительное поле",
    valueType: field?.valueType || field?.definition?.valueType || definition?.valueType || "string",
    unit: field?.unit || field?.definition?.unit || definition?.unit || "",
    value: field?.value ?? field?.currentValue ?? ""
  };
}

function employeeStatusLabel(status) {
  return ({ active: "Работает", inactive: "Не работает", archived: "В архиве" })[status] || "Статус не указан";
}

function employeeValueLabel(field) {
  const { value, valueType, unit } = employeeFieldMeta(field);
  if (value === "" || value === null || value === undefined) return "Не заполнено";
  if (valueType === "boolean") return value ? "Да" : "Нет";
  return `${String(value)}${unit ? ` ${unit}` : ""}`;
}

function employeeErrorText(error, action = "выполнить действие") {
  if (error?.status === 404) return "Раздел сотрудников пока недоступен на локальном сервере.";
  if (error?.status === 409) return /[А-Яа-яЁё]/u.test(error?.message || "")
    ? error.message
    : "Эти данные уже изменились. Обновите карточку и повторите сохранение.";
  if (error?.status >= 400 && error?.status < 500) return "Проверьте заполненные данные. Введённые значения сохранены в форме.";
  return `Не удалось ${action}. Проверьте работу локального сервера и повторите.`;
}

function setEmployeeWorkspaceState(kind, title, detail, error = null) {
  const root = $("#employeeWorkspaceStatus");
  if (!root) return;
  root.className = `employee-state${kind ? ` is-${kind}` : ""}`;
  root.setAttribute("aria-busy", String(kind === "loading"));
  const correlation = error?.correlationId
    ? `<small>Идентификатор операции: <code>${escapeHtml(error.correlationId)}</code></small>`
    : "";
  const retry = kind === "error"
    ? '<button class="secondary-button compact-button" type="button" data-employee-action="retry">Повторить</button>'
    : "";
  root.innerHTML = `<span class="state-mark" aria-hidden="true"></span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p>${correlation}</div>${retry}`;
}

function updateHomeEmployeeState() {
  const count = state.data.employees.length;
  const templateCount = state.data.activeTemplates.length;
  const status = $("#homeEmployeeStatus");
  if (status) status.textContent = state.employee.loaded
    ? count > 0 ? `${count} ${count === 1 ? "сотрудник" : count < 5 ? "сотрудника" : "сотрудников"}` : "Добавьте первого сотрудника"
    : "Список ещё не загружен";
  const templateStatus = $("#homeTemplateStatus");
  if (templateStatus) templateStatus.textContent = state.templateCatalog.loaded
    ? templateCount > 0 ? `Готовых шаблонов: ${templateCount}` : "Подключите DOCX или XLSX"
    : state.templateCatalog.error ? "Готовность проверить не удалось" : "Проверяем готовность…";
  if (!state.employee.loaded) return;
  const title = $("#homeNextTitle");
  const description = $("#homeNextDescription");
  const action = $("#homeNextAction");
  if (!title || !description || !action) return;
  if (count === 0) {
    title.textContent = "Добавьте первого сотрудника";
    description.textContent = "Сохраните ФИО и нужные сведения в одной карточке. После этого можно подключить шаблон и сформировать документы.";
    action.textContent = "Добавить сотрудников";
    action.dataset.viewTarget = "employees";
  } else if (templateCount === 0) {
    title.textContent = "Подключите шаблон";
    description.textContent = `Сотрудники готовы: ${count}. Выберите DOCX или XLSX, укажите поля и проверьте результат.`;
    action.textContent = "Подключить шаблон";
    action.dataset.viewTarget = "templates";
  } else {
    title.textContent = "Можно создавать документы";
    description.textContent = `Готово сотрудников: ${count}. Активных шаблонов: ${templateCount}. Проверьте состав и запустите выпуск.`;
    action.textContent = "Создать документы";
    action.dataset.viewTarget = "generation";
  }
}

async function loadActiveTemplates() {
  if (state.templateCatalog.loading) return;
  if (!state.currentSpaceId) {
    state.data.activeTemplates = [];
    state.templateCatalog.loaded = true;
    state.templateCatalog.error = false;
    updateHomeEmployeeState();
    return;
  }
  state.templateCatalog.loading = true;
  try {
    const body = await api(spaceEndpoint("/active-templates"));
    state.data.activeTemplates = Array.isArray(body?.data) ? body.data : [];
    state.templateCatalog.loaded = true;
    state.templateCatalog.error = false;
  } catch {
    state.data.activeTemplates = [];
    state.templateCatalog.loaded = false;
    state.templateCatalog.error = true;
  } finally {
    state.templateCatalog.loading = false;
    updateHomeEmployeeState();
  }
}

function initializeTemplateCatalogSync() {
  document.addEventListener("docomator:template-wizard-step-completed", (event) => {
    if (event?.detail?.step === 4 && event.detail.spaceId === state.currentSpaceId) {
      void loadActiveTemplates();
    }
  });
}

function renderEmployeeList() {
  const root = $("#employeeList");
  if (!root) return;
  const query = $("#employeeSearch")?.value.trim().toLocaleLowerCase("ru-RU") || "";
  const employees = state.data.employees.filter((employee) => {
    const searchable = [employee.displayName, employeeStatusLabel(employee.status), ...employeeFields(employee).flatMap((field) => {
      const meta = employeeFieldMeta(field);
      return [meta.label, employeeValueLabel(field)];
    })].join(" ").toLocaleLowerCase("ru-RU");
    return !query || searchable.includes(query);
  });
  const addButton = $("#employeeAddButtonHeader");
  if (addButton) addButton.hidden = state.data.employees.length === 0;
  if (state.data.employees.length === 0) {
    root.innerHTML = `<div class="employee-empty"><div class="empty-sheet" aria-hidden="true"><i></i><i></i><i></i></div><h3>Сотрудников пока нет</h3><p>Добавьте первого человека и укажите сведения, которые понадобятся в документах.</p><button class="primary-button" type="button" data-employee-action="add">Добавить сотрудника</button></div>`;
    return;
  }
  if (employees.length === 0) {
    root.innerHTML = `<div class="employee-empty is-search"><h3>Ничего не найдено</h3><p>Измените запрос — карточки и введённые данные не изменены.</p><button class="secondary-button" type="button" data-employee-action="clear-search">Очистить поиск</button></div>`;
    return;
  }
  root.innerHTML = employees.map((employee) => {
    const fields = employeeFields(employee).map(employeeFieldMeta).filter((field) => field.value !== "" && field.value !== null && field.value !== undefined);
    const detail = fields.length > 0
      ? fields.slice(0, 2).map((field) => `${escapeHtml(field.label)}: ${escapeHtml(employeeValueLabel(field))}`).join(" · ")
      : employee.fieldCount > 0
        ? `Заполнено дополнительных полей: ${employee.fieldCount}`
        : "Дополнительные сведения не заполнены";
    return `<button class="employee-row" type="button" data-employee-id="${escapeHtml(employeeId(employee))}"><span class="employee-avatar" aria-hidden="true">${escapeHtml((employee.displayName || "С").slice(0, 1).toLocaleUpperCase("ru-RU"))}</span><span class="employee-row-copy"><strong>${escapeHtml(employee.displayName || "Без имени")}</strong><small>${detail}</small></span><span class="employee-row-status ${employee.status === "active" ? "is-active" : ""}">${escapeHtml(employeeStatusLabel(employee.status))}</span><span class="employee-chevron" aria-hidden="true">›</span></button>`;
  }).join("");
}

function renderEmployeeSuccess() {
  const name = state.employee.lastSavedName;
  if (!name) {
    setEmployeeWorkspaceState("success", "Список сотрудников готов", `Загружено карточек: ${state.data.employees.length}.`);
    return;
  }
  const root = $("#employeeWorkspaceStatus");
  root.className = "employee-state is-success";
  root.setAttribute("aria-busy", "false");
  root.innerHTML = `<span class="state-mark" aria-hidden="true"></span><div><strong>Карточка сохранена</strong><p>«${escapeHtml(name)}» доступен для шаблонов и новых документов.</p></div><div class="employee-success-actions"><button class="secondary-button compact-button" type="button" data-employee-action="add">Добавить ещё</button><button class="text-button" type="button" data-view-target="generation">Создать документы</button></div>`;
  state.employee.lastSavedName = "";
}

async function loadEmployees({ preserveSuccess = false } = {}) {
  if (state.employee.loading || (!state.currentSpaceId && state.loading)) return;
  if (!state.currentSpaceId) {
    state.data.employees = [];
    state.employee.loaded = true;
    setEmployeeWorkspaceState("warning", "Не выбран раздел данных", "Откройте настройки и выберите подразделение для списка сотрудников.");
    renderEmployeeList();
    updateHomeEmployeeState();
    return;
  }
  state.employee.loading = true;
  setEmployeeWorkspaceState("loading", "Получаем сотрудников", "Список появится после ответа локального сервера.");
  try {
    const body = await api(`${employeeEndpoint()}?limit=1000`);
    state.data.employees = employeeItems(body);
    state.employee.loaded = true;
    renderEmployeeList();
    if (preserveSuccess) renderEmployeeSuccess();
    else setEmployeeWorkspaceState("success", "Список сотрудников готов", state.data.employees.length > 0 ? `Загружено карточек: ${state.data.employees.length}.` : "Можно добавить первого сотрудника.");
    updateHomeEmployeeState();
  } catch (cause) {
    const error = cause instanceof ApiError ? cause : new ApiError("Не удалось получить сотрудников.");
    state.employee.loaded = false;
    setEmployeeWorkspaceState("error", "Список не загружен", employeeErrorText(error, "получить сотрудников"), error);
    updateHomeEmployeeState();
  } finally {
    state.employee.loading = false;
  }
}

function employeeInputHtml(field, index) {
  const meta = employeeFieldMeta(field);
  const id = `employee-existing-field-${index}`;
  const common = `id="${id}" data-employee-existing-field data-property-key="${escapeHtml(meta.propertyKey)}" data-value-type="${escapeHtml(meta.valueType)}" data-initial-value="${escapeHtml(meta.value ?? "")}"`;
  let control;
  if (meta.valueType === "boolean") {
    control = `<select ${common}><option value="">Не указано</option><option value="true" ${meta.value === true ? "selected" : ""}>Да</option><option value="false" ${meta.value === false ? "selected" : ""}>Нет</option></select>`;
  } else {
    const type = meta.valueType === "number" || meta.valueType === "integer" ? "number" : meta.valueType === "date" ? "date" : "text";
    control = `<input ${common} type="${type}" value="${escapeHtml(meta.value ?? "")}" />`;
  }
  return `<div class="field employee-existing-field"><label for="${id}">${escapeHtml(meta.label)}</label>${control}${meta.unit ? `<small>Единица: ${escapeHtml(meta.unit)}</small>` : ""}</div>`;
}

function renderEmployeeFormFields(employee) {
  const fields = employeeFields(employee);
  const primary = fields.slice(0, 3).map(employeeInputHtml).join("");
  const additional = fields.slice(3).map((field, index) => employeeInputHtml(field, index + 3)).join("");
  $("#employeeFields").innerHTML = `${primary}${additional ? `<details class="employee-more-fields"><summary>Ещё поля (${fields.length - 3})</summary><div>${additional}</div></details>` : ""}`;
  renderEmployeeFieldSourceOptions(fields.map((field) => employeeFieldMeta(field).propertyKey));
}

function employeeSelectableProperties(excludedKeys = []) {
  const excluded = new Set(excludedKeys.filter(Boolean));
  const supportedTypes = new Set(["string", "text", "number", "integer", "boolean", "date", "date-time"]);
  return state.data.properties
    .filter((property) => supportedTypes.has(property.valueType))
    .filter((property) => !excluded.has(property.key))
    .filter((property) => !Array.isArray(property.appliesTo) || property.appliesTo.length === 0 || property.appliesTo.includes("person"))
    .sort((left, right) => left.label.localeCompare(right.label, "ru-RU"));
}

function renderEmployeeFieldSourceOptions(excludedKeys = []) {
  const select = $("#employeeFieldSource");
  const previous = select.value;
  const properties = employeeSelectableProperties(excludedKeys);
  select.innerHTML = `<option value="">Выберите поле</option>${properties.map((property) => `<option value="existing:${escapeHtml(property.key)}">${escapeHtml(property.label)} · ${escapeHtml(displayLabel("valueTypes", property.valueType))}</option>`).join("")}<option value="__new__">Новое поле…</option>`;
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  updateEmployeeNewFieldMode();
}

function selectedEmployeeProperty() {
  const value = $("#employeeFieldSource").value;
  if (!value.startsWith("existing:")) return null;
  const key = value.slice("existing:".length);
  return state.data.properties.find((property) => property.key === key) || null;
}

function updateEmployeeFieldValueControl(valueType) {
  const current = $("#employeeFieldValue");
  if (valueType === "boolean") {
    if (current.tagName === "SELECT") return;
    const select = document.createElement("select");
    select.id = "employeeFieldValue";
    select.innerHTML = '<option value="">Не указано</option><option value="true">Да</option><option value="false">Нет</option>';
    current.replaceWith(select);
    return;
  }
  let input = current;
  if (current.tagName !== "INPUT") {
    input = document.createElement("input");
    input.id = "employeeFieldValue";
    input.maxLength = 2000;
    current.replaceWith(input);
  }
  input.type = valueType === "number" || valueType === "integer" ? "number" : valueType === "date" ? "date" : "text";
  input.step = valueType === "integer" ? "1" : "any";
  input.placeholder = "Введите значение";
}

function updateEmployeeNewFieldMode() {
  const value = $("#employeeFieldSource").value;
  const isNew = value === "__new__";
  const isExisting = value.startsWith("existing:");
  $("#employeeFieldLabelField").hidden = !isNew;
  $("#employeeFieldTypeField").hidden = !isNew;
  $("#employeeFieldValueField").hidden = !isNew && !isExisting;
  const property = selectedEmployeeProperty();
  updateEmployeeFieldValueControl(property?.valueType || $("#employeeFieldType").value);
  state.employee.fieldConfirmed = false;
}

function resolvedEmployeeAddedField() {
  const source = $("#employeeFieldSource").value;
  if (source.startsWith("existing:")) {
    const property = selectedEmployeeProperty();
    return property ? { kind: "existing", propertyKey: property.key, label: property.label, valueType: property.valueType } : null;
  }
  if (source !== "__new__") return null;
  const label = $("#employeeFieldLabel").value.trim();
  if (!label) return { kind: "new", label: "", valueType: $("#employeeFieldType").value };
  const matches = state.data.properties.filter((property) => property.label.trim().localeCompare(label, "ru-RU", { sensitivity: "accent" }) === 0);
  if (matches.length === 1) {
    return { kind: "existing", propertyKey: matches[0].key, label: matches[0].label, valueType: matches[0].valueType };
  }
  return { kind: "new", label, valueType: $("#employeeFieldType").value };
}

function resetEmployeeNewField() {
  $("#employeeNewField").hidden = true;
  $("#employeeAddFieldButton").hidden = false;
  $("#employeeStatusField").hidden = false;
  $("#employeeFields").hidden = false;
  renderEmployeeFieldSourceOptions();
  $("#employeeFieldSource").value = "";
  $("#employeeFieldLabel").value = "";
  $("#employeeFieldType").value = "string";
  updateEmployeeFieldValueControl("string");
  $("#employeeFieldValue").value = "";
  updateEmployeeNewFieldMode();
  state.employee.fieldConfirmed = false;
}

function showEmployeeFormError(message, error = null) {
  const root = $("#employeeFormError");
  root.hidden = false;
  root.innerHTML = `${escapeHtml(message)}${error?.correlationId ? `<code>Идентификатор операции: ${escapeHtml(error.correlationId)}</code>` : ""}`;
}

function clearEmployeeFormError() {
  $("#employeeFormError").hidden = true;
  $("#employeeFormError").textContent = "";
}

async function openEmployeeDialog(employeeIdValue = "") {
  const dialog = $("#employeeDialog");
  state.employee.editingId = employeeIdValue;
  state.employee.fieldConfirmed = false;
  state.employee.idempotencyKey = requestCorrelationId();
  clearEmployeeFormError();
  $("#employeeForm").reset();
  resetEmployeeNewField();
  $("#employeeFields").innerHTML = "";
  $("#employeeTechnicalDetails").hidden = true;
  $("#employeeDialogTitle").textContent = employeeIdValue ? "Карточка сотрудника" : "Новый сотрудник";
  $("#employeeSubmitButton").textContent = employeeIdValue ? "Сохранить изменения" : "Сохранить сотрудника";
  if (!dialog.open) dialog.showModal();
  if (!employeeIdValue) {
    requestAnimationFrame(() => $("#employeeDisplayName").focus());
    return;
  }
  const summary = state.data.employees.find((employee) => employeeId(employee) === employeeIdValue);
  if (summary) {
    $("#employeeDisplayName").value = summary.displayName || "";
    $("#employeeStatus").value = summary.status || "active";
  }
  $("#employeeSubmitButton").disabled = true;
  $("#employeeFields").innerHTML = '<div class="employee-inline-loading"><span class="state-mark" aria-hidden="true"></span><span>Получаем сведения…</span></div>';
  try {
    const body = await api(employeeEndpoint(employeeIdValue));
    const employee = body?.data || summary || {};
    $("#employeeDisplayName").value = employee.displayName || "";
    $("#employeeStatus").value = employee.status || "active";
    renderEmployeeFormFields(employee);
    $("#employeeTechnicalDetails").hidden = false;
    $("#employeeTechnicalContent").innerHTML = `<div><dt>Идентификатор записи</dt><dd><code>${escapeHtml(employeeId(employee) || employeeIdValue)}</code></dd></div>`;
  } catch (cause) {
    const error = cause instanceof ApiError ? cause : new ApiError("Не удалось открыть карточку.");
    $("#employeeFields").innerHTML = "";
    showEmployeeFormError(employeeErrorText(error, "открыть карточку"), error);
  } finally {
    $("#employeeSubmitButton").disabled = false;
  }
}

function closeEmployeeDialog() {
  if ($("#employeeDialog").open) $("#employeeDialog").close();
  state.employee.editingId = null;
}

function employeeControlValue(control, valueType) {
  const raw = control.value;
  if (raw === "") return "";
  if (valueType === "boolean") return raw === "true" || /^(да|yes|1)$/iu.test(raw);
  if (valueType === "number") return Number(raw);
  if (valueType === "integer") return Number(raw);
  return raw;
}

function employeePayload() {
  const fields = $$('[data-employee-existing-field]', $("#employeeForm"))
    .filter((control) => !state.employee.editingId || control.value !== control.dataset.initialValue)
    .map((control) => ({
      propertyKey: control.dataset.propertyKey,
      value: employeeControlValue(control, control.dataset.valueType)
    }))
    .filter((field) => field.propertyKey);
  const added = $("#employeeNewField").hidden ? null : resolvedEmployeeAddedField();
  if (added?.kind === "existing") {
    fields.push({ propertyKey: added.propertyKey, value: employeeControlValue($("#employeeFieldValue"), added.valueType) });
  } else if (added?.kind === "new" && added.label) {
    fields.push({ definition: { label: added.label, valueType: added.valueType }, value: employeeControlValue($("#employeeFieldValue"), added.valueType) });
  }
  return {
    displayName: $("#employeeDisplayName").value.trim(),
    status: $("#employeeStatus").value,
    fields,
    idempotencyKey: state.employee.idempotencyKey
  };
}

async function saveEmployee() {
  const button = $("#employeeSubmitButton");
  const payload = employeePayload();
  const editing = Boolean(state.employee.editingId);
  button.disabled = true;
  button.textContent = "Сохраняем…";
  clearEmployeeFormError();
  setStatus("", "…", "Сохраняем карточку", "Проверяем значения. Окно закроется только после подтверждения локального сервера.");
  try {
    const body = await api(employeeEndpoint(state.employee.editingId || ""), {
      method: editing ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    for (const field of employeeFields(body?.data)) {
      const definition = field?.definition;
      if (definition?.key && !state.data.properties.some((property) => property.key === definition.key)) {
        state.data.properties.push(definition);
      }
    }
    state.employee.lastSavedName = payload.displayName;
    closeEmployeeDialog();
    await loadEmployees({ preserveSuccess: true });
    setStatus("success", "✓", "Карточка сотрудника сохранена", `Можно добавить ещё человека или перейти к созданию документов. Идентификатор операции: ${body?.correlationId || "не указан"}.`);
  } catch (cause) {
    const error = cause instanceof ApiError ? cause : new ApiError("Не удалось сохранить карточку.");
    showEmployeeFormError(employeeErrorText(error, "сохранить карточку"), error);
    setStatus("error", "!", "Карточка не сохранена", "Введённые значения остались в форме. Проверьте данные или повторите действие.");
  } finally {
    button.disabled = false;
    button.textContent = editing ? "Сохранить изменения" : "Сохранить сотрудника";
  }
}

function submitEmployeeForm(event) {
  event.preventDefault();
  clearEmployeeFormError();
  if (!event.currentTarget.reportValidity()) {
    showEmployeeFormError("Укажите ФИО. Остальные введённые значения сохранены в форме.");
    return;
  }
  const newFieldVisible = !$("#employeeNewField").hidden;
  const added = newFieldVisible ? resolvedEmployeeAddedField() : null;
  if (newFieldVisible && !added) {
    showEmployeeFormError("Выберите существующее поле или создайте новое.");
    $("#employeeFieldSource").focus();
    return;
  }
  if (added?.kind === "new" && !added.label) {
    showEmployeeFormError("Укажите название нового поля или выберите существующее.");
    $("#employeeFieldLabel").focus();
    return;
  }
  if (added?.kind === "new" && !state.employee.fieldConfirmed) {
    $("#employeeFieldConfirmText").textContent = `Поле «${added.label}» станет доступно в каждой карточке. Введённое значение сохранится у текущего сотрудника.`;
    const confirmDialog = $("#employeeFieldConfirmDialog");
    confirmDialog.returnValue = "";
    confirmDialog.showModal();
    confirmDialog.addEventListener("close", () => {
      if (confirmDialog.returnValue !== "confirm") return;
      state.employee.fieldConfirmed = true;
      void saveEmployee();
    }, { once: true });
    return;
  }
  void saveEmployee();
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
    if (create?.dataset.create) openDialog(create.dataset.create);
    const employeeAction = event.target.closest("[data-employee-action]")?.dataset.employeeAction;
    if (employeeAction === "add") void openEmployeeDialog();
    if (employeeAction === "close") closeEmployeeDialog();
    if (employeeAction === "show-field") {
      $("#employeeNewField").hidden = false;
      $("#employeeAddFieldButton").hidden = true;
      $("#employeeStatusField").hidden = true;
      $("#employeeFields").hidden = true;
      renderEmployeeFieldSourceOptions($$('[data-employee-existing-field]', $("#employeeForm")).map((control) => control.dataset.propertyKey));
      $("#employeeFieldSource").focus();
    }
    if (employeeAction === "cancel-field") resetEmployeeNewField();
    if (employeeAction === "retry") void loadEmployees();
    if (employeeAction === "clear-search") {
      $("#employeeSearch").value = "";
      renderEmployeeList();
      $("#employeeSearch").focus();
    }
    const employeeRow = event.target.closest("[data-employee-id]");
    if (employeeRow) void openEmployeeDialog(employeeRow.dataset.employeeId);
    const space = event.target.closest("[data-space-id]");
    if (space) void selectSpace(space.dataset.spaceId);
    const tab = event.target.closest("[data-space-tab-target]");
    if (tab) setSpaceTab(tab.dataset.spaceTabTarget);
    const editGroup = event.target.closest("[data-edit-group]");
    if (editGroup) void loadGroupSelection(editGroup.dataset.editGroup);
    const useGroupButton = event.target.closest("[data-use-group]");
    if (useGroupButton) void useGroup(useGroupButton.dataset.useGroup);
    const snapshot = event.target.closest("[data-open-snapshot]");
    if (snapshot) void openSnapshot(snapshot.dataset.openSnapshot);
    if (event.target.closest("[data-clear-search]")) { $("#knowledgeSearch").value = ""; renderKnowledge(); }
    if (event.target.closest("[data-retry-load]")) void loadData();
    if (event.target.closest("[data-close-help]")) closeHelp();
  });
  document.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-select-entity]");
    if (checkbox) {
      if (checkbox.checked) state.selectedEntityIds.add(checkbox.dataset.selectEntity); else state.selectedEntityIds.delete(checkbox.dataset.selectEntity);
      checkbox.closest(".member-row")?.classList.toggle("is-selected", checkbox.checked);
      updateSelectedCount();
    }
  });
  $$('[data-knowledge-tab]').forEach((button) => button.addEventListener("click", () => setKnowledgeTab(button.dataset.knowledgeTab)));
  $$('[data-space-tab]').forEach((button) => button.addEventListener("click", () => setSpaceTab(button.dataset.spaceTab)));
  $("#knowledgeSearch").addEventListener("input", renderKnowledge);
  $("#employeeSearch").addEventListener("input", renderEmployeeList);
  $("#employeeFieldLabel").addEventListener("input", () => { state.employee.fieldConfirmed = false; });
  $("#employeeFieldSource").addEventListener("change", updateEmployeeNewFieldMode);
  $("#employeeFieldType").addEventListener("change", () => {
    state.employee.fieldConfirmed = false;
    updateEmployeeFieldValueControl($("#employeeFieldType").value);
  });
  $("#audienceSource").addEventListener("change", updateAudiencePreview);
  $$('input[name="targetMode"]').forEach((input) => input.addEventListener("change", updateAudiencePreview));
  $("#createAudienceSnapshotButton").addEventListener("click", createAudienceSnapshot);
  $("#selectAllButton").addEventListener("click", () => { state.selectedEntityIds = new Set(state.data.spaceEntities.filter((entity) => entity.status === "active").map((entity) => entity.entityId)); renderMembers(); });
  $("#clearSelectionButton").addEventListener("click", () => { state.selectedEntityIds.clear(); renderMembers(); });
  $("#refreshButton").addEventListener("click", loadData);
  $("#statusRetryButton").addEventListener("click", () => state.retry?.());
  $("#themeButton").addEventListener("click", () => applyTheme({ system: "light", light: "dark", dark: "system" }[state.theme]));
  $("#helpButton").addEventListener("click", openHelp);
  $("#mobileHelpButton")?.addEventListener("click", openHelp);
  $("#overviewHelpButton")?.addEventListener("click", openHelp);
  $("#dialogCloseButton").addEventListener("click", closeDialog);
  $("#dialogCancelButton").addEventListener("click", closeDialog);
  $("#createForm").addEventListener("submit", submitDialog);
  $("#createDialog").addEventListener("cancel", (event) => { event.preventDefault(); closeDialog(); });
  $("#employeeForm").addEventListener("submit", submitEmployeeForm);
  $("#employeeDialog").addEventListener("cancel", (event) => { event.preventDefault(); closeEmployeeDialog(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeHelp(); });
  window.addEventListener("docomator:employees-changed", (event) => {
    const spaceId = String(event.detail?.spaceId || "");
    if (spaceId === "" || spaceId === state.currentSpaceId) {
      void loadEmployees({ preserveSuccess: true });
    }
  });
  window.addEventListener("online", loadData);
  window.addEventListener("offline", () => {
    setConnection("error", "Браузер не видит сеть");
    setStatus("warning", "!", "Соединение прервано", "Введённые данные и текущий выбор не удалены. После восстановления подключения нажмите «Повторить».", loadData);
  });
}

applyTheme(state.theme);
publishCurrentSpace();
attachEvents();
initializeTemplateCatalogSync();
selectView(location.hash.slice(1) in views ? location.hash.slice(1) : "overview");
loadData();
