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
  currentSpaceId: localStorage.getItem("docomator.space") || DEFAULT_SPACE_ID,
  selectedEntityIds: new Set(),
  lastPlan: null,
  data: {
    types: [],
    properties: [],
    spaces: [],
    spaceEntities: [],
    groups: [],
    snapshots: [],
    access: []
  }
};

const views = {
  overview: ["Рабочее пространство", "Обзор", "Состояние данных, аудитории и следующий безопасный шаг.", "Создать пространство", "space"],
  spaces: ["Изолированные наборы", "Пространства", "Люди, группы и точный план будущего документа.", "Создать пространство", "space"],
  knowledge: ["Общая схема", "Типы и свойства", "Переиспользуемая структура данных для всех пространств.", "Создать тип", "entity-type"],
  templates: ["Безопасный приём", "Проверка шаблона", "Проверяем структуру DOCX/XLSX до сохранения и объясняем безопасный следующий шаг.", null, null],
  documents: ["Формирование", "Документы", "Будущий пошаговый процесс использует уже готовый снимок состава.", null, null],
  automations: ["События и расписания", "Автоматизации", "Каждое правило будет ограничено одним пространством.", null, null]
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
      ["key", "Стабильный ключ", "text", true, "person", "Латиница без пробелов. Ключ используется шаблонами и не должен меняться."],
      ["label", "Понятное название", "text", true, "Человек", "Эту подпись увидят пользователи."],
      ["description", "Описание", "textarea", false, "Сотрудник, автор или получатель", "Необязательно. Коротко объясните назначение типа."]
    ],
    payload: (values) => compact({ key: values.key, label: values.label, description: values.description })
  },
  property: {
    eyebrow: "Структура данных",
    title: "Новое свойство",
    description: "Создайте параметр, который можно использовать в разных пространствах и документах.",
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
    payload: (values) => compact({ key: values.key, label: values.label, valueType: values.valueType, unit: values.unit, appliesTo: split(values.appliesTo), sensitivity: values.sensitivity, description: values.description })
  },
  space: {
    eyebrow: "Изоляция данных",
    title: "Новое пространство",
    description: "Создайте отдельный контур для подразделения, проекта или заказчика.",
    endpoint: "/api/v1/spaces",
    success: "Пространство создано",
    submit: "Создать пространство",
    fields: [
      ["key", "Стабильный ключ", "text", true, "engineering", "Латиница без пробелов. Например: engineering, branch-north или project.alpha."],
      ["name", "Понятное название", "text", true, "Инженерная служба", "Название показывается в переключателе пространства."],
      ["description", "Описание", "textarea", false, "Сотрудники и документы инженерной службы", "Объясните, какие данные должны находиться только здесь."]
    ],
    payload: (values) => compact({ key: values.key, name: values.name, description: values.description })
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
      ["key", "Стабильный ключ", "text", true, "monthly-report", "Латиница без пробелов. Ключ уникален внутри пространства."],
      ["name", "Название группы", "text", true, "Ежемесячный отчёт", "Название будет показано при выборе аудитории."],
      ["description", "Описание", "textarea", false, "Участники ежемесячного сводного отчёта", "Необязательно. Укажите назначение группы."]
    ],
    payload: (values) => compact({ key: values.key, name: values.name, description: values.description }),
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
  primary.querySelector("span:last-child").textContent = primaryLabel || "";
  if (view === "knowledge") renderKnowledge();
  if (view === "spaces") renderSpaces();
  window.history.replaceState(null, "", `#${view}`);
}

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
    if (state.knowledgeTab === "types") return `<article class="collection-card"><header><div><h3>${escapeHtml(item.label)}</h3><code>${escapeHtml(item.key)}</code></div><span class="pill">Тип</span></header><p>${escapeHtml(item.description || "Описание пока не добавлено.")}</p></article>`;
    return `<article class="collection-card"><header><div><h3>${escapeHtml(item.label)}</h3><code>${escapeHtml(item.key)}</code></div><span class="pill">${escapeHtml(displayLabel("valueTypes", item.valueType))}</span></header><p>${escapeHtml(item.description || "Описание пока не добавлено.")}</p><div class="card-meta"><span class="pill">${escapeHtml(displayLabel("sensitivity", item.sensitivity || "internal"))}</span>${item.unit ? `<span class="pill">${escapeHtml(item.unit)}</span>` : ""}</div></article>`;
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
  root.innerHTML = state.data.groups.map((group) => `<article class="collection-card group-card"><header><div><h3>${escapeHtml(group.name)}</h3><code>${escapeHtml(group.key)}</code></div><span class="pill">${group.memberCount} чел.</span></header><p>${escapeHtml(group.description || "Описание не добавлено.")}</p><div class="card-actions"><button class="text-button" type="button" data-edit-group="${escapeHtml(group.id)}">Показать состав</button><button class="secondary-button compact-button" type="button" data-use-group="${escapeHtml(group.id)}">Использовать для документа</button></div></article>`).join("");
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
  root.innerHTML = `<article class="panel plan-card is-success"><div class="plan-icon" aria-hidden="true">${plan.targetMode === "aggregate" ? "📋" : "📄"}</div><div><p class="eyebrow">Состав зафиксирован</p><h2>${escapeHtml(modeLabel(plan.targetMode))}</h2><p>${plan.targetMode === "aggregate" ? `Создаётся одно задание. Шаблон получит упорядоченный список из ${snapshot.memberCount} участников.` : `Создаётся ${plan.documentCount} независимых заданий — каждое со своим основным участником.`}</p><div class="member-chip-list">${memberNames.slice(0, 12).map((name) => `<span class="pill">${escapeHtml(name)}</span>`).join("")}${memberNames.length > 12 ? `<span class="pill">ещё ${memberNames.length - 12}</span>` : ""}</div><small>Идентификатор снимка: <code>${escapeHtml(snapshot.id)}</code>. Изменение группы не изменит этот состав.</small></div></article>`;
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
    await loadCurrentSpaceData();
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
  state.selectedEntityIds.clear();
  state.lastPlan = null;
  $("#audiencePlan").innerHTML = "";
  setStatus("", "⏳", "Переключаем пространство", "Получаем только его участников, группы, снимки и настройки доступа.");
  try {
    await loadCurrentSpaceData();
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
  $("#audienceSource").addEventListener("change", updateAudiencePreview);
  $$('input[name="targetMode"]').forEach((input) => input.addEventListener("change", updateAudiencePreview));
  $("#createAudienceSnapshotButton").addEventListener("click", createAudienceSnapshot);
  $("#selectAllButton").addEventListener("click", () => { state.selectedEntityIds = new Set(state.data.spaceEntities.filter((entity) => entity.status === "active").map((entity) => entity.entityId)); renderMembers(); });
  $("#clearSelectionButton").addEventListener("click", () => { state.selectedEntityIds.clear(); renderMembers(); });
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
    setStatus("warning", "!", "Соединение прервано", "Введённые данные и текущий выбор не удалены. После восстановления подключения нажмите «Повторить».", loadData);
  });
}

applyTheme(state.theme);
attachEvents();
selectView(location.hash.slice(1) in views ? location.hash.slice(1) : "overview");
loadData();
