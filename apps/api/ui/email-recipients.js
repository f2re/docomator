let emailRecipientsCache = [];
let emailRecipientsBusy = false;
let emailRecipientsRenderToken = 0;

async function loadEmailRecipients(spaceId, includeInactive = true) {
  const query = includeInactive ? "?includeInactive=true" : "";
  const body = await generationFetchJson(
    `/api/v1/spaces/${encodeURIComponent(spaceId)}/email-recipients${query}`
  );
  emailRecipientsCache = Array.isArray(body.data) ? body.data : [];
  return emailRecipientsCache;
}

function activeEmailRecipients() {
  return emailRecipientsCache.filter((recipient) => recipient.status === "active");
}

function fillEmailRecipient(panel, recipientId) {
  const recipient = emailRecipientsCache.find(
    (candidate) => candidate.id === recipientId
  );
  if (!recipient) return;
  const email = panel.querySelector("#documentEmailRecipient");
  const name = panel.querySelector("#documentEmailRecipientName");
  const description = panel.querySelector("#emailRecipientDescription");
  if (email) email.value = recipient.email;
  if (name) name.value = recipient.name;
  if (description) description.value = recipient.description || "";
}

function renderEmailRecipientOptions(panel) {
  const select = panel.querySelector("#savedEmailRecipient");
  if (!select) return;
  const previous = select.value;
  const active = activeEmailRecipients();
  select.innerHTML = `
    <option value="">Ввести адрес вручную</option>
    ${active
      .map(
        (recipient) =>
          `<option value="${generationEscape(recipient.id)}">${generationEscape(recipient.name)} · ${generationEscape(recipient.email)}</option>`
      )
      .join("")}`;
  if (active.some((recipient) => recipient.id === previous)) {
    select.value = previous;
  }
}

function renderEmailRecipientList(panel) {
  const holder = panel.querySelector("#emailRecipientList");
  if (!holder) return;
  if (emailRecipientsCache.length === 0) {
    holder.innerHTML = `<div class="generation-history-empty">Сохранённых получателей пока нет.</div>`;
    return;
  }
  holder.innerHTML = emailRecipientsCache
    .map(
      (recipient) => `
        <article class="email-recipient-item ${recipient.status === "inactive" ? "is-inactive" : ""}">
          <div>
            <span class="generation-state-code">${recipient.status === "active" ? "Активен" : "Отключён"}</span>
            <strong>${generationEscape(recipient.name)}</strong>
            <span>${generationEscape(recipient.email)}</span>
            ${recipient.description ? `<span>${generationEscape(recipient.description)}</span>` : ""}
          </div>
          <div class="generation-history-actions">
            <button class="secondary-button" type="button" data-recipient-use="${generationEscape(recipient.id)}">Выбрать</button>
            <button class="secondary-button" type="button" data-recipient-status="${generationEscape(recipient.id)}" data-next-status="${recipient.status === "active" ? "inactive" : "active"}">${recipient.status === "active" ? "Отключить" : "Включить"}</button>
          </div>
        </article>`
    )
    .join("");
  holder.querySelectorAll("[data-recipient-use]").forEach((button) =>
    button.addEventListener("click", () => {
      fillEmailRecipient(panel, button.dataset.recipientUse || "");
      const select = panel.querySelector("#savedEmailRecipient");
      if (select) select.value = button.dataset.recipientUse || "";
      panel.querySelector("#documentEmailRecipient")?.focus();
    })
  );
  holder.querySelectorAll("[data-recipient-status]").forEach((button) =>
    button.addEventListener("click", () =>
      updateEmailRecipientStatus(
        panel,
        button.dataset.recipientStatus || "",
        button.dataset.nextStatus || "inactive"
      )
    )
  );
}

async function updateEmailRecipientStatus(panel, recipientId, status) {
  if (emailRecipientsBusy || !recipientId) return;
  const message = panel.querySelector("#emailRecipientMessage");
  emailRecipientsBusy = true;
  if (message) {
    message.className = "is-loading";
    message.textContent = status === "active" ? "Включаем получателя…" : "Отключаем получателя…";
  }
  try {
    await generationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(currentGenerationSpaceId())}/email-recipients/${encodeURIComponent(recipientId)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status })
      }
    );
    await loadEmailRecipients(currentGenerationSpaceId(), true);
    renderEmailRecipientOptions(panel);
    renderEmailRecipientList(panel);
    if (message) {
      message.className = "is-success";
      message.textContent = status === "active" ? "Получатель включён." : "Получатель отключён без удаления истории.";
    }
  } catch (error) {
    if (message) {
      message.className = "is-error";
      message.textContent = error?.message || "Состояние получателя не изменено.";
    }
  } finally {
    emailRecipientsBusy = false;
  }
}

