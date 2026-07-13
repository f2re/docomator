let documentDeliveryRenderToken = 0;
let documentDeliveryBusy = false;

function documentDeliveryStateLabel(state) {
  return (
    {
      pending: "Выполняется",
      completed: "Доставлено",
      failed: "Ошибка"
    }[state] || "Неизвестно"
  );
}

function documentDeliveryError(delivery) {
  const value = delivery?.error;
  if (value && typeof value === "object" && typeof value.message === "string") {
    return value.message;
  }
  return "Доставка не завершена.";
}

function renderDocumentDeliveryHistory(deliveries) {
  if (!Array.isArray(deliveries) || deliveries.length === 0) {
    return `<div class="generation-history-empty">Результат ещё не передавался в сетевую папку.</div>`;
  }
  return deliveries
    .map(
      (delivery) => `
        <article class="generation-history-item">
          <div>
            <span class="generation-state-code">${generationEscape(documentDeliveryStateLabel(delivery.state))}</span>
            <strong>${generationEscape(delivery.destinationRelative)}</strong>
            <span>${delivery.state === "completed" ? `Файл: ${generationEscape(delivery.deliveredName || "сохранён")}` : generationEscape(documentDeliveryError(delivery))}</span>
          </div>
          <div class="generation-history-actions"><span>${generationEscape(new Date(delivery.requestedAt).toLocaleString("ru-RU"))}</span></div>
        </article>`
    )
    .join("");
}

async function deliverDocumentToNetworkFolder(job, panel) {
  if (documentDeliveryBusy || generationBusy) return;
  const input = panel.querySelector("#documentDeliverySubdirectory");
  const button = panel.querySelector("#documentDeliverySubmit");
  const message = panel.querySelector("#documentDeliveryMessage");
  if (!input || !button || !message) return;
  documentDeliveryBusy = true;
  button.disabled = true;
  message.className = "is-loading";
  message.textContent = "Записываем результат в разрешённую сетевую папку…";
  try {
    const body = await generationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(job.spaceId)}/document-jobs/${encodeURIComponent(job.id)}/deliver/network-folder`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subdirectory: input.value })
      }
    );
    const delivery = body.data.delivery;
    message.className = "is-success";
    message.textContent = `Доставлено: ${delivery.destinationRelative}/${delivery.deliveredName}.`;
    await appendDocumentDeliveryPanel(job);
  } catch (error) {
    message.className = "is-error";
    message.textContent = error?.message || "Доставка не выполнена.";
  } finally {
    documentDeliveryBusy = false;
    button.disabled = false;
  }
}

async function appendDocumentDeliveryPanel(job) {
  const holder = document.querySelector("#documentGenerationStatus");
  if (!holder || !job || !["completed", "partial"].includes(job.state) || job.generatedCount < 1) {
    return;
  }
  const token = ++documentDeliveryRenderToken;
  try {
    const body = await generationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(job.spaceId)}/document-jobs/${encodeURIComponent(job.id)}/deliveries`
    );
    if (token !== documentDeliveryRenderToken) return;
    holder.querySelector("#documentDeliveryPanel")?.remove();
    const panel = document.createElement("section");
    panel.id = "documentDeliveryPanel";
    panel.className = "generation-history";
    panel.innerHTML = `
      <div class="generation-history-heading">
        <div><p class="eyebrow">Доставка</p><h3>Передать результат в сетевую папку</h3></div>
      </div>
      ${body.data.networkFolderEnabled ? `
        <div class="generation-form-grid">
          <label class="generation-field">
            <span>Вложенный каталог</span>
            <input id="documentDeliverySubdirectory" type="text" maxlength="500" value="Документы" placeholder="Например: Отдел кадров/2026" />
            <small>Абсолютный корень задаёт администратор. Вы можете указать только каталог внутри разрешённой папки.</small>
          </label>
          <div class="generation-field">
            <span>Что будет передано</span>
            <div class="generation-mode-note"><span aria-hidden="true">📁</span><div><strong>${job.archiveSha256 ? "Комплект ZIP" : "Готовый документ"}</strong><p>Исходный результат и его контрольная сумма не изменяются.</p></div></div>
          </div>
        </div>
        <div class="generation-actions">
          <button class="primary-button" id="documentDeliverySubmit" type="button">Передать в сетевую папку</button>
          <p id="documentDeliveryMessage">Передача выполняется атомарно и фиксируется в журнале.</p>
        </div>` : `
        <div class="generation-state is-warning"><span aria-hidden="true">⚙️</span><div><strong>Сетевая папка не настроена</strong><p>Администратору необходимо задать <code>DOCOMATOR_NETWORK_DELIVERY_ROOT</code> и предоставить службе права записи.</p></div></div>`}
      <div class="generation-history-list">
        ${renderDocumentDeliveryHistory(body.data.deliveries)}
      </div>`;
    holder.append(panel);
    panel
      .querySelector("#documentDeliverySubmit")
      ?.addEventListener("click", () => deliverDocumentToNetworkFolder(job, panel));
  } catch (error) {
    if (token !== documentDeliveryRenderToken) return;
    holder.insertAdjacentHTML(
      "beforeend",
      `<div class="generation-state is-error"><span aria-hidden="true">⚠️</span><div><strong>Состояние доставки получить не удалось</strong><p>${generationEscape(error?.message || "Повторите открытие задания.")}</p></div></div>`
    );
  }
}

const baseRenderGenerationJobWithDelivery = renderGenerationJob;
renderGenerationJob = function renderGenerationJobWithDelivery(payload) {
  baseRenderGenerationJobWithDelivery(payload);
  void appendDocumentDeliveryPanel(payload?.job);
};
