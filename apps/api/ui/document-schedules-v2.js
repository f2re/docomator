let scheduleV2EditingId = null;
let scheduleV2DuplicateFromId = null;
let scheduleV2FormOpen = false;
let scheduleV2DependencyErrors = [];
let scheduleV2LoadSequence = 0;

function scheduleV2DefaultsKey() {
  return `docomator.schedule.defaults.${currentGenerationSpaceId() || "default"}`;
}

function scheduleV2ReadDefaults() {
  try {
    const value = JSON.parse(localStorage.getItem(scheduleV2DefaultsKey()) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function scheduleV2RememberDefaults(body) {
  try {
    localStorage.setItem(
      scheduleV2DefaultsKey(),
      JSON.stringify({
        targetMode: body.targetMode,
        recurrenceKind: body.recurrenceKind,
        timezone: body.timezone,
        localTime: body.localTime,
        dayOfMonth: body.dayOfMonth || 1,
        deliveryChannel: body.deliveryChannel,
        emailRecipientId: body.emailRecipientId || "",
        networkSubdirectory:
          body.networkSubdirectory || "Автоматические документы/{schedule}/{period}"
      })
    );
  } catch {
    // Local preferences are optional; server state remains authoritative.
  }
}

function scheduleV2EnsurePanel() {
  createSchedulePanel();
  const panel = schedulePanel();
  if (!panel) return null;
  if (!panel.querySelector("#scheduleV2Header")) {
    panel.innerHTML = `
      <article class="panel schedule-card">
        <div class="schedule-v2-heading" id="scheduleV2Header">
          <div>
            <p class="eyebrow">Автоматизация</p>
            <h2>Расписания выпуска документов</h2>
            <p>Настройте один раз: система сама зафиксирует актуальный состав группы, проверит данные, сформирует файлы и сохранит результат.</p>
          </div>
          <div class="schedule-v2-heading-actions">
            <button class="secondary-button" id="scheduleV2Refresh" type="button">Обновить</button>
            <button class="primary-button" id="scheduleV2New" type="button">＋ Новое расписание</button>
          </div>
        </div>
        <div id="scheduleContent" class="schedule-content" aria-live="polite">
          <div class="generation-state"><span aria-hidden="true">⏳</span><div><strong>Получаем настройки</strong><p>Загружаем шаблоны, группы и существующие расписания.</p></div></div>
        </div>
      </article>`;
    panel
      .querySelector("#scheduleV2Refresh")
      ?.addEventListener("click", () => void loadScheduleWorkspace());
    panel
      .querySelector("#scheduleV2New")
      ?.addEventListener("click", () => scheduleV2OpenForm());
  }
  return panel;
}

function scheduleV2ActiveGroups() {
  return scheduleGroups.filter(
    (group) => group.status === "active" && group.memberCount > 0
  );
}

function scheduleV2DependenciesReady() {
  return scheduleTemplates.length > 0 && scheduleV2ActiveGroups().length > 0;
}

function scheduleV2TemplateHasRepeat(template) {
  return Array.isArray(template?.manifest?.repeats) && template.manifest.repeats.length > 0;
}

function scheduleV2CurrentItem() {
  return scheduleItems.find((item) => item.id === scheduleV2EditingId) || null;
}

function scheduleV2SourceItem() {
  const id = scheduleV2EditingId || scheduleV2DuplicateFromId;
  return scheduleItems.find((item) => item.id === id) || null;
}

function scheduleV2GeneratedName(templateId, groupId, recurrenceKind) {
  const template = scheduleTemplates.find((item) => item.id === templateId);
  const group = scheduleGroups.find((item) => item.id === groupId);
  const recurrence =
    recurrenceKind === "daily"
      ? "ежедневно"
      : recurrenceKind === "monthly"
        ? "ежемесячно"
        : "однократно";
  return [template?.title, group?.name, recurrence].filter(Boolean).join(" · ");
}

function scheduleV2FormValues() {
  const defaults = scheduleV2ReadDefaults();
  const source = scheduleV2SourceItem();
  const editing = scheduleV2EditingId !== null;
  const duplicate = scheduleV2DuplicateFromId !== null;
  const templateId =
    source?.activeReleaseId || defaults.activeReleaseId || scheduleTemplates[0]?.id || "";
  const groupId =
    source?.groupId || defaults.groupId || scheduleV2ActiveGroups()[0]?.id || "";
  const recurrenceKind =
    source?.recurrenceKind || defaults.recurrenceKind || "monthly";
  const targetMode =
    source?.targetMode || defaults.targetMode ||
    (scheduleV2TemplateHasRepeat(
      scheduleTemplates.find((item) => item.id === templateId)
    )
      ? "aggregate"
      : "one_per_member");
  const deliveryChannel =
    source?.deliveryChannel || defaults.deliveryChannel || "none";
  const name = duplicate
    ? `${source?.name || scheduleV2GeneratedName(templateId, groupId, recurrenceKind)} — копия`
    : source?.name || scheduleV2GeneratedName(templateId, groupId, recurrenceKind);
  return {
    editing,
    duplicate,
    name,
    description: duplicate ? source?.description || "" : source?.description || "",
    templateId,
    groupId,
    targetMode,
    recurrenceKind,
    startDate: duplicate ? scheduleToday() : source?.startDate || scheduleToday(),
    localTime: source?.localTime || defaults.localTime || scheduleTimeSoon(),
    timezone: source?.timezone || defaults.timezone || scheduleTimezone(),
    dayOfMonth: source?.dayOfMonth || defaults.dayOfMonth || 1,
    deliveryChannel,
    emailRecipientId:
      source?.emailRecipientId || defaults.emailRecipientId || scheduleRecipients[0]?.id || "",
    emailSubject:
      source?.emailSubject || "Документы: {template} · {period}",
    emailMessageText:
      source?.emailMessageText ||
      "Автоматический выпуск «{schedule}» за период {period}.\nШаблон: {template}.\nГруппа: {group}.\n\nДокументы находятся во вложении.",
    networkSubdirectory:
      source?.networkSubdirectory ||
      defaults.networkSubdirectory ||
      "Автоматические документы/{schedule}/{period}"
  };
}

function scheduleV2Option(items, selectedValue, valueKey, label) {
  return items
    .map((item) => {
      const value = String(item[valueKey]);
      return `<option value="${generationEscape(value)}"${value === selectedValue ? " selected" : ""}>${generationEscape(label(item))}</option>`;
    })
    .join("");
}

function scheduleV2DependencyHtml() {
  const missingTemplate = scheduleTemplates.length === 0;
  const missingGroup = scheduleV2ActiveGroups().length === 0;
  const errors = scheduleV2DependencyErrors.length > 0
    ? `<div class="schedule-v2-dependency is-error"><span aria-hidden="true">!</span><div><strong>Часть данных не загрузилась</strong><p>${generationEscape(scheduleV2DependencyErrors.join(" "))}</p></div><button class="secondary-button" type="button" data-schedule-v2-retry>Повторить</button></div>`
    : "";
  return `<section class="schedule-v2-dependencies" aria-label="Готовность автоматизации">
    ${errors}
    <div class="schedule-v2-dependency ${missingTemplate ? "is-warning" : "is-ready"}">
      <span aria-hidden="true">${missingTemplate ? "1" : "✓"}</span>
      <div><strong>${missingTemplate ? "Нужен активный шаблон" : `Шаблоны готовы: ${scheduleTemplates.length}`}</strong><p>${missingTemplate ? "Подключите DOCX или XLSX, свяжите поля и активируйте проверенную версию." : "Расписание всегда использует зафиксированную активную версию."}</p></div>
      ${missingTemplate ? '<button class="secondary-button" type="button" data-view-target="templates">Открыть шаблоны</button>' : ""}
    </div>
    <div class="schedule-v2-dependency ${missingGroup ? "is-warning" : "is-ready"}">
      <span aria-hidden="true">${missingGroup ? "2" : "✓"}</span>
      <div><strong>${missingGroup ? "Нужна непустая группа сотрудников" : `Группы готовы: ${scheduleV2ActiveGroups().length}`}</strong><p>${missingGroup ? "Создайте группу один раз. При каждом запуске система сама фиксирует её актуальный состав." : "Изменение группы влияет только на будущие запуски; выполненные выпуски не меняются."}</p></div>
      ${missingGroup ? '<button class="primary-button" type="button" data-schedule-v2-create-group>Создать группу</button>' : '<button class="secondary-button" type="button" data-schedule-v2-manage-groups>Управлять группами</button>'}
    </div>
  </section>`;
}

function scheduleV2EditorHtml() {
  if (!scheduleV2FormOpen) return "";
  const values = scheduleV2FormValues();
  const activeGroups = scheduleV2ActiveGroups();
  const currentGroup = scheduleGroups.find((group) => group.id === values.groupId);
  const groupOptions = [
    ...activeGroups,
    ...(currentGroup && !activeGroups.some((group) => group.id === currentGroup.id)
      ? [currentGroup]
      : [])
  ];
  const recipientOptions = scheduleRecipients.filter((recipient) => recipient.status === "active");
  const networkExisting = values.editing && values.deliveryChannel === "network_folder";
  return `<section class="schedule-v2-editor" id="scheduleV2Editor">
    <div class="schedule-v2-editor-heading">
      <div><p class="eyebrow">${values.editing ? "Редактирование" : values.duplicate ? "Новая копия" : "Новое правило"}</p><h3>${values.editing ? "Изменить расписание" : "Настроить расписание"}</h3><p>Все параметры можно изменить позже. Следующий запуск пересчитывается сразу после сохранения.</p></div>
      <button class="icon-button" type="button" data-schedule-v2-close aria-label="Закрыть редактор">×</button>
    </div>
    <form id="scheduleV2Form" novalidate>
      <div class="schedule-grid schedule-v2-grid">
        <label class="generation-field schedule-v2-wide"><span>Название расписания</span><input id="scheduleName" type="text" maxlength="300" value="${generationEscape(values.name)}" required /><small>Понятное имя для истории и уведомлений. При создании система предлагает его автоматически.</small></label>
        <label class="generation-field"><span>Активный шаблон</span><select id="scheduleTemplate">${scheduleV2Option(scheduleTemplates, values.templateId, "id", (template) => `${template.title} · ${String(template.format).toUpperCase()}`)}</select></label>
        <label class="generation-field"><span>Группа сотрудников</span><select id="scheduleGroup">${scheduleV2Option(groupOptions, values.groupId, "id", (group) => `${group.name} · ${group.memberCount} участников`)}</select><small><button class="text-button schedule-inline-link" type="button" data-schedule-v2-manage-groups>Изменить группы</button></small></label>
        <label class="generation-field"><span>Форма результата</span><select id="scheduleTargetMode"><option value="one_per_member"${values.targetMode === "one_per_member" ? " selected" : ""}>Документ на каждого</option><option value="aggregate"${values.targetMode === "aggregate" ? " selected" : ""}>Один сводный документ</option></select></label>
        <label class="generation-field"><span>Периодичность</span><select id="scheduleRecurrence"><option value="once"${values.recurrenceKind === "once" ? " selected" : ""}>Однократно</option><option value="daily"${values.recurrenceKind === "daily" ? " selected" : ""}>Каждый день</option><option value="monthly"${values.recurrenceKind === "monthly" ? " selected" : ""}>Каждый месяц</option></select></label>
        <label class="generation-field"><span>Дата начала</span><input id="scheduleStartDate" type="date" value="${generationEscape(values.startDate)}" required /></label>
        <label class="generation-field"><span>Время запуска</span><input id="scheduleLocalTime" type="time" value="${generationEscape(values.localTime)}" required /></label>
        <label class="generation-field"><span>Часовой пояс</span><input id="scheduleTimezone" type="text" maxlength="100" value="${generationEscape(values.timezone)}" list="scheduleV2Timezones" required /><datalist id="scheduleV2Timezones"><option value="Europe/Moscow"></option><option value="Europe/Kaliningrad"></option><option value="Asia/Yekaterinburg"></option><option value="Asia/Omsk"></option><option value="Asia/Krasnoyarsk"></option><option value="Asia/Irkutsk"></option><option value="Asia/Yakutsk"></option><option value="Asia/Vladivostok"></option><option value="Asia/Magadan"></option><option value="Asia/Kamchatka"></option><option value="UTC"></option></datalist><small>Определён автоматически. Меняйте только если подразделение работает в другом поясе.</small></label>
        <label class="generation-field" id="scheduleMonthlyField"${values.recurrenceKind === "monthly" ? "" : " hidden"}><span>День месяца</span><input id="scheduleDayOfMonth" type="number" min="1" max="28" value="${values.dayOfMonth}" /><small>Дни 1–28 гарантированно существуют в каждом месяце.</small></label>
        <label class="generation-field"><span>После формирования</span><select id="scheduleDeliveryChannel"${networkExisting ? " disabled" : ""}><option value="none"${values.deliveryChannel === "none" ? " selected" : ""}>Оставить в разделе «Результаты»</option><option value="email"${values.deliveryChannel === "email" ? " selected" : ""}${recipientOptions.length === 0 ? " disabled" : ""}>Отправить по электронной почте</option>${scheduleNetworkEnabled || values.deliveryChannel === "network_folder" ? `<option value="network_folder"${values.deliveryChannel === "network_folder" ? " selected" : ""}>Сохранить в сетевую папку</option>` : ""}</select>${networkExisting ? "<small>Для смены канала создайте копию расписания. Путь сетевой папки можно изменить.</small>" : ""}</label>
        <label class="generation-field schedule-v2-wide"><span>Описание</span><input id="scheduleDescription" type="text" maxlength="2000" value="${generationEscape(values.description)}" placeholder="Необязательно: назначение и ответственный" /></label>
        <section id="scheduleEmailFields" class="schedule-email-fields schedule-v2-wide"${values.deliveryChannel === "email" ? "" : " hidden"}>
          <label class="generation-field"><span>Получатель</span><select id="scheduleRecipient">${scheduleV2Option(recipientOptions, values.emailRecipientId, "id", (recipient) => `${recipient.name} · ${recipient.email}`)}</select></label>
          <label class="generation-field"><span>Тема письма</span><input id="scheduleEmailSubject" type="text" maxlength="300" value="${generationEscape(values.emailSubject)}" /></label>
          <label class="generation-field schedule-v2-wide"><span>Текст письма</span><textarea id="scheduleEmailText" rows="5" maxlength="20000">${generationEscape(values.emailMessageText)}</textarea><small>Подстановки: {schedule}, {period}, {template}, {group}.</small></label>
        </section>
        <section id="scheduleNetworkFields" class="schedule-email-fields schedule-v2-wide"${values.deliveryChannel === "network_folder" ? "" : " hidden"}>
          <label class="generation-field schedule-v2-wide"><span>Вложенный каталог</span><input id="scheduleNetworkSubdirectory" type="text" maxlength="500" value="${generationEscape(values.networkSubdirectory)}" /><small>Корневую папку задаёт администратор. Подстановки: {schedule}, {period}, {template}, {group}.</small></label>
        </section>
      </div>
      <div class="schedule-v2-preview" id="scheduleV2Preview" role="status"></div>
      <div class="generation-actions schedule-v2-actions">
        <button class="secondary-button" type="button" data-schedule-v2-close>Отмена</button>
        <button id="scheduleSubmit" class="primary-button" type="submit">${values.editing ? "Сохранить изменения" : "Создать расписание"}</button>
        <p id="scheduleMessage">Перед каждым запуском система фиксирует текущий состав группы и проверяет обязательные данные.</p>
      </div>
    </form>
  </section>`;
}

function scheduleV2NextRunText(schedule) {
  if (schedule.status === "inactive") return "Отключено — автоматических запусков не будет";
  if (!schedule.nextRunAt) return "Следующий запуск пока не рассчитан";
  return `Следующий запуск: ${new Date(schedule.nextRunAt).toLocaleString("ru-RU")}`;
}

function scheduleV2ListHtml() {
  if (scheduleItems.length === 0) {
    return `<div class="schedule-v2-empty"><span aria-hidden="true">🗓️</span><div><strong>Расписаний пока нет</strong><p>Создайте первое правило — оно будет работать без ежедневных действий оператора.</p></div>${scheduleV2DependenciesReady() ? '<button class="primary-button" type="button" data-schedule-v2-new>Создать расписание</button>' : ""}</div>`;
  }
  return scheduleItems
    .map(
      (schedule) => `<article class="schedule-item schedule-v2-item ${schedule.status === "inactive" ? "is-inactive" : ""}">
        <div class="schedule-item-main">
          <div class="schedule-item-heading"><span class="generation-state-code">${generationEscape(scheduleStatusLabel(schedule.status))}</span><strong>${generationEscape(schedule.name)}</strong></div>
          <span>${generationEscape(schedule.templateTitle)} · ${generationEscape(schedule.groupName)} (${schedule.groupMemberCount})</span>
          <span>${generationEscape(scheduleModeLabel(schedule.targetMode))}</span>
          <span>${generationEscape(scheduleRecurrenceLabel(schedule))} · ${generationEscape(schedule.timezone)}</span>
          <span>${generationEscape(scheduleDeliveryLabel(schedule))}</span>
          <span class="schedule-v2-next">${generationEscape(scheduleV2NextRunText(schedule))}</span>
        </div>
        <div class="generation-history-actions schedule-actions schedule-v2-item-actions">
          <button class="primary-button" type="button" data-schedule-run="${generationEscape(schedule.id)}">Запустить сейчас</button>
          <button class="secondary-button" type="button" data-schedule-v2-edit="${generationEscape(schedule.id)}">Изменить</button>
          <button class="secondary-button" type="button" data-schedule-v2-duplicate="${generationEscape(schedule.id)}">Создать копию</button>
          <button class="secondary-button" type="button" data-schedule-runs="${generationEscape(schedule.id)}">История</button>
          <button class="text-button" type="button" data-schedule-status="${generationEscape(schedule.id)}" data-next-status="${schedule.status === "active" ? "inactive" : "active"}">${schedule.status === "active" ? "Отключить" : "Включить"}</button>
        </div>
        <div class="schedule-runs" id="scheduleRuns_${generationEscape(schedule.id)}" hidden></div>
      </article>`
    )
    .join("");
}

function renderScheduleWorkspace() {
  scheduleV2EnsurePanel();
  const holder = document.querySelector("#scheduleContent");
  if (!holder) return;
  const ready = scheduleV2DependenciesReady();
  const newButton = document.querySelector("#scheduleV2New");
  if (newButton) {
    newButton.disabled = !ready;
    newButton.title = ready
      ? "Создать расписание"
      : "Сначала подготовьте активный шаблон и непустую группу";
  }
  if (!ready) {
    scheduleV2FormOpen = false;
    scheduleV2EditingId = null;
    scheduleV2DuplicateFromId = null;
  }
  holder.innerHTML = `
    ${scheduleV2DependencyHtml()}
    ${scheduleV2EditorHtml()}
    <section class="schedule-list-section">
      <div class="generation-history-heading"><div><p class="eyebrow">Действующие правила</p><h3>Расписания пространства</h3></div><span class="operator-counter">Всего: ${scheduleItems.length}</span></div>
      <div id="scheduleList" class="schedule-list">${scheduleV2ListHtml()}</div>
    </section>`;
  scheduleV2BindWorkspace();
  if (scheduleV2FormOpen) {
    scheduleV2UpdateConditionalFields();
    scheduleV2UpdatePreview();
    requestAnimationFrame(() =>
      document.querySelector("#scheduleV2Editor")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      })
    );
  }
}

function scheduleV2OpenForm(scheduleId = "", duplicate = false) {
  if (!scheduleV2DependenciesReady()) return;
  scheduleV2EditingId = duplicate ? null : scheduleId || null;
  scheduleV2DuplicateFromId = duplicate ? scheduleId : null;
  scheduleV2FormOpen = true;
  renderScheduleWorkspace();
}

function scheduleV2CloseForm() {
  scheduleV2FormOpen = false;
  scheduleV2EditingId = null;
  scheduleV2DuplicateFromId = null;
  renderScheduleWorkspace();
}

function scheduleV2UpdateConditionalFields() {
  const recurrence = document.querySelector("#scheduleRecurrence")?.value || "once";
  const delivery = document.querySelector("#scheduleDeliveryChannel")?.value || "none";
  const monthly = document.querySelector("#scheduleMonthlyField");
  if (monthly) monthly.hidden = recurrence !== "monthly";
  const email = document.querySelector("#scheduleEmailFields");
  if (email) email.hidden = delivery !== "email";
  const network = document.querySelector("#scheduleNetworkFields");
  if (network) network.hidden = delivery !== "network_folder";
  const template = scheduleTemplates.find(
    (item) => item.id === document.querySelector("#scheduleTemplate")?.value
  );
  const personal = document.querySelector('#scheduleTargetMode option[value="one_per_member"]');
  if (personal) personal.disabled = scheduleV2TemplateHasRepeat(template);
  if (
    scheduleV2TemplateHasRepeat(template) &&
    document.querySelector("#scheduleTargetMode")?.value !== "aggregate"
  ) {
    document.querySelector("#scheduleTargetMode").value = "aggregate";
  }
  scheduleV2UpdateSuggestedName();
  scheduleV2UpdatePreview();
}

function scheduleV2UpdateSuggestedName() {
  const name = document.querySelector("#scheduleName");
  if (!name || scheduleV2EditingId || scheduleV2DuplicateFromId) return;
  if (name.dataset.operatorEdited === "true") return;
  name.value = scheduleV2GeneratedName(
    document.querySelector("#scheduleTemplate")?.value || "",
    document.querySelector("#scheduleGroup")?.value || "",
    document.querySelector("#scheduleRecurrence")?.value || "once"
  );
}

function scheduleV2UpdatePreview() {
  const preview = document.querySelector("#scheduleV2Preview");
  if (!preview) return;
  const recurrence = document.querySelector("#scheduleRecurrence")?.value || "once";
  const date = document.querySelector("#scheduleStartDate")?.value || scheduleToday();
  const time = document.querySelector("#scheduleLocalTime")?.value || "00:00";
  const timezone = document.querySelector("#scheduleTimezone")?.value.trim() || "UTC";
  const groupId = document.querySelector("#scheduleGroup")?.value || "";
  const group = scheduleGroups.find((item) => item.id === groupId);
  const targetMode = document.querySelector("#scheduleTargetMode")?.value || "one_per_member";
  const files = targetMode === "aggregate" ? 1 : group?.memberCount || 0;
  const recurrenceText =
    recurrence === "daily"
      ? `каждый день с ${date}`
      : recurrence === "monthly"
        ? `${document.querySelector("#scheduleDayOfMonth")?.value || 1}-го числа каждого месяца с ${date}`
        : `один раз ${date}`;
  preview.innerHTML = `<span aria-hidden="true">✓</span><div><strong>Что произойдёт</strong><p>${generationEscape(recurrenceText)} в ${generationEscape(time)} (${generationEscape(timezone)}) система возьмёт актуальный состав группы «${generationEscape(group?.name || "—") }», проверит данные и подготовит файлов: ${files}. Повтор одного календарного периода не создаётся.</p></div>`;
}

function scheduleV2RequestBody() {
  const recurrenceKind = document.querySelector("#scheduleRecurrence")?.value || "once";
  const deliveryChannel = document.querySelector("#scheduleDeliveryChannel")?.value || "none";
  return {
    name: document.querySelector("#scheduleName")?.value.trim() || "",
    ...(document.querySelector("#scheduleDescription")?.value.trim()
      ? { description: document.querySelector("#scheduleDescription").value.trim() }
      : {}),
    activeReleaseId: document.querySelector("#scheduleTemplate")?.value || "",
    groupId: document.querySelector("#scheduleGroup")?.value || "",
    targetMode: document.querySelector("#scheduleTargetMode")?.value || "one_per_member",
    recurrenceKind,
    timezone: document.querySelector("#scheduleTimezone")?.value.trim() || "UTC",
    localTime: document.querySelector("#scheduleLocalTime")?.value || "00:00",
    startDate: document.querySelector("#scheduleStartDate")?.value || scheduleToday(),
    ...(recurrenceKind === "monthly"
      ? { dayOfMonth: Number(document.querySelector("#scheduleDayOfMonth")?.value || 1) }
      : {}),
    deliveryChannel,
    ...(deliveryChannel === "email"
      ? {
          emailRecipientId: document.querySelector("#scheduleRecipient")?.value || "",
          emailSubject: document.querySelector("#scheduleEmailSubject")?.value || "",
          emailMessageText: document.querySelector("#scheduleEmailText")?.value || ""
        }
      : {}),
    ...(deliveryChannel === "network_folder"
      ? {
          networkSubdirectory:
            document.querySelector("#scheduleNetworkSubdirectory")?.value.trim() || ""
        }
      : {})
  };
}

function scheduleV2NetworkKey() {
  return `schedule_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

async function scheduleV2Submit(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  if (scheduleBusy) return;
  const form = document.querySelector("#scheduleV2Form");
  if (!form?.reportValidity()) return;
  const button = document.querySelector("#scheduleSubmit");
  const message = document.querySelector("#scheduleMessage");
  if (!button || !message) return;
  const body = scheduleV2RequestBody();
  scheduleBusy = true;
  button.disabled = true;
  button.textContent = scheduleV2EditingId ? "Сохраняем…" : "Создаём…";
  message.className = "is-loading";
  message.textContent = "Проверяем шаблон, группу и рассчитываем следующий запуск…";
  try {
    let url = `/api/v1/spaces/${encodeURIComponent(currentGenerationSpaceId())}/document-schedules`;
    let method = "POST";
    let payload = body;
    if (scheduleV2EditingId) {
      method = "PUT";
      url += `/${encodeURIComponent(scheduleV2EditingId)}`;
      if (body.deliveryChannel === "network_folder") {
        url += "/network-folder";
      }
    } else if (body.deliveryChannel === "network_folder") {
      url += "/network-folder";
      payload = { ...body, key: scheduleV2NetworkKey() };
    }
    const result = await generationFetchJson(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    scheduleV2RememberDefaults(body);
    scheduleV2FormOpen = false;
    scheduleV2EditingId = null;
    scheduleV2DuplicateFromId = null;
    await loadScheduleWorkspace();
    const next = result.data?.nextRunAt
      ? new Date(result.data.nextRunAt).toLocaleString("ru-RU")
      : "не назначен";
    const list = document.querySelector("#scheduleList");
    list?.insertAdjacentHTML(
      "afterbegin",
      `<div class="generation-state is-success"><span aria-hidden="true">✓</span><div><strong>Расписание сохранено</strong><p>Следующий автоматический запуск: ${generationEscape(next)}.</p></div></div>`
    );
  } catch (error) {
    message.className = "is-error";
    message.textContent = error?.message || "Расписание сохранить не удалось.";
  } finally {
    scheduleBusy = false;
    button.disabled = false;
    button.textContent = scheduleV2EditingId ? "Сохранить изменения" : "Создать расписание";
  }
}

function scheduleV2BindWorkspace() {
  document.querySelectorAll("[data-schedule-v2-close]").forEach((button) =>
    button.addEventListener("click", scheduleV2CloseForm)
  );
  document.querySelectorAll("[data-schedule-v2-new]").forEach((button) =>
    button.addEventListener("click", () => scheduleV2OpenForm())
  );
  document.querySelectorAll("[data-schedule-v2-edit]").forEach((button) =>
    button.addEventListener("click", () =>
      scheduleV2OpenForm(button.dataset.scheduleV2Edit || "")
    )
  );
  document.querySelectorAll("[data-schedule-v2-duplicate]").forEach((button) =>
    button.addEventListener("click", () =>
      scheduleV2OpenForm(button.dataset.scheduleV2Duplicate || "", true)
    )
  );
  document.querySelectorAll("[data-schedule-v2-create-group]").forEach((button) =>
    button.addEventListener("click", () =>
      window.dispatchEvent(
        new CustomEvent("docomator:open-group-manager", {
          detail: { selectAll: true }
        })
      )
    )
  );
  document.querySelectorAll("[data-schedule-v2-manage-groups]").forEach((button) =>
    button.addEventListener("click", () =>
      window.dispatchEvent(new CustomEvent("docomator:open-group-manager"))
    )
  );
  document.querySelectorAll("[data-schedule-v2-retry]").forEach((button) =>
    button.addEventListener("click", () => void loadScheduleWorkspace())
  );
  document.querySelectorAll("[data-schedule-run]").forEach((button) =>
    button.addEventListener("click", () =>
      void runScheduleNow(button.dataset.scheduleRun || "")
    )
  );
  document.querySelectorAll("[data-schedule-runs]").forEach((button) =>
    button.addEventListener("click", () =>
      void loadScheduleRuns(button.dataset.scheduleRuns || "")
    )
  );
  document.querySelectorAll("[data-schedule-status]").forEach((button) =>
    button.addEventListener("click", () =>
      void setScheduleStatus(
        button.dataset.scheduleStatus || "",
        button.dataset.nextStatus || "inactive"
      )
    )
  );
  const form = document.querySelector("#scheduleV2Form");
  form?.addEventListener("submit", scheduleV2Submit, true);
  [
    "#scheduleTemplate",
    "#scheduleGroup",
    "#scheduleTargetMode",
    "#scheduleRecurrence",
    "#scheduleStartDate",
    "#scheduleLocalTime",
    "#scheduleTimezone",
    "#scheduleDayOfMonth",
    "#scheduleDeliveryChannel"
  ].forEach((selector) =>
    document.querySelector(selector)?.addEventListener("change", scheduleV2UpdateConditionalFields)
  );
  document.querySelector("#scheduleName")?.addEventListener("input", (event) => {
    event.currentTarget.dataset.operatorEdited = "true";
  });
}

async function loadScheduleWorkspace() {
  scheduleV2EnsurePanel();
  const holder = document.querySelector("#scheduleContent");
  const spaceId = currentGenerationSpaceId();
  if (!holder) return;
  const sequence = ++scheduleV2LoadSequence;
  if (!spaceId) {
    holder.innerHTML = `<div class="generation-state"><span aria-hidden="true">🧑‍🤝‍🧑</span><div><strong>Выберите раздел данных</strong><p>Расписания, группы и шаблоны относятся к выбранному разделу.</p></div></div>`;
    return;
  }
  holder.innerHTML = `<div class="generation-state" role="status"><span aria-hidden="true">⏳</span><div><strong>Получаем расписания</strong><p>Загружаем шаблоны, группы и каналы доставки. Это не блокирует другие разделы.</p></div></div>`;
  const endpoints = [
    ["templates", `/api/v1/spaces/${encodeURIComponent(spaceId)}/active-templates`, true],
    ["groups", `/api/v1/spaces/${encodeURIComponent(spaceId)}/groups?limit=200`, true],
    ["schedules", `/api/v1/spaces/${encodeURIComponent(spaceId)}/document-schedules`, true],
    ["recipients", `/api/v1/spaces/${encodeURIComponent(spaceId)}/email-recipients`, false],
    ["network", `/api/v1/spaces/${encodeURIComponent(spaceId)}/document-schedule-network-settings`, false]
  ];
  const results = await Promise.allSettled(
    endpoints.map(([, url]) => generationFetchJson(url))
  );
  if (sequence !== scheduleV2LoadSequence) return;
  scheduleV2DependencyErrors = [];
  const values = new Map();
  results.forEach((result, index) => {
    const [name, , required] = endpoints[index];
    if (result.status === "fulfilled") {
      values.set(name, result.value.data);
    } else if (required) {
      scheduleV2DependencyErrors.push(
        `${name === "templates" ? "Шаблоны" : name === "groups" ? "Группы" : "Расписания"}: ${result.reason?.message || "нет ответа сервера"}.`
      );
    }
  });
  scheduleTemplates = Array.isArray(values.get("templates")) ? values.get("templates") : [];
  scheduleGroups = Array.isArray(values.get("groups")) ? values.get("groups") : [];
  scheduleItems = Array.isArray(values.get("schedules")) ? values.get("schedules") : [];
  scheduleRecipients = Array.isArray(values.get("recipients")) ? values.get("recipients") : [];
  const network = values.get("network");
  scheduleNetworkEnabled = network?.networkFolderEnabled === true;
  scheduleNetworkSettings = Array.isArray(network?.items) ? network.items : [];
  if (scheduleNetworkSettings.length > 0) {
    const byId = new Map(scheduleNetworkSettings.map((item) => [item.id, item]));
    scheduleItems = scheduleItems.map((item) => byId.get(item.id) || item);
  }
  renderScheduleWorkspace();
}

updateScheduleConditionalFields = scheduleV2UpdateConditionalFields;
bindScheduleListActions = scheduleV2BindWorkspace;

function scheduleV2HandleSpaceChanged() {
  scheduleV2FormOpen = false;
  scheduleV2EditingId = null;
  scheduleV2DuplicateFromId = null;
  void loadScheduleWorkspace();
}

document.addEventListener("docomator:space-changed", scheduleV2HandleSpaceChanged);
window.addEventListener("docomator:view-changed", (event) => {
  if (event.detail?.view === "automations") void loadScheduleWorkspace();
});
window.addEventListener("docomator:groups-changed", (event) => {
  if (!event.detail?.spaceId || event.detail.spaceId === currentGenerationSpaceId()) {
    void loadScheduleWorkspace();
  }
});

scheduleV2EnsurePanel();
if (currentGenerationSpaceId()) void loadScheduleWorkspace();
