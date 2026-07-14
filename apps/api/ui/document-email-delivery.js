let documentEmailRenderToken = 0;
let documentEmailBusy = false;
let documentEmailPollTimer = null;
let documentEmailPollToken = 0;

function clearDocumentEmailPolling() {
  documentEmailPollToken += 1;
  if (documentEmailPollTimer !== null) {
    clearTimeout(documentEmailPollTimer);
    documentEmailPollTimer = null;
  }
}

function documentEmailStateLabel(delivery) {
  if (delivery.state === "completed") return "Отправлено";
  if (delivery.state === "failed") return "Ошибка";
  if (delivery.state === "retry" || delivery.workerJobState === "retry") {
    return "Повтор ожидается";
  }
  if (delivery.state === "running" || delivery.workerJobState === "running") {
    return "Отправляется";
  }
  return "В очереди";
}

function documentEmailStateClass(delivery) {
  if (delivery.state === "completed") return "is-success";
  if (delivery.state === "failed") return "is-error";
  if (delivery.state === "retry") return "is-warning";
  return "is-pending";
}

function documentEmailError(delivery) {
  const value = delivery?.error;
  if (value && typeof value === "object" && typeof value.message === "string") {
    return value.message;
  }
  return "Почтовая отправка не завершена.";
}

function documentEmailDetails(delivery) {
  if (delivery.state === "completed") {
    return `Message-ID: ${delivery.messageId}`;
  }
  if (delivery.state === "failed") return documentEmailError(delivery);
  if (delivery.state === "retry") {
    return `Попытка ${delivery.attempts} из ${delivery.maxAttempts}. Следующая: ${new Date(delivery.nextAttemptAt).toLocaleString("ru-RU")}.`;
  }
  return `Попытка ${delivery.attempts} из ${delivery.maxAttempts}.`;
}

function renderDocumentEmailHistory(deliveries) {
  if (!Array.isArray(deliveries) || deliveries.length === 0) {
    return `<div class="generation-history-empty">Результат ещё не отправлялся по электронной почте.</div>`;
  }
  return deliveries
    .map(
      (delivery) => `
        <article class="generation-history-item ${documentEmailStateClass(delivery)}">
          <div>
            <span class="generation-state-code">${generationEscape(documentEmailStateLabel(delivery))}</span>
            <strong>${generationEscape(delivery.recipientName ? `${delivery.recipientName} <${delivery.recipientEmail}>` : delivery.recipientEmail)}</strong>
            <span>${generationEscape(delivery.subject)}</span>
            <span>${generationEscape(documentEmailDetails(delivery))}</span>
          </div>
          <div class="generation-history-actions">
            <span>${generationEscape(new Date(delivery.requestedAt).toLocaleString("ru-RU"))}</span>
          </div>
        </article>`
    )
    .join("");
}

function allowedDomainText(domains) {
  if (!Array.isArray(domains) || domains.length === 0) return "не заданы";
  if (domains.includes("*")) return "любые домены";
  return domains.join(", ");
}

async function pollDocumentEmailDelivery(job, deliveryId, token = null) {
  const pollToken = token ?? ++documentEmailPollToken;
  try {
    const body = await generationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(job.spaceId)}/document-jobs/${encodeURIComponent(job.id)}/email-deliveries/${encodeURIComponent(deliveryId)}`
    );
    const delivery = body.data;
    await appendDocumentEmailPanel(job);
    if (["completed", "failed"].includes(delivery.state)) {
      clearDocumentEmailPolling();
      return;
    }
    documentEmailPollTimer = setTimeout(() => {
      if (pollToken === documentEmailPollToken) {
        void pollDocumentEmailDelivery(job, deliveryId, pollToken);
      }
    }, 1_500);
  } catch (error) {
    clearDocumentEmailPolling();
    const panel = document.querySelector("#documentEmailDeliveryPanel");
    const message = panel?.querySelector("#documentEmailMessage");
    if (message) {
      message.className = "is-error";
      message.textContent = error?.message || "Состояние письма получить не удалось.";
    }
  }
}

async function sendDocumentEmail(job, panel) {
  if (documentEmailBusy || generationBusy) return;
  const email = panel.querySelector("#documentEmailRecipient");
  const name = panel.querySelector("#documentEmailRecipientName");
  const subject = panel.querySelector("#documentEmailSubject");
  const text = panel.querySelector("#documentEmailText");
  const button = panel.querySelector("#documentEmailSubmit");
  const message = panel.querySelector("#documentEmailMessage");
  if (!email || !name || !subject || !text || !button || !message) return;
  documentEmailBusy = true;
  button.disabled = true;
  message.className = "is-loading";
  message.textContent = "Ставим письмо в очередь фоновой отправки…";
  try {
    const body = await generationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(job.spaceId)}/document-jobs/${encodeURIComponent(job.id)}/deliver/email`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipientEmail: email.value,
          ...(name.value.trim() ? { recipientName: name.value.trim() } : {}),
          subject: subject.value,
          messageText: text.value
        })
      }
    );
    const delivery = body.data.delivery;
    message.className = "is-success";
    message.textContent = body.data.created
      ? "Письмо поставлено в очередь. Состояние обновляется автоматически."
      : "Такое же письмо уже было поставлено в очередь ранее. Показываем существующую операцию.";
    clearDocumentEmailPolling();
    await pollDocumentEmailDelivery(job, delivery.id);
  } catch (error) {
    message.className = "is-error";
    message.textContent = error?.message || "Письмо не поставлено в очередь.";
  } finally {
    documentEmailBusy = false;
    button.disabled = false;
  }
}

