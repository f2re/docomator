let scheduleNetworkSettings = [];
let scheduleNetworkEnabled = false;

const baseScheduleDeliveryLabel = scheduleDeliveryLabel;
scheduleDeliveryLabel = function scheduleDeliveryLabelWithNetwork(schedule) {
  if (schedule.deliveryChannel === "network_folder") {
    return `Сетевая папка: ${schedule.networkSubdirectory || "вложенный каталог"}`;
  }
  return baseScheduleDeliveryLabel(schedule);
};

const baseUpdateScheduleConditionalFields = updateScheduleConditionalFields;
updateScheduleConditionalFields = function updateScheduleConditionalFieldsWithNetwork() {
  baseUpdateScheduleConditionalFields();
  const network = document.querySelector("#scheduleNetworkFields");
  if (network) network.hidden = scheduleSelectedDelivery() !== "network_folder";
};

const baseRenderScheduleWorkspace = renderScheduleWorkspace;
renderScheduleWorkspace = function renderScheduleWorkspaceWithNetwork() {
  baseRenderScheduleWorkspace();
  const select = document.querySelector("#scheduleDeliveryChannel");
  if (!select) return;
  if (!select.querySelector('option[value="network_folder"]')) {
    const option = document.createElement("option");
    option.value = "network_folder";
    option.textContent = scheduleNetworkEnabled
      ? "Сохранить в сетевую папку"
      : "Сетевая папка не настроена";
    option.disabled = !scheduleNetworkEnabled;
    select.append(option);
  }
  const emailFields = document.querySelector("#scheduleEmailFields");
  if (emailFields && !document.querySelector("#scheduleNetworkFields")) {
    const section = document.createElement("section");
    section.id = "scheduleNetworkFields";
    section.className = "schedule-email-fields document-email-wide";
    section.hidden = true;
    section.innerHTML = `
      <label class="generation-field document-email-wide">
        <span>Вложенный каталог</span>
        <input id="scheduleNetworkSubdirectory" type="text" maxlength="500" value="Автоматические документы/{schedule}/{period}" />
        <small>Корень задаёт администратор. Подстановки: {schedule}, {period}, {template}, {group}. Сформированный документ в любом случае останется в общем хранилище.</small>
      </label>`;
    emailFields.insertAdjacentElement("afterend", section);
  }
  select.addEventListener("change", updateScheduleConditionalFields);
  updateScheduleConditionalFields();
};

const baseScheduleRequestBody = scheduleRequestBody;
scheduleRequestBody = function scheduleRequestBodyWithNetwork() {
  const body = baseScheduleRequestBody();
  if (scheduleSelectedDelivery() === "network_folder") {
    return {
      ...body,
      deliveryChannel: "network_folder",
      networkSubdirectory:
        document.querySelector("#scheduleNetworkSubdirectory")?.value.trim() || ""
    };
  }
  return body;
};

const baseSubmitSchedule = submitSchedule;
submitSchedule = async function submitScheduleWithNetwork(event) {
  if (scheduleSelectedDelivery() !== "network_folder") {
    return baseSubmitSchedule(event);
  }
  event.preventDefault();
  if (scheduleBusy) return;
  const button = document.querySelector("#scheduleSubmit");
  const message = document.querySelector("#scheduleMessage");
  if (!button || !message) return;
  scheduleBusy = true;
  button.disabled = true;
  message.className = "is-loading";
  message.textContent = "Проверяем путь и рассчитываем первый календарный запуск…";
  try {
    const body = await generationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(currentGenerationSpaceId())}/document-schedules/network-folder`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(scheduleRequestBody())
      }
    );
    message.className = "is-success";
    message.textContent = `Расписание создано. Первый запуск: ${new Date(body.data.nextRunAt).toLocaleString("ru-RU")}.`;
    await loadScheduleWorkspace();
  } catch (error) {
    message.className = "is-error";
    message.textContent = error?.message || "Сетевое расписание не создано.";
  } finally {
    scheduleBusy = false;
    button.disabled = false;
  }
};

const baseLoadScheduleWorkspace = loadScheduleWorkspace;
loadScheduleWorkspace = async function loadScheduleWorkspaceWithNetwork() {
  await baseLoadScheduleWorkspace();
  const spaceId = currentGenerationSpaceId();
  if (!spaceId) return;
  try {
    const body = await generationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/document-schedule-network-settings`
    );
    scheduleNetworkEnabled = body.data?.networkFolderEnabled === true;
    scheduleNetworkSettings = Array.isArray(body.data?.items) ? body.data.items : [];
    const byId = new Map(scheduleNetworkSettings.map((item) => [item.id, item]));
    scheduleItems = scheduleItems.map((item) => byId.get(item.id) || item);
    renderScheduleWorkspace();
  } catch {
    scheduleNetworkEnabled = false;
    scheduleNetworkSettings = [];
  }
};
