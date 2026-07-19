const scheduleView = document.querySelector('[data-view="automations"]');
let schedulePanelCreated = false;
let scheduleBusy = false;
let scheduleSpaceSelect = null;
let scheduleTemplates = [];
let scheduleGroups = [];
let scheduleRecipients = [];
let scheduleItems = [];

function schedulePanel() {
  return document.querySelector("#documentSchedulesPanel");
}

function scheduleToday() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function scheduleTimeSoon() {
  const date = new Date(Date.now() + 5 * 60_000);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function scheduleTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function scheduleStateLabel(state) {
  return (
    {
      pending: "Ожидает обработки",
      generation_requested: "Формируются документы",
      delivery_requested: "Выполняется доставка",
      completed: "Завершён",
      skipped: "Пропущен",
      failed: "Ошибка"
    }[state] || state
  );
}

function scheduleStatusLabel(status) {
  return status === "active" ? "Активно" : "Отключено";
}

function scheduleRecurrenceLabel(schedule) {
  if (schedule.recurrenceKind === "once") {
    return `Однократно ${schedule.startDate} в ${schedule.localTime}`;
  }
  if (schedule.recurrenceKind === "daily") {
    return `Ежедневно в ${schedule.localTime}`;
  }
  return `Ежемесячно, ${schedule.dayOfMonth}-го числа в ${schedule.localTime}`;
}

function scheduleModeLabel(mode) {
  return mode === "aggregate"
    ? "Один сводный документ"
    : "Документ на каждого участника";
}

function scheduleDeliveryLabel(schedule) {
  return schedule.deliveryChannel === "email"
    ? `Почта: ${schedule.emailRecipientName || schedule.emailRecipientEmail || "получатель"}`
    : "Без автоматической доставки";
}

function scheduleResultMessage(run) {
  const value = run.error || run.result;
  if (value && typeof value === "object" && typeof value.message === "string") {
    return value.message;
  }
  if (run.state === "completed") return "Выпуск и доставка завершены.";
  return "";
}

function createSchedulePanel() {
  if (!scheduleView || schedulePanelCreated) return;
  schedulePanelCreated = true;
  const panel = document.createElement("section");
  panel.id = "documentSchedulesPanel";
  panel.className = "document-schedules-panel";
  panel.innerHTML = `
    <article class="panel schedule-card">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Автоматизация</p>
          <h2>Расписания выпуска документов</h2>
          <p>Запускайте проверенный шаблон по сохранённой группе однократно, ежедневно или ежемесячно. Каждый календарный период создаётся не более одного раза.</p>
        </div>
        <span class="large-emoji" aria-hidden="true">🗓️</span>
      </div>
      <div id="scheduleContent" class="schedule-content" aria-live="polite">
        <div class="generation-state"><span aria-hidden="true">⏳</span><div><strong>Получаем настройки</strong><p>Загружаем шаблоны, группы, получателей и существующие расписания.</p></div></div>
      </div>
    </article>`;
  scheduleView.append(panel);
}

function scheduleSelectedDelivery() {
  return document.querySelector("#scheduleDeliveryChannel")?.value || "none";
}

function scheduleSelectedRecurrence() {
  return document.querySelector("#scheduleRecurrence")?.value || "once";
}

function updateScheduleConditionalFields() {
  const monthly = document.querySelector("#scheduleMonthlyField");
  if (monthly) monthly.hidden = scheduleSelectedRecurrence() !== "monthly";
  const email = document.querySelector("#scheduleEmailFields");
  if (email) email.hidden = scheduleSelectedDelivery() !== "email";
}

function scheduleFormAvailable() {
  return (
    scheduleTemplates.length > 0 &&
    scheduleGroups.some((group) => group.status === "active" && group.memberCount > 0)
  );
}

function renderScheduleListHtml() {
  if (scheduleItems.length === 0) {
    return `<div class="generation-history-empty">Расписаний пока нет.</div>`;
  }
  return scheduleItems
    .map(
      (schedule) => `
        <article class="schedule-item ${schedule.status === "inactive" ? "is-inactive" : ""}">
          <div class="schedule-item-main">
            <div class="schedule-item-heading">
              <span class="generation-state-code">${scheduleStatusLabel(schedule.status)}</span>
              <strong>${generationEscape(schedule.name)}</strong>
            </div>
            <span>${generationEscape(schedule.templateTitle)} · ${generationEscape(schedule.groupName)} (${schedule.groupMemberCount})</span>
            <span>${generationEscape(scheduleModeLabel(schedule.targetMode))}</span>
            <span>${generationEscape(scheduleRecurrenceLabel(schedule))} · ${generationEscape(schedule.timezone)}</span>
            <span>${generationEscape(scheduleDeliveryLabel(schedule))}</span>
            <span>${schedule.nextRunAt ? `Следующий запуск: ${generationEscape(new Date(schedule.nextRunAt).toLocaleString("ru-RU"))}` : "Следующий запуск не назначен"}</span>
          </div>
          <div class="generation-history-actions schedule-actions">
            <button class="secondary-button" type="button" data-schedule-run="${generationEscape(schedule.id)}">Запустить сейчас</button>
            <button class="secondary-button" type="button" data-schedule-runs="${generationEscape(schedule.id)}">История</button>
            <button class="secondary-button" type="button" data-schedule-status="${generationEscape(schedule.id)}" data-next-status="${schedule.status === "active" ? "inactive" : "active"}">${schedule.status === "active" ? "Отключить" : "Включить"}</button>
          </div>
          <div class="schedule-runs" id="scheduleRuns_${generationEscape(schedule.id)}" hidden></div>
        </article>`
    )
    .join("");
}

function renderScheduleWorkspace() {
  const holder = document.querySelector("#scheduleContent");
  if (!holder) return;
  const activeGroups = scheduleGroups.filter(
    (group) => group.status === "active" && group.memberCount > 0
  );
  holder.innerHTML = `
    ${scheduleFormAvailable() ? `
      <form id="scheduleForm" class="schedule-form" novalidate>
        <div class="schedule-grid">
          <label class="generation-field"><span>Название расписания</span><input id="scheduleName" type="text" maxlength="300" placeholder="Например: ежемесячная ведомость" required /></label>
          <label class="generation-field"><span>Активный шаблон</span><select id="scheduleTemplate">${scheduleTemplates.map((template) => `<option value="${generationEscape(template.id)}">${generationEscape(template.title)} · ${String(template.format).toUpperCase()}</option>`).join("")}</select></label>
          <label class="generation-field"><span>Сохранённая группа</span><select id="scheduleGroup">${activeGroups.map((group) => `<option value="${generationEscape(group.id)}">${generationEscape(group.name)} · ${group.memberCount} участников</option>`).join("")}</select></label>
          <label class="generation-field"><span>Форма результата</span><select id="scheduleTargetMode"><option value="one_per_member">Документ на каждого участника</option><option value="aggregate">Один сводный документ</option></select></label>
          <label class="generation-field"><span>Периодичность</span><select id="scheduleRecurrence"><option value="once">Однократно</option><option value="daily">Ежедневно</option><option value="monthly">Ежемесячно</option></select></label>
          <label class="generation-field"><span>Дата начала</span><input id="scheduleStartDate" type="date" value="${scheduleToday()}" required /></label>
          <label class="generation-field"><span>Локальное время</span><input id="scheduleLocalTime" type="time" value="${scheduleTimeSoon()}" required /></label>
          <label class="generation-field"><span>Часовой пояс IANA</span><input id="scheduleTimezone" type="text" maxlength="100" value="${generationEscape(scheduleTimezone())}" required /><small>Например: Europe/Moscow или Asia/Yekaterinburg.</small></label>
          <label class="generation-field" id="scheduleMonthlyField" hidden><span>День месяца</span><input id="scheduleDayOfMonth" type="number" min="1" max="28" value="1" /><small>Первая версия ограничена днями 1–28.</small></label>
          <label class="generation-field"><span>Автоматическая доставка</span><select id="scheduleDeliveryChannel"><option value="none">Не доставлять автоматически</option><option value="email" ${scheduleRecipients.length === 0 ? "disabled" : ""}>Отправить по электронной почте</option></select></label>
          <label class="generation-field document-email-wide"><span>Описание</span><input id="scheduleDescription" type="text" maxlength="2000" placeholder="Необязательно" /></label>
          <section id="scheduleEmailFields" class="schedule-email-fields document-email-wide" hidden>
            <label class="generation-field"><span>Сохранённый получатель</span><select id="scheduleRecipient">${scheduleRecipients.filter((recipient) => recipient.status === "active").map((recipient) => `<option value="${generationEscape(recipient.id)}">${generationEscape(recipient.name)} · ${generationEscape(recipient.email)}</option>`).join("")}</select></label>
            <label class="generation-field"><span>Тема письма</span><input id="scheduleEmailSubject" type="text" maxlength="300" value="Документы: {template} · {period}" /></label>
            <label class="generation-field document-email-wide"><span>Текст письма</span><textarea id="scheduleEmailText" rows="4" maxlength="20000">Автоматический выпуск «{schedule}» за период {period}.\nШаблон: {template}.\nГруппа: {group}.\n\nДокументы находятся во вложении.</textarea><small>Доступны подстановки: {schedule}, {period}, {template}, {group}.</small></label>
          </section>
        </div>
        <div class="generation-actions"><button id="scheduleSubmit" class="primary-button" type="submit">Создать расписание</button><p id="scheduleMessage">Перед запуском система создаёт новый снимок группы и проверяет обязательные данные.</p></div>
      </form>` : `
      <div class="generation-state is-warning"><span aria-hidden="true">⚠️</span><div><strong>Расписание пока нельзя создать</strong><p>${scheduleTemplates.length === 0 ? "Нет активного шаблона." : "Нет активной непустой группы участников."}</p></div></div>`}
    <section class="schedule-list-section">
      <div class="generation-history-heading"><div><p class="eyebrow">Действующие правила</p><h3>Расписания пространства</h3></div><button class="secondary-button" id="scheduleRefresh" type="button">Обновить</button></div>
      <div id="scheduleList" class="schedule-list">${renderScheduleListHtml()}</div>
    </section>`;
  holder.querySelector("#scheduleRecurrence")?.addEventListener("change", updateScheduleConditionalFields);
  holder.querySelector("#scheduleDeliveryChannel")?.addEventListener("change", updateScheduleConditionalFields);
  holder.querySelector("#scheduleForm")?.addEventListener("submit", submitSchedule);
  holder.querySelector("#scheduleRefresh")?.addEventListener("click", loadScheduleWorkspace);
  bindScheduleListActions();
  updateScheduleConditionalFields();
}

function bindScheduleListActions() {
  document.querySelectorAll("[data-schedule-run]").forEach((button) => button.addEventListener("click", () => runScheduleNow(button.dataset.scheduleRun || "")));
  document.querySelectorAll("[data-schedule-runs]").forEach((button) => button.addEventListener("click", () => loadScheduleRuns(button.dataset.scheduleRuns || "")));
  document.querySelectorAll("[data-schedule-status]").forEach((button) => button.addEventListener("click", () => setScheduleStatus(button.dataset.scheduleStatus || "", button.dataset.nextStatus || "inactive")));
}

function scheduleRequestBody() {
  const recurrenceKind = scheduleSelectedRecurrence();
  const deliveryChannel = scheduleSelectedDelivery();
  return {
    name: document.querySelector("#scheduleName")?.value.trim() || "",
    ...(document.querySelector("#scheduleDescription")?.value.trim() ? { description: document.querySelector("#scheduleDescription").value.trim() } : {}),
    activeReleaseId: document.querySelector("#scheduleTemplate")?.value || "",
    groupId: document.querySelector("#scheduleGroup")?.value || "",
    targetMode: document.querySelector("#scheduleTargetMode")?.value || "one_per_member",
    recurrenceKind,
    timezone: document.querySelector("#scheduleTimezone")?.value.trim() || "UTC",
    localTime: document.querySelector("#scheduleLocalTime")?.value || "00:00",
    startDate: document.querySelector("#scheduleStartDate")?.value || scheduleToday(),
    ...(recurrenceKind === "monthly" ? { dayOfMonth: Number(document.querySelector("#scheduleDayOfMonth")?.value || 1) } : {}),
    deliveryChannel,
    ...(deliveryChannel === "email" ? {
      emailRecipientId: document.querySelector("#scheduleRecipient")?.value || "",
      emailSubject: document.querySelector("#scheduleEmailSubject")?.value || "",
      emailMessageText: document.querySelector("#scheduleEmailText")?.value || ""
    } : {})
  };
}

async function submitSchedule(event) {
  event.preventDefault();
  if (scheduleBusy) return;
  const button = document.querySelector("#scheduleSubmit");
  const message = document.querySelector("#scheduleMessage");
  if (!button || !message) return;
  scheduleBusy = true;
  button.disabled = true;
  message.className = "is-loading";
  message.textContent = "Проверяем связи и рассчитываем первый календарный запуск…";
  try {
    const body = await generationFetchJson(`/api/v1/spaces/${encodeURIComponent(currentGenerationSpaceId())}/document-schedules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(scheduleRequestBody())
    });
    message.className = "is-success";
    message.textContent = `Расписание создано. Первый запуск: ${new Date(body.data.nextRunAt).toLocaleString("ru-RU")}.`;
    await loadScheduleWorkspace();
  } catch (error) {
    message.className = "is-error";
    message.textContent = error?.message || "Расписание не создано.";
  } finally {
    scheduleBusy = false;
    button.disabled = false;
  }
}

async function setScheduleStatus(scheduleId, status) {
  if (scheduleBusy || !scheduleId) return;
  scheduleBusy = true;
  try {
    await generationFetchJson(`/api/v1/spaces/${encodeURIComponent(currentGenerationSpaceId())}/document-schedules/${encodeURIComponent(scheduleId)}/status`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status })
    });
    await loadScheduleWorkspace();
  } catch (error) {
    document.querySelector("#scheduleList")?.insertAdjacentHTML("afterbegin", `<div class="generation-state is-error"><span aria-hidden="true">⛔</span><div><strong>Состояние не изменено</strong><p>${generationEscape(error?.message || "Повторите действие.")}</p></div></div>`);
  } finally {
    scheduleBusy = false;
  }
}

async function runScheduleNow(scheduleId) {
  if (scheduleBusy || !scheduleId) return;
  scheduleBusy = true;
  try {
    const body = await generationFetchJson(`/api/v1/spaces/${encodeURIComponent(currentGenerationSpaceId())}/document-schedules/${encodeURIComponent(scheduleId)}/run-now`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    await loadScheduleRuns(scheduleId, true);
    document.querySelector(`#scheduleRuns_${CSS.escape(scheduleId)}`)?.insertAdjacentHTML("afterbegin", `<div class="generation-state is-pending"><span aria-hidden="true">⏳</span><div><strong>Ручной запуск создан</strong><p>Период: ${generationEscape(body.data.periodKey)}. Worker подхватит его без изменения календаря.</p></div></div>`);
  } catch (error) {
    const holder = document.querySelector(`#scheduleRuns_${CSS.escape(scheduleId)}`);
    if (holder) {
      holder.hidden = false;
      holder.innerHTML = `<div class="generation-state is-error"><span aria-hidden="true">⛔</span><div><strong>Запуск не создан</strong><p>${generationEscape(error?.message || "Повторите действие.")}</p></div></div>`;
    }
  } finally {
    scheduleBusy = false;
  }
}

async function loadScheduleRuns(scheduleId, forceOpen = false) {
  const holder = document.querySelector(`#scheduleRuns_${CSS.escape(scheduleId)}`);
  if (!holder) return;
  if (!forceOpen && !holder.hidden) {
    holder.hidden = true;
    return;
  }
  holder.hidden = false;
  holder.innerHTML = `<div class="generation-history-empty">Получаем историю…</div>`;
  try {
    const body = await generationFetchJson(`/api/v1/spaces/${encodeURIComponent(currentGenerationSpaceId())}/document-schedules/${encodeURIComponent(scheduleId)}/runs?limit=50`);
    const runs = Array.isArray(body.data) ? body.data : [];
    holder.innerHTML = runs.length === 0 ? `<div class="generation-history-empty">Запусков пока нет.</div>` : runs.map((run) => `
      <article class="schedule-run is-${generationEscape(run.state)}">
        <div><span class="generation-state-code">${generationEscape(scheduleStateLabel(run.state))}</span><strong>${generationEscape(run.periodKey)}</strong><span>Назначен: ${generationEscape(new Date(run.dueAt).toLocaleString("ru-RU"))}</span>${scheduleResultMessage(run) ? `<span>${generationEscape(scheduleResultMessage(run))}</span>` : ""}</div>
        <div class="generation-history-actions">${run.documentJobId ? `<button class="secondary-button" type="button" data-open-schedule-job="${generationEscape(run.documentJobId)}">Открыть выпуск</button>` : ""}</div>
      </article>`).join("");
    holder.querySelectorAll("[data-open-schedule-job]").forEach((button) => button.addEventListener("click", () => {
      const jobId = button.dataset.openScheduleJob;
      if (jobId) {
        generationPanel()?.scrollIntoView({ behavior: "smooth", block: "start" });
        void pollGenerationJob(jobId);
      }
    }));
  } catch (error) {
    holder.innerHTML = `<div class="generation-state is-error"><span aria-hidden="true">⚠️</span><div><strong>Историю получить не удалось</strong><p>${generationEscape(error?.message || "Повторите действие.")}</p></div></div>`;
  }
}

async function loadScheduleWorkspace() {
  createSchedulePanel();
  const holder = document.querySelector("#scheduleContent");
  const spaceId = currentGenerationSpaceId();
  if (!holder) return;
  if (!spaceId) {
    holder.innerHTML = `<div class="generation-state"><span aria-hidden="true">🧑‍🤝‍🧑</span><div><strong>Выберите пространство</strong><p>Расписания организованы по пространствам.</p></div></div>`;
    return;
  }
  holder.innerHTML = `<div class="generation-state"><span aria-hidden="true">⏳</span><div><strong>Получаем расписания</strong><p>Загружаем рабочие зависимости выбранного пространства.</p></div></div>`;
  try {
    const [templates, groups, recipients, schedules] = await Promise.all([
      generationFetchJson(`/api/v1/spaces/${encodeURIComponent(spaceId)}/active-templates`),
      generationFetchJson(`/api/v1/spaces/${encodeURIComponent(spaceId)}/groups?limit=200`),
      generationFetchJson(`/api/v1/spaces/${encodeURIComponent(spaceId)}/email-recipients`),
      generationFetchJson(`/api/v1/spaces/${encodeURIComponent(spaceId)}/document-schedules`)
    ]);
    scheduleTemplates = Array.isArray(templates.data) ? templates.data : [];
    scheduleGroups = Array.isArray(groups.data) ? groups.data : [];
    scheduleRecipients = Array.isArray(recipients.data) ? recipients.data : [];
    scheduleItems = Array.isArray(schedules.data) ? schedules.data : [];
    renderScheduleWorkspace();
  } catch (error) {
    holder.innerHTML = `<div class="generation-state is-error"><span aria-hidden="true">⚠️</span><div><strong>Расписания загрузить не удалось</strong><p>${generationEscape(error?.message || "Повторите действие.")}</p><button class="secondary-button" id="scheduleRetry" type="button">Повторить</button></div></div>`;
    holder.querySelector("#scheduleRetry")?.addEventListener("click", loadScheduleWorkspace);
  }
}

function bindScheduleSpaceSelect() {
  const candidate = document.querySelector("#documentQuarantineSpace");
  if (!candidate || candidate === scheduleSpaceSelect) return false;
  scheduleSpaceSelect = candidate;
  scheduleSpaceSelect.addEventListener("change", loadScheduleWorkspace);
  void loadScheduleWorkspace();
  return true;
}

if (scheduleView) {
  createSchedulePanel();
  if (!bindScheduleSpaceSelect()) {
    const observer = new MutationObserver(() => {
      if (bindScheduleSpaceSelect()) observer.disconnect();
    });
    observer.observe(scheduleView, { childList: true, subtree: true });
  }
}