async function appendDocumentEmailPanel(job) {
  const holder = document.querySelector("#documentGenerationStatus");
  if (
    !holder ||
    !job ||
    !["completed", "partial"].includes(job.state) ||
    job.generatedCount < 1
  ) {
    return;
  }
  const token = ++documentEmailRenderToken;
  try {
    const body = await generationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(job.spaceId)}/document-jobs/${encodeURIComponent(job.id)}/email-deliveries`
    );
    if (token !== documentEmailRenderToken) return;
    holder.querySelector("#documentEmailDeliveryPanel")?.remove();
    const smtp = body.data.smtp;
    const panel = document.createElement("section");
    panel.id = "documentEmailDeliveryPanel";
    panel.className = "generation-history document-email-panel";
    const defaultSubject = `Документы: ${job.templateTitle}`;
    const defaultText = `Документы сформированы в Docomator.\n\nРезультат находится во вложении.`;
    panel.innerHTML = `
      <div class="generation-history-heading">
        <div><p class="eyebrow">Доставка</p><h3>Отправить результат по электронной почте</h3></div>
      </div>
      ${smtp.enabled ? `
        <div class="document-email-grid">
          <label class="generation-field">
            <span>Электронная почта получателя</span>
            <input id="documentEmailRecipient" type="email" maxlength="254" autocomplete="email" placeholder="name@example.org" />
            <small>Разрешённые домены: ${generationEscape(allowedDomainText(smtp.allowedDomains))}.</small>
          </label>
          <label class="generation-field">
            <span>Имя получателя</span>
            <input id="documentEmailRecipientName" type="text" maxlength="200" autocomplete="name" placeholder="Необязательно" />
            <small>Имя используется только в заголовке письма.</small>
          </label>
          <label class="generation-field document-email-wide">
            <span>Тема письма</span>
            <input id="documentEmailSubject" type="text" maxlength="300" value="${generationEscape(defaultSubject)}" />
          </label>
          <label class="generation-field document-email-wide">
            <span>Текст письма</span>
            <textarea id="documentEmailText" rows="5" maxlength="20000">${generationEscape(defaultText)}</textarea>
            <small>Во вложение попадёт ${job.archiveSha256 ? "ZIP-комплект" : "готовый документ"}. Предельный размер: ${Math.floor(smtp.maxAttachmentBytes / 1024 / 1024)} МБ.</small>
          </label>
        </div>
        <div class="generation-actions">
          <button class="primary-button" id="documentEmailSubmit" type="button">Отправить письмо</button>
          <p id="documentEmailMessage">Отправитель: ${generationEscape(smtp.fromName)} &lt;${generationEscape(smtp.fromAddress)}&gt;. Пароль и параметры сервера в интерфейс не передаются.</p>
        </div>` : `
        <div class="generation-state is-warning"><span aria-hidden="true">✉️</span><div><strong>Почтовая доставка не настроена</strong><p>Администратору необходимо включить <code>DOCOMATOR_SMTP_ENABLED</code>, задать отправителя и разрешённые домены.</p></div></div>`}
      <div class="generation-history-list">
        ${renderDocumentEmailHistory(body.data.deliveries)}
      </div>`;
    holder.append(panel);
    panel
      .querySelector("#documentEmailSubmit")
      ?.addEventListener("click", () => sendDocumentEmail(job, panel));
  } catch (error) {
    if (token !== documentEmailRenderToken) return;
    holder.insertAdjacentHTML(
      "beforeend",
      `<div class="generation-state is-error"><span aria-hidden="true">⚠️</span><div><strong>Состояние почтовой доставки получить не удалось</strong><p>${generationEscape(error?.message || "Повторите открытие задания.")}</p></div></div>`
    );
  }
}

const baseRenderGenerationJobWithEmail = renderGenerationJob;
renderGenerationJob = function renderGenerationJobWithEmail(payload) {
  baseRenderGenerationJobWithEmail(payload);
  void appendDocumentEmailPanel(payload?.job);
};

window.addEventListener("beforeunload", clearDocumentEmailPolling);