async function saveEmailRecipient(panel) {
  if (emailRecipientsBusy) return;
  const email = panel.querySelector("#documentEmailRecipient");
  const name = panel.querySelector("#documentEmailRecipientName");
  const description = panel.querySelector("#emailRecipientDescription");
  const button = panel.querySelector("#emailRecipientSave");
  const message = panel.querySelector("#emailRecipientMessage");
  if (!email || !name || !description || !button || !message) return;
  const recipientEmail = email.value.trim();
  const recipientName = name.value.trim();
  if (!recipientEmail || !recipientName) {
    message.className = "is-error";
    message.textContent = "Для сохранения заполните имя и электронную почту.";
    return;
  }
  emailRecipientsBusy = true;
  button.disabled = true;
  message.className = "is-loading";
  message.textContent = "Сохраняем получателя в текущем пространстве…";
  try {
    const body = await generationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(currentGenerationSpaceId())}/email-recipients`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: recipientName,
          email: recipientEmail,
          ...(description.value.trim()
            ? { description: description.value.trim() }
            : {})
        })
      }
    );
    await loadEmailRecipients(currentGenerationSpaceId(), true);
    renderEmailRecipientOptions(panel);
    renderEmailRecipientList(panel);
    const select = panel.querySelector("#savedEmailRecipient");
    if (select) select.value = body.data.id;
    message.className = "is-success";
    message.textContent = "Получатель сохранён и доступен для следующих выпусков.";
  } catch (error) {
    message.className = "is-error";
    message.textContent = error?.message || "Получатель не сохранён.";
  } finally {
    emailRecipientsBusy = false;
    button.disabled = false;
  }
}

async function enhanceEmailRecipientPanel(job) {
  const panel = document.querySelector("#documentEmailDeliveryPanel");
  if (!panel || panel.querySelector("#emailRecipientManager")) return;
  const token = ++emailRecipientsRenderToken;
  try {
    await loadEmailRecipients(job.spaceId, true);
    if (token !== emailRecipientsRenderToken) return;
    const form = panel.querySelector(".document-email-grid");
    if (!form) return;
    const manager = document.createElement("section");
    manager.id = "emailRecipientManager";
    manager.className = "email-recipient-manager document-email-wide";
    manager.innerHTML = `
      <div class="email-recipient-select-row">
        <label class="generation-field">
          <span>Сохранённый получатель</span>
          <select id="savedEmailRecipient"><option value="">Ввести адрес вручную</option></select>
          <small>Получатели относятся к текущему пространству.</small>
        </label>
        <label class="generation-field document-email-wide">
          <span>Описание получателя</span>
          <input id="emailRecipientDescription" type="text" maxlength="2000" placeholder="Например: бухгалтерия головного офиса" />
        </label>
      </div>
      <div class="generation-actions email-recipient-actions">
        <button class="secondary-button" id="emailRecipientSave" type="button">Сохранить текущий адрес</button>
        <p id="emailRecipientMessage">Изменение карточки не меняет адрес в уже созданных отправках.</p>
      </div>
      <details class="email-recipient-details">
        <summary>Управление сохранёнными получателями (${emailRecipientsCache.length})</summary>
        <div id="emailRecipientList" class="email-recipient-list"></div>
      </details>`;
    form.prepend(manager);
    renderEmailRecipientOptions(panel);
    renderEmailRecipientList(panel);
    manager
      .querySelector("#savedEmailRecipient")
      ?.addEventListener("change", (event) =>
        fillEmailRecipient(panel, event.target.value)
      );
    manager
      .querySelector("#emailRecipientSave")
      ?.addEventListener("click", () => saveEmailRecipient(panel));
  } catch (error) {
    panel.insertAdjacentHTML(
      "beforeend",
      `<div class="generation-state is-error"><span aria-hidden="true">⚠️</span><div><strong>Получателей загрузить не удалось</strong><p>${generationEscape(error?.message || "Повторите открытие задания.")}</p></div></div>`
    );
  }
}

const baseAppendDocumentEmailPanelWithRecipients = appendDocumentEmailPanel;
appendDocumentEmailPanel = async function appendDocumentEmailPanelWithRecipients(job) {
  await baseAppendDocumentEmailPanelWithRecipients(job);
  await enhanceEmailRecipientPanel(job);
};
