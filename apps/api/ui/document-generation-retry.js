let generationRetryBusy = false;

async function retryFailedGeneration(job) {
  if (generationRetryBusy || generationBusy) return;
  const holder = document.querySelector("#documentGenerationStatus");
  if (!holder) return;
  generationRetryBusy = true;
  holder.insertAdjacentHTML(
    "afterbegin",
    `<div class="generation-state is-pending" id="generationRetryProgress" role="status"><span aria-hidden="true">⏳</span><div><strong>Создаём повторное задание</strong><p>В новый выпуск войдут только проблемные участники. Готовые файлы исходного задания не изменяются.</p></div></div>`
  );
  try {
    const body = await generationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(job.spaceId)}/document-jobs/${encodeURIComponent(job.id)}/retry-failed`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: newGenerationKey() })
      }
    );
    const repeated = body.data.job;
    holder.innerHTML = `<div class="generation-state is-pending"><span aria-hidden="true">⏳</span><div><strong>Повторное задание создано</strong><p>Проблемных результатов: ${body.data.retriedUnitCount}. Отслеживаем новое задание отдельно от исходного.</p></div></div>`;
    await pollGenerationJob(repeated.id);
  } catch (error) {
    document.querySelector("#generationRetryProgress")?.remove();
    holder.insertAdjacentHTML(
      "afterbegin",
      `<div class="generation-state is-error"><span aria-hidden="true">⛔</span><div><strong>Повтор не запущен</strong><p>${generationEscape(error?.message || "Повторите действие.")}</p>${error?.operationId ? `<small>Идентификатор операции: <code>${generationEscape(error.operationId)}</code>.</small>` : ""}</div></div>`
    );
  } finally {
    generationRetryBusy = false;
  }
}

const baseRenderGenerationJobWithRetry = renderGenerationJob;
renderGenerationJob = function renderGenerationJobWithRetry(payload) {
  baseRenderGenerationJobWithRetry(payload);
  const job = payload?.job;
  const holder = document.querySelector("#documentGenerationStatus");
  if (
    !job ||
    !holder ||
    job.failedCount < 1 ||
    !["partial", "failed"].includes(job.state)
  ) {
    return;
  }
  const actions = document.createElement("div");
  actions.className = "generation-state is-warning";
  actions.innerHTML = `
    <span aria-hidden="true">↻</span>
    <div>
      <strong>Можно повторить только проблемные результаты</strong>
      <p>Будет создано новое задание для ${job.failedCount} неуспешных строк. Уже готовые документы исходного выпуска останутся без изменений.</p>
      <div class="generation-downloads"><button class="primary-button" id="generationRetryFailed" type="button">Повторить ошибки (${job.failedCount})</button></div>
    </div>`;
  holder.append(actions);
  actions
    .querySelector("#generationRetryFailed")
    ?.addEventListener("click", () => retryFailedGeneration(job));
};
